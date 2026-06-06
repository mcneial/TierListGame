import path from "node:path";
import { fileURLToPath } from "node:url";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { createHostAuthToken, getHostAuthCookieName, verifyHostAuthToken } from "./auth.js";
import { env } from "./env.js";
import { InMemoryGameStore, isHttpError, type GameStore } from "./game/store.js";
import {
  answerSchema,
  createRoomSchema,
  hostAuthorizationSchema,
  joinRoomSchema,
  tierListDraftSchema,
  tierListSchema
} from "./game/validation.js";
import { InMemoryRateLimiter } from "./rateLimit.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDistPath = path.resolve(__dirname, "../../client/dist");

function getPlayerToken(request: express.Request) {
  const value = request.header("x-player-token");
  if (!value) {
    throw new Error("Missing player token.");
  }
  return value;
}

export function createApp(store: GameStore = new InMemoryGameStore()) {
  const app = express();
  const authRateLimiter = new InMemoryRateLimiter();

  app.use(
    cors({
      origin: true,
      credentials: true
    })
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  app.post("/api/host/authorize", (request, response, next) => {
    try {
      const ip = request.ip ?? "unknown";
      if (authRateLimiter.isBlocked(ip)) {
        response.status(429).json({ error: "Too many attempts. Try again later." });
        return;
      }

      const { password } = hostAuthorizationSchema.parse(request.body);
      if (password !== env.hostGamePassword) {
        authRateLimiter.registerFailure(ip);
        response.status(401).json({ error: "That password was not accepted." });
        return;
      }

      response
        .cookie(getHostAuthCookieName(), createHostAuthToken(), {
          httpOnly: true,
          sameSite: "lax",
          secure: env.nodeEnv === "production",
          maxAge: 15 * 60 * 1000
        })
        .json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/rooms", (request, response, next) => {
    try {
      const hostCookie = request.cookies[getHostAuthCookieName()] as string | undefined;
      if (!verifyHostAuthToken(hostCookie)) {
        response.status(401).json({ error: "Host authorization is required." });
        return;
      }

      const { username, maxPlayers } = createRoomSchema.parse(request.body);
      const result = store.createRoom(username, maxPlayers);
      response.status(201).json({
        roomCode: result.room.code,
        playerToken: result.playerToken
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/rooms/:code/join", (request, response, next) => {
    try {
      const { username } = joinRoomSchema.parse(request.body);
      const result = store.joinRoom(request.params.code, username);
      response.status(201).json({
        roomCode: result.room.code,
        playerToken: result.playerToken
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/rooms/:code/rejoin", (request, response, next) => {
    try {
      const { username } = joinRoomSchema.parse(request.body);
      const result = store.rejoinRoom(request.params.code, username);
      response.status(200).json({
        roomCode: result.room.code,
        playerToken: result.playerToken
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/rooms/:code/session", (request, response, next) => {
    try {
      response.json(store.getSession(request.params.code, getPlayerToken(request)));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/rooms/:code/start", (request, response, next) => {
    try {
      store.startGame(request.params.code, getPlayerToken(request));
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/rooms/:code/my-list", (request, response, next) => {
    try {
      const payload = tierListDraftSchema.parse(request.body);
      store.saveOwnList(request.params.code, getPlayerToken(request), payload, false);
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/rooms/:code/my-list/submit", (request, response, next) => {
    try {
      const payload = tierListSchema.parse(request.body);
      store.saveOwnList(request.params.code, getPlayerToken(request), payload, true);
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/rooms/:code/peer-answers/:authorId", (request, response, next) => {
    try {
      const payload = answerSchema.parse(request.body);
      store.savePeerAnswer(request.params.code, getPlayerToken(request), request.params.authorId, payload, false);
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/rooms/:code/peer-answers/:authorId/submit", (request, response, next) => {
    try {
      const payload = answerSchema.parse(request.body);
      store.savePeerAnswer(request.params.code, getPlayerToken(request), request.params.authorId, payload, true);
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/rooms/:code/review/current-answer", (request, response, next) => {
    try {
      const payload = answerSchema.parse(request.body);
      store.saveReviewAnswer(request.params.code, getPlayerToken(request), payload);
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/rooms/:code/review/advance", (request, response, next) => {
    try {
      store.advanceReview(request.params.code, getPlayerToken(request));
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/rooms/:code/play-again", (request, response, next) => {
    try {
      store.playAgain(request.params.code, getPlayerToken(request));
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.use(express.static(clientDistPath));

  app.get("/{*path}", (_request, response) => {
    response.sendFile(path.join(clientDistPath, "index.html"));
  });

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    if (isHttpError(error)) {
      response.status(error.statusCode).json({ error: error.message, code: error.code });
      return;
    }

    if (error instanceof Error && "issues" in error) {
      response.status(400).json({ error: "Validation failed.", details: error });
      return;
    }

    console.error(error);
    response.status(500).json({ error: "Something went wrong." });
  });

  return { app, store };
}

export function attachSocketServer(httpServer: HttpServer, store: GameStore) {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: true,
      credentials: true
    }
  });

  const broadcastRoomState = (roomCode: string, event: string) => {
    io.to(roomCode).emit("room:state", { event, roomCode });
  };

  io.on("connection", (socket) => {
    socket.on("room:subscribe", ({ roomCode, playerToken }: { roomCode: string; playerToken: string }) => {
      try {
        const room = store.subscribePlayer(roomCode, playerToken, socket.id);
        socket.join(room.code);
        broadcastRoomState(room.code, "player:connected");
      } catch (error) {
        socket.emit("room:error", {
          error: error instanceof Error ? error.message : "Unable to subscribe to room."
        });
      }
    });

    socket.on("room:changed", ({ roomCode, event }: { roomCode: string; event: string }) => {
      broadcastRoomState(roomCode, event);
    });

    socket.on("disconnect", () => {
      const room = store.disconnectSocket(socket.id);
      if (room) {
        broadcastRoomState(room.code, "player:disconnected");
      }
    });
  });

  return io;
}
