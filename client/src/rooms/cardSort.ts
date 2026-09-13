import type { Card, Rank, Suit } from "./types";

const SUIT_ORDER: Record<Suit, number> = { S: 0, H: 1, C: 2, D: 3 };
const RANK_ORDER: Record<Rank, number> = {
  "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8,
  "9": 9, "10": 10, J: 11, Q: 12, K: 13, A: 14,
};

/** Defensive display sorting, including rooms restored from older saved state. */
export function sortCardsForDisplay(cards: Card[]): Card[] {
  return [...cards].sort(
    (a, b) => SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit] || RANK_ORDER[b.rank] - RANK_ORDER[a.rank],
  );
}
