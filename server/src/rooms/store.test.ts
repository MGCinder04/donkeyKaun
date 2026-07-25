import { describe, expect, it } from "vitest";
import {
  createRoom,
  findRoom,
  joinRoom,
  kickPlayer,
  leaveRoom,
  markSocketDisconnected,
  startRoom,
  sweepStaleRooms,
} from "./store.js";

const avatar = { catalogId: "cat", colorKey: "gold", kind: "animal" as const, preview: "x" };

const LONG_PAST = Date.now() - 20 * 60 * 1000; // well past the 10-minute disconnect grace period

describe("sweepStaleRooms", () => {
  it("deletes an abandoned in-progress room once every player has been disconnected past the grace period", () => {
    const created = createRoom("Host", avatar, "d1", "s1");
    if (!created.ok) throw new Error("setup failed");
    const code = created.value.code;
    joinRoom(code, "Guest", avatar, "d2", "s2");
    startRoom(code, "d1");

    markSocketDisconnected("s1");
    markSocketDisconnected("s2");
    const room = findRoom(code);
    if (!room) throw new Error("room missing before sweep");
    for (const p of room.players) p.disconnectedAt = LONG_PAST;

    sweepStaleRooms();

    expect(findRoom(code)).toBeUndefined();
  });

  it("keeps an in-progress room alive if at least one player is still connected", () => {
    const created = createRoom("Host", avatar, "d1", "s1");
    if (!created.ok) throw new Error("setup failed");
    const code = created.value.code;
    joinRoom(code, "Guest", avatar, "d2", "s2");
    startRoom(code, "d1");

    markSocketDisconnected("s2");
    const room = findRoom(code);
    if (!room) throw new Error("room missing before sweep");
    const guest = room.players.find((p) => p.deviceId === "d2")!;
    guest.disconnectedAt = LONG_PAST;

    sweepStaleRooms();

    expect(findRoom(code)).toBeDefined();
    expect(findRoom(code)?.players).toHaveLength(2);
  });

  it("keeps an in-progress room alive while the grace period hasn't elapsed yet", () => {
    const created = createRoom("Host", avatar, "d1", "s1");
    if (!created.ok) throw new Error("setup failed");
    const code = created.value.code;
    joinRoom(code, "Guest", avatar, "d2", "s2");
    startRoom(code, "d1");

    markSocketDisconnected("s1");
    markSocketDisconnected("s2");

    sweepStaleRooms();

    expect(findRoom(code)).toBeDefined();
  });

  it("still prunes long-disconnected players from lobby rooms (existing behavior)", () => {
    const created = createRoom("Host", avatar, "d1", "s1");
    if (!created.ok) throw new Error("setup failed");
    const code = created.value.code;
    joinRoom(code, "Guest", avatar, "d2", "s2");

    markSocketDisconnected("s2");
    const room = findRoom(code);
    if (!room) throw new Error("room missing before sweep");
    const guest = room.players.find((p) => p.deviceId === "d2")!;
    guest.disconnectedAt = LONG_PAST;

    sweepStaleRooms();

    expect(findRoom(code)?.players.map((p) => p.deviceId)).toEqual(["d1"]);
  });
});

describe("leaveRoom mid-game", () => {
  it("does not splice the player out of an in-progress room (would desync GameState.seatOrder)", () => {
    const created = createRoom("Host", avatar, "d1", "s1");
    if (!created.ok) throw new Error("setup failed");
    const code = created.value.code;
    joinRoom(code, "Guest", avatar, "d2", "s2");
    startRoom(code, "d1");

    const room = leaveRoom(code, "d2");

    expect(room?.players.map((p) => p.deviceId)).toEqual(["d1", "d2"]);
    expect(room?.players.find((p) => p.deviceId === "d2")?.socketId).toBeNull();
  });

  it("still removes the player outright when the room is still in the lobby", () => {
    const created = createRoom("Host", avatar, "d1", "s1");
    if (!created.ok) throw new Error("setup failed");
    const code = created.value.code;
    joinRoom(code, "Guest", avatar, "d2", "s2");

    const room = leaveRoom(code, "d2");

    expect(room?.players.map((p) => p.deviceId)).toEqual(["d1"]);
  });
});

describe("kickPlayer mid-game", () => {
  it("does not splice the target out of an in-progress room, and blocks their rejoin", () => {
    const created = createRoom("Host", avatar, "d1", "s1");
    if (!created.ok) throw new Error("setup failed");
    const code = created.value.code;
    joinRoom(code, "Guest", avatar, "d2", "s2");
    startRoom(code, "d1");

    const result = kickPlayer(code, "d1", "d2");
    expect(result.ok).toBe(true);

    const room = findRoom(code);
    expect(room?.players.map((p) => p.deviceId)).toEqual(["d1", "d2"]);
    expect(room?.players.find((p) => p.deviceId === "d2")?.socketId).toBeNull();

    const rejoin = joinRoom(code, "Guest", avatar, "d2", "s3");
    expect(rejoin).toEqual({ ok: false, error: "kicked" });
  });

  it("still removes the target outright when kicked from the lobby", () => {
    const created = createRoom("Host", avatar, "d1", "s1");
    if (!created.ok) throw new Error("setup failed");
    const code = created.value.code;
    joinRoom(code, "Guest", avatar, "d2", "s2");

    kickPlayer(code, "d1", "d2");

    const room = findRoom(code);
    expect(room?.players.map((p) => p.deviceId)).toEqual(["d1"]);

    const rejoin = joinRoom(code, "Guest", avatar, "d2", "s3");
    expect(rejoin).toEqual({ ok: false, error: "kicked" });
  });
});
