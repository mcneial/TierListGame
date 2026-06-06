import jwt from "jsonwebtoken";
import { env } from "./env.js";

const HOST_AUTH_COOKIE = "tierlist_host_auth";

interface HostAuthPayload {
  canHost: true;
}

export function createHostAuthToken() {
  return jwt.sign({ canHost: true satisfies HostAuthPayload["canHost"] }, env.sessionSecret, {
    expiresIn: "15m"
  });
}

export function verifyHostAuthToken(token?: string) {
  if (!token) {
    return false;
  }

  try {
    const payload = jwt.verify(token, env.sessionSecret);
    return Boolean(typeof payload === "object" && payload && "canHost" in payload);
  } catch {
    return false;
  }
}

export function getHostAuthCookieName() {
  return HOST_AUTH_COOKIE;
}
