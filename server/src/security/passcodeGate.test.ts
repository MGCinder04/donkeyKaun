import type { Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertSecureProductionConfig,
  isUnlocked,
  resetSecurityStateForTests,
  unlockHandler,
} from "./passcodeGate.js";

const managedEnv = [
  "NODE_ENV",
  "SITE_PASSCODE",
  "SESSION_SECRET",
  "CLIENT_ORIGIN",
  "TURN_ENABLED",
  "CLOUDFLARE_TURN_KEY_ID",
  "CLOUDFLARE_TURN_KEY_API_TOKEN",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
] as const;
const originalEnv = new Map(managedEnv.map((key) => [key, process.env[key]]));

interface MockResponse {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
}

function response(): Response & MockResponse {
  const state: MockResponse = { statusCode: 200, body: null, headers: {} };
  return Object.assign(state, {
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    json(body: unknown) {
      state.body = body;
      return this;
    },
    setHeader(name: string, value: string) {
      state.headers[name] = value;
      return this;
    },
  }) as unknown as Response & MockResponse;
}

function request(passcode: string, ip = "203.0.113.20"): Request {
  return { body: { passcode }, ip, headers: {} } as Request;
}

beforeEach(() => {
  process.env.NODE_ENV = "test";
  process.env.SITE_PASSCODE = "family-passphrase";
  process.env.SESSION_SECRET = "a-secure-session-secret-that-is-long-enough";
  process.env.CLIENT_ORIGIN = "https://donkeykaun.onrender.com";
});

afterEach(() => {
  for (const key of managedEnv) {
    const original = originalEnv.get(key);
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
  resetSecurityStateForTests();
});

describe("passcode security", () => {
  it("issues unique, signed, expiring tokens that authenticate subsequent requests", () => {
    const first = response();
    const second = response();
    unlockHandler(request("family-passphrase"), first);
    unlockHandler(request("family-passphrase"), second);

    const firstToken = (first.body as { token: string }).token;
    const secondToken = (second.body as { token: string }).token;
    expect(first.statusCode).toBe(200);
    expect(firstToken).not.toBe(secondToken);
    expect(isUnlocked({ headers: { authorization: `Bearer ${firstToken}` } } as Request)).toBe(true);
    expect(isUnlocked({ headers: { authorization: `Bearer ${firstToken}x` } } as Request)).toBe(false);
    expect(isUnlocked({ headers: { authorization: `Bearer ${firstToken}.extra` } } as Request)).toBe(false);
  });

  it("blocks an IP after five failed passcode attempts", () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = response();
      unlockHandler(request("wrong"), failed);
      expect(failed.statusCode).toBe(401);
    }
    const blocked = response();
    unlockHandler(request("family-passphrase"), blocked);
    expect(blocked.statusCode).toBe(429);
  });

  it("fails production startup when the private gate is missing or weak", () => {
    process.env.NODE_ENV = "production";
    process.env.SITE_PASSCODE = "short";
    expect(() => assertSecureProductionConfig()).toThrow(/SITE_PASSCODE/);

    process.env.SITE_PASSCODE = "long-family-passcode";
    process.env.SESSION_SECRET = "short";
    expect(() => assertSecureProductionConfig()).toThrow(/SESSION_SECRET/);

    process.env.SESSION_SECRET = "a-secure-session-secret-that-is-long-enough";
    process.env.CLIENT_ORIGIN = "http://not-secure.example";
    expect(() => assertSecureProductionConfig()).toThrow(/CLIENT_ORIGIN/);

    process.env.CLIENT_ORIGIN = "https://donkeykaun.onrender.com";
    process.env.TURN_ENABLED = "true";
    delete process.env.CLOUDFLARE_TURN_KEY_ID;
    delete process.env.CLOUDFLARE_TURN_KEY_API_TOKEN;
    expect(() => assertSecureProductionConfig()).toThrow(/TURN_ENABLED/);

    process.env.TURN_ENABLED = "false";
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    expect(() => assertSecureProductionConfig()).toThrow(/UPSTASH/);

    process.env.UPSTASH_REDIS_REST_TOKEN = "example-token";
    expect(() => assertSecureProductionConfig()).not.toThrow();
  });
});
