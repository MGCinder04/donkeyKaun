import type { GameState } from "../game/engine.js";
import type { PublicGameState } from "../game/publicState.js";
import type { BotKind } from "../bots/types.js";

export interface AvatarChoice {
  catalogId: string;
  colorKey: string;
  kind: "dicebear" | "animal";
  preview: string;
}

export interface Player {
  deviceId: string;
  name: string;
  avatar: AvatarChoice;
  /** SHA-256 only. The raw per-room resume token never leaves the player's browser. */
  resumeTokenHash: string;
  socketId: string | null;
  joinedAt: number;
  disconnectedAt: number | null;
  /** Server-owned seats have no socket or resume token and can never become host. */
  botKind?: BotKind | null;
}

export type RoomStatus = "lobby" | "playing";

export interface Room {
  code: string;
  status: RoomStatus;
  players: Player[];
  createdAt: number;
  game: GameState | null;
  /** A disconnected live-game seat the host has opened for the next new joiner. */
  replacementForDeviceId: string | null;
  /** deviceIds the host has kicked — blocks rejoin even though a mid-game kick doesn't
   *  splice the player out of `players` (that would desync `GameState.seatOrder`). */
  kickedDeviceIds: Set<string>;
}

export interface PublicPlayer {
  deviceId: string;
  name: string;
  avatar: AvatarChoice;
  connected: boolean;
  isHost: boolean;
  botKind: BotKind | null;
}

export interface PublicRoom {
  code: string;
  status: RoomStatus;
  players: PublicPlayer[];
  game: PublicGameState | null;
  replacementForDeviceId: string | null;
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
  | "must_follow_suit"
  | "kicked"
  | "session_conflict"
  | "player_connected"
  | "too_few_players";
