import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isGateEnabled, passcodeGate, socketAuthMiddleware, unlockHandler } from "./security/passcodeGate.js";
import { registerRoomHandlers } from "./rooms/socketHandlers.js";
import { sweepStaleRooms } from "./rooms/store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
const CLIENT_DIST = path.resolve(__dirname, "../../client/dist");

const app = express();
app.set("trust proxy", 1);
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: process.env.NODE_ENV === "production" ? undefined : { origin: "*" },
});

if (isGateEnabled()) {
  console.log("[security] site passcode gate is ENABLED");
} else {
  console.log("[security] site passcode gate is disabled (SITE_PASSCODE not set)");
}

app.post("/api/unlock", express.json({ limit: "1kb" }), unlockHandler);
app.use(passcodeGate);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use(express.static(CLIENT_DIST));
app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(CLIENT_DIST, "index.html"));
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
