import http from "node:http";
import { attachSocketServer, createApp } from "./app.js";
import { env } from "./env.js";

const { app, store } = createApp();
const server = http.createServer(app);

attachSocketServer(server, store);

server.listen(env.port, () => {
  console.log(`Tier List Game server listening on port ${env.port}`);
});
