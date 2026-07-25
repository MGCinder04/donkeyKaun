import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;

/** Lazily create (and connect) the single shared socket. Nothing opens a connection
 *  until a room page actually needs one — landing/setup never touch this module. */
export function getSocket(): Socket {
  if (!socket) {
    socket = io({ path: "/socket.io", autoConnect: false, withCredentials: true });
  }
  if (!socket.connected) {
    socket.connect();
  }
  return socket;
}
