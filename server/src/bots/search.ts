import { cardId, rankValue, type Card, type Suit } from "../game/cards.js";
import type { TrickCard } from "../game/engine.js";
import { buildKnowledge } from "./knowledge.js";
import type { BotView } from "./strategy.js";

/**
 * Fair-information card search.
 *
 * The only game input is BotView: the bot's own hand and public observations. Hidden
 * hands used below are generated hypotheses, never the room's real GameState hands.
 * Search is deterministic and bounded by state-transition/node counters rather than
 * wall-clock time, so identical views and options produce identical answers.
 */

export interface CardSearchOptions {
  /** Total simulated state transitions/tree nodes. Clamped to 60,000. */
  maxNodes?: number;
  /** Number of deterministic plausible deals retained for ordinary search. */
  maxDeals?: number;
  /** Maximum ISMCTS iterations. Actual iterations can be lower when maxNodes is used. */
  maxIterations?: number;
  /** Use exhaustive continuation search at or below this hand size (1-3). */
  endgameHandSize?: number;
  /** Maximum hidden deals enumerated in endgame mode. */
  maxEndgameDeals?: number;
  /** UCB exploration strength for information-set search. */
  exploration?: number;
}

export type CardSearchMode = "trivial" | "exact-endgame" | "sampled-endgame" | "ismcts";

export interface CardSearchEvaluation {
  card: Card;
  utility: number;
  exactContractRate: number;
  expectedHandsWon: number;
  visits: number;
  weight: number;
}

export interface CardSearchResult {
  card: Card;
  mode: CardSearchMode;
  evaluations: CardSearchEvaluation[];
  determinizations: number;
  iterations: number;
  nodes: number;
  /** True only when every feasible hidden deal and every continuation was searched. */
  complete: boolean;
}

interface NormalizedOptions {
  maxNodes: number;
  maxDeals: number;
  maxIterations: number;
  endgameHandSize: number;
  maxEndgameDeals: number;
  exploration: number;
}

interface PlausibleDeal {
  hands: Record<string, Card[]>;
  bidWeight: number;
}

interface SimState {
  hands: Record<string, Card[]>;
  won: Record<string, number>;
  trick: TrickCard[];
  turnSeat: number;
}

interface Outcome {
  utilities: Record<string, number>;
  won: Record<string, number>;
  exact: Record<string, boolean>;
}

interface WorkBudget {
  remaining: number;
  used: number;
}

interface SolveResult {
  outcome: Outcome;
  complete: boolean;
}

interface ActionStats {
  visits: number;
  weight: number;
  utilityTotals: Record<string, number>;
  exactWeight: number;
  wonTotal: number;
}

interface TreeNode {
  visits: number;
  actions: Map<string, ActionStats>;
}

const DEFAULTS: NormalizedOptions = {
  maxNodes: 18_000,
  maxDeals: 28,
  maxIterations: 320,
  endgameHandSize: 2,
  maxEndgameDeals: 96,
  exploration: 1.1,
};

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(value!)));
}

function normalizedOptions(options: CardSearchOptions): NormalizedOptions {
  return {
    maxNodes: boundedInteger(options.maxNodes, DEFAULTS.maxNodes, 50, 60_000),
    maxDeals: boundedInteger(options.maxDeals, DEFAULTS.maxDeals, 1, 64),
    maxIterations: boundedInteger(options.maxIterations, DEFAULTS.maxIterations, 1, 800),
    endgameHandSize: boundedInteger(options.endgameHandSize, DEFAULTS.endgameHandSize, 1, 3),
    maxEndgameDeals: boundedInteger(options.maxEndgameDeals, DEFAULTS.maxEndgameDeals, 1, 160),
    exploration: Math.max(0, Math.min(3, options.exploration ?? DEFAULTS.exploration)),
  };
}

