import { describe, expect, it } from "vitest";
import { chooseBidBaseline, chooseCardBaseline } from "./strategy.js";
import {
  compareStrategies,
  currentStrategyPolicy,
  type StrategyPolicy,
} from "./compareStrategies.js";

function wrappedCurrent(name: string): StrategyPolicy {
  return {
    name,
    chooseBid: (view) => chooseBidBaseline(view),
    chooseCard: (view) => chooseCardBaseline(view),
  };
}

describe("paired strategy comparison", () => {
  it("gives equivalent wrappers identical deals, balanced seats, and identical metrics", () => {
    const result = compareStrategies({
      seeds: [0x12345678],
      rosters: [["bhola", "hisaabi", "shaitaan"]],
      baseline: currentStrategyPolicy("frozen current"),
      candidate: wrappedCurrent("wrapped current"),
      capturePairs: true,
    });

    expect(result.paired.scheduledPairs).toBe(3);
    expect(result.paired.completedPairs).toBe(3);
    expect(result.baseline.completedGames).toBe(3);
    expect(result.candidate.completedGames).toBe(3);
    expect(result.baseline.failures).toEqual({ illegal: 0, deadlock: 0, nonFinite: 0 });
    expect(result.candidate.failures).toEqual({ illegal: 0, deadlock: 0, nonFinite: 0 });
    expect(result.candidate).toEqual(result.baseline);
    expect(Object.values(result.delta).every((value) => value === 0)).toBe(true);
    expect(result.paired.meanScoreDelta).toBe(0);
    expect(result.paired.equalScoreRate).toBe(1);

    expect(result.pairs?.map((pair) => pair.evaluatedSeat)).toEqual([0, 1, 2]);
    for (const pair of result.pairs ?? []) {
      expect(pair.matchedDealFingerprints).toHaveLength(8);
      expect(new Set(pair.matchedDealFingerprints).size).toBe(8);
      expect(pair.baseline).toEqual(pair.candidate);
    }
  }, 15_000);

  it("is deterministic across repeated paired runs", () => {
    const config = {
      seeds: [17, 29],
      rosters: [["bhola", "hisaabi"]],
      baseline: currentStrategyPolicy("baseline"),
      candidate: wrappedCurrent("candidate"),
      capturePairs: true,
    } as const;

    expect(compareStrategies(config)).toEqual(compareStrategies(config));
  }, 15_000);

  it("counts illegal candidate decisions without changing the baseline result", () => {
    const illegalCandidate: StrategyPolicy = {
      name: "illegal candidate",
      chooseBid: () => -1,
      chooseCard: (view) => view.legalCards[0],
    };
    const result = compareStrategies({
      seeds: [7],
      rosters: [["bhola", "hisaabi"]],
      baseline: currentStrategyPolicy("baseline"),
      candidate: illegalCandidate,
      capturePairs: true,
    });

    expect(result.baseline.completedGames).toBe(2);
    expect(result.baseline.failures.illegal).toBe(0);
    expect(result.candidate.completedGames).toBe(0);
    expect(result.candidate.failures).toEqual({ illegal: 2, deadlock: 0, nonFinite: 0 });
    expect(result.paired.completedPairs).toBe(0);
    expect(result.pairs?.every((pair) => pair.candidate.failureActor === "evaluated")).toBe(true);
  }, 15_000);

  it("uses the action ceiling to report deadlocks rather than hang", () => {
    const result = compareStrategies({
      seeds: [3],
      rosters: [["bhola", "hisaabi"]],
      baseline: currentStrategyPolicy("baseline"),
      candidate: wrappedCurrent("candidate"),
      maxActionsPerGame: 1,
    });

    expect(result.baseline.failures.deadlock).toBe(2);
    expect(result.candidate.failures.deadlock).toBe(2);
    expect(result.baseline.completedGames).toBe(0);
    expect(result.candidate.completedGames).toBe(0);
  });
});
