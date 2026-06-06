import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createApp } from "./app.js";

vi.mock("./env.js", () => ({
  env: {
    hostGamePassword: "letmein",
    sessionSecret: "test-secret",
    port: 3001,
    nodeEnv: "test"
  }
}));

describe("app host authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("rejects room creation without host authorization", async () => {
    const { app } = createApp();
    const response = await request(app).post("/api/rooms").send({ username: "Host", maxPlayers: 4 });
    expect(response.status).toBe(401);
  });

  test("authorizes host and creates room with cookie", async () => {
    const { app } = createApp();
    const agent = request.agent(app);
    const authResponse = await agent.post("/api/host/authorize").send({ password: "letmein" });
    expect(authResponse.status).toBe(200);

    const createResponse = await agent.post("/api/rooms").send({ username: "Host", maxPlayers: 4 });
    expect(createResponse.status).toBe(201);
    expect(createResponse.body.roomCode).toHaveLength(4);
  });
});
