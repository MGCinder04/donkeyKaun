import { createAvatar } from "@dicebear/core";
import type { Style } from "@dicebear/core";
import {
  adventurer,
  avataaars,
  bigSmile,
  croodles,
  funEmoji,
  notionists,
  openPeeps,
  personas,
  thumbs,
} from "@dicebear/collection";

export const DICEBEAR_STYLES: Record<string, Style<object>> = {
  adventurer,
  avataaars,
  bigSmile,
  croodles,
  funEmoji,
  notionists,
  openPeeps,
  personas,
  thumbs,
};

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

export const PEOPLE_CATALOG: CatalogEntry[] = Object.keys(DICEBEAR_STYLES).flatMap(
  (styleKey) =>
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

export function renderDicebearDataUri(styleKey: string, seed: string, colorKey: string): string {
  const style = DICEBEAR_STYLES[styleKey];
  const avatar = createAvatar(style, {
    seed,
    backgroundColor: [colorHex(colorKey)],
    radius: 50,
    size: 128,
  });
  return avatar.toDataUri();
}
