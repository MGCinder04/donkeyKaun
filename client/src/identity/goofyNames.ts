const GOOFY_ADJECTIVES = [
  "Wobbly", "Sneaky", "Bouncy", "Giggle", "Spicy",
  "Dizzy", "Noodle", "Pickle", "Fizzy", "Cheeky",
  "Goofy", "Soggy", "Jumpy", "Turbo", "Grumpy",
] as const;

const GOOFY_NOUNS = [
  "Donkey", "Samosa", "Goblin", "Potato", "Penguin",
  "Papad", "Panda", "Pickle", "Noodle", "Biscuit",
] as const;

/** 15 × 10 = 150 short, silly names, all within the profile's 20-character limit. */
export const GOOFY_NAMES = GOOFY_ADJECTIVES.flatMap((adjective) =>
  GOOFY_NOUNS.map((noun) => `${adjective} ${noun}`),
);

export function randomGoofyName(rng: () => number = Math.random): string {
  return GOOFY_NAMES[Math.floor(rng() * GOOFY_NAMES.length)];
}
