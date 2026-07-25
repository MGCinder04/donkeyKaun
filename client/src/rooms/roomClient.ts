import { getSocket } from "./socket";
import type { AvatarChoice } from "../identity/useIdentity";
import type { Envelope, PublicRoom } from "./types";

function request<T>(event: string, payload: Record<string, unknown>): Promise<Envelope<T>> {
  return new Promise((resolve) => {
    getSocket().emit(event, payload, (response: Envelope<T>) => resolve(response));
  });
}

export function createRoom(name: string, avatar: AvatarChoice, deviceId: string) {
  return request<{ code: string }>("room:create", { name, avatar, deviceId });
}

export function joinRoom(code: string, name: string, avatar: AvatarChoice, deviceId: string) {
  return request<PublicRoom>("room:join", { code, name, avatar, deviceId });
}

export function updateRoomProfile(code: string, deviceId: string, name: string, avatar: AvatarChoice) {
  return request<null>("room:update-profile", { code, deviceId, name, avatar });
}

export function startRoom(code: string, deviceId: string) {
  return request<null>("room:start", { code, deviceId });
}

export function leaveRoom(code: string, deviceId: string) {
  getSocket().emit("room:leave", { code, deviceId });
}

export function onRoomState(cb: (room: PublicRoom) => void): () => void {
  const socket = getSocket();
  socket.on("room:state", cb);
  return () => socket.off("room:state", cb);
}
