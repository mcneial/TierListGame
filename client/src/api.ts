import type { AnswerView, SessionResponse, StoredSession, TierListDraftPayload } from "./types";

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, options: RequestInit = {}, playerToken?: string): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(playerToken ? { "x-player-token": playerToken } : {}),
      ...(options.headers ?? {})
    }
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string; code?: string } | null;
    throw new ApiError(payload?.error ?? "Request failed.", response.status, payload?.code);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function authorizeHost(password: string) {
  return request<{ ok: true }>("/api/host/authorize", {
    method: "POST",
    body: JSON.stringify({ password })
  });
}

export async function createRoom(username: string, maxPlayers: number) {
  return request<StoredSession>("/api/rooms", {
    method: "POST",
    body: JSON.stringify({ username, maxPlayers })
  });
}

export async function joinRoom(roomCode: string, username: string) {
  try {
    return await request<StoredSession>(`/api/rooms/${roomCode}/join`, {
      method: "POST",
      body: JSON.stringify({ username })
    });
  } catch (error) {
    if (error instanceof ApiError && error.code === "PLAYER_CAN_REJOIN") {
      return request<StoredSession>(`/api/rooms/${roomCode}/rejoin`, {
        method: "POST",
        body: JSON.stringify({ username })
      });
    }
    throw error;
  }
}

export async function getSession({ roomCode, playerToken }: StoredSession) {
  return request<SessionResponse>(`/api/rooms/${roomCode}/session`, {}, playerToken);
}

export async function startGame(session: StoredSession) {
  return request<{ ok: true }>(`/api/rooms/${session.roomCode}/start`, { method: "POST" }, session.playerToken);
}

export async function saveOwnDraft(session: StoredSession, payload: TierListDraftPayload) {
  return request<{ ok: true }>(
    `/api/rooms/${session.roomCode}/my-list`,
    { method: "PUT", body: JSON.stringify(payload) },
    session.playerToken
  );
}

export async function submitOwnDraft(session: StoredSession, payload: TierListDraftPayload) {
  return request<{ ok: true }>(
    `/api/rooms/${session.roomCode}/my-list/submit`,
    { method: "POST", body: JSON.stringify(payload) },
    session.playerToken
  );
}

export async function savePeerAnswer(
  session: StoredSession,
  authorId: string,
  payload: Pick<AnswerView, "placements" | "starRating">
) {
  return request<{ ok: true }>(
    `/api/rooms/${session.roomCode}/peer-answers/${authorId}`,
    { method: "PUT", body: JSON.stringify(payload) },
    session.playerToken
  );
}

export async function submitPeerAnswer(
  session: StoredSession,
  authorId: string,
  payload: Pick<AnswerView, "placements" | "starRating">
) {
  return request<{ ok: true }>(
    `/api/rooms/${session.roomCode}/peer-answers/${authorId}/submit`,
    { method: "POST", body: JSON.stringify(payload) },
    session.playerToken
  );
}

export async function saveReviewAnswer(session: StoredSession, payload: Pick<AnswerView, "placements" | "starRating">) {
  return request<{ ok: true }>(
    `/api/rooms/${session.roomCode}/review/current-answer`,
    { method: "PUT", body: JSON.stringify(payload) },
    session.playerToken
  );
}

export async function advanceReview(session: StoredSession) {
  return request<{ ok: true }>(
    `/api/rooms/${session.roomCode}/review/advance`,
    { method: "POST" },
    session.playerToken
  );
}

export async function playAgain(session: StoredSession) {
  return request<{ ok: true }>(
    `/api/rooms/${session.roomCode}/play-again`,
    { method: "POST" },
    session.playerToken
  );
}
