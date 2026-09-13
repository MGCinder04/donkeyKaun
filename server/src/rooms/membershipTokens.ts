import { createHash, timingSafeEqual } from "node:crypto";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,100}$/;

export interface ResumeAuthorization {
  ok: boolean;
  nextHash?: string;
}

export function isValidResumeToken(token: unknown): token is string {
  return typeof token === "string" && TOKEN_PATTERN.test(token);
}

export function hashResumeToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function hashesMatch(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The browser sends both its current secret and a pre-generated replacement. Rotating
 * on every takeover prevents the superseded tab from stealing the seat back. If the
 * success acknowledgement was lost, the replacement already matches the stored hash,
 * making an identical retry safe and idempotent.
 */
export function authorizeResume(
  storedHash: string,
  currentToken: unknown,
  nextToken: unknown,
): ResumeAuthorization {
  if (!storedHash || !isValidResumeToken(currentToken) || !isValidResumeToken(nextToken)) {
    return { ok: false };
  }
  const currentHash = hashResumeToken(currentToken);
  const nextHash = hashResumeToken(nextToken);
  if (hashesMatch(storedHash, currentHash)) return { ok: true, nextHash };
  if (hashesMatch(storedHash, nextHash)) return { ok: true, nextHash: storedHash };
  return { ok: false };
}
