import type { Server, Socket } from "socket.io";
import type { Card } from "../game/cards.js";
import { privateHandFor } from "../game/publicState.js";
import {
  bidInRoom,
  continueGameInRoom,
  createRoom,
  exitGameInRoom,
  findRoom,
  joinRoom,
  kickPlayer,
  leaveRoom,
  markSocketDisconnected,
  newGameInRoom,
  playCardInRoom,
  resolvePendingTrickInRoom,
  startRoom,
  toPublicRoom,
  trickPendingResolution,
  updateProfile,
} from "./store.js";
import type { PublicRoom, RoomErrorCode } from "./types.js";

type Envelope<T> = { ok: true; value: T } | { ok: false; error: RoomErrorCode };
type Ack<T> = (response: Envelope<T>) => void;

interface RoomPayload {
  code?: unknown;
  deviceId?: unknown;
  name?: unknown;
  avatar?: unknown;
  targetDeviceId?: unknown;
  bid?: unknown;
  card?: unknown;
  data?: unknown;
}

function noop() {}

// How long a completed trick sits fully visible before it resolves (winner computed,
// pile cleared, score updated). Without this pause the client never receives a snapshot
// with the full pile in it, so there's nothing to animate the sweep-to-winner from.
const TRICK_RESOLVE_DELAY_MS = 250;

function isCard(value: unknown): value is Card {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.suit === "string" && typeof v.rank === "string";
}

function isVoiceSignal(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const signal = value as Record<string, unknown>;
  if (signal.type === "description") {
    if (typeof signal.description !== "object" || signal.description === null) return false;
    const description = signal.description as Record<string, unknown>;
    return (
      (description.type === "offer" || description.type === "answer") &&
      typeof description.sdp === "string" &&
      description.sdp.length <= 100_000
    );
  }
  if (signal.type === "ice") {
    if (typeof signal.candidate !== "object" || signal.candidate === null) return false;
    const candidate = signal.candidate as Record<string, unknown>;
    return typeof candidate.candidate === "string" && candidate.candidate.length <= 4_096;
  }
  return false;
}

function broadcastRoom(io: Server, code: string): void {
  const room = findRoom(code);
  if (!room) return;
  io.to(room.code).emit("room:state", toPublicRoom(room));
  if (!room.game) return;
  for (const player of room.players) {
    if (!player.socketId) continue;
    io.to(player.socketId).emit("game:hand", privateHandFor(room.game, player.deviceId));
  }
}

