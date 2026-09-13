import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createBalancedFourKindRosters, runBotLeague, type BotKindLeagueMetrics } from "./league.js";
import { BOT_KINDS, type BotKind } from "./types.js";

const HOLDOUT_SEEDS = Array.from({ length: 40 }, (_, index) =>
  (0x6a09e667 + Math.imul(index + 1, 0x9e3779b1)) >>> 0,
);

interface Interval {
  mean: number;
  low95: number;
  high95: number;
}

function interval(values: number[]): Interval {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.length <= 1
    ? 0
    : values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / (values.length - 1);
  // Student-t critical value for 39 degrees of freedom (40 seed clusters).
  const halfWidth = 2.0227 * Math.sqrt(variance / values.length);
  return { mean, low95: mean - halfWidth, high95: mean + halfWidth };
}

function bestOther(
  byKind: Record<BotKind, BotKindLeagueMetrics>,
  metric: keyof Pick<BotKindLeagueMetrics, "meanScore" | "exactBidRate" | "donkeyRate">,
  mode: "max" | "min",
): number {
  const values = BOT_KINDS.filter((kind) => kind !== "ustaad").map((kind) => byKind[kind][metric]);
  return mode === "max" ? Math.max(...values) : Math.min(...values);
}

function rotations<T>(values: readonly T[]): T[][] {
  return values.map((_, offset) => values.slice(offset).concat(values.slice(0, offset)));
}

function balancedRosters(size: 4 | 5 | 6): BotKind[][] {
  if (size === 4) return createBalancedFourKindRosters();
  const bases: BotKind[][] = [];
  if (size === 5) {
    for (const duplicate of BOT_KINDS) bases.push([...BOT_KINDS, duplicate]);
  } else {
    for (let left = 0; left < BOT_KINDS.length; left += 1) {
      for (let right = left + 1; right < BOT_KINDS.length; right += 1) {
        bases.push([...BOT_KINDS, BOT_KINDS[left], BOT_KINDS[right]]);
      }
    }
  }
  return bases.flatMap(rotations);
}

function qualifyFormat(size: 4 | 5 | 6) {
  const rosters = balancedRosters(size);
  const combined = runBotLeague({ seeds: HOLDOUT_SEEDS, rosters });
  const perSeed = HOLDOUT_SEEDS.map((seed) => runBotLeague({ seeds: [seed], rosters }));
  return {
    tableSize: size,
    rostersPerSeed: rosters.length,
    result: combined,
    ustaadHoldoutAdvantage: {
      scoreVersusBestOther: interval(perSeed.map((result) =>
        result.byKind.ustaad.meanScore - bestOther(result.byKind, "meanScore", "max"),
      )),
      exactBidRateVersusBestOther: interval(perSeed.map((result) =>
        result.byKind.ustaad.exactBidRate - bestOther(result.byKind, "exactBidRate", "max"),
      )),
      donkeyRateReductionVersusBestOther: interval(perSeed.map((result) =>
        bestOther(result.byKind, "donkeyRate", "min") - result.byKind.ustaad.donkeyRate,
      )),
    },
    perSeedMetrics: perSeed.map((result) => ({
      seed: result.seeds[0],
      failures: result.failures,
      byKind: result.byKind,
    })),
  };
}

const formats = ([4, 5, 6] as const).map(qualifyFormat);
const strategyCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

const artifact = {
  generatedAt: new Date().toISOString(),
  methodology: {
    description: "Frozen-strategy holdout deals; exhaustive four-player permutations and balanced five/six-player rotations",
    independentSeeds: HOLDOUT_SEEDS.length,
    seedManifest: HOLDOUT_SEEDS,
    tableSizes: [4, 5, 6],
    scheduledGames: formats.reduce((sum, format) => sum + format.result.scheduledGames, 0),
    confidenceIntervals: "Student-t 95% intervals clustered by independent deal seed",
    strategyCommit,
    nodeVersion: process.version,
  },
  formats,
};

const output = resolve(process.cwd(), "..", "docs", "BOT_QUALIFICATION.json");
await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  output,
  ...artifact.methodology,
  formats: formats.map((format) => ({
    tableSize: format.tableSize,
    scheduledGames: format.result.scheduledGames,
    failures: format.result.failures,
    ustaad: format.result.byKind.ustaad,
    advantage: format.ustaadHoldoutAdvantage,
  })),
}, null, 2));