function hash(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
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
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function sortedRecord(record: Record<string, unknown>): string {
  return Object.keys(record).sort().map((key) => `${key}:${JSON.stringify(record[key])}`).join(",");
}

function fingerprint(view: BotView): string {
  return [
    view.botId,
    view.round,
    view.trumpSuit,
    view.turnSeat,
    view.hand.map(cardId).sort().join(","),
    view.currentTrick.map((play) => `${play.deviceId}:${cardId(play.card)}`).join(","),
    view.playedCards.map((play) => `${play.deviceId}:${cardId(play.card)}`).join(","),
    sortedRecord(view.bids),
    sortedRecord(view.tricksWon),
    sortedRecord(view.handCounts),
    sortedRecord(view.voidSuits),
  ].join("|");
}

function legalFrom(hand: readonly Card[], trick: readonly TrickCard[]): Card[] {
  if (trick.length === 0) return [...hand];
  const lead = trick[0].card.suit;
  const follows = hand.filter((card) => card.suit === lead);
  return follows.length > 0 ? [...follows] : [...hand];
}

function sanitizeCandidates(view: BotView, candidates: readonly Card[]): Card[] {
  const handIds = new Set(view.hand.map(cardId));
  const suppliedLegal = new Set(view.legalCards.map(cardId));
  const derivedLegal = new Set(legalFrom(view.hand, view.currentTrick).map(cardId));
  const unique = new Map<string, Card>();
  for (const card of candidates) {
    const id = cardId(card);
    if (handIds.has(id) && suppliedLegal.has(id) && derivedLegal.has(id)) unique.set(id, card);
  }
  return [...unique.values()].sort((a, b) => cardId(a).localeCompare(cardId(b)));
}

function cardPower(card: Card, trump: Suit): number {
  return rankValue(card.rank) + (card.suit === trump ? 20 : 0);
}

function trickWinner(trick: readonly TrickCard[], trump: Suit): string {
  const lead = trick[0].card.suit;
  const trumps = trick.filter((play) => play.card.suit === trump);
  const pool = trumps.length > 0 ? trumps : trick.filter((play) => play.card.suit === lead);
  return pool.reduce((best, play) =>
    rankValue(play.card.rank) > rankValue(best.card.rank) ? play : best
  ).deviceId;
}

function cloneHands(hands: Record<string, Card[]>): Record<string, Card[]> {
  return Object.fromEntries(Object.entries(hands).map(([id, hand]) => [id, [...hand]]));
}

function initialState(view: BotView, deal: PlausibleDeal): SimState {
  return {
    hands: cloneHands(deal.hands),
    won: { ...view.tricksWon },
    trick: view.currentTrick.map((play) => ({ deviceId: play.deviceId, card: { ...play.card } })),
    turnSeat: view.turnSeat,
  };
}

function consume(budget: WorkBudget): boolean {
  if (budget.remaining <= 0) return false;
  budget.remaining -= 1;
  budget.used += 1;
  return true;
}

function playInto(state: SimState, actor: string, card: Card, view: BotView): void {
  state.hands[actor] = (state.hands[actor] ?? []).filter((candidate) => cardId(candidate) !== cardId(card));
  state.trick.push({ deviceId: actor, card });
  if (state.trick.length === view.seatOrder.length) {
    const winner = trickWinner(state.trick, view.trumpSuit);
    state.won[winner] = (state.won[winner] ?? 0) + 1;
    state.trick = [];
    state.turnSeat = view.seatOrder.indexOf(winner);
  } else {
    state.turnSeat = (state.turnSeat + 1) % view.seatOrder.length;
  }
}

function cloneState(state: SimState): SimState {
  return {
    hands: cloneHands(state.hands),
    won: { ...state.won },
    trick: state.trick.map((play) => ({ deviceId: play.deviceId, card: { ...play.card } })),
    turnSeat: state.turnSeat,
  };
}

function terminal(state: SimState): boolean {
  return Object.values(state.hands).every((hand) => hand.length === 0) && state.trick.length === 0;
}

function roundScore(bid: number, won: number): number {
  return bid === won ? (bid + 1) * 10 + bid : bid;
}

function outcomeFor(state: SimState, view: BotView): Outcome {
  const exact: Record<string, boolean> = {};
  const finalScores: Record<string, number> = {};
  for (const id of view.seatOrder) {
    const bid = view.bids[id] ?? 0;
    const won = state.won[id] ?? 0;
    exact[id] = bid === won;
    finalScores[id] = (view.scores[id] ?? 0) + roundScore(bid, won);
  }
  const values = Object.values(finalScores);
  const strongest = Math.max(...values);
  const weakest = Math.min(...values);
  const average = values.reduce((sum, score) => sum + score, 0) / Math.max(1, values.length);
  const utilities: Record<string, number> = {};
  for (const id of view.seatOrder) {
    const bid = view.bids[id] ?? 0;
    const won = state.won[id] ?? 0;
    const score = roundScore(bid, won);
    const distance = Math.abs(bid - won);
    const final = finalScores[id];
    utilities[id] = score - distance * 7 + (final - average) * 0.06 +
      (final >= strongest ? 4 : 0) - (final <= weakest ? 8 : 0);
  }
  if (view.kind === "shaitaan") {
    const target = view.seatOrder
      .filter((id) => id !== view.botId)
      .sort((a, b) =>
        (view.scores[b] ?? 0) - (view.scores[a] ?? 0) ||
        (view.bids[b] ?? 0) - (view.bids[a] ?? 0) ||
        view.seatOrder.indexOf(a) - view.seatOrder.indexOf(b)
      )[0];
    if (target) {
      const ownSafe = exact[view.botId];
      const deniedTarget = !exact[target];
      utilities[view.botId] += deniedTarget ? (ownSafe ? 8 : 3) : (ownSafe ? -3 : 0);
    }
  }
  return { utilities, won: { ...state.won }, exact };
}

function reconstructOriginalHand(id: string, current: readonly Card[], view: BotView): Card[] {
  const hand = [...current];
  const known = new Set(hand.map(cardId));
  for (const play of view.playedCards) {
    if (play.deviceId !== id || known.has(cardId(play.card))) continue;
    known.add(cardId(play.card));
    hand.push(play.card);
  }
  for (const play of view.currentTrick) {
    if (play.deviceId !== id || known.has(cardId(play.card))) continue;
    known.add(cardId(play.card));
    hand.push(play.card);
  }
  return hand;
}

function quickBid(hand: readonly Card[], trump: Suit, cardsThisRound: number): number {
  const trumps = hand.filter((card) => card.suit === trump);
  let estimate = 0;
  for (const card of hand) {
    const rank = rankValue(card.rank);
    if (card.suit === trump) {
      if (rank === 12) estimate += 1;
      else if (rank === 11) estimate += 0.78;
      else if (rank === 10) estimate += 0.55;
      else if (rank >= 8) estimate += 0.3;
    } else if (rank === 12) estimate += 0.72;
    else if (rank === 11) estimate += cardsThisRound <= 3 ? 0.52 : 0.27;
    else if (rank === 10 && cardsThisRound <= 2) estimate += 0.25;
  }
  for (const suit of ["S", "H", "C", "D"] as Suit[]) {
    if (suit === trump) continue;
    const length = hand.filter((card) => card.suit === suit).length;
    if (length <= 1 && trumps.length > 0) estimate += Math.min(0.2, trumps.length * 0.05);
  }
  return Math.max(0, Math.min(cardsThisRound, Math.round(estimate)));
}

function bidWeight(view: BotView, hands: Record<string, Card[]>): number {
  let weight = 1;
  for (const id of view.seatOrder) {
    const observed = view.bids[id];
    if (id === view.botId || observed === null) continue;
    const original = reconstructOriginalHand(id, hands[id] ?? [], view);
    const predicted = quickBid(original, view.trumpSuit, view.cardsThisRound);
    const error = Math.abs(observed - predicted);
    const dealerEvidence = id === view.dealerDeviceId ? 0.42 : 0.72;
    const historyEvidence = view.historyComplete ? 1 : 0.65;
    weight *= Math.max(0.02, Math.exp(-dealerEvidence * historyEvidence * error));
  }
  return Math.max(0.0001, weight);
}

function opponentsByConstraint(view: BotView): string[] {
  return view.seatOrder.filter((id) => id !== view.botId).sort((a, b) => {
    const voidDifference = (view.voidSuits[b]?.length ?? 0) - (view.voidSuits[a]?.length ?? 0);
    return voidDifference || view.seatOrder.indexOf(a) - view.seatOrder.indexOf(b);
  });
}

function assignmentsFeasible(
  available: readonly Card[],
  opponents: readonly string[],
  from: number,
  view: BotView,
): boolean {
  let required = 0;
  for (let index = from; index < opponents.length; index += 1) {
    const id = opponents[index];
    const count = view.handCounts[id] ?? view.hand.length;
    required += count;
    const voids = new Set(view.voidSuits[id] ?? []);
    if (available.filter((card) => !voids.has(card.suit)).length < count) return false;
  }
  return available.length >= required;
}

function sampleDeal(view: BotView, sample: number): PlausibleDeal | null {
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
  const opponents = opponentsByConstraint(view);
  const seed = hash(`${fingerprint(view)}|deal:${sample}`);
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const available = shuffle(knowledge.unseenCards, rngFrom(seed + Math.imul(attempt + 1, 0x9e3779b9)));
    const hands: Record<string, Card[]> = { [view.botId]: [...view.hand] };
    let valid = true;
    for (let opponentIndex = 0; opponentIndex < opponents.length; opponentIndex += 1) {
      const id = opponents[opponentIndex];
      const count = view.handCounts[id] ?? view.hand.length;
      const voids = new Set(view.voidSuits[id] ?? []);
      const chosen: Card[] = [];
      while (chosen.length < count) {
        const candidates = available
          .map((card, index) => ({ card, index }))
          .filter(({ card }) => !voids.has(card.suit));
        const start = candidates.length === 0 ? 0 : Math.floor(rngFrom(seed + attempt * 131 + chosen.length * 17)() * candidates.length);
        let selected: { card: Card; index: number } | undefined;
        for (let offset = 0; offset < candidates.length; offset += 1) {
          const candidate = candidates[(start + offset) % candidates.length];
          const rest = available.filter((_, index) => index !== candidate.index);
          if (assignmentsFeasible(rest, opponents, opponentIndex + 1, view)) {
            selected = candidate;
            break;
          }
        }
        if (!selected) break;
        chosen.push(selected.card);
        available.splice(selected.index, 1);
      }
      if (chosen.length !== count) {
        valid = false;
        break;
      }
      hands[id] = chosen;
    }
    if (valid) return { hands, bidWeight: bidWeight(view, hands) };
  }
  return null;
}

