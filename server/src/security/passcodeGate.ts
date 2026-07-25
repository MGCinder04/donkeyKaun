import type { Request, Response } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "dk_auth";
const MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000; // 180 days
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

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  }
  return out;
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

/** Cross-origin in production (client is a separate static site), same-origin in dev
 *  (Vite proxies /api to the server), so the cookie needs different SameSite handling. */
function cookieOptions() {
  const cross = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    sameSite: cross ? ("none" as const) : ("lax" as const),
    secure: cross,
    maxAge: MAX_AGE_MS,
  };
}

export function isUnlocked(req: Request): boolean {
  if (!isGateEnabled()) return true;
  const cookies = parseCookies(req.headers.cookie);
  return isValidToken(cookies[COOKIE_NAME]);
}

export function sessionHandler(req: Request, res: Response): void {
  res.json({ unlocked: isUnlocked(req) });
}

export function unlockHandler(req: Request, res: Response): void {
  if (!isGateEnabled()) {
    res.json({ ok: true });
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
  const token = sign(secret, "unlocked");
  res.cookie(COOKIE_NAME, token, cookieOptions());
  res.json({ ok: true });
}

export function socketAuthMiddleware(
  socket: { handshake: { headers: { cookie?: string } } },
  next: (err?: Error) => void,
): void {
  if (!isGateEnabled()) {
    next();
    return;
  }
  const cookies = parseCookies(socket.handshake.headers.cookie);
  if (isValidToken(cookies[COOKIE_NAME])) {
    next();
    return;
  }
  next(new Error("unauthorized"));
}
