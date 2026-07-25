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

const PEOPLE_SEEDS = ["Amara", "Kiran", "Zoya", "Devan", "Leela", "Farid"];

const ANIMAL_EMOJI = [
  "🦊", "🐼", "🦁", "🐨", "🐯", "🦉", "🐻", "🐺", "🐸", "🐵",
  "🐶", "🐱", "🐷", "🐰", "🦆", "🐢", "🐘", "🦋", "🐹", "🦔",
];

export interface CatalogEntry {
  id: string;
  kind: "dicebear" | "animal";
  styleKey?: string;
  seed?: string;
  emoji?: string;
}

export const PEOPLE_CATALOG: CatalogEntry[] = DICEBEAR_STYLE_KEYS.flatMap((styleKey) =>
  PEOPLE_SEEDS.map((seed) => ({
    id: `${styleKey}-${seed}`,
    kind: "dicebear" as const,
    styleKey,
    seed,
  })),
);

export const ANIMAL_CATALOG: CatalogEntry[] = ANIMAL_EMOJI.map((emoji, i) => ({
  id: `animal-${i}`,
  kind: "animal" as const,
  emoji,
}));

export const AVATAR_CATALOG: CatalogEntry[] = [...PEOPLE_CATALOG, ...ANIMAL_CATALOG];

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