function dealSignature(deal: PlausibleDeal, view: BotView): string {
  return view.seatOrder.map((id) => `${id}:${(deal.hands[id] ?? []).map(cardId).sort().join(",")}`).join("|");
}

function sampledDeals(view: BotView, maximum: number): PlausibleDeal[] {
  const deals = new Map<string, PlausibleDeal>();
  for (let sample = 0; sample < maximum * 5 && deals.size < maximum; sample += 1) {
    const deal = sampleDeal(view, sample);
    if (deal) deals.set(dealSignature(deal, view), deal);
  }
  return [...deals.values()];
}

function combinations<T>(
  values: readonly T[],
  count: number,
  visit: (chosen: T[]) => boolean,
  chosen: T[] = [],
  from = 0,
): boolean {
  if (chosen.length === count) return visit([...chosen]);
  const needed = count - chosen.length;
  for (let index = from; index <= values.length - needed; index += 1) {
    chosen.push(values[index]);
    if (!combinations(values, count, visit, chosen, index + 1)) return false;
    chosen.pop();
  }
  return true;
}

function enumerateEndgameDeals(view: BotView, maximum: number): { deals: PlausibleDeal[]; complete: boolean } {
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
  const opponents = opponentsByConstraint(view);
  const ordered = shuffle(knowledge.unseenCards, rngFrom(hash(`${fingerprint(view)}|enumerate`)));
  const deals: PlausibleDeal[] = [];
  let stopped = false;

  const assign = (opponentIndex: number, available: Card[], hands: Record<string, Card[]>): boolean => {
    if (opponentIndex === opponents.length) {
      deals.push({ hands: cloneHands(hands), bidWeight: bidWeight(view, hands) });
      if (deals.length > maximum) {
        stopped = true;
        return false;
      }
      return true;
    }
    const id = opponents[opponentIndex];
    const count = view.handCounts[id] ?? view.hand.length;
    const voids = new Set(view.voidSuits[id] ?? []);
    const eligible = available.filter((card) => !voids.has(card.suit));
    return combinations(eligible, count, (picked) => {
      const pickedIds = new Set(picked.map(cardId));
      const rest = available.filter((card) => !pickedIds.has(cardId(card)));
      if (!assignmentsFeasible(rest, opponents, opponentIndex + 1, view)) return true;
      hands[id] = picked;
      const keepGoing = assign(opponentIndex + 1, rest, hands);
      delete hands[id];
      return keepGoing;
    });
  };

  assign(0, ordered, { [view.botId]: [...view.hand] });
  return { deals: deals.slice(0, maximum), complete: !stopped };
}

