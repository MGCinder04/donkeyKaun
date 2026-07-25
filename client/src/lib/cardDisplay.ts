import type { Card, Suit } from "../rooms/types";

export const SUIT_SYMBOL: Record<Suit, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };
export const SUIT_COLOR: Record<Suit, string> = { S: "#23231f", C: "#23231f", H: "var(--brick)", D: "var(--brick)" };

export function cardLabel(card: Card): string {
  return `${card.rank}${SUIT_SYMBOL[card.suit]}`;
}

export function cardKey(card: Card): string {
  return `${card.suit}${card.rank}`;
}
