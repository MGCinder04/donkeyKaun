import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
const CLIENT_DIST = path.resolve(__dirname, "../../client/dist");

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: process.env.NODE_ENV === "production" ? undefined : { origin: "*" },
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use(express.static(CLIENT_DIST));
app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(CLIENT_DIST, "index.html"));
});

io.on("connection", (socket) => {
  console.log(`socket connected: ${socket.id}`);

  socket.on("disconnect", () => {
    console.log(`socket disconnected: ${socket.id}`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`donkey-kaun server listening on port ${PORT}`);
});