function stateKey(state: SimState, view: BotView): string {
  return [
    state.turnSeat,
    view.seatOrder.map((id) => `${id}:${(state.hands[id] ?? []).map(cardId).sort().join(",")}`).join("|"),
    state.trick.map((play) => `${play.deviceId}:${cardId(play.card)}`).join(","),
    sortedRecord(state.won),
  ].join("/");
}

function currentlyWinning(actor: string, card: Card, trick: readonly TrickCard[], trump: Suit): boolean {
  return trickWinner([...trick, { deviceId: actor, card }], trump) === actor;
}

/** A public-state/own-hand policy used only beyond the explicitly searched tree. */
function rolloutChoice(actor: string, state: SimState, view: BotView): Card {
  const legal = legalFrom(state.hands[actor] ?? [], state.trick);
  const bid = view.bids[actor] ?? 0;
  const won = state.won[actor] ?? 0;
  const needed = bid - won;
  const left = state.hands[actor]?.length ?? 0;
  const ascending = [...legal].sort((a, b) => cardPower(a, view.trumpSuit) - cardPower(b, view.trumpSuit) || cardId(a).localeCompare(cardId(b)));
  if (state.trick.length > 0) {
    const winning = ascending.filter((card) => currentlyWinning(actor, card, state.trick, view.trumpSuit));
    const losing = ascending.filter((card) => !currentlyWinning(actor, card, state.trick, view.trumpSuit));
    if (needed <= 0 || needed > left) return losing.at(-1) ?? winning[0] ?? ascending[0];
    if (needed === left || needed / Math.max(1, left) >= 0.5) return winning[0] ?? losing.at(-1) ?? ascending[0];
    return losing.at(-1) ?? winning[0] ?? ascending[0];
  }
  if (needed <= 0 || needed > left) return ascending[0];
  if (needed === left || needed / Math.max(1, left) >= 0.5) return ascending.at(-1)!;
  const nonTrump = ascending.filter((card) => card.suit !== view.trumpSuit);
  return nonTrump[0] ?? ascending[0];
}

