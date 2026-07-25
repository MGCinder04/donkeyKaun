import { type Card, type Suit, TRUMP_ROTATION, cardId, createDeck, rankValue, shuffle } from "./cards.js";

export type GamePhase = "bidding" | "trick" | "game-end";

export interface TrickCard {
  deviceId: string;
  card: Card;
}

export interface RoundSummary {
  round: number;
  trumpSuit: Suit;
  results: Array<{ deviceId: string; bid: number; tricksWon: number; roundScore: number }>;
}

export interface GameState {
  round: number; // 1-8
  cardsThisRound: number;
  dealerSeat: number; // index into seatOrder
  trumpSuit: Suit;
  seatOrder: string[]; // deviceIds, fixed for the whole game
  hands: Record<string, Card[]>;
  phase: GamePhase;
  bids: Record<string, number | null>;
  bidOrder: string[]; // deviceIds, this round's bidding order (dealer last)
  bidTurnIndex: number;
  tricksWon: Record<string, number>;
  currentTrick: TrickCard[];
  turnSeat: number; // seat index whose turn it is to play (trick phase)
  scores: Record<string, number>;
  lastRoundSummary: RoundSummary | null;
  roundHistory: RoundSummary[]; // every completed round of the current 8-round game, for a full scoresheet
  donkeys: string[] | null; // set once phase === "game-end"
}

export type GameErrorCode =
  | "wrong_phase"
  | "not_your_turn"
  | "invalid_bid"
  | "dealer_restricted"
  | "not_your_card"
  | "must_follow_suit";

export type GameResult = { ok: true; value: GameState } | { ok: false; error: GameErrorCode };

function dealRound(seatOrder: string[], round: number, dealerSeat: number, rng: () => number): GameState["hands"] {
  const cardsThisRound = 9 - round;
  const deck = shuffle(createDeck(), rng);
  const order = orderFrom(seatOrder, dealerSeat + 1);
  const hands: GameState["hands"] = {};
  order.forEach((deviceId, i) => {
    hands[deviceId] = deck.slice(i * cardsThisRound, (i + 1) * cardsThisRound);
  });
  return hands;
}

/** Rotate seatOrder to start at `from` (mod length) — the deal/bid order for a round. */
function orderFrom(seatOrder: string[], from: number): string[] {
  const n = seatOrder.length;
  const start = ((from % n) + n) % n;
  return seatOrder.slice(start).concat(seatOrder.slice(0, start));
}

function buildRound(
  seatOrder: string[],
  round: number,
  dealerSeat: number,
  scores: Record<string, number>,
  rng: () => number,
  roundHistory: RoundSummary[] = [],
): GameState {
  const cardsThisRound = 9 - round;
  const trumpSuit = TRUMP_ROTATION[(round - 1) % TRUMP_ROTATION.length];
  const bidOrder = orderFrom(seatOrder, dealerSeat + 1);
  const bids: Record<string, number | null> = {};
  const tricksWon: Record<string, number> = {};
  for (const deviceId of seatOrder) {
    bids[deviceId] = null;
    tricksWon[deviceId] = 0;
  }
  return {
    round,
    cardsThisRound,
    dealerSeat,
    trumpSuit,
    seatOrder,
    hands: dealRound(seatOrder, round, dealerSeat, rng),
    phase: "bidding",
    bids,
    bidOrder,
    bidTurnIndex: 0,
    tricksWon,
    currentTrick: [],
    turnSeat: seatOrder.indexOf(bidOrder[0]),
    scores,
    lastRoundSummary: null,
    roundHistory,
    donkeys: null,
  };
}

export function startGame(seatOrder: string[], rng: () => number = Math.random): GameState {
  const scores: Record<string, number> = {};
  for (const deviceId of seatOrder) scores[deviceId] = 0;
  return buildRound(seatOrder, 1, 0, scores, rng);
}

function maxBid(cardsThisRound: number): number {
  return cardsThisRound + 1;
}

export function placeBid(state: GameState, deviceId: string, bid: number): GameResult {
  if (state.phase !== "bidding") return { ok: false, error: "wrong_phase" };
  if (state.bidOrder[state.bidTurnIndex] !== deviceId) return { ok: false, error: "not_your_turn" };
  if (!Number.isInteger(bid) || bid < 0 || bid > maxBid(state.cardsThisRound)) {
    return { ok: false, error: "invalid_bid" };
  }

  const isDealer = state.bidTurnIndex === state.bidOrder.length - 1;
  if (isDealer) {
    const othersSum = Object.entries(state.bids)
      .filter(([id]) => id !== deviceId)
      .reduce((sum, [, b]) => sum + (b ?? 0), 0);
    const forbidden = state.cardsThisRound - othersSum;
    if (bid === forbidden) return { ok: false, error: "dealer_restricted" };
  }

  const bids = { ...state.bids, [deviceId]: bid };
  const bidTurnIndex = state.bidTurnIndex + 1;

  if (bidTurnIndex >= state.bidOrder.length) {
    const turnSeat = state.seatOrder.indexOf(state.bidOrder[0]);
    return { ok: true, value: { ...state, bids, bidTurnIndex, phase: "trick", turnSeat } };
  }
  return { ok: true, value: { ...state, bids, bidTurnIndex } };
}

