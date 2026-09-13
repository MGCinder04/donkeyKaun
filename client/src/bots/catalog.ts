export const BOT_KINDS = ["bhola", "hisaabi", "shaitaan", "ustaad"] as const;
export type BotKind = (typeof BOT_KINDS)[number];

export const BOT_PROFILES: Record<BotKind, { name: string; emoji: string; level: string; description: string }> = {
  bhola: { name: "Bhola", emoji: "🐣", level: "Easy", description: "Plays by instinct and sometimes misjudges a hand." },
  hisaabi: { name: "Hisaabi", emoji: "🦉", level: "Calculated", description: "Protects its bid and spends strong cards carefully." },
  shaitaan: { name: "Shaitaan", emoji: "😈", level: "Saboteur", description: "Disrupts everyone once its own plan is safe or lost." },
  ustaad: { name: "Ustaad", emoji: "🧠", level: "Expert", description: "Adapts to the table and fights hard to avoid last place." },
};
