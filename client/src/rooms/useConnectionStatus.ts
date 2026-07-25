import { useEffect, useState } from "react";
import { getSocket } from "./socket";

/** Tracks the shared socket's connect/disconnect state so the UI can show local
 *  feedback ("reconnecting…") instead of silently freezing on the last known state. */
export function useConnectionStatus(): boolean {
  const [connected, setConnected] = useState(() => getSocket().connected);

  useEffect(() => {
    const socket = getSocket();
    // The socket can connect between the initial render and this effect attaching its
    // listeners (it fired once, already, for good) — re-sync here or a fast connect
    // gets missed entirely and the banner sticks at "reconnecting" forever.
    setConnected(socket.connected);
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, []);

  return connected;
}
