export type Suit = "S" | "H" | "C" | "D";
export type Rank = "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "A";

export interface Card {
  suit: Suit;
  rank: Rank;
}

// Ranks low to high (index = strength). Ace is high.
export const RANKS: Rank[] = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

// Trump rotates through this order, one step per round, cycling twice over 8 rounds.
export const TRUMP_ROTATION: Suit[] = ["S", "H", "C", "D"];

export function rankValue(rank: Rank): number {
  return RANKS.indexOf(rank);
}

export function cardId(card: Card): string {
  return `${card.suit}${card.rank}`;
}

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of TRUMP_ROTATION) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

/** Fisher-Yates shuffle. Takes an injectable rng so tests can be deterministic. */
export function shuffle<T>(items: T[], rng: () => number = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
