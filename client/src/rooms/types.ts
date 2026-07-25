import type { AvatarChoice } from "../identity/useIdentity";

export type RoomStatus = "lobby" | "playing";

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
}

export type RoomErrorCode = "not_found" | "full" | "in_progress" | "invalid" | "not_host" | "cant_start";

export type Envelope<T> = { ok: true; value: T } | { ok: false; error: RoomErrorCode };
