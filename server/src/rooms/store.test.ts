import { describe, expect, it } from "vitest";
import {
  createRoom,
  addBot,
  botTakeover,
  findRoom,
  joinRoom,
  kickPlayer,
  leaveRoom,
  markSocketDisconnected,
  normalizeRestoredGameState,
  removePlayerFromRoom,
  removeBot,
  setReplacementSeat,
  startRoom,
  sweepStaleRooms,
} from "./store.js";
import { startGame } from "../game/engine.js";
import { toPublicGameState } from "../game/publicState.js";

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

  it("lets an accidentally departed player reclaim the same live seat", () => {
    const created = createRoom("Host", avatar, "return-host", "return-s1");
    if (!created.ok) throw new Error("setup failed");
    joinRoom(created.value.code, "Guest", avatar, "return-guest", "return-s2");
    startRoom(created.value.code, "return-host");
    const originalHand = findRoom(created.value.code)?.game?.hands["return-guest"];

    leaveRoom(created.value.code, "return-guest");
    const rejoined = joinRoom(created.value.code, "Guest", avatar, "return-guest", "return-s3");

    expect(rejoined.ok).toBe(true);
    expect(findRoom(created.value.code)?.game?.hands["return-guest"]).toEqual(originalHand);
    expect(findRoom(created.value.code)?.players.find((p) => p.deviceId === "return-guest")?.socketId).toBe("return-s3");
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

describe("mid-game seat decisions", () => {
  it("lets the host open a disconnected seat and transfers all game state to its replacement", () => {
    const created = createRoom("Host", avatar, "replace-host", "replace-s1");
    if (!created.ok) throw new Error("setup failed");
    const code = created.value.code;
    joinRoom(code, "Guest", avatar, "replace-old", "replace-s2");
    joinRoom(code, "Third", avatar, "replace-third", "replace-s3");
    startRoom(code, "replace-host");
    const room = findRoom(code)!;
    room.game!.scores["replace-old"] = 43;
    const inheritedHand = room.game!.hands["replace-old"];
    markSocketDisconnected("replace-s2");

    expect(setReplacementSeat(code, "replace-host", "replace-old").ok).toBe(true);
    const joined = joinRoom(code, "New Player", avatar, "replace-new", "replace-s4");

    expect(joined.ok).toBe(true);
    expect(findRoom(code)?.replacementForDeviceId).toBeNull();
    expect(findRoom(code)?.game?.seatOrder).toContain("replace-new");
    expect(findRoom(code)?.game?.seatOrder).not.toContain("replace-old");
    expect(findRoom(code)?.game?.hands["replace-new"]).toEqual(inheritedHand);
    expect(findRoom(code)?.game?.scores["replace-new"]).toBe(43);
    expect(findRoom(code)?.kickedDeviceIds.has("replace-old")).toBe(true);
  });

  it("removes a disconnected seat and keeps a three-player game playable with two", () => {
    const created = createRoom("Host", avatar, "remove-host", "remove-s1");
    if (!created.ok) throw new Error("setup failed");
    const code = created.value.code;
    joinRoom(code, "Leaving", avatar, "remove-old", "remove-s2");
    joinRoom(code, "Third", avatar, "remove-third", "remove-s3");
    startRoom(code, "remove-host");
    markSocketDisconnected("remove-s2");

    const removed = removePlayerFromRoom(code, "remove-host", "remove-old");

    expect(removed.ok).toBe(true);
    expect(findRoom(code)?.players.map((player) => player.deviceId)).toEqual(["remove-host", "remove-third"]);
    expect(findRoom(code)?.game?.seatOrder).toEqual(["remove-host", "remove-third"]);
  });

  it("never lets the host reduce a game below two players", () => {
    const created = createRoom("Host", avatar, "minimum-host", "minimum-s1");
    if (!created.ok) throw new Error("setup failed");
    const code = created.value.code;
    joinRoom(code, "Guest", avatar, "minimum-guest", "minimum-s2");
    startRoom(code, "minimum-host");
    markSocketDisconnected("minimum-s2");

    expect(removePlayerFromRoom(code, "minimum-host", "minimum-guest")).toEqual({
      ok: false,
      error: "too_few_players",
    });
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

describe("startRoom connected-player safety", () => {
  it("does not count a disconnected lobby player toward the minimum", () => {
    const created = createRoom("Host", avatar, "connected-host", "socket-host");
    if (!created.ok) throw new Error("setup failed");
    joinRoom(created.value.code, "Guest", avatar, "offline-guest", "socket-guest");
    markSocketDisconnected("socket-guest");

    expect(startRoom(created.value.code, "connected-host")).toEqual({ ok: false, error: "cant_start" });
  });

  it("drops abandoned lobby seats when enough connected players start", () => {
    const created = createRoom("Host", avatar, "start-host", "start-socket-host");
    if (!created.ok) throw new Error("setup failed");
    joinRoom(created.value.code, "Online", avatar, "start-online", "start-socket-online");
    joinRoom(created.value.code, "Offline", avatar, "start-offline", "start-socket-offline");
    markSocketDisconnected("start-socket-offline");

    const started = startRoom(created.value.code, "start-host");
    expect(started.ok).toBe(true);
    expect(findRoom(created.value.code)?.players.map((player) => player.deviceId)).toEqual([
      "start-host",
      "start-online",
    ]);
  });
});

describe("server-owned bot seats", () => {
  it("lets one human add a bot and start a solo challenge", () => {
    const created = createRoom("Solo", avatar, "bot-host", "bot-socket");
    if (!created.ok) throw new Error("setup failed");
    expect(addBot(created.value.code, "bot-host", "ustaad").ok).toBe(true);
    expect(startRoom(created.value.code, "bot-host").ok).toBe(true);
    const room = findRoom(created.value.code)!;
    expect(room.players).toHaveLength(2);
    expect(room.players[1].botKind).toBe("ustaad");
    expect(room.game?.seatOrder).toContain(room.players[1].deviceId);
  });

  it("lets only the host add and remove bots", () => {
    const created = createRoom("Host", avatar, "bot-auth-host", "bot-auth-socket");
    if (!created.ok) throw new Error("setup failed");
    joinRoom(created.value.code, "Guest", avatar, "bot-auth-guest", "bot-auth-guest-socket");
    expect(addBot(created.value.code, "bot-auth-guest", "bhola")).toEqual({ ok: false, error: "not_host" });
    const added = addBot(created.value.code, "bot-auth-host", "bhola");
    expect(added.ok).toBe(true);
    const botId = findRoom(created.value.code)!.players.find((player) => player.botKind)!.deviceId;
    expect(removeBot(created.value.code, "bot-auth-guest", botId)).toEqual({ ok: false, error: "not_host" });
    expect(removeBot(created.value.code, "bot-auth-host", botId).ok).toBe(true);
  });

  it("transfers a disconnected seat's complete game state to a bot", () => {
    const created = createRoom("Host", avatar, "take-host", "take-host-socket");
    if (!created.ok) throw new Error("setup failed");
    joinRoom(created.value.code, "Guest", avatar, "take-guest", "take-guest-socket");
    startRoom(created.value.code, "take-host");
    const before = findRoom(created.value.code)!;
    before.game!.scores["take-guest"] = 86;
    const inheritedHand = before.game!.hands["take-guest"];
    markSocketDisconnected("take-guest-socket");

    const result = botTakeover(created.value.code, "take-host", "take-guest", "hisaabi");
    expect(result.ok).toBe(true);
    const after = findRoom(created.value.code)!;
    const bot = after.players.find((player) => player.botKind === "hisaabi")!;
    expect(after.game!.scores[bot.deviceId]).toBe(86);
    expect(after.game!.hands[bot.deviceId]).toEqual(inheritedHand);
    expect(after.game!.seatOrder).not.toContain("take-guest");
  });
});

describe("restored card knowledge", () => {
  it("repairs legacy history and derives void suits from public plays", () => {
    const game = startGame(["legacy-a", "legacy-b"], () => 0.5);
    game.phase = "trick";
    game.tricksWon = { "legacy-a": 1, "legacy-b": 0 };
    game.currentTrick = [
      { deviceId: "legacy-a", card: { suit: "H", rank: "A" } },
      { deviceId: "legacy-b", card: { suit: "S", rank: "2" } },
    ];
    (game as unknown as { playHistory: unknown }).playHistory = {
      complete: "not-a-boolean",
      plays: [
        { handNumber: 1, deviceId: "legacy-a", card: { suit: "D", rank: "A" }, leadSuit: "D" },
        { handNumber: 1, deviceId: "legacy-b", card: { suit: "C", rank: "2" }, leadSuit: "D" },
        { handNumber: 1, deviceId: "legacy-b", card: { suit: "C", rank: "2" }, leadSuit: "D" },
        { nonsense: true },
      ],
    };
    game.voidSuits = { "legacy-a": ["S"], "legacy-b": [] };

    normalizeRestoredGameState(game);

    expect(game.playHistory.complete).toBe(false);
    expect(game.playHistory.plays).toHaveLength(4);
    expect(game.playHistory.plays.slice(-2).map((play) => play.handNumber)).toEqual([2, 2]);
    expect(game.voidSuits["legacy-a"]).toEqual([]);
    expect(game.voidSuits["legacy-b"]).toEqual(["D", "H"]);
  });

  it("keeps private inference history out of public game state", () => {
    const game = startGame(["public-a", "public-b"], () => 0.25);
    const publicGame = toPublicGameState(game) as unknown as Record<string, unknown>;

    expect(publicGame.playHistory).toBeUndefined();
    expect(publicGame.voidSuits).toBeUndefined();
    expect(publicGame.hands).toBeUndefined();
  });
});
