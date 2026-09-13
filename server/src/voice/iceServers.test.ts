import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearTurnMembership, getIceServerConfiguration, resetIceServerStateForTests } from "./iceServers.js";

const managedEnv = [
  "TURN_ENABLED",
  "TURN_HOURLY_IP_LIMIT",
  "TURN_DAILY_CREDENTIAL_LIMIT",
  "CLOUDFLARE_TURN_KEY_ID",
  "CLOUDFLARE_TURN_KEY_API_TOKEN",
] as const;
const originalEnv = new Map(managedEnv.map((key) => [key, process.env[key]]));

beforeEach(() => {
  process.env.TURN_ENABLED = "true";
  process.env.CLOUDFLARE_TURN_KEY_ID = "turn-key-id";
  process.env.CLOUDFLARE_TURN_KEY_API_TOKEN = "permanent-secret";
});

afterEach(() => {
  for (const key of managedEnv) {
    const original = originalEnv.get(key);
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
  vi.unstubAllGlobals();
  resetIceServerStateForTests();
});

function cloudflareResponse() {
  return [
    { urls: ["stun:stun.cloudflare.com:3478"] },
    {
      urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turns:turn.cloudflare.com:5349?transport=tcp"],
      username: "temporary-user",
      credential: "temporary-password",
    },
  ];
}

describe("TURN credential configuration", () => {
  it("uses STUN only unless the explicit paid-service kill switch is enabled", async () => {
    process.env.TURN_ENABLED = "false";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getIceServerConfiguration("ROOM:DEVICE", "127.0.0.1")).resolves.toEqual({
      iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
      turnAvailable: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a short-lived credential and caches it only for that room member", async () => {
    const servers = cloudflareResponse();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ iceServers: servers }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getIceServerConfiguration("ROOM:DEVICE", "127.0.0.1")).resolves.toEqual({
      iceServers: servers,
      turnAvailable: true,
    });
    await getIceServerConfiguration("ROOM:DEVICE", "127.0.0.1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://rtc.live.cloudflare.com/v1/turn/keys/turn-key-id/credentials/generate-ice-servers",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer permanent-secret" }),
        body: JSON.stringify({ ttl: 1_800 }),
      }),
    );
  });

  it("falls back safely if Cloudflare rejects the credential request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("denied", { status: 401 })));

    await expect(getIceServerConfiguration("ROOM:DEVICE", "127.0.0.1")).resolves.toEqual({
      iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
      turnAvailable: false,
    });
  });

  it("stops issuing credentials when the per-IP allowance is exhausted", async () => {
    process.env.TURN_HOURLY_IP_LIMIT = "1";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ iceServers: cloudflareResponse() }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await getIceServerConfiguration("ROOM:A", "203.0.113.10");
    const blocked = await getIceServerConfiguration("ROOM:B", "203.0.113.10");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(blocked.turnAvailable).toBe(false);
  });

  it("stops all credential issuance at the global daily allowance", async () => {
    process.env.TURN_DAILY_CREDENTIAL_LIMIT = "1";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ iceServers: cloudflareResponse() }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await getIceServerConfiguration("ROOM:A", "203.0.113.10");
    const blocked = await getIceServerConfiguration("ROOM:B", "203.0.113.11");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(blocked.turnAvailable).toBe(false);
  });

  it("revokes a live temporary credential when its room membership ends", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ iceServers: cloudflareResponse() }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await getIceServerConfiguration("ROOM:DEVICE", "203.0.113.10");
    await clearTurnMembership("ROOM:DEVICE");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://rtc.live.cloudflare.com/v1/turn/keys/turn-key-id/credentials/temporary-user/revoke",
    );
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ method: "POST", headers: { Authorization: "Bearer permanent-secret" } }),
    );
  });
});
