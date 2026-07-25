import type { Request, Response, NextFunction } from "express";
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

const LOCK_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>Donkey Kaun</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: radial-gradient(circle at 50% 20%, #1e2a3a, #0b0f14 70%);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #e8edf2;
  }
  form {
    background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
    border-radius: 16px; padding: 2.5rem 2rem; width: 90%; max-width: 340px;
    backdrop-filter: blur(8px); box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    text-align: center;
  }
  h1 { font-size: 1.4rem; margin: 0 0 0.25rem; }
  p { color: #9aa7b5; font-size: 0.9rem; margin: 0 0 1.5rem; }
  input {
    width: 100%; padding: 0.75rem 1rem; border-radius: 10px; border: 1px solid rgba(255,255,255,0.12);
    background: rgba(0,0,0,0.3); color: #e8edf2; font-size: 1rem; text-align: center;
    letter-spacing: 0.05em;
  }
  input:focus { outline: none; border-color: #6ea8fe; }
  button {
    margin-top: 1rem; width: 100%; padding: 0.75rem; border-radius: 10px; border: none;
    background: #6ea8fe; color: #0b0f14; font-weight: 600; font-size: 1rem; cursor: pointer;
    transition: transform 0.15s ease, background 0.15s ease;
  }
  button:hover { background: #8fbcff; }
  button:active { transform: scale(0.98); }
  #err { color: #ff8080; font-size: 0.85rem; min-height: 1.2em; margin-top: 0.75rem; }
</style>
</head>
<body>
<form id="f">
  <h1>Donkey Kaun</h1>
  <p>Family game night — enter the passcode to continue</p>
  <input id="p" type="password" inputmode="text" autocomplete="off" autofocus placeholder="Passcode" />
  <button type="submit">Enter</button>
  <div id="err"></div>
</form>
<script>
  document.getElementById("f").addEventListener("submit", async (e) => {
    e.preventDefault();
    const passcode = document.getElementById("p").value;
    const err = document.getElementById("err");
    err.textContent = "";
    try {
      const res = await fetch("/api/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      if (res.ok) {
        window.location.reload();
      } else if (res.status === 429) {
        err.textContent = "Too many attempts. Try again later.";
      } else {
        err.textContent = "Wrong passcode.";
      }
    } catch {
      err.textContent = "Something went wrong. Try again.";
    }
  });
</script>
</body>
</html>`;

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

export function passcodeGate(req: Request, res: Response, next: NextFunction): void {
  if (!isGateEnabled()) {
    next();
    return;
  }
  const cookies = parseCookies(req.headers.cookie);
  if (isValidToken(cookies[COOKIE_NAME])) {
    next();
    return;
  }
  if (req.path.startsWith("/api/")) {
    res.status(401).json({ error: "locked" });
    return;
  }
  res.status(200).type("html").send(LOCK_PAGE);
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
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE_MS,
  });
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
