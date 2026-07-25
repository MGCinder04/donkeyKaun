import "dotenv/config";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { isGateEnabled, sessionHandler, socketAuthMiddleware, unlockHandler } from "./security/passcodeGate.js";
import { registerRoomHandlers } from "./rooms/socketHandlers.js";
import { sweepStaleRooms } from "./rooms/store.js";

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
// The client is a separate static-hosted service in production (so it loads instantly
// and never shows Render's own cold-start page), so this API needs real CORS.
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN;

const app = express();
app.set("trust proxy", 1);

// No cookies involved (see passcodeGate.ts) — auth travels as an explicit Authorization
// header/socket handshake token instead, so this CORS setup doesn't need credentials.
function cors(req: Request, res: Response, next: NextFunction): void {
  if (CLIENT_ORIGIN && req.headers.origin === CLIENT_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", CLIENT_ORIGIN);
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.status(204).end();
    return;
  }
  next();
}

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: CLIENT_ORIGIN ? { origin: CLIENT_ORIGIN } : { origin: "*" },
});

if (isGateEnabled()) {
  console.log("[security] site passcode gate is ENABLED");
} else {
  console.log("[security] site passcode gate is disabled (SITE_PASSCODE not set)");
}

app.use(cors);
app.get("/api/session", sessionHandler);
app.post("/api/unlock", express.json({ limit: "1kb" }), unlockHandler);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

io.use(socketAuthMiddleware);

io.on("connection", (socket) => {
  console.log(`socket connected: ${socket.id}`);
  registerRoomHandlers(io, socket);

  socket.on("disconnect", () => {
    console.log(`socket disconnected: ${socket.id}`);
  });
});

setInterval(sweepStaleRooms, 60_000);

httpServer.listen(PORT, () => {
  console.log(`donkey-kaun server listening on port ${PORT}`);
});
