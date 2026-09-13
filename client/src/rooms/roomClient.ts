import { getSocket } from "./socket";
import type { AvatarChoice } from "../identity/useIdentity";
import {
  clearMembershipCredentials,
  commitMembershipCredentials,
  createInitialMembershipTokens,
  prepareMembershipCredentials,
  storeCreatedMembership,
} from "./membershipCredentials";
import type { Card, ClientRoomErrorCode, Envelope, PrivateHand, PublicRoom } from "./types";

const CONNECT_TIMEOUT_MS = 12_000;
const ACK_TIMEOUT_MS = 10_000;
const REJOIN_RETRY_MS = 2_000;

function connectionError(message: string): ClientRoomErrorCode {
  return message.toLowerCase().includes("unauthorized") ? "unauthorized" : "network";
}

function waitForConnection(): Promise<ClientRoomErrorCode | null> {
  const socket = getSocket();
  if (socket.connected) return Promise.resolve(null);
  return new Promise((resolve) => {
    const finish = (error: ClientRoomErrorCode | null) => {
      clearTimeout(timer);
      socket.off("connect", onConnect);
      socket.off("connect_error", onError);
      resolve(error);
    };
    const onConnect = () => finish(null);
    const onError = (error: Error) => finish(connectionError(error.message));
    const timer = setTimeout(() => finish("timeout"), CONNECT_TIMEOUT_MS);
    socket.once("connect", onConnect);
    socket.once("connect_error", onError);
  });
}

async function request<T>(event: string, payload: Record<string, unknown>): Promise<Envelope<T>> {
  const connectionFailure = await waitForConnection();
  if (connectionFailure) return { ok: false, error: connectionFailure };
  return new Promise((resolve) => {
    getSocket()
      .timeout(ACK_TIMEOUT_MS)
      .emit(event, payload, (error: Error | null, response: Envelope<T> | undefined) => {
        if (error || !response) {
          resolve({ ok: false, error: "timeout" });
          return;
        }
        resolve(response);
      });
  });
}

interface Membership {
  code: string;
  name: string;
  avatar: AvatarChoice;
  deviceId: string;
}

interface JoinWireValue {
  room: PublicRoom;
}

interface MembershipResultEvent {
  code: string;
  result: Envelope<PublicRoom>;
}

let activeMembership: Membership | null = null;
let joinInFlight: Promise<Envelope<PublicRoom>> | null = null;
let rejoinTimer: ReturnType<typeof setTimeout> | null = null;
const membershipListeners = new Set<(event: MembershipResultEvent) => void>();

function isTransient(error: ClientRoomErrorCode): boolean {
  return error === "network" || error === "timeout";
}

function notifyMembership(event: MembershipResultEvent): void {
  for (const listener of membershipListeners) listener(event);
}

function scheduleRejoin(): void {
  if (rejoinTimer || !activeMembership) return;
  rejoinTimer = setTimeout(() => {
    rejoinTimer = null;
    if (activeMembership && getSocket().connected) void performJoin(activeMembership, true);
  }, REJOIN_RETRY_MS);
}

async function performJoin(membership: Membership, notify: boolean): Promise<Envelope<PublicRoom>> {
  if (joinInFlight) return joinInFlight;
  const credentials = prepareMembershipCredentials(membership.code);
  joinInFlight = request<JoinWireValue>("room:join", {
    ...membership,
    resumeToken: credentials.current,
    nextResumeToken: credentials.pending,
  })
    .then((wireResult): Envelope<PublicRoom> => {
      if (wireResult.ok) {
        commitMembershipCredentials(membership.code);
        activeMembership = membership;
        return { ok: true, value: wireResult.value.room };
      }
      if (wireResult.error === "kicked") clearMembershipCredentials(membership.code);
      if (isTransient(wireResult.error)) scheduleRejoin();
      return wireResult;
    })
    .finally(() => {
      joinInFlight = null;
    });
  const result = await joinInFlight;
  if (notify) notifyMembership({ code: membership.code, result });
  return result;
}

getSocket().on("connect", () => {
  if (!activeMembership) return;
  void performJoin(activeMembership, true);
});

