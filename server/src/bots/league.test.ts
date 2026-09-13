import { describe, expect, it } from "vitest";
import { BOT_KINDS } from "./types.js";
import { createBalancedFourKindRosters, runBotLeague } from "./league.js";

describe("deterministic bot evaluation league", () => {
  it("creates an exhaustive and seat-balanced four-personality schedule", () => {
    const rosters = createBalancedFourKindRosters();

    expect(rosters).toHaveLength(24);
    expect(new Set(rosters.map((roster) => roster.join("|"))).size).toBe(24);

    for (const kind of BOT_KINDS) {
      for (let seat = 0; seat < BOT_KINDS.length; seat += 1) {
        expect(rosters.filter((roster) => roster[seat] === kind)).toHaveLength(6);
      }
    }
  });

  it("runs a fast balanced league with complete, finite, reproducible metrics", () => {
    const config = {
      seeds: [0x1a2b3c4d, 0x55667788],
      rosters: createBalancedFourKindRosters(),
    } as const;

    const first = runBotLeague(config);
    const replay = runBotLeague(config);

    expect(replay).toEqual(first);
    expect(first.scheduledGames).toBe(48);
    expect(first.completedGames).toBe(48);
    expect(first.failures).toEqual({ nonFinite: 0, illegal: 0, deadlock: 0 });

    for (const kind of BOT_KINDS) {
      const metrics = first.byKind[kind];
      expect(metrics.games).toBe(48);
      expect(metrics.rounds).toBe(384);
      expect(metrics.nonFinite).toBe(0);
      expect(metrics.illegal).toBe(0);
      expect(metrics.deadlock).toBe(0);
      expect(metrics.meanScore).toBeGreaterThanOrEqual(0);
      expect(metrics.meanAbsoluteBidError).toBeGreaterThanOrEqual(0);
      expect(metrics.firstPlaceRate).toBeGreaterThanOrEqual(0);
      expect(metrics.firstPlaceRate).toBeLessThanOrEqual(1);
      expect(metrics.donkeyRate).toBeGreaterThanOrEqual(0);
      expect(metrics.donkeyRate).toBeLessThanOrEqual(1);
      expect(metrics.exactBidRate + metrics.overbidRate + metrics.underbidRate).toBeCloseTo(1, 12);

      for (const value of Object.values(metrics)) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }

    // This two-seed run is deliberately only a fast determinism/safety smoke test.
    // Statistical strength is measured by the independent holdout qualification run.
  }, 15_000);

  it("reports a deterministic safety-stop as a deadlock instead of hanging", () => {
    const result = runBotLeague({
      seeds: [7],
      rosters: [["bhola", "ustaad"]],
      maxActionsPerGame: 1,
    });

    expect(result.scheduledGames).toBe(1);
    expect(result.completedGames).toBe(0);
    expect(result.failures).toEqual({ nonFinite: 0, illegal: 0, deadlock: 1 });
  });

  it("can retain every bot decision for diagnosis", () => {
    const result = runBotLeague({
      seeds: [91],
      rosters: [["bhola", "hisaabi", "shaitaan", "ustaad"]],
      captureDecisions: true,
    });
    expect(result.decisions?.length).toBeGreaterThan(100);
    expect(result.decisions?.some((decision) => decision.phase === "bid")).toBe(true);
    expect(result.decisions?.some((decision) => decision.phase === "play")).toBe(true);
    for (const decision of result.decisions ?? []) expect(decision.legal).toContain(decision.choice);
  });
});
