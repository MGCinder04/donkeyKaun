import type { Server, Socket } from "socket.io";
import {
  createRoom,
  findRoom,
  joinRoom,
  kickPlayer,
  leaveRoom,
  markSocketDisconnected,
  startRoom,
  toPublicRoom,
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
}

function noop() {}

function broadcastRoom(io: Server, code: string): void {
  const room = findRoom(code);
  if (!room) return;
  io.to(room.code).emit("room:state", toPublicRoom(room));
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

  socket.on("disconnect", () => {
    const room = markSocketDisconnected(socket.id);
    if (room) broadcastRoom(io, room.code);
  });
}
