import { Redis } from "@upstash/redis";
import type { Room } from "./types.js";

const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
const MIN_TTL_SECONDS = 60 * 60;
const MAX_TTL_SECONDS = 7 * 24 * 60 * 60;
const OPERATION_TIMEOUT_MS = 4_000;
const KEY_PREFIX = "donkey-kaun:room:";

interface StoredRoom extends Omit<Room, "players" | "kickedDeviceIds"> {
  players: Array<Omit<Room["players"][number], "socketId">>;
  kickedDeviceIds: string[];
}

let redis: Redis | null = null;
let redisSignature = "";
const writeQueues = new Map<string, Promise<void>>();
let lastWarningAt = 0;

function roomTtlSeconds(): number {
  const parsed = Number.parseInt(process.env.ROOM_STATE_TTL_SECONDS ?? "", 10);
  if (!Number.isFinite(parsed)) return DEFAULT_TTL_SECONDS;
  return Math.min(Math.max(parsed, MIN_TTL_SECONDS), MAX_TTL_SECONDS);
}

function client(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const signature = `${url}\n${token}`;
  if (!redis || signature !== redisSignature) {
    redis = new Redis({ url, token });
    redisSignature = signature;
  }
  return redis;
}

function warn(operation: string, error: unknown): void {
  const now = Date.now();
  if (now - lastWarningAt < 60_000) return;
  lastWarningAt = now;
  const message = error instanceof Error ? error.message : "unknown error";
  console.warn(`[rooms] persistent ${operation} unavailable; continuing in memory: ${message}`);
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Redis operation timed out")), OPERATION_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function snapshotRoom(room: Room): StoredRoom {
  return {
    code: room.code,
    status: room.status,
    createdAt: room.createdAt,
    game: room.game,
    replacementForDeviceId: room.replacementForDeviceId,
    kickedDeviceIds: [...room.kickedDeviceIds],
    players: room.players.map(({ socketId: _socketId, ...player }) => player),
  };
}

export function roomFromSnapshot(value: unknown): Room | null {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const stored = parsed as Partial<StoredRoom>;
  if (typeof stored.code !== "string" || !Array.isArray(stored.players) || !Array.isArray(stored.kickedDeviceIds)) {
    return null;
  }
  return {
    code: stored.code.toUpperCase(),
    status: stored.status === "playing" ? "playing" : "lobby",
    createdAt: typeof stored.createdAt === "number" ? stored.createdAt : Date.now(),
    game: stored.game ?? null,
    replacementForDeviceId:
      typeof stored.replacementForDeviceId === "string" ? stored.replacementForDeviceId : null,
    kickedDeviceIds: new Set(stored.kickedDeviceIds.filter((id): id is string => typeof id === "string")),
    players: stored.players.map((player) => ({
      ...player,
      resumeTokenHash: player.resumeTokenHash ?? "",
      socketId: null,
      disconnectedAt: Date.now(),
    })),
  } as Room;
}

function enqueue(code: string, operation: () => Promise<unknown>): Promise<void> {
  const previous = writeQueues.get(code) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    await withTimeout(Promise.resolve(operation()));
  });
  writeQueues.set(code, next);
  void next
    .finally(() => {
      if (writeQueues.get(code) === next) writeQueues.delete(code);
    })
    .catch(() => undefined);
  return next;
}

export async function persistRoom(room: Room): Promise<void> {
  const db = client();
  if (!db) return;
  const snapshot = snapshotRoom(room);
  try {
    await enqueue(room.code, () => db.set(`${KEY_PREFIX}${room.code}`, snapshot, { ex: roomTtlSeconds() }));
  } catch (error) {
    warn("write", error);
  }
}

export async function loadPersistedRoom(code: string): Promise<Room | null> {
  const db = client();
  if (!db) return null;
  const normalized = code.toUpperCase();
  try {
    await writeQueues.get(normalized);
    return roomFromSnapshot(await withTimeout(db.get(`${KEY_PREFIX}${normalized}`)));
  } catch (error) {
    warn("read", error);
    return null;
  }
}

export async function deletePersistedRoom(code: string): Promise<void> {
  const db = client();
  if (!db) return;
  const normalized = code.toUpperCase();
  try {
    await enqueue(normalized, () => db.del(`${KEY_PREFIX}${normalized}`));
  } catch (error) {
    warn("delete", error);
  }
}

export function persistenceConfigured(): boolean {
  return client() !== null;
}
