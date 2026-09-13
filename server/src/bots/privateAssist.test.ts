import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearPrivateAssist,
  isPrivateAssistEnabled,
  privateAssistStatus,
  resetPrivateAssistForTests,
  setPrivateAssistEnabled,
  unlockPrivateAssist,
} from "./privateAssist.js";

const originalSecret = process.env.PRIVATE_USTAAD_SECRET;
const secret = "correct-horse-battery-staple-private";

beforeEach(() => {
  process.env.PRIVATE_USTAAD_SECRET = secret;
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.PRIVATE_USTAAD_SECRET;
  else process.env.PRIVATE_USTAAD_SECRET = originalSecret;
  resetPrivateAssistForTests();
});

describe("private Ustaad assist", () => {
  it("binds a successful unlock to one socket, room, and device", () => {
    expect(unlockPrivateAssist("s1", "abc12", "d1", secret, "203.0.113.5")).toEqual({
      ok: true,
      value: { unlocked: true, enabled: false },
    });
    expect(setPrivateAssistEnabled("s1", "ABC12", "d1", true)).toEqual({
      ok: true,
      value: { unlocked: true, enabled: true },
    });
    expect(isPrivateAssistEnabled("s1", "ABC12", "d1")).toBe(true);
    expect(privateAssistStatus("s1", "OTHER", "d1")).toEqual({ unlocked: false, enabled: false });
    expect(privateAssistStatus("s2", "ABC12", "d1")).toEqual({ unlocked: false, enabled: false });
  });

  it("never enables when the server secret is missing or incorrect", () => {
    delete process.env.PRIVATE_USTAAD_SECRET;
    expect(unlockPrivateAssist("s1", "ABC12", "d1", secret, "203.0.113.5").ok).toBe(false);
    process.env.PRIVATE_USTAAD_SECRET = secret;
    expect(unlockPrivateAssist("s1", "ABC12", "d1", `${secret}-wrong`, "203.0.113.5").ok).toBe(false);
    expect(privateAssistStatus("s1", "ABC12", "d1")).toEqual({ unlocked: false, enabled: false });
  });

  it("rate-limits repeated guesses without locking out a different device", () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(unlockPrivateAssist("s1", "ABC12", "d1", "wrong-secret-that-is-long-enough", "203.0.113.5"))
        .toEqual({ ok: false, error: "unauthorized" });
    }
    expect(unlockPrivateAssist("s1", "ABC12", "d1", secret, "203.0.113.5"))
      .toEqual({ ok: false, error: "rate_limited" });
    expect(unlockPrivateAssist("s2", "ABC12", "d2", secret, "203.0.113.5").ok).toBe(true);
  });

  it("forgets the capability as soon as its socket disconnects", () => {
    unlockPrivateAssist("s1", "ABC12", "d1", secret, "203.0.113.5");
    setPrivateAssistEnabled("s1", "ABC12", "d1", true);
    clearPrivateAssist("s1");
    expect(isPrivateAssistEnabled("s1", "ABC12", "d1")).toBe(false);
  });
});
