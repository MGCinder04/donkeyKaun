import type { Request, Response } from "express";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const RATE_LIMIT_WINDOW_MS = 30 * 60 * 1000;
const RATE_LIMIT_MAX_FAILURES = 5;
const GLOBAL_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const GLOBAL_RATE_LIMIT_MAX_FAILURES = 100;
const SESSION_LIFETIME_MS = 180 * 24 * 60 * 60 * 1000;

const attempts = new Map<string, { count: number; resetAt: number }>();
let globalFailures: number[] = [];

// Generated once per process (not hardcoded) — if this were a fixed string, anyone who
// has read this source could compute a valid unlock token themselves without ever
// knowing SITE_PASSCODE, entirely bypassing the gate whenever an operator sets
// SITE_PASSCODE but forgets the separate SESSION_SECRET dashboard field.
const EPHEMERAL_SECRET = randomBytes(32).toString("hex");

function sign(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function pruneGlobalFailures(now: number): void {
  globalFailures = globalFailures.filter((timestamp) => now - timestamp < GLOBAL_RATE_LIMIT_WINDOW_MS);
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  pruneGlobalFailures(now);
  if (globalFailures.length >= GLOBAL_RATE_LIMIT_MAX_FAILURES) return true;
  const entry = attempts.get(ip);
  if (!entry || now > entry.resetAt) {
    attempts.delete(ip);
    return false;
  }
  return entry.count >= RATE_LIMIT_MAX_FAILURES;
}

function recordFailure(ip: string): void {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
  } else {
    entry.count += 1;
  }
  globalFailures.push(now);
}

/** Periodic sweep: drop expired rate-limit entries so `attempts` doesn't grow forever
 *  (every distinct IP that has ever hit /api/unlock would otherwise stay in memory). */
export function sweepStaleAttempts(): void {
  const now = Date.now();
  for (const [ip, entry] of attempts) {
    if (now > entry.resetAt) attempts.delete(ip);
  }
  pruneGlobalFailures(now);
}

export function isGateEnabled(): boolean {
  return Boolean(process.env.SITE_PASSCODE);
}

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret) return secret;
  console.warn(
    "[security] SESSION_SECRET is not set — using a random per-process secret. " +
      "Everyone will be logged out on every server restart. Set SESSION_SECRET in production.",
  );
  return EPHEMERAL_SECRET;
}

function isValidToken(token: string | undefined): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payload, signature] = parts;
  if (!payload || !signature || !safeEqual(signature, sign(sessionSecret(), payload))) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    return parsed.scope === "site" && typeof parsed.expiresAt === "number" && parsed.expiresAt > Date.now();
  } catch {
    return false;
  }
}

function createSessionToken(): string {
  const payload = Buffer.from(
    JSON.stringify({ scope: "site", expiresAt: Date.now() + SESSION_LIFETIME_MS, nonce: randomBytes(16).toString("hex") }),
  ).toString("base64url");
  return `${payload}.${sign(sessionSecret(), payload)}`;
}

function bearerToken(header: string | undefined): string | undefined {
  if (!header?.startsWith("Bearer ")) return undefined;
  return header.slice("Bearer ".length);
}

// Deliberately NOT a cookie: the client is a separate static-hosted origin from this
// API (see render.yaml notes), which makes an auth cookie a third-party cookie from the
// browser's perspective — Safari/mobile browsers purge or block those regardless of
// maxAge, causing exactly the "keeps asking for the passcode" symptom this replaced.
// A token the client stores itself and sends explicitly sidesteps that entirely.
export function isUnlocked(req: Request): boolean {
  if (!isGateEnabled()) return true;
  return isValidToken(bearerToken(req.headers.authorization));
}

export function sessionHandler(req: Request, res: Response): void {
  res.setHeader("Cache-Control", "no-store");
  res.json({ unlocked: isUnlocked(req) });
}

export function unlockHandler(req: Request, res: Response): void {
  res.setHeader("Cache-Control", "no-store");
  if (!isGateEnabled()) {
    res.json({ ok: true, token: null });
    return;
  }
  const ip = req.ip ?? "unknown";
  if (isRateLimited(ip)) {
    res.setHeader("Retry-After", String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)));
    res.status(429).json({ ok: false, error: "rate_limited" });
    return;
  }
  const passcode = typeof req.body?.passcode === "string" ? req.body.passcode : "";
  const secret = sessionSecret();
  const expected = sign(secret, `passcode:${process.env.SITE_PASSCODE}`);
  const provided = sign(secret, `passcode:${passcode}`);
  if (!safeEqual(provided, expected)) {
    recordFailure(ip);
    res.status(401).json({ ok: false });
    return;
  }
  attempts.delete(ip);
  res.json({ ok: true, token: createSessionToken() });
}

/** Production must fail closed. A missing or weak gate is safer as a failed deploy than
 * an accidentally public game/API with paid TURN credentials attached. */
export function assertSecureProductionConfig(): void {
  if (process.env.NODE_ENV !== "production") return;
  const passcode = process.env.SITE_PASSCODE ?? "";
  const secret = process.env.SESSION_SECRET ?? "";
  const origin = process.env.CLIENT_ORIGIN ?? "";
  if (passcode.length < 12) throw new Error("SITE_PASSCODE must be at least 12 characters in production");
  if (secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters in production");
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "https:" || parsed.origin !== origin) throw new Error();
  } catch {
    throw new Error("CLIENT_ORIGIN must be an exact HTTPS origin in production");
  }
  if (
    process.env.TURN_ENABLED === "true" &&
    (!process.env.CLOUDFLARE_TURN_KEY_ID || !process.env.CLOUDFLARE_TURN_KEY_API_TOKEN)
  ) {
    throw new Error("TURN_ENABLED=true requires both Cloudflare TURN credentials in production");
  }
}

export function resetSecurityStateForTests(): void {
  attempts.clear();
  globalFailures = [];
}

export function socketAuthMiddleware(
  socket: { handshake: { auth: Record<string, unknown> } },
  next: (err?: Error) => void,
): void {
  if (!isGateEnabled()) {
    next();
    return;
  }
  const token = socket.handshake.auth?.token;
  if (isValidToken(typeof token === "string" ? token : undefined)) {
    next();
    return;
  }
  next(new Error("unauthorized"));
}
