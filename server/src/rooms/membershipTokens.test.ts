import { describe, expect, it } from "vitest";
import { authorizeResume, hashResumeToken, isValidResumeToken } from "./membershipTokens.js";

const token = (character: string) => character.repeat(43);

describe("room resume tokens", () => {
  it("accepts URL-safe cryptographic-length tokens", () => {
    expect(isValidResumeToken(token("a"))).toBe(true);
    expect(isValidResumeToken("short")).toBe(false);
    expect(isValidResumeToken("x".repeat(42) + "+")).toBe(false);
  });

  it("rotates a valid current token", () => {
    const current = token("a");
    const next = token("b");
    expect(authorizeResume(hashResumeToken(current), current, next)).toEqual({
      ok: true,
      nextHash: hashResumeToken(next),
    });
  });

  it("accepts an idempotent retry after an acknowledgement was lost", () => {
    const old = token("a");
    const pending = token("b");
    expect(authorizeResume(hashResumeToken(pending), old, pending)).toEqual({
      ok: true,
      nextHash: hashResumeToken(pending),
    });
  });

  it("rejects a different browser secret", () => {
    expect(authorizeResume(hashResumeToken(token("a")), token("x"), token("y"))).toEqual({ ok: false });
  });
});
