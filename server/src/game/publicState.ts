import type { Card } from "./cards.js";
import { legalCards, type GamePhase, type GameState, type RoundSummary, type TrickCard } from "./engine.js";
import type { Suit } from "./cards.js";

export interface PublicGameState {
  round: number;
  cardsThisRound: number;
  trumpSuit: Suit;
  dealerSeat: number;
  seatOrder: string[];
  phase: GamePhase;
  bids: Record<string, number | null>;
  bidTurnDeviceId: string | null;
  tricksWon: Record<string, number>;
  currentTrick: TrickCard[];
  turnDeviceId: string | null;
  handCounts: Record<string, number>;
  scores: Record<string, number>;
  lastRoundSummary: RoundSummary | null;
  roundHistory: RoundSummary[];
  donkeys: string[] | null;
}

export function toPublicGameState(state: GameState): PublicGameState {
  return {
    round: state.round,
    cardsThisRound: state.cardsThisRound,
    trumpSuit: state.trumpSuit,
    dealerSeat: state.dealerSeat,
    seatOrder: state.seatOrder,
    phase: state.phase,
    bids: state.bids,
    bidTurnDeviceId: state.phase === "bidding" ? (state.bidOrder[state.bidTurnIndex] ?? null) : null,
    tricksWon: state.tricksWon,
    currentTrick: state.currentTrick,
    turnDeviceId: state.phase === "trick" ? (state.seatOrder[state.turnSeat] ?? null) : null,
    handCounts: Object.fromEntries(Object.entries(state.hands).map(([id, hand]) => [id, hand.length])),
    scores: state.scores,
    lastRoundSummary: state.lastRoundSummary,
    roundHistory: state.roundHistory,
    donkeys: state.donkeys,
  };
}

export interface PrivateHand {
  hand: Card[];
  legalCards: Card[];
}

export function privateHandFor(state: GameState, deviceId: string): PrivateHand {
  const hand = state.hands[deviceId] ?? [];
  const isMyTurn = state.phase === "trick" && state.seatOrder[state.turnSeat] === deviceId;
  return { hand, legalCards: isMyTurn ? legalCards(state, deviceId) : [] };
}
