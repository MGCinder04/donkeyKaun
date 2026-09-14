import { cardId, type Card } from "../game/cards.js";
import {
  placeBid,
  playCard,
  resolvePendingTrick,
  startGame,
  type GameState,
} from "../game/engine.js";
import {
  chooseBidBaseline,
  chooseCardBaseline,
  viewForBot,
  type BotView,
} from "./strategy.js";
import { seededLeagueRng } from "./league.js";
import { BOT_KINDS, type BotKind } from "./types.js";

/** A strategy is deliberately just two injectable decisions. Keeping this seam
 * independent from chooseBid/chooseCard lets a candidate be evaluated before it
 * replaces the production policy. */
export interface StrategyPolicy {
  readonly name: string;
  readonly chooseBid: (view: BotView) => number;
  readonly chooseCard: (view: BotView) => Card;
}

export interface StrategyComparisonConfig {
  /** Every seed produces one reproducible eight-round deal sequence. */
  seeds: readonly number[];
  /** Bot personality at each physical seat. Every seat is evaluated in turn. */
  rosters: readonly (readonly BotKind[])[];
  /** Stable policy being protected against regression. */
  baseline: StrategyPolicy;
  /** New policy under evaluation. */
  candidate: StrategyPolicy;
  /** Frozen policy used by all non-evaluated seats. Defaults to baseline. */
  opponents?: StrategyPolicy;
  /** Safety ceiling for bids, plays, and hand resolutions in one game. */
  maxActionsPerGame?: number;
  /** Retain per-pair outcomes. Leave false for large qualification runs. */
  capturePairs?: boolean;
}

export interface ComparisonFailureCounts {
  illegal: number;
  deadlock: number;
  nonFinite: number;
}

export interface StrategyMetrics {
  scheduledGames: number;
  completedGames: number;
  completedRounds: number;
  failures: ComparisonFailureCounts;
  meanScore: number;
  exactBidRate: number;
  meanAbsoluteBidError: number;
  /** Ties for the highest score count as first place, matching the bot league. */
  firstPlaceRate: number;
  /** Ties for the lowest score count as donkey finishes. */
  donkeyRate: number;
}

export interface StrategyMetricDelta {
  /** Candidate minus baseline. Positive is desirable for score/exact/first. */
  meanScore: number;
  exactBidRate: number;
  /** Candidate minus baseline. Negative is desirable for bid error/donkey. */
  meanAbsoluteBidError: number;
  firstPlaceRate: number;
  donkeyRate: number;
}

export interface CapturedGameOutcome {
  completed: boolean;
  score: number | null;
  exactBidRate: number | null;
  meanAbsoluteBidError: number | null;
  firstPlace: boolean | null;
  donkey: boolean | null;
  failure: keyof ComparisonFailureCounts | null;
  failureActor: "evaluated" | "opponent" | null;
}

export interface StrategyPairOutcome {
  seed: number;
  roster: BotKind[];
  evaluatedSeat: number;
  evaluatedKind: BotKind;
  /** One digest per round reached by both arms; equality is verified internally. */
  matchedDealFingerprints: string[];
  baseline: CapturedGameOutcome;
  candidate: CapturedGameOutcome;
}

export interface PairedMetrics {
  scheduledPairs: number;
  completedPairs: number;
  meanScoreDelta: number;
  candidateHigherScoreRate: number;
  candidateLowerScoreRate: number;
  equalScoreRate: number;
}

export interface StrategyComparisonResult {
  baselineName: string;
  candidateName: string;
  opponentName: string;
  seeds: number[];
  rosters: BotKind[][];
  baseline: StrategyMetrics;
  candidate: StrategyMetrics;
  delta: StrategyMetricDelta;
  paired: PairedMetrics;
  pairs?: StrategyPairOutcome[];
}

interface FixtureOutcome extends CapturedGameOutcome {
  rounds: number;
  exactRounds: number;
  absoluteBidErrorTotal: number;
  dealFingerprints: string[];
}

interface MutableMetrics {
  scheduledGames: number;
  completedGames: number;
  completedRounds: number;
  scoreTotal: number;
  exactRounds: number;
  absoluteBidErrorTotal: number;
  firstPlaces: number;
  donkeyFinishes: number;
  failures: ComparisonFailureCounts;
}

const DEFAULT_MAX_ACTIONS = 2_000;
const KNOWN_BOT_KINDS = new Set<string>(BOT_KINDS);