function finishByRollout(state: SimState, view: BotView, budget?: WorkBudget): Outcome {
  const simulation = cloneState(state);
  let safety = 0;
  while (!terminal(simulation) && safety < 64) {
    if (budget && !consume(budget)) break;
    const actor = view.seatOrder[simulation.turnSeat];
    const hand = simulation.hands[actor] ?? [];
    if (hand.length === 0) break;
    playInto(simulation, actor, rolloutChoice(actor, simulation, view), view);
    safety += 1;
  }
  return outcomeFor(simulation, view);
}

function exactContinuation(
  state: SimState,
  view: BotView,
  budget: WorkBudget,
  memo: Map<string, Outcome>,
): SolveResult {
  if (terminal(state)) return { outcome: outcomeFor(state, view), complete: true };
  const key = stateKey(state, view);
  const cached = memo.get(key);
  if (cached) return { outcome: cached, complete: true };
  if (!consume(budget)) return { outcome: finishByRollout(state, view, budget), complete: false };

  const actor = view.seatOrder[state.turnSeat];
  const legal = legalFrom(state.hands[actor] ?? [], state.trick)
    .sort((a, b) => cardId(a).localeCompare(cardId(b)));
  if (legal.length === 0) return { outcome: finishByRollout(state, view, budget), complete: false };

  let best: Outcome | null = null;
  let complete = true;
  for (const card of legal) {
    const child = cloneState(state);
    playInto(child, actor, card, view);
    const solved = exactContinuation(child, view, budget, memo);
    complete &&= solved.complete;
    if (!best || solved.outcome.utilities[actor] > best.utilities[actor]) best = solved.outcome;
  }
  const outcome = best ?? finishByRollout(state, view, budget);
  if (complete) memo.set(key, outcome);
  return { outcome, complete };
}

function emptyEvaluation(card: Card): CardSearchEvaluation {
  return { card, utility: 0, exactContractRate: 0, expectedHandsWon: 0, visits: 0, weight: 0 };
}

function addOutcome(evaluation: CardSearchEvaluation, outcome: Outcome, view: BotView, weight: number): void {
  evaluation.utility += (outcome.utilities[view.botId] ?? 0) * weight;
  evaluation.exactContractRate += (outcome.exact[view.botId] ? 1 : 0) * weight;
  evaluation.expectedHandsWon += (outcome.won[view.botId] ?? 0) * weight;
  evaluation.visits += 1;
  evaluation.weight += weight;
}

