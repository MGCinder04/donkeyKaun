import { cardId, rankValue, type Card, type Suit } from "../game/cards.js";
import type { TrickCard } from "../game/engine.js";
import { buildKnowledge } from "./knowledge.js";
import type { BotView } from "./strategy.js";

interface SimState {
  hands: Record<string, Card[]>;
  bids: Record<string, number>;
  won: Record<string, number>;
  trick: TrickCard[];
  turnSeat: number;
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
  for (const id of view.seatOrder) {
    if (id === view.botId || view.bids[id] === null) continue;
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
    const predicted = quickBid(originalHand, view.trumpSuit, view.cardsThisRound);
    const error = Math.abs((view.bids[id] ?? 0) - predicted);
    // A dealer's forced alternative is weaker evidence about their cards.
    const strength = id === view.dealerDeviceId ? 0.38 : 0.7;
    weight *= Math.max(0.025, Math.exp(-strength * error));
  }
  return weight;
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

function rolloutCard(id: string, state: SimState, view: BotView): Card {
  const hand = state.hands[id];
  const legal = legalFrom(hand, state.trick);
  if (legal.length === 1) return legal[0];
  const needed = (state.bids[id] ?? 0) - (state.won[id] ?? 0);
  const exact = needed === 0;
  const broken = needed < 0 || needed > hand.length;
  const ascending = [...legal].sort((a, b) => power(a, view.trumpSuit) - power(b, view.trumpSuit));

  if (state.trick.length > 0) {
    const winning = ascending.filter((card) => currentlyWins(id, card, state.trick, view.trumpSuit));
    const losing = ascending.filter((card) => !currentlyWins(id, card, state.trick, view.trumpSuit));
    if (exact) return losing.at(-1) ?? winning[0] ?? ascending[0];
    if (broken) return losing.at(-1) ?? winning[0] ?? ascending[0];
    if (needed >= hand.length || needed / hand.length >= 0.45) return winning[0] ?? ascending[0];
    return losing.at(-1) ?? winning[0] ?? ascending[0];
  }

  if (exact) return ascending[0];
  if (broken) return ascending[0];
  // Simulated opponents choose from their own cards and public contract state. They
  // deliberately do not inspect the other sampled hidden hands (strategy fusion).
  if (needed >= hand.length || needed / hand.length >= 0.45) return ascending.at(-1)!;
  return ascending[0];
}

function quickBid(hand: Card[], trump: Suit, cardsThisRound: number): number {
  const trumpCards = hand.filter((card) => card.suit === trump);
  const highTrump = trumpCards.filter((card) => rankValue(card.rank) >= 9).length;
  const sideAces = hand.filter((card) => card.suit !== trump && card.rank === "A").length;
  const sideKings = hand.filter((card) => card.suit !== trump && card.rank === "K").length;
  const shortSuits = (["S", "H", "C", "D"] as Suit[])
    .filter((suit) => suit !== trump && hand.filter((card) => card.suit === suit).length <= 1).length;
  const estimate = highTrump + sideAces * 0.7 + sideKings * (cardsThisRound <= 3 ? 0.55 : 0.25) +
    Math.min(trumpCards.length, shortSuits) * 0.18;
  return Math.max(0, Math.min(cardsThisRound, Math.round(estimate)));
}

export function projectRemainingBids(
  view: BotView,
  hands: Record<string, Card[]>,
  ownBid: number,
): Record<string, number> {
  const dealerSeat = view.seatOrder.indexOf(view.dealerDeviceId);
  const bidOrder = view.seatOrder.slice(dealerSeat + 1).concat(view.seatOrder.slice(0, dealerSeat + 1));
  const bids: Record<string, number> = {};
  for (const id of bidOrder) {
    const observed = view.bids[id];
    if (id === view.botId) {
      let candidate = ownBid;
      if (id === view.dealerDeviceId) {
        const previousTotal = Object.values(bids).reduce((sum, bid) => sum + bid, 0);
        const forbidden = view.cardsThisRound - previousTotal;
        if (candidate === forbidden) {
          const allowed = Array.from({ length: view.cardsThisRound + 2 }, (_, index) => index)
            .filter((bid) => bid !== forbidden);
          candidate = allowed.sort((a, b) => Math.abs(a - ownBid) - Math.abs(b - ownBid) || a - b)[0];
        }
      }
      bids[id] = candidate;
      continue;
    }
    if (observed !== null) {
      bids[id] = observed;
      continue;
    }
    const desired = quickBid(hands[id] ?? [], view.trumpSuit, view.cardsThisRound);
    let allowed = Array.from({ length: view.cardsThisRound + 2 }, (_, index) => index);
    if (id === view.dealerDeviceId) {
      const previousTotal = Object.values(bids).reduce((sum, bid) => sum + bid, 0);
      const forbidden = view.cardsThisRound - previousTotal;
      allowed = allowed.filter((bid) => bid !== forbidden);
    }
    bids[id] = allowed.sort((a, b) => Math.abs(a - desired) - Math.abs(b - desired) || a - b)[0];
  }
  return bids;
}

function cloneHands(hands: Record<string, Card[]>): Record<string, Card[]> {
  return Object.fromEntries(Object.entries(hands).map(([id, hand]) => [id, [...hand]]));
}

function playInto(state: SimState, id: string, card: Card, view: BotView): void {
  state.hands[id] = state.hands[id].filter((candidate) => cardId(candidate) !== cardId(card));
  state.trick.push({ deviceId: id, card });
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
    turnSeat: view.turnSeat,
  };
  if (firstCard) playInto(state, view.botId, firstCard, view);

  let actions = 0;
  while (Object.values(state.hands).some((hand) => hand.length > 0) && actions < 100) {
    const id = view.seatOrder[state.turnSeat];
    if (!id || !state.hands[id]?.length) break;
    playInto(state, id, rolloutCard(id, state, view), view);
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
