import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server, Socket } from "socket.io";
import { resetPrivateAssistForTests } from "../bots/privateAssist.js";
import { findRoom, toPublicRoom } from "./store.js";
import { registerRoomHandlers } from "./socketHandlers.js";

type Handler = (...args: unknown[]) => unknown;

const avatar = { catalogId: "cat", colorKey: "gold", kind: "animal" as const, preview: "🐈" };
const secret = "correct-horse-battery-staple-private";

function harness() {
  const handlers = new Map<string, Handler>();
  const emitted: Array<{ target: string; event: string; payload: unknown }> = [];
  const socket = {
    id: "private-owner-socket",
    data: {},
    handshake: { address: "203.0.113.9" },
    on(event: string, handler: Handler) {
      handlers.set(event, handler);
      return this;
    },
    emit(event: string, payload: unknown) {
      emitted.push({ target: this.id, event, payload });
      return true;
    },
    join() {},
    leave() {},
    disconnect() {},
  } as unknown as Socket;
  const sockets = new Map([[socket.id, socket]]);
  const io = {
    sockets: { sockets },
    to(target: string) {
      return {
        emit(event: string, payload: unknown) {
          emitted.push({ target, event, payload });
        },
      };
    },
  } as unknown as Server;
  registerRoomHandlers(io, socket);

  async function call<T>(event: string, payload: Record<string, unknown>): Promise<T> {
    const handler = handlers.get(event);
    if (!handler) throw new Error(`Missing handler: ${event}`);
    return new Promise<T>((resolve, reject) => {
      try {
        const pending = handler(payload, resolve);
        if (pending instanceof Promise) void pending.catch(reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  return { call, emitted };
}

beforeEach(() => {
  vi.useFakeTimers();
  process.env.PRIVATE_USTAAD_SECRET = secret;
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.PRIVATE_USTAAD_SECRET;
  resetPrivateAssistForTests();
});

describe("private assist socket flow", () => {
  it("autoplays a human seat as Ustaad without exposing a bot marker", async () => {
    const { call } = harness();
    const created = await call<{ ok: true; value: { code: string } }>("room:create", {
      name: "Relaxed Host",
      avatar,
      deviceId: "private-owner-device",
      resumeToken: "a".repeat(48),
    });
    const code = created.value.code;

    expect(await call("room:add-bot", { code, deviceId: "private-owner-device", botKind: "ustaad" }))
      .toEqual({ ok: true, value: null });
    expect(await call("private-assist:unlock", {
      code,
      deviceId: "private-owner-device",
      secret,
    })).toEqual({ ok: true, value: { unlocked: true, enabled: false } });
    expect(await call("private-assist:set", {
      code,
      deviceId: "private-owner-device",
      enabled: true,
    })).toEqual({ ok: true, value: { unlocked: true, enabled: true } });
    expect(await call("room:start", { code, deviceId: "private-owner-device" }))
      .toEqual({ ok: true, value: null });

    await vi.runAllTimersAsync();

    const room = findRoom(code);
    expect(room?.game?.phase).toBe("game-end");
    const owner = toPublicRoom(room!).players.find((player) => player.deviceId === "private-owner-device");
    expect(owner).toMatchObject({ name: "Relaxed Host", connected: true, botKind: null });

    await call("game:exit", { code, deviceId: "private-owner-device" });
  }, 20_000);
});