/** Convenience adapter for smoke tests and for comparing a candidate module with
 * today's production implementation. For a long-lived frozen baseline, pass
 * functions imported from the archived baseline module instead. */
export function currentStrategyPolicy(name = "frozen-baseline"): StrategyPolicy {
  return Object.freeze({ name, chooseBid: chooseBidBaseline, chooseCard: chooseCardBaseline });
}

/** Copies and freezes the policy boundary so a comparison cannot swap handlers
 * halfway through a run. */
function freezePolicy(policy: StrategyPolicy, field: string): StrategyPolicy {
  if (!policy || typeof policy.name !== "string" || policy.name.trim() === "") {
    throw new Error(`${field} policy requires a non-empty name`);
  }
  if (typeof policy.chooseBid !== "function" || typeof policy.chooseCard !== "function") {
    throw new Error(`${field} policy requires chooseBid and chooseCard functions`);
  }
  return Object.freeze({
    name: policy.name,
    chooseBid: policy.chooseBid,
    chooseCard: policy.chooseCard,
  });
}

function emptyMetrics(): MutableMetrics {
  return {
    scheduledGames: 0,
    completedGames: 0,
    completedRounds: 0,
    scoreTotal: 0,
    exactRounds: 0,
    absoluteBidErrorTotal: 0,
    firstPlaces: 0,
    donkeyFinishes: 0,
    failures: { illegal: 0, deadlock: 0, nonFinite: 0 },
  };
}

function finiteState(state: GameState): boolean {
  const values = [
    state.round,
    state.cardsThisRound,
    state.dealerSeat,
    state.bidTurnIndex,
    state.turnSeat,
    ...Object.values(state.bids).filter((bid): bid is number => bid !== null),
    ...Object.values(state.tricksWon),
    ...Object.values(state.scores),
  ];
  return values.every(Number.isFinite);
}

function hashText(text: string): string {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0).toString(16).padStart(8, "0");
}

/** Seat-labelled hands make the digest sensitive to both cards and seat rotation. */
function dealFingerprint(state: GameState): string {
  const deal = state.seatOrder.map((id) =>
    `${id}:${(state.hands[id] ?? []).map(cardId).sort().join(",")}`,
  ).join("|");
  return `${state.round}:${hashText(deal)}`;
}

function failureOutcome(
  kind: keyof ComparisonFailureCounts,
  actor: "evaluated" | "opponent" | null,
  dealFingerprints: string[],
): FixtureOutcome {
  return {
    completed: false,
    score: null,
    exactBidRate: null,
    meanAbsoluteBidError: null,
    firstPlace: null,
    donkey: null,
    failure: kind,
    failureActor: actor,
    rounds: 0,
    exactRounds: 0,
    absoluteBidErrorTotal: 0,
    dealFingerprints,
  };
}

