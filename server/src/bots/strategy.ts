import { cardId, rankValue, type Card, type Suit } from "../game/cards.js";
import { legalCards, type GameState, type PlayedCardEvent, type TrickCard } from "../game/engine.js";
import {
  buildKnowledge,
  contiguousTopTrumpCount,
  higherCards,
  probabilityNone,
  type CardKnowledge,
} from "./knowledge.js";
import { rolloutBidEstimates, rolloutCardUtilities } from "./rollout.js";
import type { BotKind } from "./types.js";

/** Fair information boundary: own cards plus facts every person at the table has
 * seen. Opponent hands and undealt cards never cross this boundary. */
export interface BotView {
  botId: string;
  kind: BotKind;
  hand: Card[];
  legalCards: Card[];
  round: number;
  cardsThisRound: number;
  trumpSuit: Suit;
  dealerDeviceId: string;
  seatOrder: string[];
  turnSeat: number;
  phase: GameState["phase"];
  bids: Record<string, number | null>;
  tricksWon: Record<string, number>;
  currentTrick: TrickCard[];
  playedCards: PlayedCardEvent[];
  historyComplete: boolean;
  voidSuits: Record<string, Suit[]>;
  handCounts: Record<string, number>;
  scores: Record<string, number>;
}

export function viewForBot(state: GameState, botId: string, kind: BotKind): BotView {
  return {
    botId,
    kind,
    hand: [...(state.hands[botId] ?? [])],
    legalCards: legalCards(state, botId),
    round: state.round,
    cardsThisRound: state.cardsThisRound,
    trumpSuit: state.trumpSuit,
    dealerDeviceId: state.seatOrder[state.dealerSeat],
    seatOrder: [...state.seatOrder],
    turnSeat: state.turnSeat,
    phase: state.phase,
    bids: { ...state.bids },
    tricksWon: { ...state.tricksWon },
    currentTrick: state.currentTrick.map((play) => ({ ...play, card: { ...play.card } })),
    playedCards: (state.playHistory?.plays ?? []).map((play) => ({ ...play, card: { ...play.card } })),
    historyComplete: state.playHistory?.complete ?? false,
    voidSuits: Object.fromEntries(
      state.seatOrder.map((id) => [id, [...(state.voidSuits?.[id] ?? [])]]),
    ),
    handCounts: Object.fromEntries(Object.entries(state.hands).map(([id, hand]) => [id, hand.length])),
    scores: { ...state.scores },
  };
}

