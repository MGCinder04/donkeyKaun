import type { Server, Socket } from "socket.io";
import { hashResumeToken, authorizeResume, isValidResumeToken } from "./membershipTokens.js";
import { cardId, type Card } from "../game/cards.js";
import { chooseBid, chooseCard, viewForBot } from "../bots/strategy.js";
import { BOT_PROFILES, isBotKind, type BotKind } from "../bots/types.js";
import {
  clearPrivateAssist,
  isPrivateAssistEnabled,
  privateAssistStatus,
  setPrivateAssistEnabled,
  unlockPrivateAssist,
  type PrivateAssistStatus,
} from "../bots/privateAssist.js";
import { privateHandFor } from "../game/publicState.js";
import {
  bidInRoom,
  addBot,
  botTakeover,
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
  removePlayerFromRoom,
  removeBot,
  resolvePendingTrickInRoom,
  restoreRoom,
  setReplacementSeat,
  startRoom,
  toPublicRoom,
  trickPendingResolution,
  updateProfile,
} from "./store.js";
import type { PublicRoom, RoomErrorCode } from "./types.js";
import type { Player, Room } from "./types.js";
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
type PrivateAssistAck = (
  response: { ok: true; value: PrivateAssistStatus } | { ok: false; error: "unauthorized" | "rate_limited" },
) => void;

