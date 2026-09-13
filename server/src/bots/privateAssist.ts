import { createHash, timingSafeEqual } from "node:crypto";

const FAILURE_WINDOW_MS = 30 * 60 * 1000;
const MAX_FAILURES_PER_SOURCE = 5;
const GLOBAL_WINDOW_MS = 60 * 60 * 1000;
const MAX_GLOBAL_FAILURES = 60;

export interface PrivateAssistStatus {
  unlocked: boolean;
  enabled: boolean;
}

interface AssistSession extends PrivateAssistStatus {
  roomCode: string;
  deviceId: string;
}

interface FailureBucket {
  count: number;
  resetAt: number;
}

export type PrivateAssistError = "unauthorized" | "rate_limited";
export type PrivateAssistResult =
  | { ok: true; value: PrivateAssistStatus }
  | { ok: false; error: PrivateAssistError };

const sessions = new Map<string, AssistSession>();
const failures = new Map<string, FailureBucket>();
let globalFailures: number[] = [];

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function equalSecret(provided: string, expected: string): boolean {
  return timingSafeEqual(digest(provided), digest(expected));
}

function sourceKey(ip: string, deviceId: string): string {
  return `${ip}:${deviceId}`;
}

function prune(now: number): void {
  globalFailures = globalFailures.filter((timestamp) => now - timestamp < GLOBAL_WINDOW_MS);
  for (const [key, bucket] of failures) {
    if (now > bucket.resetAt) failures.delete(key);
  }
}

function rateLimited(key: string, now: number): boolean {
  prune(now);
  return globalFailures.length >= MAX_GLOBAL_FAILURES || (failures.get(key)?.count ?? 0) >= MAX_FAILURES_PER_SOURCE;
}

function recordFailure(key: string, now: number): void {
  const current = failures.get(key);
  failures.set(
    key,
    !current || now > current.resetAt
      ? { count: 1, resetAt: now + FAILURE_WINDOW_MS }
      : { count: current.count + 1, resetAt: current.resetAt },
  );
  globalFailures.push(now);
}

function matches(session: AssistSession | undefined, roomCode: string, deviceId: string): session is AssistSession {
  return Boolean(
    session &&
      session.roomCode === roomCode.toUpperCase() &&
      session.deviceId === deviceId,
  );
}

/** Unlocks only the currently authenticated Socket.IO membership. The secret is
 * compared in constant time and is never retained in session state or logs. */
export function unlockPrivateAssist(
  socketId: string,
  roomCode: string,
  deviceId: string,
  providedSecret: string,
  ip: string,
  now = Date.now(),
): PrivateAssistResult {
  const expectedSecret = process.env.PRIVATE_USTAAD_SECRET ?? "";
  const key = sourceKey(ip, deviceId);
  if (rateLimited(key, now)) return { ok: false, error: "rate_limited" };

  // Treat an absent/weak server secret exactly like a wrong key. This does not
  // reveal whether the private feature is configured on a particular deploy.
  if (expectedSecret.length < 24 || providedSecret.length > 128 || !equalSecret(providedSecret, expectedSecret)) {
    recordFailure(key, now);
    return { ok: false, error: "unauthorized" };
  }

  failures.delete(key);
  const status: AssistSession = {
    roomCode: roomCode.toUpperCase(),
    deviceId,
    unlocked: true,
    enabled: false,
  };
  sessions.set(socketId, status);
  return { ok: true, value: { unlocked: true, enabled: false } };
}

export function privateAssistStatus(socketId: string, roomCode: string, deviceId: string): PrivateAssistStatus {
  const session = sessions.get(socketId);
  return matches(session, roomCode, deviceId)
    ? { unlocked: session.unlocked, enabled: session.enabled }
    : { unlocked: false, enabled: false };
}

export function setPrivateAssistEnabled(
  socketId: string,
  roomCode: string,
  deviceId: string,
  enabled: boolean,
): PrivateAssistResult {
  const session = sessions.get(socketId);
  if (!matches(session, roomCode, deviceId) || !session.unlocked) {
    return { ok: false, error: "unauthorized" };
  }
  session.enabled = enabled;
  return { ok: true, value: { unlocked: true, enabled } };
}

export function isPrivateAssistEnabled(socketId: string, roomCode: string, deviceId: string): boolean {
  const session = sessions.get(socketId);
  return matches(session, roomCode, deviceId) && session.enabled;
}

export function clearPrivateAssist(socketId: string): void {
  sessions.delete(socketId);
}

export function sweepPrivateAssistSecurityState(now = Date.now()): void {
  prune(now);
}

export function resetPrivateAssistForTests(): void {
  sessions.clear();
  failures.clear();
  globalFailures = [];
}
