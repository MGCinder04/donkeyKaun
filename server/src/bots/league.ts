import { cardId } from "../game/cards.js";
import {
  placeBid,
  playCard,
  resolvePendingTrick,
  startGame,
  type GameState,
} from "../game/engine.js";
import { chooseBid, chooseCard, legalBids, viewForBot } from "./strategy.js";
import { BOT_KINDS, type BotKind } from "./types.js";

export interface BotLeagueConfig {
  /** Each seed owns an independent, reproducible eight-round deal sequence. */
  seeds: readonly number[];
  /** One bot kind per physical seat. Rosters may contain between two and six seats. */
  rosters: readonly (readonly BotKind[])[];
  /** Safety ceiling for bids, plays, and hand resolutions in one complete game. */
  maxActionsPerGame?: number;
  /** Retain every bid/card decision for focused diagnosis. Keep false for large leagues. */
  captureDecisions?: boolean;
}

export interface LeagueDecision {
  seed: number;
  roster: BotKind[];
  action: number;
  round: number;
  bot: BotKind;
  seat: number;
  phase: "bid" | "play";
  hand: string[];
  publicCards: string[];
  bid: number | null;
  handsWon: number;
  legal: Array<number | string>;
  choice: number | string;
}

export interface LeagueFailureCounts {
  nonFinite: number;
  illegal: number;
  deadlock: number;
}

export interface BotKindLeagueMetrics extends LeagueFailureCounts {
  /** Completed bot-seat appearances, not the number of distinct table fixtures. */
  games: number;
  rounds: number;
  meanScore: number;
  exactBidRate: number;
  meanAbsoluteBidError: number;
  firstPlaceRate: number;
  donkeyRate: number;
  /** Bid was greater than the number of hands actually won. */
  overbidRate: number;
  /** Bid was less than the number of hands actually won. */
  underbidRate: number;
}

export interface BotLeagueResult {
  seeds: number[];
  rosters: BotKind[][];
  scheduledGames: number;
  completedGames: number;
  failures: LeagueFailureCounts;
  byKind: Record<BotKind, BotKindLeagueMetrics>;
  decisions?: LeagueDecision[];
}

interface MutableKindMetrics extends LeagueFailureCounts {
  games: number;
  rounds: number;
  scoreTotal: number;
  absoluteBidErrorTotal: number;
  exactRounds: number;
  overbidRounds: number;
  underbidRounds: number;
  firstPlaces: number;
  donkeyFinishes: number;
}

interface FixtureFailures {
  /** `false` means no failure; `null` means a fixture-level failure with no actor. */
  nonFinite: BotKind | null | false;
  illegal: BotKind | null | false;
  deadlock: BotKind | null | false;
}

const DEFAULT_MAX_ACTIONS = 2_000;
const KNOWN_BOT_KINDS = new Set<string>(BOT_KINDS);

/** Mulberry32 PRNG. Keeping deal randomness here separate from strategy randomness
 * ensures a strategy change cannot alter future deals in the same fixture. */
