const raw = import.meta.env.VITE_API_URL;

/** Base URL for the API/socket server. Empty string means "same origin" — used in
 *  local dev, where Vite proxies /api and /socket.io to the server. In production
 *  (client and server as separate Render services) this points at the API service. */
export const API_BASE = typeof raw === "string" ? raw.replace(/\/$/, "") : "";