export async function createRoom(name: string, avatar: AvatarChoice, deviceId: string) {
  const tokens = createInitialMembershipTokens();
  const result = await request<{ code: string }>("room:create", {
    name,
    avatar,
    deviceId,
    resumeToken: tokens.pending,
  });
  if (result.ok) {
    storeCreatedMembership(result.value.code, tokens.pending);
    activeMembership = { code: result.value.code, name, avatar, deviceId };
  }
  return result;
}

export async function joinRoom(code: string, name: string, avatar: AvatarChoice, deviceId: string) {
  const membership = { code: code.toUpperCase(), name, avatar, deviceId };
  activeMembership = membership;
  const result = await performJoin(membership, false);
  if (!result.ok && !isTransient(result.error)) activeMembership = null;
  return result;
}

export function retryActiveMembership(): Promise<Envelope<PublicRoom>> | null {
  return activeMembership ? performJoin(activeMembership, false) : null;
}

export function onMembershipResult(cb: (event: MembershipResultEvent) => void): () => void {
  membershipListeners.add(cb);
  return () => membershipListeners.delete(cb);
}

export function startRoom(code: string, deviceId: string) {
  return request<null>("room:start", { code, deviceId });
}

export function kickPlayer(code: string, hostDeviceId: string, targetDeviceId: string) {
  return request<null>("room:kick", { code, deviceId: hostDeviceId, targetDeviceId });
}

export function setReplacementSeat(code: string, hostDeviceId: string, targetDeviceId: string | null) {
  return request<null>("room:replacement", { code, deviceId: hostDeviceId, targetDeviceId });
}

export function removePlayerSeat(code: string, hostDeviceId: string, targetDeviceId: string) {
  return request<null>("room:remove-seat", { code, deviceId: hostDeviceId, targetDeviceId });
}

export function leaveRoom(code: string, deviceId: string, preserveMembership = false) {
  if (activeMembership?.code === code) activeMembership = null;
  if (!preserveMembership) clearMembershipCredentials(code);
  getSocket().emit("room:leave", { code, deviceId });
}

export function onRoomState(cb: (room: PublicRoom) => void): () => void {
  const socket = getSocket();
  socket.on("room:state", cb);
  return () => socket.off("room:state", cb);
}

export function onKicked(cb: (code: string) => void): () => void {
  const socket = getSocket();
  const handler = (payload: { code: string }) => {
    if (activeMembership?.code === payload.code) activeMembership = null;
    clearMembershipCredentials(payload.code);
    cb(payload.code);
  };
  socket.on("room:kicked", handler);
  return () => socket.off("room:kicked", handler);
}

export function onRoomReplaced(cb: (code: string) => void): () => void {
  const socket = getSocket();
  const handler = (payload: { code: string }) => {
    if (activeMembership?.code === payload.code) activeMembership = null;
    cb(payload.code);
  };
  socket.on("room:replaced", handler);
  return () => socket.off("room:replaced", handler);
}

export function onRoomExited(cb: (code: string) => void): () => void {
  const socket = getSocket();
  const handler = (payload: { code: string }) => {
    if (activeMembership?.code === payload.code) activeMembership = null;
    clearMembershipCredentials(payload.code);
    cb(payload.code);
  };
  socket.on("room:exited", handler);
  return () => socket.off("room:exited", handler);
}

export function placeBid(code: string, deviceId: string, bid: number) {
  return request<null>("game:bid", { code, deviceId, bid });
}

export function playCard(code: string, deviceId: string, card: Card) {
  return request<null>("game:play", { code, deviceId, card });
}

export function newGame(code: string, deviceId: string) {
  return request<null>("game:new", { code, deviceId });
}

export function continueGame(code: string, deviceId: string) {
  return request<null>("game:continue", { code, deviceId });
}

export function exitGame(code: string, deviceId: string) {
  return request<null>("game:exit", { code, deviceId });
}

export function onHand(cb: (hand: PrivateHand) => void): () => void {
  const socket = getSocket();
  socket.on("game:hand", cb);
  return () => socket.off("game:hand", cb);
}
