import { type Card, type Suit, TRUMP_ROTATION, cardId, createDeck, rankValue, shuffle, sortCards } from "./cards.js";

export type GamePhase = "bidding" | "trick" | "game-end";

export interface TrickCard {
  deviceId: string;
  card: Card;
}

export interface PlayedCardEvent extends TrickCard {
  handNumber: number;
  leadSuit: Suit;
}

export interface RoundPlayHistory {
  /** False only for a legacy room restored halfway through a round, where cards
   * played before the deployment were never recorded. */
  complete: boolean;
  plays: PlayedCardEvent[];
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
  /** Every publicly played card in this round, recorded at play time. */
  playHistory: RoundPlayHistory;
  /** Suits each player has publicly failed to follow this round. */
  voidSuits: Record<string, Suit[]>;
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
    hands[deviceId] = sortCards(deck.slice(i * cardsThisRound, (i + 1) * cardsThisRound));
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
  const voidSuits: Record<string, Suit[]> = {};
  for (const deviceId of seatOrder) {
    bids[deviceId] = null;
    tricksWon[deviceId] = 0;
    voidSuits[deviceId] = [];
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
    playHistory: { complete: true, plays: [] },
    voidSuits,
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
  const leadSuit = state.currentTrick[0]?.card.suit;
  const resolvedLeadSuit = leadSuit ?? card.suit;
  // The public ledger is the durable source of hand numbering. `tricksWon` can lose
  // an entry when the host removes a departed player, so summing it can make a later
  // hand reuse an earlier number. Reuse the current pile's number while a hand is in
  // progress; otherwise advance past the greatest number ever recorded.
  const priorPlays = state.playHistory?.plays ?? [];
  const handNumber = state.currentTrick.length > 0
    ? (priorPlays.at(-1)?.handNumber ?? 1)
    : Math.max(0, ...priorPlays.map((play) => play.handNumber)) + 1;
  const playHistory: RoundPlayHistory = {
    complete: state.playHistory?.complete ?? false,
    plays: [
      ...priorPlays,
      { handNumber, deviceId, card: { ...card }, leadSuit: resolvedLeadSuit },
    ],
  };
  const voidSuits = { ...(state.voidSuits ?? {}) };
  if (leadSuit && card.suit !== leadSuit) {
    const known = voidSuits[deviceId] ?? [];
    if (!known.includes(leadSuit)) voidSuits[deviceId] = [...known, leadSuit];
  }

  if (currentTrick.length < state.seatOrder.length) {
    const turnSeat = (state.turnSeat + 1) % state.seatOrder.length;
    return { ok: true, value: { ...state, hands, currentTrick, playHistory, voidSuits, turnSeat } };
  }

  // The trick is complete but deliberately left unresolved here — turnSeat -1 means
  // nobody's turn, so no further plays are accepted. The caller (room store) broadcasts
  // this full-pile state first, so clients actually get a snapshot with all cards
  // visible to animate, then calls resolvePendingTrick after a short pause. Resolving
  // synchronously in this same call would mean the server only ever broadcasts "trick
  // cleared, score updated" and clients would have nothing to animate the sweep from.
  return { ok: true, value: { ...state, hands, currentTrick, playHistory, voidSuits, turnSeat: -1 } };
}

export function isTrickComplete(state: GameState): boolean {
  return state.phase === "trick" && state.currentTrick.length === state.seatOrder.length;
}

export function resolvePendingTrick(state: GameState, rng: () => number = Math.random): GameState {
  if (!isTrickComplete(state)) return state;
  const leadSuit = state.currentTrick[0].card.suit;
  const winnerId = resolveTrick(state.currentTrick, leadSuit, state.trumpSuit);
  const tricksWon = { ...state.tricksWon, [winnerId]: (state.tricksWon[winnerId] ?? 0) + 1 };
  const winnerSeat = state.seatOrder.indexOf(winnerId);

  const roundOver = Object.values(state.hands).every((h) => h.length === 0);
  const afterTrick: GameState = {
    ...state,
    currentTrick: [],
    tricksWon,
    turnSeat: winnerSeat,
  };

  if (!roundOver) return afterTrick;
  return finishRound(afterTrick, rng);
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

function renameRecordKey<T>(record: Record<string, T>, from: string, to: string): Record<string, T> {
  const renamed = { ...record };
  if (Object.hasOwn(renamed, from)) {
    renamed[to] = renamed[from];
    delete renamed[from];
  }
  return renamed;
}

function removeRecordKey<T>(record: Record<string, T>, deviceId: string): Record<string, T> {
  const trimmed = { ...record };
  delete trimmed[deviceId];
  return trimmed;
}

function renameSummary(summary: RoundSummary | null, from: string, to: string): RoundSummary | null {
  if (!summary) return null;
  return {
    ...summary,
    results: summary.results.map((result) =>
      result.deviceId === from ? { ...result, deviceId: to } : result,
    ),
  };
}

function removeFromSummary(summary: RoundSummary | null, deviceId: string): RoundSummary | null {
  if (!summary) return null;
  return { ...summary, results: summary.results.filter((result) => result.deviceId !== deviceId) };
}

/** Transfer a live seat to a new device without changing its position, cards, bid,
 * hands won, score, or history. This is also the seam a future bot player can use. */
export function replacePlayer(state: GameState, from: string, to: string): GameState {
  if (!state.seatOrder.includes(from) || state.seatOrder.includes(to)) return state;
  return {
    ...state,
    seatOrder: state.seatOrder.map((id) => (id === from ? to : id)),
    hands: renameRecordKey(state.hands, from, to),
    bids: renameRecordKey(state.bids, from, to),
    bidOrder: state.bidOrder.map((id) => (id === from ? to : id)),
    tricksWon: renameRecordKey(state.tricksWon, from, to),
    currentTrick: state.currentTrick.map((play) =>
      play.deviceId === from ? { ...play, deviceId: to } : play,
    ),
    playHistory: {
      complete: state.playHistory?.complete ?? false,
      plays: (state.playHistory?.plays ?? []).map((play) =>
        play.deviceId === from ? { ...play, deviceId: to } : play,
      ),
    },
    voidSuits: renameRecordKey(state.voidSuits ?? {}, from, to),
    scores: renameRecordKey(state.scores, from, to),
    lastRoundSummary: renameSummary(state.lastRoundSummary, from, to),
    roundHistory: state.roundHistory.map((summary) => renameSummary(summary, from, to)!),
    donkeys: state.donkeys?.map((id) => (id === from ? to : id)) ?? null,
  };
}

/** Remove a departed seat while preserving a playable state for everyone left. Cards
 * still in that hand (and any card they played into the current hand) are discarded. */
export function removePlayer(state: GameState, deviceId: string): GameState {
  const removedSeat = state.seatOrder.indexOf(deviceId);
  if (removedSeat < 0 || state.seatOrder.length <= 2) return state;

  const previousSeatOrder = state.seatOrder;
  const seatOrder = previousSeatOrder.filter((id) => id !== deviceId);
  const bidOrder = state.bidOrder.filter((id) => id !== deviceId);
  const bids = removeRecordKey(state.bids, deviceId);
  const currentTrick = state.currentTrick.filter((play) => play.deviceId !== deviceId);

  let dealerSeat = state.dealerSeat;
  if (removedSeat < state.dealerSeat) dealerSeat -= 1;
  else if (removedSeat === state.dealerSeat) dealerSeat = (removedSeat - 1 + seatOrder.length) % seatOrder.length;

  let phase = state.phase;
  let bidTurnIndex = state.bidTurnIndex;
  let turnSeat = state.turnSeat;

  if (phase === "bidding") {
    const pendingBid = bidOrder.findIndex((id) => bids[id] === null);
    if (pendingBid === -1) {
      phase = "trick";
      bidTurnIndex = bidOrder.length;
      turnSeat = seatOrder.indexOf(bidOrder[0]);
    } else {
      bidTurnIndex = pendingBid;
      const oldTurnId = previousSeatOrder[state.turnSeat];
      turnSeat = oldTurnId === deviceId ? removedSeat % seatOrder.length : seatOrder.indexOf(oldTurnId);
    }
  } else if (phase === "trick") {
    if (currentTrick.length === seatOrder.length) {
      turnSeat = -1;
    } else {
      const oldTurnId = previousSeatOrder[state.turnSeat];
      if (oldTurnId && oldTurnId !== deviceId) {
        turnSeat = seatOrder.indexOf(oldTurnId);
      } else {
        const nextId = previousSeatOrder[(removedSeat + 1) % previousSeatOrder.length];
        turnSeat = seatOrder.indexOf(nextId);
      }
    }
  }

  const scores = removeRecordKey(state.scores, deviceId);
  const donkeys = phase === "game-end"
    ? (() => {
        const minimum = Math.min(...Object.values(scores));
        return Object.entries(scores).filter(([, score]) => score === minimum).map(([id]) => id);
      })()
    : state.donkeys?.filter((id) => id !== deviceId) ?? null;

  return {
    ...state,
    seatOrder,
    hands: removeRecordKey(state.hands, deviceId),
    phase,
    bids,
    bidOrder,
    bidTurnIndex,
    tricksWon: removeRecordKey(state.tricksWon, deviceId),
    voidSuits: removeRecordKey(state.voidSuits ?? {}, deviceId),
    currentTrick,
    turnSeat,
    dealerSeat,
    scores,
    lastRoundSummary: removeFromSummary(state.lastRoundSummary, deviceId),
    roundHistory: state.roundHistory.map((summary) => removeFromSummary(summary, deviceId)!),
    donkeys,
  };
}
