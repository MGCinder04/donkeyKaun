import type { Server, Socket } from "socket.io";
import { hashResumeToken, authorizeResume, isValidResumeToken } from "./membershipTokens.js";
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
  restoreRoom,
  startRoom,
  toPublicRoom,
  trickPendingResolution,
  updateProfile,
} from "./store.js";
import type { PublicRoom, RoomErrorCode } from "./types.js";
import type { Room } from "./types.js";
import {
  deletePersistedRoom,
  loadPersistedRoom,
  persistRoom,
} from "./roomPersistence.js";
import {
  clearTurnMembership,
  getIceServerConfiguration,
  type IceServerConfiguration,
} from "../voice/iceServers.js";

type Envelope<T> = { ok: true; value: T } | { ok: false; error: RoomErrorCode };
type Ack<T> = (response: Envelope<T>) => void;
type VoiceIceAck = (
  response: { ok: true; value: IceServerConfiguration } | { ok: false; error: "unauthorized" },
) => void;
type VoiceSignalAck = (response: { ok: true } | { ok: false; error: "invalid" | "unauthorized" | "target_unavailable" }) => void;

interface RoomPayload {
  code?: unknown;
  deviceId?: unknown;
  name?: unknown;
  avatar?: unknown;
  targetDeviceId?: unknown;
  bid?: unknown;
  card?: unknown;
  data?: unknown;
  resumeToken?: unknown;
  nextResumeToken?: unknown;
}

function noop() {}

function membershipKey(code: string, deviceId: string): string {
  return `${code.toUpperCase()}:${deviceId}`;
}

function bindSocket(socket: Socket, code: string, deviceId: string): void {
  socket.data.roomCode = code.toUpperCase();
  socket.data.deviceId = deviceId;
}

function unbindSocket(socket: Socket): void {
  delete socket.data.roomCode;
  delete socket.data.deviceId;
}

function socketOwnsMembership(socket: Socket, code: string, deviceId: string): boolean {
  if (socket.data.roomCode !== code.toUpperCase() || socket.data.deviceId !== deviceId) return false;
  const room = findRoom(code);
  return room?.players.some((player) => player.deviceId === deviceId && player.socketId === socket.id) ?? false;
}

/** Let a socket move away from an abandoned lobby without weakening in-game
 * reconnect protection. A playing room must still be exited explicitly. */
async function persistOrDelete(code: string, room: Room | null | undefined): Promise<void> {
  if (room) await persistRoom(room);
  else await deletePersistedRoom(code);
}

async function ensureRoomLoaded(code: string): Promise<Room | undefined> {
  const inMemory = findRoom(code);
  if (inMemory) return inMemory;
  const persisted = await loadPersistedRoom(code);
  if (!persisted) return undefined;
  const restored = restoreRoom(persisted);
  return restored.ok ? restored.value : undefined;
}