function runFixture(
  seed: number,
  roster: readonly BotKind[],
  evaluatedSeat: number,
  evaluatedPolicy: StrategyPolicy,
  opponentPolicy: StrategyPolicy,
  maxActions: number,
): FixtureOutcome {
  const seatOrder = roster.map((_, seat) => `seat-${seat}`);
  const evaluatedId = seatOrder[evaluatedSeat];
  const rng = seededLeagueRng(seed);
  let state = startGame(seatOrder, rng);
  let actions = 0;
  let recordedRound = 0;
  const dealFingerprints: string[] = [];

  const recordDeal = () => {
    if (state.round !== recordedRound) {
      recordedRound = state.round;
      dealFingerprints.push(dealFingerprint(state));
    }
  };
  recordDeal();

  while (state.phase !== "game-end") {
    if (actions >= maxActions) {
      const actorId = state.phase === "bidding"
        ? state.bidOrder[state.bidTurnIndex]
        : state.seatOrder[state.turnSeat];
      return failureOutcome("deadlock", actorId ? (actorId === evaluatedId ? "evaluated" : "opponent") : null, dealFingerprints);
    }

    if (!finiteState(state)) return failureOutcome("nonFinite", null, dealFingerprints);

    if (state.phase === "trick" && state.currentTrick.length === state.seatOrder.length) {
      state = resolvePendingTrick(state, rng);
      actions += 1;
      recordDeal();
      continue;
    }

    const actorId = state.phase === "bidding"
      ? state.bidOrder[state.bidTurnIndex]
      : state.seatOrder[state.turnSeat];
    if (!actorId) return failureOutcome("deadlock", null, dealFingerprints);
    const actorRole = actorId === evaluatedId ? "evaluated" : "opponent";
    const policy = actorRole === "evaluated" ? evaluatedPolicy : opponentPolicy;
    const kind = roster[state.seatOrder.indexOf(actorId)];

    try {
      const view = viewForBot(state, actorId, kind);
      if (state.phase === "bidding") {
        const bid = policy.chooseBid(view);
        if (!Number.isFinite(bid)) return failureOutcome("nonFinite", actorRole, dealFingerprints);
        const result = placeBid(state, actorId, bid);
        if (!result.ok) return failureOutcome("illegal", actorRole, dealFingerprints);
        state = result.value;
      } else {
        const card = policy.chooseCard(view);
        // Evaluate identity before entering the engine so malformed injected output
        // is reported as an illegal policy action rather than crashing the harness.
        cardId(card);
        const result = playCard(state, actorId, card, rng);
        if (!result.ok) return failureOutcome("illegal", actorRole, dealFingerprints);
        state = result.value;
      }
    } catch {
      return failureOutcome("illegal", actorRole, dealFingerprints);
    }

    actions += 1;
    recordDeal();
  }

  if (!finiteState(state)) return failureOutcome("nonFinite", null, dealFingerprints);
  const score = state.scores[evaluatedId];
  const scores = Object.values(state.scores);
  const firstPlace = score === Math.max(...scores);
  const donkey = score === Math.min(...scores);
  let exactRounds = 0;
  let absoluteBidErrorTotal = 0;
  for (const round of state.roundHistory) {
    const result = round.results.find((entry) => entry.deviceId === evaluatedId);
    if (!result) continue;
    const error = Math.abs(result.bid - result.tricksWon);
    absoluteBidErrorTotal += error;
    if (error === 0) exactRounds += 1;
  }
  const rounds = state.roundHistory.length;

  return {
    completed: true,
    score,
    exactBidRate: rounds === 0 ? 0 : exactRounds / rounds,
    meanAbsoluteBidError: rounds === 0 ? 0 : absoluteBidErrorTotal / rounds,
    firstPlace,
    donkey,
    failure: null,
    failureActor: null,
    rounds,
    exactRounds,
    absoluteBidErrorTotal,
    dealFingerprints,
  };
}

function collect(metrics: MutableMetrics, outcome: FixtureOutcome): void {
  metrics.scheduledGames += 1;
  if (!outcome.completed) {
    if (outcome.failure) metrics.failures[outcome.failure] += 1;
    return;
  }
  metrics.completedGames += 1;
  metrics.completedRounds += outcome.rounds;
  metrics.scoreTotal += outcome.score ?? 0;
  metrics.exactRounds += outcome.exactRounds;
  metrics.absoluteBidErrorTotal += outcome.absoluteBidErrorTotal;
  if (outcome.firstPlace) metrics.firstPlaces += 1;
  if (outcome.donkey) metrics.donkeyFinishes += 1;
}

