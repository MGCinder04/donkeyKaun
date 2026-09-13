export const DICEBEAR_STYLE_KEYS = [
  "adventurer",
  "avataaars",
  "bigSmile",
  "croodles",
  "funEmoji",
  "notionists",
  "openPeeps",
  "personas",
  "thumbs",
] as const;

const MALE_SEEDS = [
  "Dev", "Aarav", "Rohan", "Karan", "Vikram", "Sameer", "Ishaan", "Nikhil", "Arjun", "Rahul",
];

const FEMALE_SEEDS = [
  "Amara", "Zoya", "Leela", "Priya", "Anaya", "Kavya", "Meera", "Sana", "Riya", "Naina",
];

const ALL_SEEDS = [...MALE_SEEDS, ...FEMALE_SEEDS];

type DicebearStyleKey = (typeof DICEBEAR_STYLE_KEYS)[number];

/**
 * DiceBear seeds do not encode gender: the same seed can produce different
 * presentations in different styles. These lists were curated by visually
 * reviewing every style/seed combination. Abstract faces belong in Misc
 * instead of being misleadingly filed under Male or Female.
 */
const MALE_PRESENTATION: Partial<Record<DicebearStyleKey, readonly string[]>> = {
  adventurer: ["Aarav", "Rohan", "Karan", "Ishaan", "Nikhil", "Rahul", "Meera", "Sana", "Naina"],
  avataaars: ["Aarav", "Rohan", "Karan", "Nikhil", "Rahul", "Zoya", "Priya", "Anaya", "Meera", "Naina"],
  bigSmile: ["Dev", "Rohan", "Priya", "Anaya", "Kavya", "Meera", "Sana", "Riya"],
  notionists: ["Dev", "Rohan", "Karan", "Vikram", "Sameer", "Rahul", "Amara", "Zoya", "Anaya", "Kavya", "Meera", "Riya", "Naina"],
  openPeeps: ["Dev", "Karan", "Sameer", "Arjun", "Rahul", "Leela", "Kavya", "Sana", "Naina"],
  personas: ["Rohan", "Sameer", "Nikhil", "Zoya", "Leela", "Priya", "Anaya", "Meera", "Sana"],
};

const FEMALE_PRESENTATION: Partial<Record<DicebearStyleKey, readonly string[]>> = {
  adventurer: ["Dev", "Vikram", "Sameer", "Arjun", "Amara", "Zoya", "Leela", "Priya", "Anaya", "Kavya", "Riya"],
  avataaars: ["Dev", "Vikram", "Sameer", "Ishaan", "Arjun", "Amara", "Leela", "Kavya", "Sana", "Riya"],
  bigSmile: ["Aarav", "Karan", "Vikram", "Sameer", "Ishaan", "Nikhil", "Arjun", "Rahul", "Amara", "Zoya", "Leela", "Naina"],
  notionists: ["Aarav", "Ishaan", "Nikhil", "Arjun", "Leela", "Priya", "Sana"],
  openPeeps: ["Aarav", "Rohan", "Vikram", "Ishaan", "Nikhil", "Amara", "Zoya", "Priya", "Anaya", "Meera", "Riya"],
  personas: ["Dev", "Aarav", "Karan", "Vikram", "Ishaan", "Arjun", "Rahul", "Amara", "Kavya", "Riya", "Naina"],
};

const ANIMAL_EMOJI = [
  "🦊", "🐼", "🦁", "🐨", "🐯", "🦉", "🐻", "🐺", "🐸", "🐵",
  "🐶", "🐱", "🐷", "🐰", "🦆", "🐢", "🐘", "🦋", "🐹", "🦔",
  "🦓", "🦒", "🐴", "🐮", "🐔", "🐧", "🦅", "🦩", "🐙", "🐬",
  "🐳", "🦎",
];

const MISC_EMOJI = [
  "🤖", "👽", "🎃", "👻", "🧙", "🦸", "🦹", "🧛", "🥷", "🧑‍🚀",
  "🕵️", "🤡", "👑", "🐉", "🦄", "💀", "🧞", "🧚", "🧜‍♀️", "⚽",
  "🎩", "🕶️", "🎭", "🔥",
];

export type AvatarCategory = "male" | "female" | "animal" | "misc";

export interface CatalogEntry {
  id: string;
  kind: "dicebear" | "animal";
  category: AvatarCategory;
  styleKey?: string;
  seed?: string;
  emoji?: string;
}

function categoryFor(styleKey: DicebearStyleKey, seed: string): AvatarCategory {
  if (MALE_PRESENTATION[styleKey]?.includes(seed)) return "male";
  if (FEMALE_PRESENTATION[styleKey]?.includes(seed)) return "female";
  return "misc";
}

function legacyCatalogId(styleKey: DicebearStyleKey, seed: string): string {
  // Preserve IDs so already-saved avatars continue to resolve after recategorizing.
  return `${styleKey}-${MALE_SEEDS.includes(seed) ? "m" : "f"}-${seed}`;
}

const DICEBEAR_CATALOG: CatalogEntry[] = DICEBEAR_STYLE_KEYS.flatMap((styleKey) =>
  ALL_SEEDS.map((seed) => ({
    id: legacyCatalogId(styleKey, seed),
    kind: "dicebear" as const,
    category: categoryFor(styleKey, seed),
    styleKey,
    seed,
  })),
);

export const MALE_CATALOG: CatalogEntry[] = DICEBEAR_CATALOG.filter((entry) => entry.category === "male");
export const FEMALE_CATALOG: CatalogEntry[] = DICEBEAR_CATALOG.filter((entry) => entry.category === "female");

export const ANIMAL_CATALOG: CatalogEntry[] = ANIMAL_EMOJI.map((emoji, i) => ({
  id: `animal-${i}`,
  kind: "animal" as const,
  category: "animal" as const,
  emoji,
}));

export const MISC_CATALOG: CatalogEntry[] = MISC_EMOJI.map((emoji, i) => ({
  id: `misc-${i}`,
  kind: "animal" as const,
  category: emoji === "🧜‍♀️" ? "female" as const : emoji === "🐉" || emoji === "🦄" ? "animal" as const : "misc" as const,
  emoji,
}));

export const AVATAR_CATALOG: CatalogEntry[] = [
  ...DICEBEAR_CATALOG,
  ...ANIMAL_CATALOG,
  ...MISC_CATALOG,
];

export interface ColorOption {
  key: string;
  hex: string;
}

export const COLOR_PALETTE: ColorOption[] = [
  { key: "gold", hex: "cb9b3e" },
  { key: "emerald", hex: "3f7a5a" },
  { key: "brick", hex: "b14634" },
  { key: "plum", hex: "5a4a8a" },
  { key: "teal", hex: "2c7a72" },
  { key: "amber", hex: "c97c2c" },
];

export function findCatalogEntry(id: string): CatalogEntry | undefined {
  return AVATAR_CATALOG.find((entry) => entry.id === id);
}

export function colorHex(colorKey: string): string {
  return COLOR_PALETTE.find((c) => c.key === colorKey)?.hex ?? COLOR_PALETTE[0].hex;
}

/** In-progress pick while editing — resolved into a full AvatarChoice (with a cached
 *  preview image) only when the user confirms, so we don't re-render on every click. */
export interface AvatarSelection {
  catalogId: string;
  colorKey: string;
}