function finalizeEvaluations(evaluations: CardSearchEvaluation[]): CardSearchEvaluation[] {
  return evaluations.map((evaluation) => evaluation.weight > 0 ? {
    ...evaluation,
    utility: evaluation.utility / evaluation.weight,
    exactContractRate: evaluation.exactContractRate / evaluation.weight,
    expectedHandsWon: evaluation.expectedHandsWon / evaluation.weight,
  } : evaluation);
}

function chooseEvaluation(evaluations: CardSearchEvaluation[]): CardSearchEvaluation {
  return [...evaluations].sort((a, b) =>
    b.utility - a.utility ||
    b.exactContractRate - a.exactContractRate ||
    b.visits - a.visits ||
    cardId(a.card).localeCompare(cardId(b.card))
  )[0];
}

function searchEndgame(
  view: BotView,
  candidates: Card[],
  options: NormalizedOptions,
): CardSearchResult {
  const enumerated = enumerateEndgameDeals(view, options.maxEndgameDeals);
  const deals = enumerated.deals.length > 0 ? enumerated.deals : sampledDeals(view, Math.min(8, options.maxEndgameDeals));
  const evaluations = candidates.map(emptyEvaluation);
  const perCandidate = Math.max(1, Math.floor(options.maxNodes / candidates.length));
  let totalNodes = 0;
  let allComplete = enumerated.complete && deals.length > 0;

  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    const card = candidates[candidateIndex];
    const evaluation = evaluations[candidateIndex];
    const budget: WorkBudget = { remaining: perCandidate, used: 0 };
    for (const deal of deals) {
      const state = initialState(view, deal);
      if (!consume(budget)) {
        allComplete = false;
        break;
      }
      playInto(state, view.botId, card, view);
      const solved = exactContinuation(state, view, budget, new Map());
      allComplete &&= solved.complete;
      addOutcome(evaluation, solved.outcome, view, deal.bidWeight);
    }
    totalNodes += budget.used;
  }

  const final = finalizeEvaluations(evaluations);
  const chosen = chooseEvaluation(final);
  return {
    card: chosen.card,
    mode: allComplete ? "exact-endgame" : "sampled-endgame",
    evaluations: final,
    determinizations: deals.length,
    iterations: evaluations.reduce((sum, evaluation) => sum + evaluation.visits, 0),
    nodes: totalNodes,
    complete: allComplete,
  };
}

function actionStats(): ActionStats {
  return { visits: 0, weight: 0, utilityTotals: {}, exactWeight: 0, wonTotal: 0 };
}

function selectTreeAction(
  node: TreeNode,
  legal: Card[],
  actor: string,
  exploration: number,
  salt: number,
): { card: Card; stats: ActionStats; expanded: boolean } {
  const ordered = [...legal].sort((a, b) => cardId(a).localeCompare(cardId(b)));
  const unvisited = ordered.filter((card) => !node.actions.has(cardId(card)));
  if (unvisited.length > 0) {
    const card = unvisited[salt % unvisited.length];
    const stats = actionStats();
    node.actions.set(cardId(card), stats);
    return { card, stats, expanded: true };
  }
  const selected = ordered.map((card) => {
    const stats = node.actions.get(cardId(card))!;
    const average = (stats.utilityTotals[actor] ?? 0) / Math.max(0.0001, stats.weight);
    const bonus = exploration * 16 * Math.sqrt(Math.log(node.visits + 1) / Math.max(1, stats.visits));
    return { card, stats, score: average + bonus };
  }).sort((a, b) => b.score - a.score || cardId(a.card).localeCompare(cardId(b.card)))[0];
  return { ...selected, expanded: false };
}

function backpropagate(
  path: Array<{ node: TreeNode; stats: ActionStats }>,
  outcome: Outcome,
  view: BotView,
  weight: number,
): void {
  for (const { node, stats } of path) {
    node.visits += 1;
    stats.visits += 1;
    stats.weight += weight;
    for (const id of view.seatOrder) {
      stats.utilityTotals[id] = (stats.utilityTotals[id] ?? 0) + (outcome.utilities[id] ?? 0) * weight;
    }
    stats.exactWeight += (outcome.exact[view.botId] ? 1 : 0) * weight;
    stats.wonTotal += (outcome.won[view.botId] ?? 0) * weight;
  }
}

