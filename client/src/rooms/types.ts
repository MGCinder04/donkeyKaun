import type { AvatarChoice } from "../identity/useIdentity";

export type RoomStatus = "lobby" | "playing";

export type Suit = "S" | "H" | "C" | "D";
export type Rank = "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "A";

export interface Card {
  suit: Suit;
  rank: Rank;
}

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

export interface PrivateHand {
  hand: Card[];
  legalCards: Card[];
}

export interface PublicPlayer {
  deviceId: string;
  name: string;
  avatar: AvatarChoice;
  connected: boolean;
  isHost: boolean;
}

export interface PublicRoom {
  code: string;
  status: RoomStatus;
  players: PublicPlayer[];
  game: PublicGameState | null;
}

export type RoomErrorCode =
  | "not_found"
  | "full"
  | "in_progress"
  | "invalid"
  | "not_host"
  | "cant_start"
  | "not_playing"
  | "wrong_phase"
  | "not_your_turn"
  | "invalid_bid"
  | "dealer_restricted"
  | "not_your_card"
  | "must_follow_suit";

export type Envelope<T> = { ok: true; value: T } | { ok: false; error: RoomErrorCode };
