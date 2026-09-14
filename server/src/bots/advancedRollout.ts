import { cardId, createDeck, rankValue, type Card, type Suit } from "../game/cards.js";
import type { PlayedCardEvent, TrickCard } from "../game/engine.js";
import { buildKnowledge, probabilityNone } from "./knowledge.js";
import type { BotView } from "./strategy.js";
import type { BotKind } from "./types.js";

interface SimState {
  hands: Record<string, Card[]>;
  bids: Record<string, number>;
  won: Record<string, number>;
  trick: TrickCard[];
  playedCards: PlayedCardEvent[];
  voidSuits: Record<string, Suit[]>;
  turnSeat: number;
}
/** The deliberately narrow information set used by a simulated actor. */
export interface RolloutActorView {
  actorId: string;
  kind: BotKind | null;
  hand: Card[];
  bid: number;
  won: number;
  bids: Record<string, number>;
  tricksWon: Record<string, number>;
  scores: Record<string, number>;
  trick: TrickCard[];
  playedCards: PlayedCardEvent[];
  voidSuits: Record<string, Suit[]>;
  handCounts: Record<string, number>;
  seatOrder: string[];
  turnSeat: number;
  trumpSuit: Suit;
  cardsThisRound: number;
}

export interface QuickBidContext {
  priorBids?: readonly number[];
  playerCount?: number;
}

interface Outcome {
  ownWon: number;
  ownScore: number;
  ownExact: boolean;
  targetExact: boolean;
  firstPlaceMargin: number;
  donkeySafetyMargin: number;
  firstPlace: boolean;
  donkey: boolean;
}

interface SampledDeal {
  hands: Record<string, Card[]>;
  /** Likelihood of the already-observed bids given this determinization. */
  bidWeight: number;
}

export interface BidRolloutEstimate {
  utility: number;
  exactRate: number;
  acceptedSamples: number;
  effectiveSamples: number;
}