export function registerRoomHandlers(io: Server, socket: Socket): void {
  socket.on("room:create", (payload: RoomPayload, ack: Ack<{ code: string }> = noop) => {
    if (typeof payload?.deviceId !== "string") {
      ack({ ok: false, error: "invalid" });
      return;
    }
    const result = createRoom(payload.name, payload.avatar, payload.deviceId, socket.id);
    if (!result.ok) {
      ack({ ok: false, error: result.error });
      return;
    }
    socket.join(result.value.code);
    ack({ ok: true, value: { code: result.value.code } });
    broadcastRoom(io, result.value.code);
  });

  socket.on("room:join", (payload: RoomPayload, ack: Ack<PublicRoom> = noop) => {
    if (typeof payload?.code !== "string" || typeof payload?.deviceId !== "string") {
      ack({ ok: false, error: "invalid" });
      return;
    }
    const result = joinRoom(payload.code, payload.name, payload.avatar, payload.deviceId, socket.id);
    if (!result.ok) {
      ack({ ok: false, error: result.error });
      return;
    }
    socket.join(result.value.code);
    ack({ ok: true, value: toPublicRoom(result.value) });
    broadcastRoom(io, result.value.code);
  });

  socket.on("room:update-profile", (payload: RoomPayload, ack: Ack<null> = noop) => {
    if (typeof payload?.code !== "string" || typeof payload?.deviceId !== "string") {
      ack({ ok: false, error: "invalid" });
      return;
    }
    const result = updateProfile(payload.code, payload.deviceId, payload.name, payload.avatar);
    if (!result.ok) {
      ack({ ok: false, error: result.error });
      return;
    }
    ack({ ok: true, value: null });
    broadcastRoom(io, payload.code);
  });

  socket.on("room:start", (payload: RoomPayload, ack: Ack<null> = noop) => {
    if (typeof payload?.code !== "string" || typeof payload?.deviceId !== "string") {
      ack({ ok: false, error: "invalid" });
      return;
    }
    const result = startRoom(payload.code, payload.deviceId);
    if (!result.ok) {
      ack({ ok: false, error: result.error });
      return;
    }
    ack({ ok: true, value: null });
    broadcastRoom(io, payload.code);
  });

  socket.on("room:kick", (payload: RoomPayload, ack: Ack<null> = noop) => {
    if (
      typeof payload?.code !== "string" ||
      typeof payload?.deviceId !== "string" ||
      typeof payload?.targetDeviceId !== "string"
    ) {
      ack({ ok: false, error: "invalid" });
      return;
    }
    const result = kickPlayer(payload.code, payload.deviceId, payload.targetDeviceId);
    if (!result.ok) {
      ack({ ok: false, error: result.error });
      return;
    }
    ack({ ok: true, value: null });
    const { removedSocketId } = result.value;
    if (removedSocketId) {
      io.to(removedSocketId).emit("room:kicked", { code: payload.code });
      io.sockets.sockets.get(removedSocketId)?.leave(payload.code);
    }
    broadcastRoom(io, payload.code);
  });

  socket.on("room:leave", (payload: RoomPayload) => {
    if (typeof payload?.code !== "string" || typeof payload?.deviceId !== "string") return;
    socket.leave(payload.code);
    leaveRoom(payload.code, payload.deviceId);
    broadcastRoom(io, payload.code);
  });

  socket.on("game:bid", (payload: RoomPayload, ack: Ack<null> = noop) => {
    if (typeof payload?.code !== "string" || typeof payload?.deviceId !== "string" || typeof payload?.bid !== "number") {
      ack({ ok: false, error: "invalid" });
      return;
    }
    const result = bidInRoom(payload.code, payload.deviceId, payload.bid);
    if (!result.ok) {
      ack({ ok: false, error: result.error });
      return;
    }
    ack({ ok: true, value: null });
    broadcastRoom(io, payload.code);
  });

  socket.on("game:play", (payload: RoomPayload, ack: Ack<null> = noop) => {
    if (typeof payload?.code !== "string" || typeof payload?.deviceId !== "string" || !isCard(payload?.card)) {
      ack({ ok: false, error: "invalid" });
      return;
    }
    const result = playCardInRoom(payload.code, payload.deviceId, payload.card);
    if (!result.ok) {
      ack({ ok: false, error: result.error });
      return;
    }
    ack({ ok: true, value: null });
    broadcastRoom(io, payload.code);

    if (trickPendingResolution(result.value)) {
      const code = payload.code;
      setTimeout(() => {
        const resolved = resolvePendingTrickInRoom(code);
        if (resolved.ok) broadcastRoom(io, code);
      }, TRICK_RESOLVE_DELAY_MS);
    }
  });

  socket.on("game:new", (payload: RoomPayload, ack: Ack<null> = noop) => {
    if (typeof payload?.code !== "string" || typeof payload?.deviceId !== "string") {
      ack({ ok: false, error: "invalid" });
      return;
    }
    const result = newGameInRoom(payload.code, payload.deviceId);
    if (!result.ok) {
      ack({ ok: false, error: result.error });
      return;
    }
    ack({ ok: true, value: null });
    broadcastRoom(io, payload.code);
  });

  socket.on("game:continue", (payload: RoomPayload, ack: Ack<null> = noop) => {
    if (typeof payload?.code !== "string" || typeof payload?.deviceId !== "string") {
      ack({ ok: false, error: "invalid" });
      return;
    }
    const result = continueGameInRoom(payload.code, payload.deviceId);
    if (!result.ok) {
      ack({ ok: false, error: result.error });
      return;
    }
    ack({ ok: true, value: null });
    broadcastRoom(io, payload.code);
  });

  socket.on("game:exit", (payload: RoomPayload, ack: Ack<null> = noop) => {
    if (typeof payload?.code !== "string" || typeof payload?.deviceId !== "string") {
      ack({ ok: false, error: "invalid" });
      return;
    }
    const code = payload.code;
    const result = exitGameInRoom(code, payload.deviceId);
    if (!result.ok) {
      ack({ ok: false, error: result.error });
      return;
    }
    ack({ ok: true, value: null });
    io.to(code).emit("room:exited", { code });
  });

  // WebRTC signaling relay for voice chat: purely a pass-through between two players
  // already confirmed to be in the same room. The server only validates shape/size and
  // forwards the opaque SDP/ICE payload; media remains peer-to-peer (or TURN-relayed).
  socket.on("voice:signal", (payload: RoomPayload) => {
    if (
      typeof payload?.code !== "string" ||
      typeof payload?.deviceId !== "string" ||
      typeof payload?.targetDeviceId !== "string" ||
      !isVoiceSignal(payload?.data)
    ) {
      return;
    }
    const room = findRoom(payload.code);
    if (!room) return;
    const sender = room.players.find((p) => p.deviceId === payload.deviceId);
    const target = room.players.find((p) => p.deviceId === payload.targetDeviceId);
    if (!sender || sender.socketId !== socket.id || !target?.socketId) return;
    io.to(target.socketId).emit("voice:signal", { deviceId: payload.deviceId, data: payload.data });
  });

  socket.on("disconnect", () => {
    const room = markSocketDisconnected(socket.id);
    if (room) broadcastRoom(io, room.code);
  });
}