function divide(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function finalize(metrics: MutableMetrics): StrategyMetrics {
  return {
    scheduledGames: metrics.scheduledGames,
    completedGames: metrics.completedGames,
    completedRounds: metrics.completedRounds,
    failures: { ...metrics.failures },
    meanScore: divide(metrics.scoreTotal, metrics.completedGames),
    exactBidRate: divide(metrics.exactRounds, metrics.completedRounds),
    meanAbsoluteBidError: divide(metrics.absoluteBidErrorTotal, metrics.completedRounds),
    firstPlaceRate: divide(metrics.firstPlaces, metrics.completedGames),
    donkeyRate: divide(metrics.donkeyFinishes, metrics.completedGames),
  };
}

function validateConfig(config: StrategyComparisonConfig): number {
  if (config.seeds.length === 0) throw new Error("Strategy comparison requires at least one seed");
  if (config.rosters.length === 0) throw new Error("Strategy comparison requires at least one roster");
  for (const seed of config.seeds) {
    if (!Number.isSafeInteger(seed)) throw new Error(`Invalid deterministic seed: ${seed}`);
  }
  for (const roster of config.rosters) {
    if (roster.length < 2 || roster.length > 6) {
      throw new Error(`Comparison rosters must contain 2 to 6 seats; received ${roster.length}`);
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

function publicOutcome(outcome: FixtureOutcome): CapturedGameOutcome {
  const { completed, score, exactBidRate, meanAbsoluteBidError, firstPlace, donkey, failure, failureActor } = outcome;
  return { completed, score, exactBidRate, meanAbsoluteBidError, firstPlace, donkey, failure, failureActor };
}

/**
 * Runs paired A/B fixtures. For every seed and roster, the evaluated strategy is
 * rotated through every seat. Baseline and candidate receive the same deals; all
 * other seats use one frozen opponent policy. Aggregate metrics include only the
 * evaluated seat, preventing the unchanged opponents from diluting the result.
 */
export function compareStrategies(config: StrategyComparisonConfig): StrategyComparisonResult {
  const maxActions = validateConfig(config);
  const baselinePolicy = freezePolicy(config.baseline, "baseline");
  const candidatePolicy = freezePolicy(config.candidate, "candidate");
  const opponentPolicy = freezePolicy(config.opponents ?? config.baseline, "opponent");
  const baselineMutable = emptyMetrics();
  const candidateMutable = emptyMetrics();
  const pairs = config.capturePairs ? [] as StrategyPairOutcome[] : undefined;
  let completedPairs = 0;
  let scoreDeltaTotal = 0;
  let candidateHigher = 0;
  let candidateLower = 0;
  let equal = 0;

  for (const seed of config.seeds) {
    for (const roster of config.rosters) {
      for (let evaluatedSeat = 0; evaluatedSeat < roster.length; evaluatedSeat += 1) {
        const baseline = runFixture(seed, roster, evaluatedSeat, baselinePolicy, opponentPolicy, maxActions);
        const candidate = runFixture(seed, roster, evaluatedSeat, candidatePolicy, opponentPolicy, maxActions);
        const sharedRounds = Math.min(baseline.dealFingerprints.length, candidate.dealFingerprints.length);
        const matchedDealFingerprints = baseline.dealFingerprints.slice(0, sharedRounds);
        for (let round = 0; round < sharedRounds; round += 1) {
          if (baseline.dealFingerprints[round] !== candidate.dealFingerprints[round]) {
            throw new Error(`Deal sequence diverged for seed ${seed}, seat ${evaluatedSeat}, round ${round + 1}`);
          }
        }

        collect(baselineMutable, baseline);
        collect(candidateMutable, candidate);
        if (baseline.completed && candidate.completed) {
          completedPairs += 1;
          const scoreDelta = (candidate.score ?? 0) - (baseline.score ?? 0);
          scoreDeltaTotal += scoreDelta;
          if (scoreDelta > 0) candidateHigher += 1;
          else if (scoreDelta < 0) candidateLower += 1;
          else equal += 1;
        }

        pairs?.push({
          seed,
          roster: [...roster],
          evaluatedSeat,
          evaluatedKind: roster[evaluatedSeat],
          matchedDealFingerprints,
          baseline: publicOutcome(baseline),
          candidate: publicOutcome(candidate),
        });
      }
    }
  }

  const baseline = finalize(baselineMutable);
  const candidate = finalize(candidateMutable);
  const scheduledPairs = config.seeds.reduce(
    (total) => total + config.rosters.reduce((seats, roster) => seats + roster.length, 0),
    0,
  );

  return {
    baselineName: baselinePolicy.name,
    candidateName: candidatePolicy.name,
    opponentName: opponentPolicy.name,
    seeds: [...config.seeds],
    rosters: config.rosters.map((roster) => [...roster]),
    baseline,
    candidate,
    delta: {
      meanScore: candidate.meanScore - baseline.meanScore,
      exactBidRate: candidate.exactBidRate - baseline.exactBidRate,
      meanAbsoluteBidError: candidate.meanAbsoluteBidError - baseline.meanAbsoluteBidError,
      firstPlaceRate: candidate.firstPlaceRate - baseline.firstPlaceRate,
      donkeyRate: candidate.donkeyRate - baseline.donkeyRate,
    },
    paired: {
      scheduledPairs,
      completedPairs,
      meanScoreDelta: divide(scoreDeltaTotal, completedPairs),
      candidateHigherScoreRate: divide(candidateHigher, completedPairs),
      candidateLowerScoreRate: divide(candidateLower, completedPairs),
      equalScoreRate: divide(equal, completedPairs),
    },
    pairs,
  };
}
