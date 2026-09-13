import { cardId, createDeck, rankValue, type Card, type Suit } from "../game/cards.js";
import type { PlayedCardEvent, TrickCard } from "../game/engine.js";

export interface KnowledgeInput {
  botId: string;
  hand: Card[];
  trumpSuit: Suit;
  seatOrder: string[];
  turnSeat: number;
  playedCards: PlayedCardEvent[];
  currentTrick: TrickCard[];
  voidSuits: Record<string, Suit[]>;
  handCounts: Record<string, number>;
}

export interface CardKnowledge {
  seenCardIds: Set<string>;
  unseenCards: Card[];
  remainingBySuit: Record<Suit, Card[]>;
  voidSuits: Record<string, Set<Suit>>;
  opponentsAfter: string[];
  opponentSlots: number;
  undealtCount: number;
}

const SUITS: Suit[] = ["S", "H", "C", "D"];

export function buildKnowledge(input: KnowledgeInput): CardKnowledge {
  const seenCardIds = new Set([
    ...input.hand.map(cardId),
    ...input.playedCards.map((play) => cardId(play.card)),
    ...input.currentTrick.map((play) => cardId(play.card)),
  ]);
  const unseenCards = createDeck().filter((card) => !seenCardIds.has(cardId(card)));
  const remainingBySuit = Object.fromEntries(
    SUITS.map((suit) => [suit, unseenCards.filter((card) => card.suit === suit)]),
  ) as Record<Suit, Card[]>;
  const voidSuits = Object.fromEntries(
    input.seatOrder.map((id) => [id, new Set(input.voidSuits[id] ?? [])]),
  ) as Record<string, Set<Suit>>;
  const opponentSlots = input.seatOrder
    .filter((id) => id !== input.botId)
    .reduce((sum, id) => sum + (input.handCounts[id] ?? input.hand.length), 0);
  const undealtCount = Math.max(0, unseenCards.length - opponentSlots);

  const opponentsAfter: string[] = [];
  if (input.turnSeat >= 0) {
    for (let offset = 1; offset < input.seatOrder.length - input.currentTrick.length; offset += 1) {
      const id = input.seatOrder[(input.turnSeat + offset) % input.seatOrder.length];
      if (id !== input.botId) opponentsAfter.push(id);
    }
  }

  return { seenCardIds, unseenCards, remainingBySuit, voidSuits, opponentsAfter, opponentSlots, undealtCount };
}

/** Probability that none of `dangerousCount` cards occupy `draws` opponent slots
 * when drawing without replacement from `population`. */
export function probabilityNone(population: number, dangerousCount: number, draws: number): number {
  if (dangerousCount <= 0 || draws <= 0) return 1;
  if (population <= 0 || population - dangerousCount < draws) return 0;
  let probability = 1;
  for (let i = 0; i < draws; i += 1) {
    probability *= (population - dangerousCount - i) / (population - i);
  }
  return Math.max(0, Math.min(1, probability));
}

export function higherCards(cards: Card[], card: Card): Card[] {
  return cards.filter((candidate) => candidate.suit === card.suit && rankValue(candidate.rank) > rankValue(card.rank));
}

export function isTopRemainingCard(card: Card, knowledge: CardKnowledge): boolean {
  return !higherCards(knowledge.unseenCards, card).length;
}

export function contiguousTopTrumpCount(hand: Card[], trumpSuit: Suit): number {
  const ranks = new Set(hand.filter((card) => card.suit === trumpSuit).map((card) => rankValue(card.rank)));
  let count = 0;
  for (let rank = 12; rank >= 0 && ranks.has(rank); rank -= 1) count += 1;
  return count;
}