interface RoomPayload {
  code?: unknown;
  deviceId?: unknown;
  name?: unknown;
  avatar?: unknown;
  targetDeviceId?: unknown;
  bid?: unknown;
  card?: unknown;
  data?: unknown;
  botKind?: unknown;
  resumeToken?: unknown;
  nextResumeToken?: unknown;
  secret?: unknown;
  enabled?: unknown;
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
  clearPrivateAssist(socket.id);
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
const botTimers = new Map<string, ReturnType<typeof setTimeout>>();
interface PendingTrickTimer {
  timer: ReturnType<typeof setTimeout>;
  fingerprint: string;
}

const trickTimers = new Map<string, PendingTrickTimer>();

function trickFingerprint(room: Room): string | null {
  if (!room.game || !trickPendingResolution(room)) return null;
  return [
    room.game.round,
    ...room.game.currentTrick.map((play) => `${play.deviceId}:${cardId(play.card)}`),
  ].join("|");
}

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

interface AutomatedActor {
  player: Player;
  botKind: BotKind;
  privateAssist: boolean;
}

function currentAutomatedActor(room: Room): AutomatedActor | null {
  if (!room.game || room.game.phase === "game-end" || trickPendingResolution(room)) return null;
  const id = room.game.phase === "bidding"
    ? room.game.bidOrder[room.game.bidTurnIndex]
    : room.game.seatOrder[room.game.turnSeat];
  const player = room.players.find((candidate) => candidate.deviceId === id);
  if (!player) return null;
  if (player.botKind) return { player, botKind: player.botKind, privateAssist: false };
  if (
    player.socketId &&
    isPrivateAssistEnabled(player.socketId, room.code, player.deviceId)
  ) {
    return { player, botKind: "ustaad", privateAssist: true };
  }
  return null;
}

function humanLikeDelay(room: Room, actor: AutomatedActor, fingerprint: string): number {
  if (!actor.privateAssist) return BOT_PROFILES[actor.botKind].delayMs;
  let hash = 2166136261;
  for (const character of `${room.code}:${actor.player.deviceId}:${fingerprint}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const jitter = hash >>> 0;
  return room.game?.phase === "bidding"
    ? 2_400 + (jitter % 3_201)
    : 1_300 + (jitter % 2_501);
}

function scheduleBotTurn(io: Server, code: string): void {
  const normalized = code.toUpperCase();
  const existingTimer = botTimers.get(normalized);
  if (existingTimer) clearTimeout(existingTimer);
  botTimers.delete(normalized);

  const room = findRoom(normalized);
  // Bots pause if every human is offline, so an abandoned room cannot play itself.
  if (!room || !room.players.some((player) => !player.botKind && player.socketId !== null)) return;
  const actor = currentAutomatedActor(room);
  if (!actor || !room.game) return;
  const { player, botKind, privateAssist } = actor;
  const fingerprint = `${room.game.round}:${room.game.phase}:${room.game.bidTurnIndex}:${room.game.turnSeat}:${room.game.currentTrick.length}:${room.game.hands[player.deviceId]?.length ?? -1}`;
  const timer = setTimeout(() => {
    botTimers.delete(normalized);
    const latest = findRoom(normalized);
    const latestActor = latest ? currentAutomatedActor(latest) : null;
    if (
      !latest?.game ||
      !latest.players.some((player) => !player.botKind && player.socketId !== null) ||
      latestActor?.player.deviceId !== player.deviceId ||
      latestActor.botKind !== botKind ||
      latestActor.privateAssist !== privateAssist
    ) return;
    const latestFingerprint = `${latest.game.round}:${latest.game.phase}:${latest.game.bidTurnIndex}:${latest.game.turnSeat}:${latest.game.currentTrick.length}:${latest.game.hands[player.deviceId]?.length ?? -1}`;
    if (latestFingerprint !== fingerprint) return;

    const view = viewForBot(latest.game, player.deviceId, botKind);
    const result = latest.game.phase === "bidding"
      ? bidInRoom(normalized, player.deviceId, chooseBid(view))
      : playCardInRoom(normalized, player.deviceId, chooseCard(view));
    if (!result.ok) {
      console.warn(`[automation] An automated seat could not act in ${normalized}: ${result.error}`);
      return;
    }
    broadcastRoom(io, normalized);
    void persistRoom(result.value);
    scheduleRoomProgress(io, normalized);
  }, humanLikeDelay(room, actor, fingerprint));
  botTimers.set(normalized, timer);
}

function scheduleTrickResolution(io: Server, code: string): void {
  const normalized = code.toUpperCase();
  const room = findRoom(normalized);
  if (!room) return;
  const fingerprint = trickFingerprint(room);
  if (!fingerprint) return;
  const existing = trickTimers.get(normalized);
  if (existing?.fingerprint === fingerprint) return;
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => {
    trickTimers.delete(normalized);
    const latest = findRoom(normalized);
    if (!latest || trickFingerprint(latest) !== fingerprint) {
      scheduleRoomProgress(io, normalized);
      return;
    }
    const resolved = resolvePendingTrickInRoom(normalized);
    if (resolved.ok) {
      broadcastRoom(io, normalized);
      void persistRoom(resolved.value);
      scheduleRoomProgress(io, normalized);
    }
  }, TRICK_RESOLVE_DELAY_MS);
  trickTimers.set(normalized, { timer, fingerprint });
}

function scheduleRoomProgress(io: Server, code: string): void {
  const room = findRoom(code);
  if (room && trickPendingResolution(room)) scheduleTrickResolution(io, code);
  else scheduleBotTurn(io, code);
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
    clearPrivateAssist(socket.id);
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
    scheduleRoomProgress(io, result.value.code);
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
    const requestedRoom = findRoom(requestedCode);
    const existing = requestedRoom?.players.find((player) => player.deviceId === payload.deviceId);
    const replacementTarget = !existing ? requestedRoom?.replacementForDeviceId ?? null : null;
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
    if (replacementTarget) await clearTurnMembership(membershipKey(result.value.code, replacementTarget));
    await persistRoom(result.value);
    ack({ ok: true, value: { room: toPublicRoom(result.value) } });
    socket.emit("room:membership-ready", { code: result.value.code });
    socket.to(result.value.code).emit("voice:peer-reset", { deviceId: payload.deviceId });
    if (replacedSocketId) {
      const replacedSocket = io.sockets.sockets.get(replacedSocketId);
      if (replacedSocket) {
        clearPrivateAssist(replacedSocket.id);
        replacedSocket.emit("room:replaced", { code: result.value.code });
        replacedSocket.leave(result.value.code);
        unbindSocket(replacedSocket);
        replacedSocket.disconnect(true);
      }
    }
    broadcastRoom(io, result.value.code);
    scheduleRoomProgress(io, result.value.code);
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

  socket.on("private-assist:unlock", (payload: RoomPayload, ack: PrivateAssistAck = noop) => {
    if (
      typeof payload?.code !== "string" ||
      typeof payload?.deviceId !== "string" ||
      typeof payload?.secret !== "string" ||
      payload.secret.length > 128 ||
      !socketOwnsMembership(socket, payload.code, payload.deviceId)
    ) {
      ack({ ok: false, error: "unauthorized" });
      return;
    }
    ack(unlockPrivateAssist(
      socket.id,
      payload.code,
      payload.deviceId,
      payload.secret,
      socket.handshake.address,
    ));
  });

  socket.on("private-assist:status", (payload: RoomPayload, ack: PrivateAssistAck = noop) => {
    if (
      typeof payload?.code !== "string" ||
      typeof payload?.deviceId !== "string" ||
      !socketOwnsMembership(socket, payload.code, payload.deviceId)
    ) {
      ack({ ok: false, error: "unauthorized" });
      return;
    }
    ack({ ok: true, value: privateAssistStatus(socket.id, payload.code, payload.deviceId) });
  });

  socket.on("private-assist:set", (payload: RoomPayload, ack: PrivateAssistAck = noop) => {
    if (
      typeof payload?.code !== "string" ||
      typeof payload?.deviceId !== "string" ||
      typeof payload?.enabled !== "boolean" ||
      !socketOwnsMembership(socket, payload.code, payload.deviceId)
    ) {
      ack({ ok: false, error: "unauthorized" });
      return;
    }
    const result = setPrivateAssistEnabled(socket.id, payload.code, payload.deviceId, payload.enabled);
    ack(result);
    if (result.ok) scheduleRoomProgress(io, payload.code);
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
    scheduleRoomProgress(io, payload.code);
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
      clearPrivateAssist(removedSocketId);
      io.to(removedSocketId).emit("room:kicked", { code: payload.code });
      const removedSocket = io.sockets.sockets.get(removedSocketId);
      if (removedSocket) {
        removedSocket.leave(payload.code);
        unbindSocket(removedSocket);
        removedSocket.disconnect(true);
      }
    }
    void persistOrDelete(payload.code, findRoom(payload.code));
    ack({ ok: true, value: null });
    broadcastRoom(io, payload.code);
    scheduleRoomProgress(io, payload.code);
  });

  socket.on("room:add-bot", async (payload: RoomPayload, ack: Ack<null> = noop) => {
    if (typeof payload?.code !== "string" || typeof payload.deviceId !== "string" || !isBotKind(payload.botKind)) {
      ack({ ok: false, error: "invalid" });
      return;
    }
    if (!socketOwnsMembership(socket, payload.code, payload.deviceId)) {
      ack({ ok: false, error: "invalid" });
      return;
    }
    const result = addBot(payload.code, payload.deviceId, payload.botKind);
    if (!result.ok) {
      ack({ ok: false, error: result.error });
      return;
    }
    void persistRoom(result.value);
    ack({ ok: true, value: null });
    broadcastRoom(io, payload.code);
    scheduleRoomProgress(io, payload.code);
  });

  socket.on("room:remove-bot", async (payload: RoomPayload, ack: Ack<null> = noop) => {
    if (typeof payload?.code !== "string" || typeof payload.deviceId !== "string" || typeof payload.targetDeviceId !== "string") {
      ack({ ok: false, error: "invalid" });
      return;
    }
    if (!socketOwnsMembership(socket, payload.code, payload.deviceId)) {
      ack({ ok: false, error: "invalid" });
      return;
    }
    const result = removeBot(payload.code, payload.deviceId, payload.targetDeviceId);
    if (!result.ok) {
      ack({ ok: false, error: result.error });
      return;
    }
    void persistRoom(result.value);
    ack({ ok: true, value: null });
    broadcastRoom(io, payload.code);
    scheduleRoomProgress(io, payload.code);
  });

  socket.on("room:bot-takeover", async (payload: RoomPayload, ack: Ack<null> = noop) => {
    if (
      typeof payload?.code !== "string" ||
      typeof payload.deviceId !== "string" ||
      typeof payload.targetDeviceId !== "string" ||
      !isBotKind(payload.botKind)
    ) {
      ack({ ok: false, error: "invalid" });
      return;
    }
    if (!socketOwnsMembership(socket, payload.code, payload.deviceId)) {
      ack({ ok: false, error: "invalid" });
      return;
    }
    const result = botTakeover(payload.code, payload.deviceId, payload.targetDeviceId, payload.botKind);
    if (!result.ok) {
      ack({ ok: false, error: result.error });
      return;
    }
    await clearTurnMembership(membershipKey(payload.code, payload.targetDeviceId));
    void persistRoom(result.value);
    ack({ ok: true, value: null });
    broadcastRoom(io, payload.code);
    scheduleRoomProgress(io, payload.code);
  });

  socket.on("room:replacement", async (payload: RoomPayload, ack: Ack<null> = noop) => {
    if (
      typeof payload?.code !== "string" ||
      typeof payload?.deviceId !== "string" ||
      (payload.targetDeviceId !== null && typeof payload.targetDeviceId !== "string")
    ) {
      ack({ ok: false, error: "invalid" });
      return;
    }
    if (!socketOwnsMembership(socket, payload.code, payload.deviceId)) {
      ack({ ok: false, error: "invalid" });
      return;
    }
    const result = setReplacementSeat(payload.code, payload.deviceId, payload.targetDeviceId);
    if (!result.ok) {
      ack({ ok: false, error: result.error });
      return;
    }
    void persistRoom(result.value);
    ack({ ok: true, value: null });
    broadcastRoom(io, payload.code);
    scheduleRoomProgress(io, payload.code);
  });

  socket.on("room:remove-seat", async (payload: RoomPayload, ack: Ack<null> = noop) => {
    if (
      typeof payload?.code !== "string" ||
      typeof payload?.deviceId !== "string" ||
      typeof payload.targetDeviceId !== "string"
    ) {
      ack({ ok: false, error: "invalid" });
      return;
    }
    if (!socketOwnsMembership(socket, payload.code, payload.deviceId)) {
      ack({ ok: false, error: "invalid" });
      return;
    }
    const result = removePlayerFromRoom(payload.code, payload.deviceId, payload.targetDeviceId);
    if (!result.ok) {
      ack({ ok: false, error: result.error });
      return;
    }
    await clearTurnMembership(membershipKey(payload.code, payload.targetDeviceId));
    void persistRoom(result.value);
    ack({ ok: true, value: null });
    broadcastRoom(io, payload.code);
    scheduleRoomProgress(io, payload.code);
  });

  socket.on("room:leave", async (payload: RoomPayload) => {
    if (typeof payload?.code !== "string" || typeof payload?.deviceId !== "string") return;
    if (!socketOwnsMembership(socket, payload.code, payload.deviceId)) return;
    clearPrivateAssist(socket.id);
    socket.leave(payload.code);
    await clearTurnMembership(membershipKey(payload.code, payload.deviceId));
    const updated = leaveRoom(payload.code, payload.deviceId);
    unbindSocket(socket);
    broadcastRoom(io, payload.code);
    scheduleRoomProgress(io, payload.code);
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
    scheduleRoomProgress(io, payload.code);
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
      scheduleTrickResolution(io, payload.code);
    } else scheduleRoomProgress(io, payload.code);
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
    scheduleRoomProgress(io, payload.code);
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
    scheduleRoomProgress(io, payload.code);
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
        clearPrivateAssist(player.socketId);
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
    clearPrivateAssist(socket.id);
    const room = markSocketDisconnected(socket.id);
    if (room) {
      broadcastRoom(io, room.code);
      void persistRoom(room);
    }
  });
}
