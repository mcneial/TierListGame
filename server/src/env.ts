import dotenv from "dotenv";

dotenv.config();

export const env = {
  hostGamePassword: process.env.HOST_GAME_PASSWORD ?? "",
  sessionSecret: process.env.SESSION_SECRET ?? "dev-tier-list-session-secret",
  port: Number(process.env.PORT ?? "3001"),
  nodeEnv: process.env.NODE_ENV ?? "development"
};

if (!env.hostGamePassword) {
  throw new Error("HOST_GAME_PASSWORD is required.");
}
