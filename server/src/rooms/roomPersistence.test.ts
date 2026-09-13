import { describe, expect, it } from "vitest";
import type { Room } from "./types.js";
import { roomFromSnapshot, snapshotRoom } from "./roomPersistence.js";

const room: Room = {
  code: "ABCDE",
  status: "lobby",
  createdAt: 123,
  game: null,
  kickedDeviceIds: new Set(["kicked"]),
  players: [
    {
      deviceId: "device",
      name: "Player",
      avatar: { catalogId: "animal-0", colorKey: "gold", kind: "animal", preview: "fox" },
      resumeTokenHash: "secret-hash",
      socketId: "old-process-socket",
      joinedAt: 100,
      disconnectedAt: null,
    },
  ],
};

describe("room persistence snapshots", () => {
  it("never persists process-local socket ids", () => {
    const snapshot = snapshotRoom(room);
    expect(snapshot.players[0]).not.toHaveProperty("socketId");
    expect(snapshot.kickedDeviceIds).toEqual(["kicked"]);
  });

  it("restores every player as disconnected while retaining game membership secrets", () => {
    const restored = roomFromSnapshot(snapshotRoom(room));
    expect(restored?.players[0].socketId).toBeNull();
    expect(restored?.players[0].disconnectedAt).toEqual(expect.any(Number));
    expect(restored?.players[0].resumeTokenHash).toBe("secret-hash");
    expect(restored?.kickedDeviceIds.has("kicked")).toBe(true);
  });

  it("rejects malformed snapshots", () => {
    expect(roomFromSnapshot({ code: "ABCDE" })).toBeNull();
    expect(roomFromSnapshot("not-json")).toBeNull();
  });
});
