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
];

const MALE_SEEDS = [
  "Dev", "Aarav", "Rohan", "Karan", "Vikram", "Sameer", "Ishaan", "Nikhil", "Arjun", "Rahul",
];

const FEMALE_SEEDS = [
  "Amara", "Zoya", "Leela", "Priya", "Anaya", "Kavya", "Meera", "Sana", "Riya", "Naina",
];

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

export const MALE_CATALOG: CatalogEntry[] = DICEBEAR_STYLE_KEYS.flatMap((styleKey) =>
  MALE_SEEDS.map((seed) => ({
    id: `${styleKey}-m-${seed}`,
    kind: "dicebear" as const,
    category: "male" as const,
    styleKey,
    seed,
  })),
);

export const FEMALE_CATALOG: CatalogEntry[] = DICEBEAR_STYLE_KEYS.flatMap((styleKey) =>
  FEMALE_SEEDS.map((seed) => ({
    id: `${styleKey}-f-${seed}`,
    kind: "dicebear" as const,
    category: "female" as const,
    styleKey,
    seed,
  })),
);

export const ANIMAL_CATALOG: CatalogEntry[] = ANIMAL_EMOJI.map((emoji, i) => ({
  id: `animal-${i}`,
  kind: "animal" as const,
  category: "animal" as const,
  emoji,
}));

export const MISC_CATALOG: CatalogEntry[] = MISC_EMOJI.map((emoji, i) => ({
  id: `misc-${i}`,
  kind: "animal" as const,
  category: "misc" as const,
  emoji,
}));

export const AVATAR_CATALOG: CatalogEntry[] = [
  ...MALE_CATALOG,
  ...FEMALE_CATALOG,
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
