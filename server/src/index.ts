import http from "node:http";
import { attachSocketServer, createApp } from "./app.js";
import { env } from "./env.js";

const { app, store, setRoomUpdateListener } = createApp();
const server = http.createServer(app);

const { broadcastRoomState } = attachSocketServer(server, store);
setRoomUpdateListener((roomCode, event) => {
  broadcastRoomState(roomCode, event);
});

server.listen(env.port, () => {
  console.log(`Tier List Game server listening on port ${env.port}`);
});
