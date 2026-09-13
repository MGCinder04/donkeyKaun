export const BOT_KINDS = ["bhola", "hisaabi", "shaitaan", "ustaad"] as const;

export type BotKind = (typeof BOT_KINDS)[number];

export interface BotProfile {
  kind: BotKind;
  name: string;
  emoji: string;
  label: string;
  description: string;
  delayMs: number;
}

export const BOT_PROFILES: Record<BotKind, BotProfile> = {
  bhola: {
    kind: "bhola",
    name: "Bhola",
    emoji: "🐣",
    label: "Easy",
    description: "Plays by instinct and occasionally misjudges a hand.",
    delayMs: 380,
  },
  hisaabi: {
    kind: "hisaabi",
    name: "Hisaabi",
    emoji: "🦉",
    label: "Calculated",
    description: "Counts strength, protects its bid, and wastes cards carefully.",
    delayMs: 520,
  },
  shaitaan: {
    kind: "shaitaan",
    name: "Shaitaan",
    emoji: "😈",
    label: "Saboteur",
    description: "Turns disruptive when its own bid is safe or already lost.",
    delayMs: 620,
  },
  ustaad: {
    kind: "ustaad",
    name: "Ustaad",
    emoji: "🧠",
    label: "Expert",
    description: "Tracks the table, adapts to scores, and minimizes donkey risk.",
    delayMs: 720,
  },
};

export function isBotKind(value: unknown): value is BotKind {
  return typeof value === "string" && BOT_KINDS.includes(value as BotKind);
}
