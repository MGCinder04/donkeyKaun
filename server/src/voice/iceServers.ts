const TURN_CREDENTIAL_TTL_SECONDS = 30 * 60;
const TURN_CACHE_MS = 24 * 60 * 1000;
const FAILURE_CACHE_MS = 60 * 1000;
const HOURLY_WINDOW_MS = 60 * 60 * 1000;
const DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_HOURLY_IP_LIMIT = 30;
const DEFAULT_DAILY_GLOBAL_LIMIT = 120;
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
  turnUsername?: string;
}

interface Counter {
  count: number;
  resetAt: number;
}

const credentialCache = new Map<string, CacheEntry>();
const ipCounters = new Map<string, Counter>();
let globalCounter: Counter | null = null;

function envLimit(name: string, fallback: number, maximum: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), maximum);
}

function isTurnEnabled(): boolean {
  return process.env.TURN_ENABLED === "true";
}

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

function fallback(): IceServerConfiguration {
  return { iceServers: FALLBACK_ICE_SERVERS, turnAvailable: false };
}

function findTurnUsername(iceServers: IceServer[]): string | undefined {
  return iceServers.find((server) => typeof server.username === "string" && server.username.length > 0)?.username;
}

async function revokeCredential(username: string): Promise<void> {
  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
  const apiToken = process.env.CLOUDFLARE_TURN_KEY_API_TOKEN;
  if (!isTurnEnabled() || !keyId || !apiToken) return;
  try {
    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/${encodeURIComponent(username)}/revoke`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiToken}` },
        signal: AbortSignal.timeout(CLOUDFLARE_TIMEOUT_MS),
      },
    );
    if (!response.ok) throw new Error(`Cloudflare returned HTTP ${response.status}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.warn(`[voice] TURN credential revocation failed; it will still expire automatically: ${message}`);
  }
}

function consumeCredentialAllowance(ip: string, now: number): boolean {
  const hourlyLimit = envLimit("TURN_HOURLY_IP_LIMIT", DEFAULT_HOURLY_IP_LIMIT, 120);
  const dailyLimit = envLimit("TURN_DAILY_CREDENTIAL_LIMIT", DEFAULT_DAILY_GLOBAL_LIMIT, 500);

  const ipCounter = ipCounters.get(ip);
  if (!ipCounter || now >= ipCounter.resetAt) {
    ipCounters.set(ip, { count: 1, resetAt: now + HOURLY_WINDOW_MS });
  } else {
    if (ipCounter.count >= hourlyLimit) return false;
    ipCounter.count += 1;
  }

  if (!globalCounter || now >= globalCounter.resetAt) {
    globalCounter = { count: 1, resetAt: now + DAILY_WINDOW_MS };
  } else {
    if (globalCounter.count >= dailyLimit) {
      const currentIp = ipCounters.get(ip);
      if (currentIp) currentIp.count -= 1;
      return false;
    }
    globalCounter.count += 1;
  }
  return true;
}

/**
 * Generate one short-lived TURN credential per connected room member. Successful
 * credentials are cached only for that room/device pair, expire after 30 minutes,
 * and are protected by per-IP and global issuance limits. TURN also has an explicit
 * kill switch: unless TURN_ENABLED=true, this always returns free STUN only.
 */
export async function getIceServerConfiguration(
  membershipKey: string,
  ip: string,
  now = Date.now(),
): Promise<IceServerConfiguration> {
  if (!isTurnEnabled()) return fallback();

  const cached = credentialCache.get(membershipKey);
  if (cached && cached.expiresAt > now) {
    return { iceServers: cached.iceServers, turnAvailable: cached.turnAvailable };
  }

  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
  const apiToken = process.env.CLOUDFLARE_TURN_KEY_API_TOKEN;
  if (!keyId || !apiToken) return fallback();

  if (!consumeCredentialAllowance(ip, now)) {
    console.warn("[voice] TURN credential issuance limit reached; using STUN only");
    return fallback();
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

    credentialCache.set(membershipKey, {
      iceServers,
      turnAvailable: true,
      expiresAt: now + TURN_CACHE_MS,
      turnUsername: findTurnUsername(iceServers),
    });
    return { iceServers, turnAvailable: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.warn(`[voice] TURN credentials unavailable; using STUN only: ${message}`);
    credentialCache.set(membershipKey, { ...fallback(), expiresAt: now + FAILURE_CACHE_MS });
    return fallback();
  }
}

export async function clearTurnMembership(membershipKey: string): Promise<void> {
  const cached = credentialCache.get(membershipKey);
  credentialCache.delete(membershipKey);
  if (cached?.turnUsername) await revokeCredential(cached.turnUsername);
}

export function sweepTurnSecurityState(now = Date.now()): void {
  for (const [key, entry] of credentialCache) {
    if (entry.expiresAt <= now) credentialCache.delete(key);
  }
  for (const [ip, counter] of ipCounters) {
    if (counter.resetAt <= now) ipCounters.delete(ip);
  }
  if (globalCounter && globalCounter.resetAt <= now) globalCounter = null;
}

export function resetIceServerStateForTests(): void {
  credentialCache.clear();
  ipCounters.clear();
  globalCounter = null;
}
