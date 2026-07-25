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
  socketId: string | null;
  joinedAt: number;
  disconnectedAt: number | null;
}

export type RoomStatus = "lobby" | "playing";

export interface Room {
  code: string;
  status: RoomStatus;
  players: Player[];
  createdAt: number;
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
}

export type RoomErrorCode = "not_found" | "full" | "in_progress" | "invalid" | "not_host" | "cant_start";
