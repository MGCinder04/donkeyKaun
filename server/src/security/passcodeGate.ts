import type { Request, Response } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_ATTEMPTS = 10;

const attempts = new Map<string, { count: number; resetAt: number }>();

function sign(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX_ATTEMPTS;
}

export function isGateEnabled(): boolean {
  return Boolean(process.env.SITE_PASSCODE);
}

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret) return secret;
  console.warn(
    "[security] SESSION_SECRET is not set — using an ephemeral secret. " +
      "Everyone will be logged out on every server restart. Set SESSION_SECRET in production.",
  );
  return "dev-only-ephemeral-secret";
}

function isValidToken(token: string | undefined): boolean {
  if (!token) return false;
  return safeEqual(token, sign(sessionSecret(), "unlocked"));
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
  res.json({ unlocked: isUnlocked(req) });
}

export function unlockHandler(req: Request, res: Response): void {
  if (!isGateEnabled()) {
    res.json({ ok: true, token: null });
    return;
  }
  const ip = req.ip ?? "unknown";
  if (isRateLimited(ip)) {
    res.status(429).json({ ok: false, error: "rate_limited" });
    return;
  }
  const passcode = typeof req.body?.passcode === "string" ? req.body.passcode : "";
  const secret = sessionSecret();
  const expected = sign(secret, `passcode:${process.env.SITE_PASSCODE}`);
  const provided = sign(secret, `passcode:${passcode}`);
  if (!safeEqual(provided, expected)) {
    res.status(401).json({ ok: false });
    return;
  }
  res.json({ ok: true, token: sign(secret, "unlocked") });
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
