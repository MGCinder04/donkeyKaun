import { getSocket } from "./socket";
import type { AvatarChoice } from "../identity/useIdentity";
import type { Envelope, PublicRoom } from "./types";

function request<T>(event: string, payload: Record<string, unknown>): Promise<Envelope<T>> {
  return new Promise((resolve) => {
    getSocket().emit(event, payload, (response: Envelope<T>) => resolve(response));
  });
}

interface Membership {
  code: string;
  name: string;
  avatar: AvatarChoice;
  deviceId: string;
}

let activeMembership: Membership | null = null;

// A socket reconnect (network blip, laptop sleep/wake, a browser-discarded tab coming
// back) gets a new socket.id and drops out of every Socket.IO room it was in — none of
// which necessarily remounts the Room page that triggered the original join. Without
// this, the server keeps showing that player as permanently "reconnecting" until they
// navigate back into the room. Re-announcing on every connect keeps it accurate.
getSocket().on("connect", () => {
  if (!activeMembership) return;
  const { code, name, avatar, deviceId } = activeMembership;
  request("room:join", { code, name, avatar, deviceId });
});

export async function createRoom(name: string, avatar: AvatarChoice, deviceId: string) {
  const result = await request<{ code: string }>("room:create", { name, avatar, deviceId });
  if (result.ok) activeMembership = { code: result.value.code, name, avatar, deviceId };
  return result;
}

export async function joinRoom(code: string, name: string, avatar: AvatarChoice, deviceId: string) {
  const result = await request<PublicRoom>("room:join", { code, name, avatar, deviceId });
  if (result.ok) activeMembership = { code, name, avatar, deviceId };
  return result;
}

export function startRoom(code: string, deviceId: string) {
  return request<null>("room:start", { code, deviceId });
}

export function kickPlayer(code: string, hostDeviceId: string, targetDeviceId: string) {
  return request<null>("room:kick", { code, deviceId: hostDeviceId, targetDeviceId });
}

export function leaveRoom(code: string, deviceId: string) {
  if (activeMembership?.code === code) activeMembership = null;
  getSocket().emit("room:leave", { code, deviceId });
}

export function onRoomState(cb: (room: PublicRoom) => void): () => void {
  const socket = getSocket();
  socket.on("room:state", cb);
  return () => socket.off("room:state", cb);
}

export function onKicked(cb: (code: string) => void): () => void {
  const socket = getSocket();
  const handler = (payload: { code: string }) => cb(payload.code);
  socket.on("room:kicked", handler);
  return () => socket.off("room:kicked", handler);
}
