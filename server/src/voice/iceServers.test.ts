import { afterEach, describe, expect, it, vi } from "vitest";
import { getIceServerConfiguration, resetIceServerCacheForTests } from "./iceServers.js";

const originalKeyId = process.env.CLOUDFLARE_TURN_KEY_ID;
const originalToken = process.env.CLOUDFLARE_TURN_KEY_API_TOKEN;

afterEach(() => {
  if (originalKeyId === undefined) delete process.env.CLOUDFLARE_TURN_KEY_ID;
  else process.env.CLOUDFLARE_TURN_KEY_ID = originalKeyId;
  if (originalToken === undefined) delete process.env.CLOUDFLARE_TURN_KEY_API_TOKEN;
  else process.env.CLOUDFLARE_TURN_KEY_API_TOKEN = originalToken;
  vi.unstubAllGlobals();
  resetIceServerCacheForTests();
});

describe("TURN credential configuration", () => {
  it("uses STUN-only fallback when Cloudflare is not configured", async () => {
    delete process.env.CLOUDFLARE_TURN_KEY_ID;
    delete process.env.CLOUDFLARE_TURN_KEY_API_TOKEN;

    await expect(getIceServerConfiguration()).resolves.toEqual({
      iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
      turnAvailable: false,
    });
  });

  it("returns short-lived ICE servers from Cloudflare without exposing the permanent key", async () => {
    process.env.CLOUDFLARE_TURN_KEY_ID = "turn-key-id";
    process.env.CLOUDFLARE_TURN_KEY_API_TOKEN = "permanent-secret";
    const cloudflareServers = [
      { urls: ["stun:stun.cloudflare.com:3478"] },
      {
        urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turns:turn.cloudflare.com:5349?transport=tcp"],
        username: "temporary-user",
        credential: "temporary-password",
      },
    ];
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ iceServers: cloudflareServers }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getIceServerConfiguration()).resolves.toEqual({
      iceServers: cloudflareServers,
      turnAvailable: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://rtc.live.cloudflare.com/v1/turn/keys/turn-key-id/credentials/generate-ice-servers",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer permanent-secret" }),
        body: JSON.stringify({ ttl: 86_400 }),
      }),
    );
  });

  it("falls back safely if Cloudflare rejects the credential request", async () => {
    process.env.CLOUDFLARE_TURN_KEY_ID = "turn-key-id";
    process.env.CLOUDFLARE_TURN_KEY_API_TOKEN = "bad-secret";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("denied", { status: 401 })));

    await expect(getIceServerConfiguration()).resolves.toEqual({
      iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
      turnAvailable: false,
    });
  });
});

