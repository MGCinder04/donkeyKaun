const GOOFY_ADJECTIVES = [
  "Wobbly", "Sneaky", "Bouncy", "Giggle", "Spicy",
  "Dizzy", "Noodle", "Pickle", "Fizzy", "Cheeky",
  "Soggy", "Jumpy", "Turbo", "Grumpy", "Silly",
  "Wacky", "Fluffy", "Tiny", "Wonky", "Zippy",
] as const;

const GOOFY_NOUNS = [
  "Donkey", "Samosa", "Goblin", "Potato", "Penguin",
  "Papad", "Panda", "Pickle", "Noodle", "Biscuit",
  "Badger", "Banana", "Bandit", "Beagle", "Beetle",
  "Bhoot", "Biryani", "Blob", "Buffalo", "Bunny",
  "Cactus", "Chutney", "Cobra", "Dholak", "Dodo",
  "Dragon", "Dumpling", "Ferret", "Gorilla", "Jalebi",
  "Koala", "Ladoo", "Lizard", "Momo", "Muffin",
  "Otter", "Pakora", "Pigeon", "Poodle", "Prawn",
  "Pumpkin", "Raccoon", "Rasgulla", "Sausage", "Sloth",
  "Tandoori", "Tater", "Tikki", "Turnip", "Wombat",
] as const;

/** 20 × 50 = 1,000 short, silly names, all within the profile's 20-character limit. */
export const GOOFY_NAMES = GOOFY_ADJECTIVES.flatMap((adjective) =>
  GOOFY_NOUNS.map((noun) => `${adjective} ${noun}`),
);

export function randomGoofyName(rng: () => number = Math.random): string {
  return GOOFY_NAMES[Math.floor(rng() * GOOFY_NAMES.length)];
}
