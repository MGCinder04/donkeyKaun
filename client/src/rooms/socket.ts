import { io, type Socket } from "socket.io-client";
import { API_BASE } from "../lib/config";
import { getAuthToken } from "../lib/authToken";

let socket: Socket | null = null;

/** Lazily create (and connect) the single shared socket. Nothing opens a connection
 *  until a room page actually needs one — landing/setup never touch this module.
 *  The passcode-gate token (if any) rides in the handshake `auth` payload, not a
 *  cookie — see GateScreen.tsx for why. */
export function getSocket(): Socket {
  if (!socket) {
    const opts = { path: "/socket.io", autoConnect: false, auth: { token: getAuthToken() } };
    socket = API_BASE ? io(API_BASE, opts) : io(opts);
  }
  if (!socket.connected) {
    socket.connect();
  }
  return socket;
}
