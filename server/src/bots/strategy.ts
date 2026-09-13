import { cardId, rankValue, type Card, type Suit } from "../game/cards.js";
import { legalCards, type GameState, type TrickCard } from "../game/engine.js";
import type { BotKind } from "./types.js";

/** The only information a bot is allowed to receive. There is deliberately no
 * `hands` record here: an opponent's cards can never cross this boundary. */
export interface BotView {
  botId: string;
  kind: BotKind;
  hand: Card[];
  legalCards: Card[];
  round: number;
  cardsThisRound: number;
  trumpSuit: Suit;
  dealerDeviceId: string;
  seatOrder: string[];
  phase: GameState["phase"];
  bids: Record<string, number | null>;
  tricksWon: Record<string, number>;
  currentTrick: TrickCard[];
  scores: Record<string, number>;
}

export function viewForBot(state: GameState, botId: string, kind: BotKind): BotView {
  return {
    botId,
    kind,
    hand: [...(state.hands[botId] ?? [])],
    legalCards: legalCards(state, botId),
    round: state.round,
    cardsThisRound: state.cardsThisRound,
    trumpSuit: state.trumpSuit,
    dealerDeviceId: state.seatOrder[state.dealerSeat],
    seatOrder: [...state.seatOrder],
    phase: state.phase,
    bids: { ...state.bids },
    tricksWon: { ...state.tricksWon },
    currentTrick: state.currentTrick.map((play) => ({ ...play, card: { ...play.card } })),
    scores: { ...state.scores },
  };
}

function hash(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function deterministicNoise(view: BotView, salt: string): number {
  const cards = view.hand.map(cardId).sort().join(",");
  return (hash(`${view.botId}|${view.round}|${cards}|${view.currentTrick.length}|${salt}`) % 10_000) / 10_000;
}

function cardWinChance(card: Card, view: BotView): number {
  const rank = rankValue(card.rank);
  const players = view.seatOrder.length;
  const highness = (rank - 1) / 13;
  const sameSuit = view.hand.filter((candidate) => candidate.suit === card.suit).length;
  let chance = Math.pow(highness, Math.max(1.15, (players - 1) * 0.58));
  if (card.suit === view.trumpSuit) chance = 0.33 + chance * 0.66;
  else chance *= 0.78;
  if (sameSuit === 1 && card.suit !== view.trumpSuit) chance += 0.07;
  if (card.rank === "A") chance += card.suit === view.trumpSuit ? 0.08 : 0.13;
  return Math.max(0.02, Math.min(0.98, chance));
}

/** Poisson-binomial distribution: estimated probability of making exactly each
 * possible number of hands from independent per-card win chances. */
function exactWinDistribution(view: BotView): number[] {
  const probabilities = view.hand.map((card) => cardWinChance(card, view));
  let distribution = [1];
  for (const probability of probabilities) {
    const next = Array(distribution.length + 1).fill(0) as number[];
    distribution.forEach((value, won) => {
      next[won] += value * (1 - probability);
      next[won + 1] += value * probability;
    });
    distribution = next;
  }
  return distribution;
}

export function legalBids(view: BotView): number[] {
  const bids = Array.from({ length: view.cardsThisRound + 2 }, (_, index) => index);
  if (view.botId !== view.dealerDeviceId) return bids;
  const others = Object.entries(view.bids).reduce(
    (sum, [id, bid]) => sum + (id === view.botId || bid === null ? 0 : bid),
    0,
  );
  const forbidden = view.cardsThisRound - others;
  return bids.filter((bid) => bid !== forbidden);
}

export function chooseBid(view: BotView): number {
  const allowed = legalBids(view);
  const distribution = exactWinDistribution(view);
  const expected = distribution.reduce((sum, probability, hands) => sum + probability * hands, 0);
  const minScore = Math.min(...Object.values(view.scores));
  const behind = (view.scores[view.botId] ?? 0) === minScore && view.round >= 6;

  const scored = allowed.map((bid) => {
    const exact = distribution[bid] ?? 0;
    const scoringValue = bid + exact * 10 * (bid + 1);
    let personality = 0;
    if (view.kind === "bhola") personality = -Math.abs(bid - Math.round(expected)) * 1.8;
    if (view.kind === "hisaabi") personality = exact * 3;
    if (view.kind === "shaitaan") personality = bid > expected ? bid * 0.42 : 0;
    if (view.kind === "ustaad") personality = exact * 6 + (behind ? bid * 0.65 : -Math.abs(bid - expected));
    return { bid, score: scoringValue + personality };
  });
  scored.sort((a, b) => b.score - a.score || a.bid - b.bid);

  if (view.kind === "bhola" && allowed.length > 1 && deterministicNoise(view, "bid") < 0.28) {
    return scored[Math.min(1, scored.length - 1)].bid;
  }
  return scored[0].bid;
}

function trickWinner(trick: TrickCard[], leadSuit: Suit, trumpSuit: Suit): TrickCard {
  const trumps = trick.filter((play) => play.card.suit === trumpSuit);
  const pool = trumps.length > 0 ? trumps : trick.filter((play) => play.card.suit === leadSuit);
  return pool.reduce((best, play) => rankValue(play.card.rank) > rankValue(best.card.rank) ? play : best);
}

function wouldCurrentlyWin(card: Card, view: BotView): boolean {
  const trick = [...view.currentTrick, { deviceId: view.botId, card }];
  return trickWinner(trick, trick[0].card.suit, view.trumpSuit).deviceId === view.botId;
}

function strength(card: Card, trump: Suit): number {
  return rankValue(card.rank) + (card.suit === trump ? 20 : 0);
}

export function chooseCard(view: BotView): Card {
  const legal = [...view.legalCards];
  if (legal.length === 0) throw new Error("Bot was asked to play without a legal card");
  if (legal.length === 1) return legal[0];

  const bid = view.bids[view.botId] ?? 0;
  const won = view.tricksWon[view.botId] ?? 0;
  const stillNeeded = bid - won;
  const remainingAfter = view.hand.length - 1;
  const mustWin = stillNeeded > remainingAfter;
  const shouldLose = stillNeeded <= 0;
  const winning = legal.filter((card) => wouldCurrentlyWin(card, view));
  const losing = legal.filter((card) => !wouldCurrentlyWin(card, view));
  const ascending = (cards: Card[]) => cards.sort((a, b) => strength(a, view.trumpSuit) - strength(b, view.trumpSuit));
  const lowest = ascending([...legal])[0];
  const highest = ascending([...legal]).at(-1)!;

  // When following, win as cheaply as possible or duck with the highest safe card.
  if (view.currentTrick.length > 0) {
    if (!shouldLose && (mustWin || stillNeeded > 0) && winning.length > 0) return ascending(winning)[0];
    if (losing.length > 0) return ascending(losing).at(-1)!;
    return shouldLose ? highest : lowest;
  }

  // Leading: protect winners while targeting hands still needed. Shaitaan spends a
  // dangerous card to disturb opponents once its own contract is safe/impossible.
  if (view.kind === "shaitaan" && (shouldLose || stillNeeded > view.hand.length) && highest) return highest;
  if (shouldLose) return highest;
  if (mustWin || (view.kind === "ustaad" && stillNeeded / view.hand.length > 0.55)) return highest;
  if (view.kind === "bhola" && deterministicNoise(view, "card") < 0.22) return highest;
  return lowest;
}
