import type { AvatarChoice, Player, PublicPlayer, PublicRoom, Room, RoomErrorCode } from "./types.js";

export const MAX_PLAYERS = 6;
// The game itself calls for 5 or 6 (that's what the scoring/dealing math assumes), but
// the host can choose to start smaller — e.g. for a test run or a casual few-player game.
export const MIN_PLAYERS_TO_START = 2;
const NAME_MAX_LEN = 20;
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I/O/0/1 — avoids visual ambiguity
const CODE_LENGTH = 5;
const DISCONNECT_GRACE_MS = 10 * 60 * 1000; // 10 min: free-tier reconnects can be slow

const rooms = new Map<string, Room>();

export type RoomResult<T> = { ok: true; value: T } | { ok: false; error: RoomErrorCode };

function generateCode(): string {
  let code: string;
  do {
    code = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function sanitizeName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const trimmed = name.trim().slice(0, NAME_MAX_LEN);
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeAvatar(avatar: unknown): AvatarChoice | null {
  if (typeof avatar !== "object" || avatar === null) return null;
  const a = avatar as Record<string, unknown>;
  if (typeof a.catalogId !== "string" || typeof a.colorKey !== "string") return null;
  if (a.kind !== "dicebear" && a.kind !== "animal") return null;
  if (typeof a.preview !== "string" || a.preview.length > 20_000) return null;
  return { catalogId: a.catalogId, colorKey: a.colorKey, kind: a.kind, preview: a.preview };
}

export function findRoom(code: string): Room | undefined {
  return rooms.get(code.toUpperCase());
}

export function createRoom(
  rawName: unknown,
  rawAvatar: unknown,
  deviceId: string,
  socketId: string,
): RoomResult<Room> {
  const name = sanitizeName(rawName);
  const avatar = sanitizeAvatar(rawAvatar);
  if (!name || !avatar || !deviceId) return { ok: false, error: "invalid" };

  const code = generateCode();
  const player: Player = { deviceId, name, avatar, socketId, joinedAt: Date.now(), disconnectedAt: null };
  const room: Room = { code, status: "lobby", players: [player], createdAt: Date.now() };
  rooms.set(code, room);
  return { ok: true, value: room };
}

export function joinRoom(
  rawCode: unknown,
  rawName: unknown,
  rawAvatar: unknown,
  deviceId: string,
  socketId: string,
): RoomResult<Room> {
  const name = sanitizeName(rawName);
  const avatar = sanitizeAvatar(rawAvatar);
  if (typeof rawCode !== "string" || !name || !avatar || !deviceId) return { ok: false, error: "invalid" };

  const room = findRoom(rawCode);
  if (!room) return { ok: false, error: "not_found" };

  const existing = room.players.find((p) => p.deviceId === deviceId);
  if (existing) {
    existing.socketId = socketId;
    existing.disconnectedAt = null;
    existing.name = name;
    existing.avatar = avatar;
    return { ok: true, value: room };
  }

  if (room.status !== "lobby") return { ok: false, error: "in_progress" };
  if (room.players.length >= MAX_PLAYERS) return { ok: false, error: "full" };

  room.players.push({ deviceId, name, avatar, socketId, joinedAt: Date.now(), disconnectedAt: null });
  return { ok: true, value: room };
}

export function updateProfile(
  code: string,
  deviceId: string,
  rawName: unknown,
  rawAvatar: unknown,
): RoomResult<Room> {
  const room = findRoom(code);
  if (!room) return { ok: false, error: "not_found" };
  const player = room.players.find((p) => p.deviceId === deviceId);
  if (!player) return { ok: false, error: "not_found" };

  const name = sanitizeName(rawName);
  const avatar = sanitizeAvatar(rawAvatar);
  if (!name || !avatar) return { ok: false, error: "invalid" };

  player.name = name;
  player.avatar = avatar;
  return { ok: true, value: room };
}

export function startRoom(code: string, deviceId: string): RoomResult<Room> {
  const room = findRoom(code);
  if (!room) return { ok: false, error: "not_found" };
  const publicRoom = toPublicRoom(room);
  const host = publicRoom.players.find((p) => p.isHost);
  if (!host || host.deviceId !== deviceId) return { ok: false, error: "not_host" };
  if (room.players.length < MIN_PLAYERS_TO_START || room.players.length > MAX_PLAYERS) {
    return { ok: false, error: "cant_start" };
  }
  room.status = "playing";
  return { ok: true, value: room };
}

export interface KickResult {
  room: Room;
  removedSocketId: string | null;
}

export function kickPlayer(code: string, hostDeviceId: string, targetDeviceId: string): RoomResult<KickResult> {
  const room = findRoom(code);
  if (!room) return { ok: false, error: "not_found" };

  const host = toPublicRoom(room).players.find((p) => p.isHost);
  if (!host || host.deviceId !== hostDeviceId) return { ok: false, error: "not_host" };
  if (targetDeviceId === hostDeviceId) return { ok: false, error: "invalid" };

  const target = room.players.find((p) => p.deviceId === targetDeviceId);
  if (!target) return { ok: false, error: "not_found" };

  const removedSocketId = target.socketId;
  room.players = room.players.filter((p) => p.deviceId !== targetDeviceId);
  if (room.players.length === 0) {
    rooms.delete(room.code);
  }
  return { ok: true, value: { room, removedSocketId } };
}

export function leaveRoom(code: string, deviceId: string): Room | null {
  const room = findRoom(code);
  if (!room) return null;
  room.players = room.players.filter((p) => p.deviceId !== deviceId);
  if (room.players.length === 0) {
    rooms.delete(room.code);
    return null;
  }
  return room;
}

/** Called on socket disconnect. Returns the affected room (if any) so the caller can broadcast. */
export function markSocketDisconnected(socketId: string): Room | null {
  for (const room of rooms.values()) {
    const player = room.players.find((p) => p.socketId === socketId);
    if (player) {
      player.socketId = null;
      player.disconnectedAt = Date.now();
      return room;
    }
  }
  return null;
}

export function toPublicRoom(room: Room): PublicRoom {
  const hostDeviceId = [...room.players].sort((a, b) => a.joinedAt - b.joinedAt).find((p) => p.socketId !== null)
    ?.deviceId;
  const players: PublicPlayer[] = room.players.map((p) => ({
    deviceId: p.deviceId,
    name: p.name,
    avatar: p.avatar,
    connected: p.socketId !== null,
    isHost: p.deviceId === hostDeviceId,
  }));
  return { code: room.code, status: room.status, players };
}

/** Periodic sweep: drop long-disconnected players from lobbies (frees the seat) and empty rooms. */
export function sweepStaleRooms(): void {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.status === "lobby") {
      room.players = room.players.filter(
        (p) => p.socketId !== null || p.disconnectedAt === null || now - p.disconnectedAt < DISCONNECT_GRACE_MS,
      );
    }
    if (room.players.length === 0) {
      rooms.delete(room.code);
    }
  }
}
