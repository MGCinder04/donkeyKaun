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

const ORIGINAL_MALE_SEEDS = [
  "Dev", "Aarav", "Rohan", "Karan", "Vikram", "Sameer", "Ishaan", "Nikhil", "Arjun", "Rahul",
];

const ORIGINAL_FEMALE_SEEDS = [
  "Amara", "Zoya", "Leela", "Priya", "Anaya", "Kavya", "Meera", "Sana", "Riya", "Naina",
];

const ALL_SEEDS = [...ORIGINAL_MALE_SEEDS, ...ORIGINAL_FEMALE_SEEDS];

type DicebearStyleKey = (typeof DICEBEAR_STYLE_KEYS)[number];

// Five visually distinct styles × twenty seeds = one hundred visible people.
const VISIBLE_PEOPLE_STYLE_KEYS = [
  "adventurer",
  "avataaars",
  "bigSmile",
  "openPeeps",
  "personas",
] as const satisfies readonly DicebearStyleKey[];

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

export type AvatarCategory = "people" | "animal" | "misc";

export interface CatalogEntry {
  id: string;
  kind: "dicebear" | "animal";
  category: AvatarCategory;
  styleKey?: string;
  seed?: string;
  emoji?: string;
}

function legacyCatalogId(styleKey: DicebearStyleKey, seed: string): string {
  // Preserve IDs so already-saved avatars continue to resolve after recategorizing.
  return `${styleKey}-${ORIGINAL_MALE_SEEDS.includes(seed) ? "m" : "f"}-${seed}`;
}

const ALL_DICEBEAR_CATALOG: CatalogEntry[] = DICEBEAR_STYLE_KEYS.flatMap((styleKey) =>
  ALL_SEEDS.map((seed) => ({
    id: legacyCatalogId(styleKey, seed),
    kind: "dicebear" as const,
    category: "people" as const,
    styleKey,
    seed,
  })),
);

const visiblePeopleStyles = new Set<DicebearStyleKey>(VISIBLE_PEOPLE_STYLE_KEYS);
const DICEBEAR_CATALOG = ALL_DICEBEAR_CATALOG.filter(
  (entry) => entry.styleKey && visiblePeopleStyles.has(entry.styleKey as DicebearStyleKey),
);
const LEGACY_DICEBEAR_CATALOG = ALL_DICEBEAR_CATALOG.filter(
  (entry) => !entry.styleKey || !visiblePeopleStyles.has(entry.styleKey as DicebearStyleKey),
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
  category: emoji === "🐉" || emoji === "🦄" ? "animal" as const : "misc" as const,
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
  return AVATAR_CATALOG.find((entry) => entry.id === id)
    ?? LEGACY_DICEBEAR_CATALOG.find((entry) => entry.id === id);
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
