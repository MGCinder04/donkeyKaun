import type { Request, Response } from "express";
import { isUnlocked } from "../security/passcodeGate.js";

const TURN_CREDENTIAL_TTL_SECONDS = 24 * 60 * 60;
const TURN_CACHE_MS = 23 * 60 * 60 * 1000;
const FAILURE_CACHE_MS = 60 * 1000;
const CLOUDFLARE_TIMEOUT_MS = 8_000;

const FALLBACK_ICE_SERVERS = [{ urls: "stun:stun.cloudflare.com:3478" }];

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface IceServerConfiguration {
  iceServers: IceServer[];
  turnAvailable: boolean;
}

interface CacheEntry extends IceServerConfiguration {
  expiresAt: number;
}

let cached: CacheEntry | null = null;

function isIceServer(value: unknown): value is IceServer {
  if (typeof value !== "object" || value === null) return false;
  const server = value as Record<string, unknown>;
  const validUrls =
    typeof server.urls === "string" ||
    (Array.isArray(server.urls) && server.urls.length > 0 && server.urls.every((url) => typeof url === "string"));
  if (!validUrls) return false;
  if (server.username !== undefined && typeof server.username !== "string") return false;
  if (server.credential !== undefined && typeof server.credential !== "string") return false;
  return true;
}

function fallback(now: number): CacheEntry {
  return {
    iceServers: FALLBACK_ICE_SERVERS,
    turnAvailable: false,
    expiresAt: now + FAILURE_CACHE_MS,
  };
}

/**
 * Fetch short-lived TURN credentials without ever exposing the permanent Cloudflare
 * key to the browser. If TURN is not configured (normal in local development), or if
 * Cloudflare is temporarily unavailable, voice falls back to direct STUN connections.
 */
export async function getIceServerConfiguration(now = Date.now()): Promise<IceServerConfiguration> {
  if (cached && cached.expiresAt > now) {
    return { iceServers: cached.iceServers, turnAvailable: cached.turnAvailable };
  }

  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
  const apiToken = process.env.CLOUDFLARE_TURN_KEY_API_TOKEN;
  if (!keyId || !apiToken) {
    cached = fallback(now);
    return { iceServers: cached.iceServers, turnAvailable: false };
  }

  try {
    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl: TURN_CREDENTIAL_TTL_SECONDS }),
        signal: AbortSignal.timeout(CLOUDFLARE_TIMEOUT_MS),
      },
    );
    if (!response.ok) throw new Error(`Cloudflare returned HTTP ${response.status}`);

    const body = (await response.json()) as { iceServers?: unknown };
    if (!Array.isArray(body.iceServers)) throw new Error("Cloudflare response did not contain iceServers");
    const iceServers = body.iceServers.filter(isIceServer);
    if (iceServers.length === 0) throw new Error("Cloudflare returned no usable ICE servers");

    cached = { iceServers, turnAvailable: true, expiresAt: now + TURN_CACHE_MS };
    return { iceServers, turnAvailable: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.warn(`[voice] TURN credentials unavailable; using STUN only: ${message}`);
    cached = fallback(now);
    return { iceServers: cached.iceServers, turnAvailable: false };
  }
}

export async function iceServersHandler(req: Request, res: Response): Promise<void> {
  if (!isUnlocked(req)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.json(await getIceServerConfiguration());
}

export function resetIceServerCacheForTests(): void {
  cached = null;
}
