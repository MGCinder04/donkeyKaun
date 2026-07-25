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
import { colorHex } from "./avatarPalette";

const DICEBEAR_STYLES: Record<string, Style<object>> = {
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