function hash(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function deterministicNoise(view: BotView, salt: string): number {
  const cards = view.hand.map(cardId).sort().join(",");
  const history = view.playedCards.map((play) => cardId(play.card)).join(",");
  return (hash(`${view.botId}|${view.round}|${cards}|${history}|${view.currentTrick.length}|${salt}`) % 10_000) / 10_000;
}

function knowledgeFor(view: BotView): CardKnowledge {
  return buildKnowledge({
    botId: view.botId,
    hand: view.hand,
    trumpSuit: view.trumpSuit,
    seatOrder: view.seatOrder,
    turnSeat: view.turnSeat,
    playedCards: view.playedCards,
    currentTrick: view.currentTrick,
    voidSuits: view.voidSuits,
    handCounts: view.handCounts,
  });
}

function hypergeomHas(population: number, successes: number, draws: number): number {
  return 1 - probabilityNone(population, successes, Math.min(draws, population));
}

function clampProbability(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

/** Chance that a card eventually wins when it is led, using every publicly known
 * card, exact opponent hand sizes, known void suits and undealt-card probability. */
function leadWinChance(card: Card, view: BotView, knowledge: CardKnowledge): number {
  const population = knowledge.unseenCards.length;
  if (population === 0) return 1;
  const opponentSlots = Math.min(knowledge.opponentSlots, population);
  const higher = higherCards(knowledge.unseenCards, card).length;

  if (card.suit === view.trumpSuit) return probabilityNone(population, higher, opponentSlots);

  const survivesHigher = probabilityNone(population, higher, opponentSlots);
  const remainingSuit = knowledge.remainingBySuit[card.suit].length;
  const remainingTrump = knowledge.remainingBySuit[view.trumpSuit].length;
  let noCut = 1;
  for (const id of view.seatOrder) {
    if (id === view.botId) continue;
    const cards = view.handCounts[id] ?? view.hand.length;
    const knownVoid = knowledge.voidSuits[id]?.has(card.suit) ?? false;
    const voidChance = knownVoid ? 1 : probabilityNone(population, remainingSuit, cards);
    const trumpChance = knowledge.voidSuits[id]?.has(view.trumpSuit)
      ? 0
      : hypergeomHas(population, remainingTrump, cards);
    noCut *= 1 - voidChance * trumpChance * 0.88;
  }
  return clampProbability(survivesHigher * noCut);
}

/** Trump cards whose every higher trump is already held by us or publicly played
 * form a guaranteed sequence: A; A-K; A-K-Q; or K after the ace has appeared. */
function guaranteedTrumpCards(view: BotView, knowledge: CardKnowledge): Card[] {
  return view.hand.filter((card) =>
    card.suit === view.trumpSuit &&
    !knowledge.unseenCards.some(
      (candidate) => candidate.suit === view.trumpSuit && rankValue(candidate.rank) > rankValue(card.rank),
    ),
  );
}

function cardBidChance(card: Card, view: BotView, knowledge: CardKnowledge): number {
  if (guaranteedTrumpCards(view, knowledge).some((candidate) => cardId(candidate) === cardId(card))) return 1;
  let chance = leadWinChance(card, view, knowledge);
  const suitLength = view.hand.filter((candidate) => candidate.suit === card.suit).length;
  if (card.suit !== view.trumpSuit) {
    chance *= Math.max(0.45, 1 - Math.max(0, suitLength - 2) * 0.11);
  }
  return clampProbability(chance);
}

function exactWinDistribution(probabilities: number[]): number[] {
  let distribution = [1];
  for (const rawProbability of probabilities) {
    const probability = clampProbability(rawProbability);
    const next = Array(distribution.length + 1).fill(0) as number[];
    distribution.forEach((value, won) => {
      next[won] += value * (1 - probability);
      next[won + 1] += value * probability;
    });
    distribution = next;
  }
  return distribution;
}

export function legalBids(view: BotView): number[] {
  const bids = Array.from({ length: view.cardsThisRound + 2 }, (_, index) => index);
  if (view.botId !== view.dealerDeviceId) return bids;
  const others = Object.entries(view.bids).reduce(
    (sum, [id, bid]) => sum + (id === view.botId || bid === null ? 0 : bid),
    0,
  );
  const forbidden = view.cardsThisRound - others;
  return bids.filter((bid) => bid !== forbidden);
}

function bidSignalAdjustment(view: BotView): number {
  const prior = view.seatOrder
    .filter((id) => id !== view.botId && view.bids[id] !== null)
    .map((id) => view.bids[id] ?? 0);
  if (prior.length === 0) return 0;
  const expectedShare = view.cardsThisRound / view.seatOrder.length;
  const average = prior.reduce((sum, bid) => sum + bid, 0) / prior.length;
  return Math.max(-0.75, Math.min(0.55, (expectedShare - average) * 0.22));
}

function structuralBidBonus(view: BotView): number {
  const trumpCount = view.hand.filter((card) => card.suit === view.trumpSuit).length;
  let bonus = 0;
  for (const suit of ["S", "H", "C", "D"] as Suit[]) {
    if (suit === view.trumpSuit) continue;
    const count = view.hand.filter((card) => card.suit === suit).length;
    if (count === 0 && trumpCount > 0) bonus += Math.min(0.3, trumpCount * 0.08);
    else if (count === 1 && trumpCount > 0) bonus += Math.min(0.2, trumpCount * 0.05);
  }
  return bonus;
}

export function chooseBid(view: BotView): number {
  const allowed = legalBids(view);
  const knowledge = knowledgeFor(view);
  const guaranteed = guaranteedTrumpCards(view, knowledge).length;
  const probabilities = view.hand.map((card) => cardBidChance(card, view, knowledge));
  const distribution = exactWinDistribution(probabilities);
  const rawExpected = probabilities.reduce((sum, chance) => sum + chance, 0);
  const expected = Math.min(
    view.cardsThisRound,
    Math.max(guaranteed, rawExpected + structuralBidBonus(view) + bidSignalAdjustment(view)),
  );
  const minimumSensible = Math.min(guaranteed, view.cardsThisRound);
  const minScore = Math.min(...Object.values(view.scores));
  const trailing = (view.scores[view.botId] ?? 0) === minScore && view.round >= 6;
  const rolloutSamples = view.kind === "ustaad" ? 10 : 0;
  const rollout = rolloutSamples > 0 ? rolloutBidEstimates(view, allowed, rolloutSamples) : new Map();

  const scored = allowed.map((bid) => {
    const exactFromCards = distribution[bid] ?? 0;
    const estimate = rollout.get(bid);
    // Ustaad's exact-contract confidence comes from completed hidden-hand rollouts.
    // Other personalities retain the lightweight independent-card approximation.
    const exact = estimate && estimate.effectiveSamples >= 4
      ? estimate.exactRate
      : clampProbability(exactFromCards);
    const expectedRoundScore = bid + exact * 10 * (bid + 1);
    const impossibleGrace = bid === view.cardsThisRound + 1;
    let score = expectedRoundScore - Math.abs(bid - expected) * 2.2;

    if (bid < minimumSensible) score -= 1_000;
    if (impossibleGrace) score -= view.kind === "shaitaan" && trailing ? 3 : 25;
    if (!view.historyComplete) score -= Math.abs(bid - Math.floor(expected)) * 1.5;
    if (view.kind === "bhola") score -= Math.abs(bid - Math.round(expected)) * 1.5;
    if (view.kind === "hisaabi") score += exact * 12 - Math.max(0, bid - expected) * 2.5;
    if (view.kind === "shaitaan") score += exact * 5 + (trailing ? bid * 0.8 : 0);
    if (view.kind === "ustaad") score += exact * 18 - Math.abs(bid - expected) * 1.5 + (trailing ? bid * 0.25 : 0);
    if (estimate && estimate.effectiveSamples >= 4) {
      const weight = 1.15;
      score += estimate.utility * weight;
    }
    return { bid, score: Number.isFinite(score) ? score : -10_000 };
  });
  scored.sort((a, b) => b.score - a.score || Math.abs(a.bid - expected) - Math.abs(b.bid - expected) || a.bid - b.bid);

  if (view.kind === "bhola" && scored.length > 1 && deterministicNoise(view, "bid") < 0.24) {
    const alternative = scored.find((candidate, index) => index > 0 && candidate.bid >= minimumSensible);
    if (alternative) return alternative.bid;
  }
  return scored[0].bid;
}

function trickWinner(trick: TrickCard[], leadSuit: Suit, trumpSuit: Suit): TrickCard {
  const trumps = trick.filter((play) => play.card.suit === trumpSuit);
  const pool = trumps.length > 0 ? trumps : trick.filter((play) => play.card.suit === leadSuit);
  return pool.reduce((best, play) => rankValue(play.card.rank) > rankValue(best.card.rank) ? play : best);
}

function currentlyWins(card: Card, view: BotView): boolean {
  const trick = [...view.currentTrick, { deviceId: view.botId, card }];
  return trickWinner(trick, trick[0].card.suit, view.trumpSuit).deviceId === view.botId;
}

function winChanceNow(card: Card, view: BotView, knowledge: CardKnowledge): number {
  if (view.currentTrick.length === 0) return leadWinChance(card, view, knowledge);
  if (!currentlyWins(card, view)) return 0;
  if (knowledge.opponentsAfter.length === 0) return 1;

  const leadSuit = view.currentTrick[0].card.suit;
  const population = knowledge.unseenCards.length;
  if (population === 0) return 1;
  let survive = 1;
  if (card.suit === view.trumpSuit) {
    const higherTrump = knowledge.unseenCards.filter(
      (candidate) => candidate.suit === view.trumpSuit && rankValue(candidate.rank) > rankValue(card.rank),
    ).length;
    const remainingLead = knowledge.remainingBySuit[leadSuit].length;
    for (const id of knowledge.opponentsAfter) {
      const draws = Math.min(population, view.handCounts[id] ?? 0);
      let threat: number;
      if (leadSuit === view.trumpSuit || knowledge.voidSuits[id]?.has(leadSuit)) {
        threat = hypergeomHas(population, higherTrump, draws);
      } else {
        // A player holding the led non-trump suit must follow it, even if they also
        // hold a higher trump. They threaten only when jointly void in lead and in
        // possession of a higher trump.
        const noLead = probabilityNone(population, remainingLead, draws);
        const noLeadOrHigherTrump = probabilityNone(population, remainingLead + higherTrump, draws);
        threat = noLead - noLeadOrHigherTrump;
      }
      survive *= 1 - clampProbability(threat);
    }
    return clampProbability(survive);
  }
  if (card.suit !== leadSuit) return 0;

  const higherLead = higherCards(knowledge.unseenCards, card).length;
  const trumps = knowledge.remainingBySuit[view.trumpSuit].length;
  for (const id of knowledge.opponentsAfter) {
    const draws = Math.min(population, view.handCounts[id] ?? 0);
    const knownVoidLead = knowledge.voidSuits[id]?.has(leadSuit) ?? false;
    const knownVoidTrump = knowledge.voidSuits[id]?.has(view.trumpSuit) ?? false;
    const higherLeadThreat = knownVoidLead ? 0 : hypergeomHas(population, higherLead, draws);
    let cutThreat = 0;
    if (!knownVoidTrump) {
      if (knownVoidLead) cutThreat = hypergeomHas(population, trumps, draws);
      else {
        const allLead = knowledge.remainingBySuit[leadSuit].length;
        const noLead = probabilityNone(population, allLead, draws);
        const noLeadOrTrump = probabilityNone(population, allLead + trumps, draws);
        cutThreat = noLead - noLeadOrTrump;
      }
    }
    survive *= 1 - clampProbability(higherLeadThreat + cutThreat);
  }
  return clampProbability(survive);
}

function normalizedPower(card: Card, trump: Suit): number {
  return (rankValue(card.rank) + 1) / 13 + (card.suit === trump ? 0.45 : 0);
}

function targetOpponent(view: BotView): string | null {
  const opponents = view.seatOrder.filter((id) => id !== view.botId);
  return opponents.sort((a, b) => {
    const bidA = view.bids[a] ?? 0;
    const bidB = view.bids[b] ?? 0;
    const needA = Math.max(0, bidA - (view.tricksWon[a] ?? 0));
    const needB = Math.max(0, bidB - (view.tricksWon[b] ?? 0));
    return (view.scores[b] ?? 0) - (view.scores[a] ?? 0) || bidB - bidA || needB - needA;
  })[0] ?? null;
}

function trumpDrainBonus(card: Card, view: BotView, knowledge: CardKnowledge): number {
  if (view.currentTrick.length > 0 || card.suit !== view.trumpSuit) return 0;
  const guaranteedTrump = guaranteedTrumpCards(view, knowledge);
  if (!guaranteedTrump.some((candidate) => cardId(candidate) === cardId(card))) return 0;
  const sideWinners = view.hand.filter(
    (candidate) => candidate.suit !== view.trumpSuit && rankValue(candidate.rank) >= 11,
  ).length;
  const trumpCount = view.hand.filter((candidate) => candidate.suit === view.trumpSuit).length;
  return sideWinners > 0 && trumpCount >= 2 ? sideWinners * 3.5 : 0;
}

export function chooseCard(view: BotView): Card {
  const legal = [...view.legalCards];
  if (legal.length === 0) throw new Error("Bot was asked to play without a legal card");
  if (legal.length === 1) return legal[0];

  const knowledge = knowledgeFor(view);
  const bid = view.bids[view.botId] ?? 0;
  const won = view.tricksWon[view.botId] ?? 0;
  const needed = bid - won;
  const cardsLeft = view.hand.length;
  const exact = needed === 0;
  const brokenOver = needed < 0;
  const brokenUnder = needed > cardsLeft;
  const mustWinAll = needed === cardsLeft;
  const totalBid = Object.values(view.bids).reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const unclaimed = view.cardsThisRound - totalBid;
  const target = targetOpponent(view);
  const rolloutSamples = view.kind === "ustaad" ? 10 : view.kind === "shaitaan" ? 4 : 0;
  const rollout = rolloutSamples > 0 ? rolloutCardUtilities(view, legal, rolloutSamples) : new Map<string, number>();

  const scored = legal.map((card) => {
    const winChance = winChanceNow(card, view, knowledge);
    const futureDanger = leadWinChance(card, view, knowledge);
    const power = normalizedPower(card, view.trumpSuit);
    let score = 0;

    if (exact) {
      score = -winChance * 120 + futureDanger * (1 - winChance) * 18 + power * (1 - winChance) * 8;
    } else if (brokenOver || brokenUnder) {
      score = -power * 2 + (brokenUnder ? winChance * 10 : -winChance * 3);
    } else {
      const urgency = needed / cardsLeft;
      score = -Math.abs(winChance - urgency) * 38;
      if (mustWinAll) score += winChance * 100;
      else if (needed > 0) score += winChance * (22 + urgency * 24) - power * winChance * 5;
      if (unclaimed > 0 && futureDanger > 0.78) score += Math.min(8, unclaimed * 2.2);
      if (unclaimed <= 0) score -= power * 2;
      score += trumpDrainBonus(card, view, knowledge);
    }

    if (view.currentTrick.length > 0) {
      const leadSuit = view.currentTrick[0].card.suit;
      const singleton = view.hand.filter((candidate) => candidate.suit === card.suit).length === 1;
      const freeToDiscard = !view.hand.some((candidate) => candidate.suit === leadSuit);
      if (freeToDiscard && singleton && card.suit !== view.trumpSuit && winChance < 0.45) {
        // Shed a side-suit singleton to manufacture a future cutting opportunity.
        score += 6 - power * 2;
      }
      if (needed > 0 && winChance > 0.78) score -= power * 7;
      if (exact && winChance < 0.2) score += power * 5;
    }

    if (view.kind === "hisaabi") score += exact ? -winChance * 15 : -Math.abs(winChance - needed / cardsLeft) * 8;
    if (view.kind === "ustaad") {
      score += exact ? -winChance * 22 : trumpDrainBonus(card, view, knowledge);
      if (!view.historyComplete) score -= power * 1.5;
    }
    if (view.kind === "shaitaan" && target) {
      const targetBid = view.bids[target] ?? 0;
      const targetWon = view.tricksWon[target] ?? 0;
      const targetNeeds = targetBid - targetWon;
      const targetCurrentlyWinning = view.currentTrick.length > 0 &&
        trickWinner(view.currentTrick, view.currentTrick[0].card.suit, view.trumpSuit).deviceId === target;
      // Shaitaan protects its own live contract first. It attacks freely only once
      // exact/broken, or when it has genuine slack and the candidate remains unlikely
      // to steal an unwanted hand.
      const freeToAttack = brokenOver || brokenUnder ||
        (exact && winChance < 0.28) ||
        (needed > 0 && needed < cardsLeft && winChance < 0.34);
      if (freeToAttack && targetCurrentlyWinning) {
        score += targetNeeds > 0 ? winChance * 16 : (1 - winChance) * 12;
      }
      if (freeToAttack && view.currentTrick.length === 0 && card.suit === view.trumpSuit) score += 2;
    }
    if (view.kind === "bhola") score += (deterministicNoise(view, `card:${cardId(card)}`) - 0.5) * 9;
    if (rollout.has(cardId(card))) {
      const weight = view.kind === "ustaad" ? 1.4 : 0.65;
      score += rollout.get(cardId(card))! * weight;
    }

    return { card, score: Number.isFinite(score) ? score : -10_000, winChance, power };
  });

  scored.sort((a, b) => b.score - a.score || a.power - b.power || cardId(a.card).localeCompare(cardId(b.card)));
  if (view.kind === "bhola" && scored.length > 1 && deterministicNoise(view, "play-choice") < 0.18) {
    const alternative = scored.find((candidate, index) => index > 0 && (!exact || candidate.winChance < 0.55));
    if (alternative) return alternative.card;
  }
  return scored[0].card;
}

/** Exposed for deterministic diagnostics and tactical regression tests. */
export function analyzeBotHand(view: BotView) {
  const knowledge = knowledgeFor(view);
  const probabilities = view.hand.map((card) => ({ card, chance: cardBidChance(card, view, knowledge) }));
  return {
    guaranteedTrumpHands: guaranteedTrumpCards(view, knowledge).length,
    contiguousTopTrump: contiguousTopTrumpCount(view.hand, view.trumpSuit),
    expectedHands: probabilities.reduce((sum, item) => sum + item.chance, 0),
    probabilities,
    seenCards: knowledge.seenCardIds.size,
    unseenCards: knowledge.unseenCards.length,
    historyComplete: view.historyComplete,
  };
}
