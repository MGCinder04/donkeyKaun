import { io, type Socket } from "socket.io-client";
import { API_BASE } from "../lib/config";

let socket: Socket | null = null;

/** Lazily create (and connect) the single shared socket. Nothing opens a connection
 *  until a room page actually needs one — landing/setup never touch this module. */
export function getSocket(): Socket {
  if (!socket) {
    const opts = { path: "/socket.io", autoConnect: false, withCredentials: true };
    socket = API_BASE ? io(API_BASE, opts) : io(opts);
  }
  if (!socket.connected) {
    socket.connect();
  }
  return socket;
}