export function seededLeagueRng(seed: number): () => number {
  let value = seed | 0;
  return () => {
    value |= 0;
    value = (value + 0x6d2b79f5) | 0;
    let next = Math.imul(value ^ (value >>> 15), 1 | value);
    next = (next + Math.imul(next ^ (next >>> 7), 61 | next)) ^ next;
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function permutations<T>(values: readonly T[]): T[][] {
  if (values.length <= 1) return [[...values]];
  const result: T[][] = [];
  values.forEach((value, index) => {
    const rest = values.slice(0, index).concat(values.slice(index + 1));
    for (const suffix of permutations(rest)) result.push([value, ...suffix]);
  });
  return result;
}

/** All 24 seat assignments for one copy of each personality. This is deliberately
 * exhaustive because it is both balanced and still small enough for a smoke test. */
export function createBalancedFourKindRosters(): BotKind[][] {
  return permutations(BOT_KINDS);
}

function emptyMutableMetrics(): MutableKindMetrics {
  return {
    games: 0,
    rounds: 0,
    scoreTotal: 0,
    absoluteBidErrorTotal: 0,
    exactRounds: 0,
    overbidRounds: 0,
    underbidRounds: 0,
    firstPlaces: 0,
    donkeyFinishes: 0,
    nonFinite: 0,
    illegal: 0,
    deadlock: 0,
  };
}

function hasNonFiniteNumber(values: Iterable<number | null>): boolean {
  for (const value of values) {
    if (value !== null && !Number.isFinite(value)) return true;
  }
  return false;
}

function stateContainsNonFiniteNumber(state: GameState): boolean {
  if (
    hasNonFiniteNumber([
      state.round,
      state.cardsThisRound,
      state.dealerSeat,
      state.bidTurnIndex,
      state.turnSeat,
    ]) ||
    hasNonFiniteNumber(Object.values(state.bids)) ||
    hasNonFiniteNumber(Object.values(state.tricksWon)) ||
    hasNonFiniteNumber(Object.values(state.scores))
  ) {
    return true;
  }

  return state.roundHistory.some((summary) =>
    hasNonFiniteNumber([
      summary.round,
      ...summary.results.flatMap((result) => [result.bid, result.tricksWon, result.roundScore]),
    ]),
  );
}

function actorKind(state: GameState, kindsById: Readonly<Record<string, BotKind>>): BotKind | null {
  const actorId = state.phase === "bidding"
    ? state.bidOrder[state.bidTurnIndex]
    : state.seatOrder[state.turnSeat];
  return actorId ? kindsById[actorId] ?? null : null;
}

function runFixture(
  seed: number,
  roster: readonly BotKind[],
  maxActions: number,
  metrics: Record<BotKind, MutableKindMetrics>,
  decisions?: LeagueDecision[],
): { completed: boolean; failures: FixtureFailures } {
  const seatOrder = roster.map((_, seat) => `seat-${seat}`);
  const kindsById = Object.fromEntries(
    seatOrder.map((deviceId, seat) => [deviceId, roster[seat]]),
  ) as Record<string, BotKind>;
  const dealRng = seededLeagueRng(seed);
  let state = startGame(seatOrder, dealRng);
  let actions = 0;
  const failures: FixtureFailures = { nonFinite: false, illegal: false, deadlock: false };

  while (state.phase !== "game-end") {
    if (actions >= maxActions) {
      failures.deadlock = actorKind(state, kindsById);
      break;
    }

    const currentKind = actorKind(state, kindsById);
    try {
      if (state.phase === "bidding") {
        const deviceId = state.bidOrder[state.bidTurnIndex];
        if (!deviceId || !currentKind) {
          failures.deadlock = currentKind;
          break;
        }
        const botView = viewForBot(state, deviceId, currentKind);
        const bid = chooseBid(botView);
        decisions?.push({
          seed,
          roster: [...roster],
          action: actions,
          round: state.round,
          bot: currentKind,
          seat: state.seatOrder.indexOf(deviceId),
          phase: "bid",
          hand: botView.hand.map(cardId),
          publicCards: botView.playedCards.map((play) => cardId(play.card)),
          bid: null,
          handsWon: 0,
          legal: legalBids(botView),
          choice: bid,
        });
        if (!Number.isFinite(bid)) failures.nonFinite = currentKind;
        const result = placeBid(state, deviceId, bid);
        if (!result.ok) {
          failures.illegal = currentKind;
          break;
        }
        state = result.value;
      } else if (state.currentTrick.length === state.seatOrder.length) {
        state = resolvePendingTrick(state, dealRng);
      } else {
        const deviceId = state.seatOrder[state.turnSeat];
        if (!deviceId || !currentKind) {
          failures.deadlock = currentKind;
          break;
        }
        const botView = viewForBot(state, deviceId, currentKind);
        const card = chooseCard(botView);
        decisions?.push({
          seed,
          roster: [...roster],
          action: actions,
          round: state.round,
          bot: currentKind,
          seat: state.seatOrder.indexOf(deviceId),
          phase: "play",
          hand: botView.hand.map(cardId),
          publicCards: botView.playedCards.map((play) => cardId(play.card)),
          bid: botView.bids[deviceId],
          handsWon: botView.tricksWon[deviceId] ?? 0,
          legal: botView.legalCards.map(cardId),
          choice: cardId(card),
        });
        // Force evaluation of the public card identity before handing it to the engine;
        // malformed strategy output is counted as an illegal decision below.
        cardId(card);
        const result = playCard(state, deviceId, card, dealRng);
        if (!result.ok) {
          failures.illegal = currentKind;
          break;
        }
        state = result.value;
      }
    } catch {
      failures.illegal = currentKind;
      break;
    }

    actions += 1;
    if (stateContainsNonFiniteNumber(state)) {
      if (failures.nonFinite === false) failures.nonFinite = currentKind;
      break;
    }
  }

  const completed = state.phase === "game-end" && failures.nonFinite === false;
  if (!completed) return { completed: false, failures };

  const scores = Object.values(state.scores);
  const highestScore = Math.max(...scores);
  const lowestScore = Math.min(...scores);

  for (const deviceId of seatOrder) {
    const kind = kindsById[deviceId];
    const aggregate = metrics[kind];
    const score = state.scores[deviceId];
    aggregate.games += 1;
    aggregate.scoreTotal += score;
    if (score === highestScore) aggregate.firstPlaces += 1;
    if (score === lowestScore) aggregate.donkeyFinishes += 1;

    for (const summary of state.roundHistory) {
      const result = summary.results.find((candidate) => candidate.deviceId === deviceId);
      if (!result) continue;
      const difference = result.bid - result.tricksWon;
      aggregate.rounds += 1;
      aggregate.absoluteBidErrorTotal += Math.abs(difference);
      if (difference === 0) aggregate.exactRounds += 1;
      else if (difference > 0) aggregate.overbidRounds += 1;
      else aggregate.underbidRounds += 1;
    }
  }

  return { completed: true, failures };
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function finalizeMetrics(source: MutableKindMetrics): BotKindLeagueMetrics {
  return {
    games: source.games,
    rounds: source.rounds,
    meanScore: rate(source.scoreTotal, source.games),
    exactBidRate: rate(source.exactRounds, source.rounds),
    meanAbsoluteBidError: rate(source.absoluteBidErrorTotal, source.rounds),
    firstPlaceRate: rate(source.firstPlaces, source.games),
    donkeyRate: rate(source.donkeyFinishes, source.games),
    overbidRate: rate(source.overbidRounds, source.rounds),
    underbidRate: rate(source.underbidRounds, source.rounds),
    nonFinite: source.nonFinite,
    illegal: source.illegal,
    deadlock: source.deadlock,
  };
}

function validateConfig(config: BotLeagueConfig): number {
  if (config.seeds.length === 0) throw new Error("Bot league requires at least one seed");
  if (config.rosters.length === 0) throw new Error("Bot league requires at least one roster");
  for (const seed of config.seeds) {
    if (!Number.isSafeInteger(seed)) throw new Error(`Invalid deterministic seed: ${seed}`);
  }
  for (const roster of config.rosters) {
    if (roster.length < 2 || roster.length > 6) {
      throw new Error(`Bot league rosters must contain 2 to 6 seats; received ${roster.length}`);
    }
    for (const kind of roster) {
      if (!KNOWN_BOT_KINDS.has(kind)) throw new Error(`Unknown bot kind: ${kind}`);
    }
  }
  const maxActions = config.maxActionsPerGame ?? DEFAULT_MAX_ACTIONS;
  if (!Number.isSafeInteger(maxActions) || maxActions <= 0) {
    throw new Error("maxActionsPerGame must be a positive safe integer");
  }
  return maxActions;
}

export function runBotLeague(config: BotLeagueConfig): BotLeagueResult {
  const maxActions = validateConfig(config);
  const mutable = Object.fromEntries(
    BOT_KINDS.map((kind) => [kind, emptyMutableMetrics()]),
  ) as Record<BotKind, MutableKindMetrics>;
  const failures: LeagueFailureCounts = { nonFinite: 0, illegal: 0, deadlock: 0 };
  let completedGames = 0;
  const decisions = config.captureDecisions ? [] as LeagueDecision[] : undefined;

  for (const seed of config.seeds) {
    for (const roster of config.rosters) {
      const result = runFixture(seed, roster, maxActions, mutable, decisions);
      if (result.completed) completedGames += 1;
      for (const failure of ["nonFinite", "illegal", "deadlock"] as const) {
        const kind = result.failures[failure];
        if (kind !== false) {
          failures[failure] += 1;
          if (kind !== null) mutable[kind][failure] += 1;
        }
      }
    }
  }

  return {
    seeds: [...config.seeds],
    rosters: config.rosters.map((roster) => [...roster]),
    scheduledGames: config.seeds.length * config.rosters.length,
    completedGames,
    failures,
    byKind: Object.fromEntries(
      BOT_KINDS.map((kind) => [kind, finalizeMetrics(mutable[kind])]),
    ) as Record<BotKind, BotKindLeagueMetrics>,
    decisions,
  };
}