/** Cards `deviceId` may legally play right now, given the led suit of the current trick. */
export function legalCards(state: GameState, deviceId: string): Card[] {
  const hand = state.hands[deviceId] ?? [];
  if (state.phase !== "trick" || state.currentTrick.length === 0) return hand;
  const leadSuit = state.currentTrick[0].card.suit;
  const followable = hand.filter((c) => c.suit === leadSuit);
  return followable.length > 0 ? followable : hand;
}

function resolveTrick(trick: TrickCard[], leadSuit: Suit, trump: Suit): string {
  const trumped = trick.filter((t) => t.card.suit === trump);
  const pool = trumped.length > 0 ? trumped : trick.filter((t) => t.card.suit === leadSuit);
  return pool.reduce((best, t) => (rankValue(t.card.rank) > rankValue(best.card.rank) ? t : best)).deviceId;
}

function roundScore(bid: number, tricks: number): number {
  return bid === tricks ? (bid + 1) * 10 + bid : bid;
}

function finishRound(state: GameState, rng: () => number): GameState {
  const results = state.seatOrder.map((deviceId) => {
    const bid = state.bids[deviceId] ?? 0;
    const tricksWon = state.tricksWon[deviceId] ?? 0;
    return { deviceId, bid, tricksWon, roundScore: roundScore(bid, tricksWon) };
  });
  const scores = { ...state.scores };
  for (const r of results) scores[r.deviceId] = (scores[r.deviceId] ?? 0) + r.roundScore;
  const lastRoundSummary: RoundSummary = { round: state.round, trumpSuit: state.trumpSuit, results };
  const roundHistory = [...state.roundHistory, lastRoundSummary];

  if (state.round >= 8) {
    const min = Math.min(...Object.values(scores));
    const donkeys = Object.entries(scores)
      .filter(([, s]) => s === min)
      .map(([id]) => id);
    return { ...state, phase: "game-end", scores, lastRoundSummary, roundHistory, donkeys };
  }

  const next = buildRound(
    state.seatOrder,
    state.round + 1,
    (state.dealerSeat + 1) % state.seatOrder.length,
    scores,
    rng,
    roundHistory,
  );
  return { ...next, lastRoundSummary };
}

export function playCard(state: GameState, deviceId: string, card: Card, rng: () => number = Math.random): GameResult {
  if (state.phase !== "trick") return { ok: false, error: "wrong_phase" };
  if (state.seatOrder[state.turnSeat] !== deviceId) return { ok: false, error: "not_your_turn" };

  const hand = state.hands[deviceId] ?? [];
  const handIndex = hand.findIndex((c) => cardId(c) === cardId(card));
  if (handIndex === -1) return { ok: false, error: "not_your_card" };

  const legal = legalCards(state, deviceId);
  if (!legal.some((c) => cardId(c) === cardId(card))) return { ok: false, error: "must_follow_suit" };

  const hands = { ...state.hands, [deviceId]: hand.filter((_, i) => i !== handIndex) };
  const currentTrick = [...state.currentTrick, { deviceId, card }];

  if (currentTrick.length < state.seatOrder.length) {
    const turnSeat = (state.turnSeat + 1) % state.seatOrder.length;
    return { ok: true, value: { ...state, hands, currentTrick, turnSeat } };
  }

  const leadSuit = currentTrick[0].card.suit;
  const winnerId = resolveTrick(currentTrick, leadSuit, state.trumpSuit);
  const tricksWon = { ...state.tricksWon, [winnerId]: (state.tricksWon[winnerId] ?? 0) + 1 };
  const winnerSeat = state.seatOrder.indexOf(winnerId);

  const roundOver = Object.values(hands).every((h) => h.length === 0);
  const afterTrick: GameState = {
    ...state,
    hands,
    currentTrick: [],
    tricksWon,
    turnSeat: winnerSeat,
  };

  if (!roundOver) return { ok: true, value: afterTrick };
  return { ok: true, value: finishRound(afterTrick, rng) };
}

export function newGame(state: GameState, rng: () => number = Math.random): GameState {
  const scores: Record<string, number> = {};
  for (const deviceId of state.seatOrder) scores[deviceId] = 0;
  return buildRound(state.seatOrder, 1, 0, scores, rng);
}

export function continueGame(state: GameState, rng: () => number = Math.random): GameState {
  const nextDealer = (state.dealerSeat + 1) % state.seatOrder.length;
  return buildRound(state.seatOrder, 1, nextDealer, state.scores, rng);
}