function hash(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function rngFrom(seed: number): () => number {
  let value = seed | 0;
  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let next = Math.imul(value ^ (value >>> 15), 1 | value);
    next = (next + Math.imul(next ^ (next >>> 7), 61 | next)) ^ next;
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(values: readonly T[], rng: () => number): T[] {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function stateFingerprint(view: BotView): string {
  return [
    view.botId,
    view.round,
    view.trumpSuit,
    view.hand.map(cardId).sort().join(","),
    view.playedCards.map((play) => `${play.deviceId}:${cardId(play.card)}`).join(","),
    view.currentTrick.map((play) => `${play.deviceId}:${cardId(play.card)}`).join(","),
    Object.entries(view.bids).map(([id, bid]) => `${id}:${bid ?? "-"}`).join(","),
  ].join("|");
}

export function observedBidWeight(view: BotView, hands: Record<string, Card[]>): number {
  let weight = 1;
  const order = biddingOrder(view.seatOrder, view.dealerDeviceId);
  const priorBids: number[] = [];
  for (const id of order) {
    const observedBid = view.bids[id];
    if (id === view.botId || observedBid === null) {
      if (observedBid !== null) priorBids.push(observedBid);
      continue;
    }
    // Bids were made from the original hand, not just the cards still held now.
    // Reattach every publicly played card belonging to this player before judging
    // whether a sampled deal is plausible given their observed bid.
    const originalHand = [...(hands[id] ?? [])];
    const known = new Set(originalHand.map(cardId));
    for (const play of view.playedCards) {
      if (play.deviceId !== id || known.has(cardId(play.card))) continue;
      known.add(cardId(play.card));
      originalHand.push(play.card);
    }
    let predicted = quickBidForRollout(originalHand, view.trumpSuit, view.cardsThisRound, {
      priorBids,
      playerCount: view.seatOrder.length,
    });
    if (id === view.dealerDeviceId) {
      predicted = nearestLegalBid(predicted, view.cardsThisRound, priorBids);
    }
    const error = Math.abs(observedBid - predicted);
    // A dealer's forced alternative is weaker evidence about their cards.
    const strength = id === view.dealerDeviceId ? 0.38 : 0.7;
    weight *= Math.max(0.025, Math.exp(-strength * error));
    priorBids.push(observedBid);
  }
  return weight;
}

function biddingOrder(seatOrder: readonly string[], dealerDeviceId: string): string[] {
  const dealerSeat = seatOrder.indexOf(dealerDeviceId);
  return seatOrder.slice(dealerSeat + 1).concat(seatOrder.slice(0, dealerSeat + 1));
}

function nearestLegalBid(desired: number, cardsThisRound: number, priorBids: readonly number[]): number {
  const forbidden = cardsThisRound - priorBids.reduce((sum, bid) => sum + bid, 0);
  return Array.from({ length: cardsThisRound + 2 }, (_, index) => index)
    .filter((bid) => bid !== forbidden)
    .sort((a, b) => Math.abs(a - desired) - Math.abs(b - desired) || a - b)[0];
}

function remainingAssignmentsFeasible(
  available: readonly Card[],
  opponents: readonly string[],
  from: number,
  view: BotView,
): boolean {
  for (let index = from; index < opponents.length; index += 1) {
    const id = opponents[index];
    const count = view.handCounts[id] ?? view.hand.length;
    const voids = new Set(view.voidSuits[id] ?? []);
    if (available.filter((card) => !voids.has(card.suit)).length < count) return false;
  }
  return true;
}

export function sampleOpponentHands(view: BotView, sample: number): SampledDeal | null {
  const knowledge = buildKnowledge({
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
  const opponents = view.seatOrder
    .filter((id) => id !== view.botId)
    .sort((a, b) => (view.voidSuits[b]?.length ?? 0) - (view.voidSuits[a]?.length ?? 0));
  const baseSeed = hash(`${stateFingerprint(view)}|sample:${sample}`);

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const available = shuffle(knowledge.unseenCards, rngFrom(baseSeed + attempt * 0x9e3779b9));
    const hands: Record<string, Card[]> = { [view.botId]: [...view.hand] };
    let valid = true;
    for (const id of opponents) {
      const count = view.handCounts[id] ?? view.hand.length;
      const voids = new Set(view.voidSuits[id] ?? []);
      const chosen: Card[] = [];
      while (chosen.length < count) {
        const candidates = shuffle(
          available.map((card, index) => ({ card, index })).filter(({ card }) => !voids.has(card.suit)),
          rngFrom(baseSeed + attempt * 0x9e3779b9 + chosen.length * 97 + id.length),
        );
        const viable = candidates.find(({ index }) => {
          const rest = available.filter((_, candidateIndex) => candidateIndex !== index);
          return remainingAssignmentsFeasible(rest, opponents, opponents.indexOf(id) + 1, view);
        });
        if (!viable) break;
        chosen.push(viable.card);
        available.splice(viable.index, 1);
      }
      if (chosen.length !== count) {
        valid = false;
        break;
      }
      hands[id] = chosen;
    }
    if (valid) return { hands, bidWeight: observedBidWeight(view, hands) };
  }
  return null;
}

function legalFrom(hand: Card[], trick: TrickCard[]): Card[] {
  if (trick.length === 0) return hand;
  const lead = trick[0].card.suit;
  const follows = hand.filter((card) => card.suit === lead);
  return follows.length > 0 ? follows : hand;
}

function winner(trick: TrickCard[], trump: Suit): string {
  const lead = trick[0].card.suit;
  const trumps = trick.filter((play) => play.card.suit === trump);
  const pool = trumps.length > 0 ? trumps : trick.filter((play) => play.card.suit === lead);
  return pool.reduce((best, play) => rankValue(play.card.rank) > rankValue(best.card.rank) ? play : best).deviceId;
}

function power(card: Card, trump: Suit): number {
  return rankValue(card.rank) + (card.suit === trump ? 20 : 0);
}

function currentlyWins(id: string, card: Card, trick: TrickCard[], trump: Suit): boolean {
  const next = [...trick, { deviceId: id, card }];
  return winner(next, trump) === id;
}

function unseenFor(actor: RolloutActorView): Card[] {
  const seen = new Set([
    ...actor.hand.map(cardId),
    ...actor.playedCards.map((play) => cardId(play.card)),
    ...actor.trick.map((play) => cardId(play.card)),
  ]);
  return createDeck().filter((card) => !seen.has(cardId(card)));
}

function playersStillToAct(actor: RolloutActorView): string[] {
  const remaining = actor.seatOrder.length - actor.trick.length - 1;
  return Array.from({ length: Math.max(0, remaining) }, (_, offset) =>
    actor.seatOrder[(actor.turnSeat + offset + 1) % actor.seatOrder.length]);
}

function cardWinChance(actor: RolloutActorView, card: Card): number {
  if (actor.trick.length > 0 && !currentlyWins(actor.actorId, card, actor.trick, actor.trumpSuit)) return 0;
  const unseen = unseenFor(actor);
  const later = playersStillToAct(actor);
  if (later.length === 0) return 1;
  const leadSuit = actor.trick[0]?.card.suit ?? card.suit;
  let dangerous = unseen.filter((candidate) => {
    if (card.suit === actor.trumpSuit) {
      return candidate.suit === actor.trumpSuit && rankValue(candidate.rank) > rankValue(card.rank);
    }
    if (candidate.suit === leadSuit && rankValue(candidate.rank) > rankValue(card.rank)) return true;
    return candidate.suit === actor.trumpSuit;
  }).length;

  // A known void makes a trump danger more credible; when nobody is known void,
  // discount speculative cuts instead of pretending every unseen trump is live.
  if (card.suit !== actor.trumpSuit) {
    const knownCutters = later.filter((id) => actor.voidSuits[id]?.includes(leadSuit)).length;
    const unseenTrumps = unseen.filter((candidate) => candidate.suit === actor.trumpSuit).length;
    if (knownCutters === 0) dangerous -= Math.floor(unseenTrumps * 0.65);
  }
  dangerous = Math.max(0, dangerous);
  return probabilityNone(unseen.length, dangerous, later.length);
}

function suitLength(hand: readonly Card[], suit: Suit): number {
  return hand.filter((card) => card.suit === suit).length;
}

function discardValue(card: Card, hand: readonly Card[], trump: Suit): number {
  const length = suitLength(hand, card.suit);
  const singletonBonus = length === 1 && card.suit !== trump ? 5 : length === 2 ? 1.5 : 0;
  return rankValue(card.rank) + singletonBonus - (card.suit === trump ? 8 : 0);
}

function controlledTrumpLead(actor: RolloutActorView, legal: readonly Card[]): Card | null {
  const publicSeen = new Set([
    ...actor.playedCards.map((play) => cardId(play.card)),
    ...actor.trick.map((play) => cardId(play.card)),
  ]);
  const own = new Set(actor.hand.map(cardId));
  const controlled = legal.filter((card) => card.suit === actor.trumpSuit &&
    createDeck().every((candidate) => candidate.suit !== actor.trumpSuit ||
      rankValue(candidate.rank) <= rankValue(card.rank) || own.has(cardId(candidate)) || publicSeen.has(cardId(candidate))));
  return controlled.sort((a, b) => rankValue(a.rank) - rankValue(b.rank))[0] ?? null;
}

function highestScoringOpponent(actor: RolloutActorView): string | null {
  return actor.seatOrder
    .filter((id) => id !== actor.actorId)
    .sort((a, b) => (actor.scores[b] ?? 0) - (actor.scores[a] ?? 0) ||
      (actor.bids[b] ?? 0) - (actor.bids[a] ?? 0))[0] ?? null;
}

/** Deterministic, non-recursive continuation policy used inside rollouts. */
export function chooseRolloutCard(actor: RolloutActorView): Card {
  const legal = legalFrom(actor.hand, actor.trick);
  if (legal.length === 1) return legal[0];
  const needed = actor.bid - actor.won;
  const broken = needed < 0 || needed > actor.hand.length;
  const ascending = [...legal].sort((a, b) => power(a, actor.trumpSuit) - power(b, actor.trumpSuit));
  const ranked = ascending.map((card) => ({ card, chance: cardWinChance(actor, card) }));

  if (actor.trick.length > 0) {
    const winning = ranked.filter(({ chance }) => chance > 0);
    const losing = ranked.filter(({ chance }) => chance === 0);
    const currentLeader = winner(actor.trick, actor.trumpSuit);
    const target = actor.kind === "shaitaan" ? highestScoringOpponent(actor) : null;
    if (target && currentLeader === target) {
      const targetNeed = (actor.bids[target] ?? 0) - (actor.tricksWon[target] ?? 0);
      if (targetNeed === 0 && losing.length > 0 && needed <= 0) {
        return losing.sort((a, b) => discardValue(b.card, actor.hand, actor.trumpSuit) -
          discardValue(a.card, actor.hand, actor.trumpSuit))[0].card;
      }
      if (targetNeed > 0 && (broken || needed > 0) && winning.length > 0) {
        return winning.sort((a, b) => a.chance - b.chance || power(a.card, actor.trumpSuit) -
          power(b.card, actor.trumpSuit))[0].card;
      }
    }

    if (needed > 0 && !broken) {
      const likely = winning.filter(({ chance }) => chance >= 0.62);
      if (likely.length > 0) {
        return likely.sort((a, b) => power(a.card, actor.trumpSuit) - power(b.card, actor.trumpSuit) ||
          b.chance - a.chance)[0].card;
      }
      if (needed / actor.hand.length >= 0.5 && winning.length > 0) {
        return winning.sort((a, b) => b.chance - a.chance || power(a.card, actor.trumpSuit) -
          power(b.card, actor.trumpSuit))[0].card;
      }
    }

    if (losing.length > 0) {
      return losing.sort((a, b) => discardValue(b.card, actor.hand, actor.trumpSuit) -
        discardValue(a.card, actor.hand, actor.trumpSuit))[0].card;
    }
    // Winning is unavoidable: shed the most dangerous winner to reduce later
    // accidental hands once this contract has become over-made.
    return winning.sort((a, b) => discardValue(b.card, actor.hand, actor.trumpSuit) -
      discardValue(a.card, actor.hand, actor.trumpSuit))[0]?.card ?? ascending[0];
  }

  if (needed > 0 && !broken) {
    const controlledTrump = controlledTrumpLead(actor, legal);
    const hasSideHonor = actor.hand.some((card) => card.suit !== actor.trumpSuit && rankValue(card.rank) >= 11);
    if (controlledTrump && (needed >= 2 || hasSideHonor)) return controlledTrump;

    const likely = ranked.filter(({ chance }) => chance >= 0.62);
    if (likely.length > 0) {
      return likely.sort((a, b) => a.chance >= 0.96 && b.chance < 0.96 ? -1 :
        b.chance >= 0.96 && a.chance < 0.96 ? 1 :
          power(a.card, actor.trumpSuit) - power(b.card, actor.trumpSuit) || b.chance - a.chance)[0].card;
    }
  }

  // Avoiding a hand: first shed a dangerous singleton to manufacture a future
  // void, otherwise lead the least likely winner while discarding maximum danger.
  const singleton = ranked.filter(({ card }) => card.suit !== actor.trumpSuit &&
    suitLength(actor.hand, card.suit) === 1).sort((a, b) => b.chance - a.chance ||
      discardValue(b.card, actor.hand, actor.trumpSuit) - discardValue(a.card, actor.hand, actor.trumpSuit));
  if (singleton.length > 0 && singleton[0].chance < 0.55) return singleton[0].card;
  return ranked.sort((a, b) => a.chance - b.chance ||
    discardValue(b.card, actor.hand, actor.trumpSuit) - discardValue(a.card, actor.hand, actor.trumpSuit))[0].card;
}

/** Fast hand estimate for bid likelihoods; it sees one actor's hand only. */
export function quickBidForRollout(
  hand: Card[],
  trump: Suit,
  cardsThisRound: number,
  context: QuickBidContext = {},
): number {
  const playerCount = context.playerCount ?? 6;
  const trumpCards = hand.filter((card) => card.suit === trump);
  const trumpRanks = new Set(trumpCards.map((card) => rankValue(card.rank)));
  let topTrumpRun = 0;
  for (let rank = 12; rank >= 0 && trumpRanks.has(rank); rank -= 1) topTrumpRun += 1;

  let estimate = topTrumpRun;
  for (const card of trumpCards) {
    if (rankValue(card.rank) >= 13 - topTrumpRun) continue;
    const strength = rankValue(card.rank) / 12;
    estimate += Math.max(0.08, strength * (0.48 + trumpCards.length * 0.045));
  }

  const scarcity = Math.max(0, Math.min(1, (8 - cardsThisRound) / 7));
  for (const suit of (["S", "H", "C", "D"] as Suit[]).filter((suit) => suit !== trump)) {
    const cards = hand.filter((card) => card.suit === suit);
    if (cards.length === 0) continue;
    const ranks = new Set(cards.map((card) => card.rank));
    const concentrationPenalty = Math.max(0.5, 1 - Math.max(0, cards.length - 2) *
      (0.09 + Math.max(0, playerCount - 4) * 0.015));
    let suitEstimate = 0;
    if (ranks.has("A")) suitEstimate += 0.78 + scarcity * 0.08;
    if (ranks.has("K")) suitEstimate += ranks.has("A") ? 0.48 : 0.22 + scarcity * 0.28;
    if (ranks.has("Q")) suitEstimate += ranks.has("A") && ranks.has("K") ? 0.3 : 0.08 + scarcity * 0.2;
    estimate += suitEstimate * concentrationPenalty;
  }

  const shortSideSuits = (["S", "H", "C", "D"] as Suit[])
    .filter((suit) => suit !== trump && suitLength(hand, suit) <= 1).length;
  estimate += Math.min(Math.max(0, trumpCards.length - topTrumpRun), shortSideSuits) * 0.16;

  const prior = context.priorBids ?? [];
  if (prior.length > 0) {
    const density = prior.reduce((sum, bid) => sum + bid, 0) / (prior.length * Math.max(1, cardsThisRound));
    const discretionary = Math.max(0, estimate - topTrumpRun);
    if (density >= 0.42) estimate = topTrumpRun + discretionary * 0.82;
    else if (density <= 0.14) estimate = topTrumpRun + discretionary * 1.1 + Math.min(0.25, scarcity * 0.2);
  }
  return Math.max(topTrumpRun, Math.min(cardsThisRound, Math.round(estimate)));
}

export function projectRemainingBids(
  view: BotView,
  hands: Record<string, Card[]>,
  ownBid: number,
): Record<string, number> {
  const bidOrder = biddingOrder(view.seatOrder, view.dealerDeviceId);
  const bids: Record<string, number> = {};
  for (const id of bidOrder) {
    const observed = view.bids[id];
    if (id === view.botId) {
      let candidate = ownBid;
      if (id === view.dealerDeviceId) {
        candidate = nearestLegalBid(candidate, view.cardsThisRound, Object.values(bids));
      }
      bids[id] = candidate;
      continue;
    }
    if (observed !== null) {
      bids[id] = observed;
      continue;
    }
    const desired = quickBidForRollout(hands[id] ?? [], view.trumpSuit, view.cardsThisRound, {
      priorBids: Object.values(bids),
      playerCount: view.seatOrder.length,
    });
    let allowed = Array.from({ length: view.cardsThisRound + 2 }, (_, index) => index);
    if (id === view.dealerDeviceId) {
      const repaired = nearestLegalBid(desired, view.cardsThisRound, Object.values(bids));
      bids[id] = repaired;
      continue;
    }
    bids[id] = allowed.sort((a, b) => Math.abs(a - desired) - Math.abs(b - desired) || a - b)[0];
  }
  return bids;
}

function cloneHands(hands: Record<string, Card[]>): Record<string, Card[]> {
  return Object.fromEntries(Object.entries(hands).map(([id, hand]) => [id, [...hand]]));
}

function playInto(state: SimState, id: string, card: Card, view: BotView): void {
  const leadSuit = state.trick[0]?.card.suit ?? card.suit;
  if (state.trick.length > 0 && card.suit !== leadSuit && !state.voidSuits[id]?.includes(leadSuit)) {
    state.voidSuits[id] = [...(state.voidSuits[id] ?? []), leadSuit];
  }
  state.hands[id] = state.hands[id].filter((candidate) => cardId(candidate) !== cardId(card));
  state.trick.push({ deviceId: id, card });
  state.playedCards.push({
    handNumber: Math.max(1, view.cardsThisRound - state.hands[id].length),
    deviceId: id,
    card,
    leadSuit,
  });
  if (state.trick.length === view.seatOrder.length) {
    const handWinner = winner(state.trick, view.trumpSuit);
    state.won[handWinner] = (state.won[handWinner] ?? 0) + 1;
    state.trick = [];
    state.turnSeat = view.seatOrder.indexOf(handWinner);
  } else {
    state.turnSeat = (state.turnSeat + 1) % view.seatOrder.length;
  }
}

function simulate(view: BotView, sampledHands: Record<string, Card[]>, ownBid: number, firstCard?: Card): Outcome {
  const state: SimState = {
    hands: cloneHands(sampledHands),
    bids: projectRemainingBids(view, sampledHands, ownBid),
    won: { ...view.tricksWon },
    trick: view.currentTrick.map((play) => ({ ...play, card: { ...play.card } })),
    playedCards: view.playedCards.map((play) => ({ ...play, card: { ...play.card } })),
    voidSuits: Object.fromEntries(view.seatOrder.map((id) => [id, [...(view.voidSuits[id] ?? [])]])),
    turnSeat: view.turnSeat,
  };
  if (firstCard) playInto(state, view.botId, firstCard, view);

  let actions = 0;
  while (Object.values(state.hands).some((hand) => hand.length > 0) && actions < 100) {
    const id = view.seatOrder[state.turnSeat];
    if (!id || !state.hands[id]?.length) break;
    const actor: RolloutActorView = {
      actorId: id,
      kind: id === view.botId ? view.kind : null,
      hand: state.hands[id],
      bid: state.bids[id] ?? 0,
      won: state.won[id] ?? 0,
      bids: state.bids,
      tricksWon: state.won,
      scores: view.scores,
      trick: state.trick,
      playedCards: state.playedCards,
      voidSuits: state.voidSuits,
      handCounts: Object.fromEntries(view.seatOrder.map((playerId) => [playerId, state.hands[playerId]?.length ?? 0])),
      seatOrder: view.seatOrder,
      turnSeat: state.turnSeat,
      trumpSuit: view.trumpSuit,
      cardsThisRound: view.cardsThisRound,
    };
    playInto(state, id, chooseRolloutCard(actor), view);
    actions += 1;
  }

  const ownWon = state.won[view.botId] ?? 0;
  const ownExact = ownWon === ownBid;
  const ownScore = ownExact ? (ownBid + 1) * 10 + ownBid : ownBid;
  const target = view.seatOrder
    .filter((id) => id !== view.botId)
    .sort((a, b) => (view.scores[b] ?? 0) - (view.scores[a] ?? 0) || (state.bids[b] ?? 0) - (state.bids[a] ?? 0))[0];
  const targetExact = target ? (state.won[target] ?? 0) === (state.bids[target] ?? 0) : false;
  const ownFinal = (view.scores[view.botId] ?? 0) + ownScore;
  const opponentFinals = view.seatOrder.filter((id) => id !== view.botId).map((id) => {
    const bid = state.bids[id] ?? 0;
    const won = state.won[id] ?? 0;
    return (view.scores[id] ?? 0) + (bid === won ? (bid + 1) * 10 + bid : bid);
  });
  const strongestOpponent = Math.max(...opponentFinals);
  const weakestOpponent = Math.min(...opponentFinals);
  return {
    ownWon,
    ownScore,
    ownExact,
    targetExact,
    firstPlaceMargin: ownFinal - strongestOpponent,
    donkeySafetyMargin: ownFinal - weakestOpponent,
    firstPlace: ownFinal >= strongestOpponent,
    donkey: ownFinal <= weakestOpponent,
  };
}

export function rolloutBidEstimates(view: BotView, bids: number[], samples: number): Map<number, BidRolloutEstimate> {
  const totals = new Map(bids.map((bid) => [bid, {
    utility: 0,
    exactRate: 0,
    acceptedSamples: 0,
    effectiveSamples: 0,
  }]));
  const weights = new Map(bids.map((bid) => [bid, 0]));
  let sumWeight = 0;
  let sumWeightSquared = 0;
  let completed = 0;
  const minimumEffectiveSamples = Math.max(4, samples * 0.7);
  const maximumSamples = samples * 3;
  for (let sample = 0; sample < maximumSamples; sample += 1) {
    const deal = sampleOpponentHands(view, sample);
    if (!deal) continue;
    completed += 1;
    sumWeight += deal.bidWeight;
    sumWeightSquared += deal.bidWeight * deal.bidWeight;
    for (const bid of bids) {
      const outcome = simulate(view, deal.hands, bid);
      const lateWeight = view.round >= 6 ? 1 : 0.45;
      const utility = outcome.ownScore + (outcome.ownExact ? 24 : 0) +
        outcome.firstPlaceMargin * 0.04 + outcome.donkeySafetyMargin * 0.12 * lateWeight +
        (outcome.firstPlace ? 4 : 0) - (outcome.donkey ? 12 * lateWeight : 0);
      const total = totals.get(bid)!;
      total.utility += utility * deal.bidWeight;
      total.exactRate += (outcome.ownExact ? 1 : 0) * deal.bidWeight;
      total.acceptedSamples = completed;
      weights.set(bid, (weights.get(bid) ?? 0) + deal.bidWeight);
    }
    const effectiveSamples = sumWeightSquared > 0 ? (sumWeight * sumWeight) / sumWeightSquared : 0;
    if (completed >= samples && effectiveSamples >= minimumEffectiveSamples) break;
  }
  const effectiveSamples = sumWeightSquared > 0 ? (sumWeight * sumWeight) / sumWeightSquared : 0;
  for (const bid of bids) {
    const weight = weights.get(bid) ?? 0;
    const total = totals.get(bid)!;
    if (weight > 0) {
      total.utility /= weight;
      total.exactRate /= weight;
    }
    total.effectiveSamples = effectiveSamples;
  }
  return totals;
}

export function rolloutCardUtilities(view: BotView, cards: Card[], samples: number): Map<string, number> {
  const totals = new Map(cards.map((card) => [cardId(card), 0]));
  let completed = 0;
  let totalWeight = 0;
  let totalWeightSquared = 0;
  const ownBid = view.bids[view.botId] ?? 0;
  const minimumEffectiveSamples = Math.max(4, samples * 0.7);
  const maximumSamples = samples * 3;
  for (let sample = 0; sample < maximumSamples; sample += 1) {
    const deal = sampleOpponentHands(view, sample);
    if (!deal) continue;
    completed += 1;
    totalWeight += deal.bidWeight;
    totalWeightSquared += deal.bidWeight * deal.bidWeight;
    for (const card of cards) {
      const outcome = simulate(view, deal.hands, ownBid, card);
      const lateWeight = view.round >= 6 ? 1 : 0.45;
      let utility = outcome.ownScore + (outcome.ownExact ? 34 : 0) + outcome.firstPlaceMargin * 0.05 +
        outcome.donkeySafetyMargin * 0.14 * lateWeight + (outcome.firstPlace ? 5 : 0) -
        (outcome.donkey ? 14 * lateWeight : 0);
      if (view.kind === "shaitaan" && !outcome.targetExact) utility += 7;
      totals.set(cardId(card), (totals.get(cardId(card)) ?? 0) + utility * deal.bidWeight);
    }
    const effectiveSamples = totalWeightSquared > 0 ? (totalWeight * totalWeight) / totalWeightSquared : 0;
    if (completed >= samples && effectiveSamples >= minimumEffectiveSamples) break;
  }
  const effectiveSamples = totalWeightSquared > 0 ? (totalWeight * totalWeight) / totalWeightSquared : 0;
  if (completed > 0 && totalWeight > 0 && effectiveSamples >= minimumEffectiveSamples) {
    for (const card of cards) totals.set(cardId(card), (totals.get(cardId(card)) ?? 0) / totalWeight);
    return totals;
  }
  // If bid conditioning collapsed onto too little evidence, the caller deliberately
  // falls back to the ordinary card heuristic rather than trusting false precision.
  return new Map<string, number>();
}