function searchIsmcts(
  view: BotView,
  candidates: Card[],
  options: NormalizedOptions,
): CardSearchResult {
  const deals = sampledDeals(view, options.maxDeals);
  if (deals.length === 0) {
    const evaluations = candidates.map((card) => ({ ...emptyEvaluation(card), visits: 1 }));
    return { card: candidates[0], mode: "ismcts", evaluations, determinizations: 0, iterations: 0, nodes: 0, complete: false };
  }

  const tree = new Map<string, TreeNode>();
  const root: TreeNode = { visits: 0, actions: new Map() };
  tree.set("root", root);
  const budget: WorkBudget = { remaining: options.maxNodes, used: 0 };
  let iterations = 0;

  while (iterations < options.maxIterations && budget.remaining > 0) {
    const deal = deals[iterations % deals.length];
    const state = initialState(view, deal);
    const path: Array<{ node: TreeNode; stats: ActionStats }> = [];
    let node = root;
    let pathKey = "root";
    let expanded = false;
    let depth = 0;

    while (!terminal(state) && budget.remaining > 0 && depth < 64) {
      const actor = view.seatOrder[state.turnSeat];
      const legal = actor === view.botId && depth === 0
        ? candidates
        : legalFrom(state.hands[actor] ?? [], state.trick);
      if (legal.length === 0 || !consume(budget)) break;
      const selected = selectTreeAction(node, legal, actor, options.exploration, hash(`${iterations}|${pathKey}`));
      path.push({ node, stats: selected.stats });
      playInto(state, actor, selected.card, view);
      pathKey = `${pathKey}>${actor}:${cardId(selected.card)}`;
      depth += 1;
      if (selected.expanded) {
        expanded = true;
        break;
      }
      let next = tree.get(pathKey);
      if (!next) {
        next = { visits: 0, actions: new Map() };
        tree.set(pathKey, next);
      }
      node = next;
    }

    const outcome = terminal(state) ? outcomeFor(state, view) : finishByRollout(state, view, budget);
    if (path.length > 0) backpropagate(path, outcome, view, deal.bidWeight);
    iterations += 1;
    if (!expanded && budget.remaining <= 0) break;
  }

  const evaluations = candidates.map((card) => {
    const stats = root.actions.get(cardId(card));
    if (!stats || stats.weight <= 0) return emptyEvaluation(card);
    return {
      card,
      utility: (stats.utilityTotals[view.botId] ?? 0) / stats.weight,
      exactContractRate: stats.exactWeight / stats.weight,
      expectedHandsWon: stats.wonTotal / stats.weight,
      visits: stats.visits,
      weight: stats.weight,
    };
  });
  const chosen = chooseEvaluation(evaluations);
  return {
    card: chosen.card,
    mode: "ismcts",
    evaluations,
    determinizations: deals.length,
    iterations,
    nodes: budget.used,
    complete: false,
  };
}

/**
 * Evaluate legal candidate cards using only a BotView.
 *
 * With two or fewer cards by default, the function enumerates as many feasible
 * hidden deals as the bounded cap allows and searches each continuation with Max-N
 * (every simulated player optimizes its own contract). Earlier in a round it uses
 * root-sampled information-set MCTS. Public bids weight, rather than reveal, hidden
 * deals. `complete` is deliberately conservative: it is true only when no deal or
 * continuation was omitted.
 */
export function searchBestCard(
  view: BotView,
  candidateCards: readonly Card[] = view.legalCards,
  options: CardSearchOptions = {},
): CardSearchResult {
  if (view.phase !== "trick") throw new Error("Card search requires the trick-playing phase");
  if (view.seatOrder[view.turnSeat] !== view.botId) throw new Error("Card search requires the bot's turn");
  const candidates = sanitizeCandidates(view, candidateCards);
  if (candidates.length === 0) throw new Error("Card search received no legal candidate card");
  if (candidates.length === 1) {
    return {
      card: candidates[0],
      mode: "trivial",
      evaluations: [{ ...emptyEvaluation(candidates[0]), visits: 1, weight: 1 }],
      determinizations: 0,
      iterations: 0,
      nodes: 0,
      complete: true,
    };
  }
  const settings = normalizedOptions(options);
  return view.hand.length <= settings.endgameHandSize
    ? searchEndgame(view, candidates, settings)
    : searchIsmcts(view, candidates, settings);
}