async function releaseLobbyMembership(io: Server, socket: Socket): Promise<boolean> {
  const code = socket.data.roomCode;
  const deviceId = socket.data.deviceId;
  if (typeof code !== "string" || typeof deviceId !== "string") {
    unbindSocket(socket);
    return true;
  }
  const room = findRoom(code);
  if (room?.status === "playing") return false;
  socket.leave(code);
  await clearTurnMembership(membershipKey(code, deviceId));
  const updated = leaveRoom(code, deviceId);
  unbindSocket(socket);
  if (room) broadcastRoom(io, code);
  await persistOrDelete(code, updated);
  return true;
}

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
  socket.on("room:create", async (payload: RoomPayload, ack: Ack<{ code: string }> = noop) => {
    if (
      typeof payload?.deviceId !== "string" ||
      !isValidResumeToken(payload.resumeToken) ||
      !(await releaseLobbyMembership(io, socket))
    ) {
      ack({ ok: false, error: "invalid" });
      return;
    }
    const result = createRoom(
      payload.name,
      payload.avatar,
      payload.deviceId,
      socket.id,
      hashResumeToken(payload.resumeToken),
    );
    if (!result.ok) {
      ack({ ok: false, error: result.error });
      return;
    }
    bindSocket(socket, result.value.code, payload.deviceId);
    socket.join(result.value.code);
    await persistRoom(result.value);
    ack({ ok: true, value: { code: result.value.code } });
    socket.emit("room:membership-ready", { code: result.value.code });
    broadcastRoom(io, result.value.code);
  });

  socket.on("room:join", async (payload: RoomPayload, ack: Ack<{ room: PublicRoom }> = noop) => {
    if (
      typeof payload?.code !== "string" ||
      typeof payload?.deviceId !== "string" ||
      !isValidResumeToken(payload.resumeToken) ||
      !isValidResumeToken(payload.nextResumeToken)
    ) {
      ack({ ok: false, error: "invalid" });
      return;
    }
    const requestedCode = payload.code.toUpperCase();
    await ensureRoomLoaded(requestedCode);
    if (
      socket.data.roomCode === requestedCode &&
      typeof socket.data.deviceId === "string" &&
      socket.data.deviceId !== payload.deviceId
    ) {
      ack({ ok: false, error: "invalid" });
      return;
    }
    if (
      socket.data.roomCode &&
      socket.data.roomCode !== requestedCode &&
      !(await releaseLobbyMembership(io, socket))
    ) {
      ack({ ok: false, error: "invalid" });
      return;
    }
    const existing = findRoom(requestedCode)?.players.find((player) => player.deviceId === payload.deviceId);
    let replacedSocketId: string | null = null;
    let acceptedHash = hashResumeToken(payload.nextResumeToken);
    if (existing) {
      const authorization = authorizeResume(existing.resumeTokenHash, payload.resumeToken, payload.nextResumeToken);
      if (!authorization.ok || !authorization.nextHash) {
        ack({ ok: false, error: "session_conflict" });
        return;
      }
      acceptedHash = authorization.nextHash;
      replacedSocketId = existing.socketId && existing.socketId !== socket.id ? existing.socketId : null;
      existing.resumeTokenHash = acceptedHash;
    }
    const result = joinRoom(
      payload.code,
      payload.name,
      payload.avatar,
      payload.deviceId,
      socket.id,
      acceptedHash,
    );
    if (!result.ok) {
      ack({ ok: false, error: result.error });
      return;
    }
    bindSocket(socket, result.value.code, payload.deviceId);
    socket.join(result.value.code);
    await persistRoom(result.value);
    ack({ ok: true, value: { room: toPublicRoom(result.value) } });
    socket.emit("room:membership-ready", { code: result.value.code });
    socket.to(result.value.code).emit("voice:peer-reset", { deviceId: payload.deviceId });
    if (replacedSocketId) {
      const replacedSocket = io.sockets.sockets.get(replacedSocketId);
      if (replacedSocket) {
        replacedSocket.emit("room:replaced", { code: result.value.code });
        replacedSocket.leave(result.value.code);
        unbindSocket(replacedSocket);
        replacedSocket.disconnect(true);
      }
    }
    broadcastRoom(io, result.value.code);
  });

  socket.on("room:update-profile", async (payload: RoomPayload, ack: Ack<null> = noop) => {
    if (typeof payload?.code !== "string" || typeof payload?.deviceId !== "string") {
      ack({ ok: false, error: "invalid" });
      return;
    }
    if (!socketOwnsMembership(socket, payload.code, payload.deviceId)) {
      ack({ ok: false, error: "invalid" });
      return;
    }
    const result = updateProfile(payload.code, payload.deviceId, payload.name, payload.avatar);
    if (!result.ok) {
      ack({ ok: false, error: result.error });
      return;
    }
    void persistRoom(result.value);
    ack({ ok: true, value: null });
    broadcastRoom(io, payload.code);
  });

  socket.on("room:start", async (payload: RoomPayload, ack: Ack<null> = noop) => {
    if (typeof payload?.code !== "string" || typeof payload?.deviceId !== "string") {
      ack({ ok: false, error: "invalid" });
      return;
    }
    if (!socketOwnsMembership(socket, payload.code, payload.deviceId)) {
      ack({ ok: false, error: "invalid" });
      return;
    }
    const result = startRoom(payload.code, payload.deviceId);
    if (!result.ok) {
      ack({ ok: false, error: result.error });
      return;
    }
    void persistRoom(result.value);
    ack({ ok: true, value: null });
    broadcastRoom(io, payload.code);
  });

  socket.on("room:kick", async (payload: RoomPayload, ack: Ack<null> = noop) => {
    if (
      typeof payload?.code !== "string" ||
      typeof payload?.deviceId !== "string" ||
      typeof payload?.targetDeviceId !== "string"
    ) {
      ack({ ok: false, error: "invalid" });
      return;
    }
    if (!socketOwnsMembership(socket, payload.code, payload.deviceId)) {
      ack({ ok: false, error: "invalid" });
      return;
    }
    const result = kickPlayer(payload.code, payload.deviceId, payload.targetDeviceId);
    if (!result.ok) {
      ack({ ok: false, error: result.error });
      return;
    }
    const { removedSocketId } = result.value;
    await clearTurnMembership(membershipKey(payload.code, payload.targetDeviceId));
    if (removedSocketId) {
      io.to(removedSocketId).emit("room:kicked", { code: payload.code });
      const removedSocket = io.sockets.sockets.get(removedSocketId);
      if (removedSocket) {
        removedSocket.leave(payload.code);
        unbindSocket(removedSocket);
      }
    }
    void persistOrDelete(payload.code, findRoom(payload.code));
    ack({ ok: true, value: null });
    broadcastRoom(io, payload.code);
  });

  socket.on("room:leave", async (payload: RoomPayload) => {
    if (typeof payload?.code !== "string" || typeof payload?.deviceId !== "string") return;
    if (!socketOwnsMembership(socket, payload.code, payload.deviceId)) return;
    socket.leave(payload.code);
    await clearTurnMembership(membershipKey(payload.code, payload.deviceId));
    const updated = leaveRoom(payload.code, payload.deviceId);
    unbindSocket(socket);
    broadcastRoom(io, payload.code);
    void persistOrDelete(payload.code, updated);
  });

  socket.on("game:bid", async (payload: RoomPayload, ack: Ack<null> = noop) => {
    if (typeof payload?.code !== "string" || typeof payload?.deviceId !== "string" || typeof payload?.bid !== "number") {
      ack({ ok: false, error: "invalid" });
      return;
    }
    if (!socketOwnsMembership(socket, payload.code, payload.deviceId)) {
      ack({ ok: false, error: "invalid" });
      return;
    }
    const result = bidInRoom(payload.code, payload.deviceId, payload.bid);
    if (!result.ok) {
      ack({ ok: false, error: result.error });
      return;
    }
    void persistRoom(result.value);
    ack({ ok: true, value: null });
    broadcastRoom(io, payload.code);
  });

  socket.on("game:play", async (payload: RoomPayload, ack: Ack<null> = noop) => {
    if (typeof payload?.code !== "string" || typeof payload?.deviceId !== "string" || !isCard(payload?.card)) {
      ack({ ok: false, error: "invalid" });
      return;
    }
    if (!socketOwnsMembership(socket, payload.code, payload.deviceId)) {
      ack({ ok: false, error: "invalid" });
      return;
    }
    const result = playCardInRoom(payload.code, payload.deviceId, payload.card);
    if (!result.ok) {
      ack({ ok: false, error: result.error });
      return;
    }
    void persistRoom(result.value);
    ack({ ok: true, value: null });
    broadcastRoom(io, payload.code);

    if (trickPendingResolution(result.value)) {
      const code = payload.code;
      setTimeout(async () => {
        const resolved = resolvePendingTrickInRoom(code);
        if (resolved.ok) {
          broadcastRoom(io, code);
          void persistRoom(resolved.value);
        }
      }, TRICK_RESOLVE_DELAY_MS);
    }
  });

  socket.on("game:new", async (payload: RoomPayload, ack: Ack<null> = noop) => {
    if (typeof payload?.code !== "string" || typeof payload?.deviceId !== "string") {
      ack({ ok: false, error: "invalid" });
      return;
    }
    if (!socketOwnsMembership(socket, payload.code, payload.deviceId)) {
      ack({ ok: false, error: "invalid" });
      return;
    }
    const result = newGameInRoom(payload.code, payload.deviceId);
    if (!result.ok) {
      ack({ ok: false, error: result.error });
      return;
    }
    void persistRoom(result.value);
    ack({ ok: true, value: null });
    broadcastRoom(io, payload.code);
  });

  socket.on("game:continue", async (payload: RoomPayload, ack: Ack<null> = noop) => {
    if (typeof payload?.code !== "string" || typeof payload?.deviceId !== "string") {
      ack({ ok: false, error: "invalid" });
      return;
    }
    if (!socketOwnsMembership(socket, payload.code, payload.deviceId)) {
      ack({ ok: false, error: "invalid" });
      return;
    }
    const result = continueGameInRoom(payload.code, payload.deviceId);
    if (!result.ok) {
      ack({ ok: false, error: result.error });
      return;
    }
    void persistRoom(result.value);
    ack({ ok: true, value: null });
    broadcastRoom(io, payload.code);
  });

  socket.on("game:exit", async (payload: RoomPayload, ack: Ack<null> = noop) => {
    if (typeof payload?.code !== "string" || typeof payload?.deviceId !== "string") {
      ack({ ok: false, error: "invalid" });
      return;
    }
    if (!socketOwnsMembership(socket, payload.code, payload.deviceId)) {
      ack({ ok: false, error: "invalid" });
      return;
    }
    const code = payload.code;
    const room = findRoom(code);
    const result = exitGameInRoom(code, payload.deviceId);
    if (!result.ok) {
      ack({ ok: false, error: result.error });
      return;
    }
    for (const player of room?.players ?? []) {
      await clearTurnMembership(membershipKey(code, player.deviceId));
      if (player.socketId) {
        const playerSocket = io.sockets.sockets.get(player.socketId);
        if (playerSocket) unbindSocket(playerSocket);
      }
    }
    await deletePersistedRoom(code);
    ack({ ok: true, value: null });
    io.to(code).emit("room:exited", { code });
  });

  socket.on("voice:ice", async (payload: RoomPayload, ack: VoiceIceAck = noop) => {
    if (
      typeof payload?.code !== "string" ||
      typeof payload?.deviceId !== "string" ||
      !socketOwnsMembership(socket, payload.code, payload.deviceId)
    ) {
      ack({ ok: false, error: "unauthorized" });
      return;
    }
    const room = findRoom(payload.code);
    const connectedPlayers = room?.players.filter((player) => player.socketId !== null).length ?? 0;
    if (connectedPlayers < 2) {
      ack({ ok: false, error: "unauthorized" });
      return;
    }
    const config = await getIceServerConfiguration(
      membershipKey(payload.code, payload.deviceId),
      socket.handshake.address,
    );
    ack({ ok: true, value: config });
  });

  // WebRTC signaling relay for voice chat: purely a pass-through between two players
  // already confirmed to be in the same room. The server only validates shape/size and
  // forwards the opaque SDP/ICE payload; media remains peer-to-peer (or TURN-relayed).
  socket.on("voice:signal", (payload: RoomPayload, ack: VoiceSignalAck = noop) => {
    if (
      typeof payload?.code !== "string" ||
      typeof payload?.deviceId !== "string" ||
      typeof payload?.targetDeviceId !== "string" ||
      !isVoiceSignal(payload?.data)
    ) {
      ack({ ok: false, error: "invalid" });
      return;
    }
    const room = findRoom(payload.code);
    if (!room || !socketOwnsMembership(socket, payload.code, payload.deviceId)) {
      ack({ ok: false, error: "unauthorized" });
      return;
    }
    const sender = room.players.find((p) => p.deviceId === payload.deviceId);
    const target = room.players.find((p) => p.deviceId === payload.targetDeviceId);
    if (!sender || sender.socketId !== socket.id || !target?.socketId) {
      ack({ ok: false, error: "target_unavailable" });
      return;
    }
    io.to(target.socketId).emit("voice:signal", { deviceId: payload.deviceId, data: payload.data });
    ack({ ok: true });
  });

  socket.on("disconnect", async () => {
    const room = markSocketDisconnected(socket.id);
    if (room) {
      broadcastRoom(io, room.code);
      void persistRoom(room);
    }
  });
}
