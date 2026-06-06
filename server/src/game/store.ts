import { randomUUID } from "node:crypto";
import { computeAwards } from "./scoring.js";
import {
  DEFAULT_TIERS,
  MAX_ROOM_PLAYERS,
  MIN_ROOM_PLAYERS,
  ROOM_CODE_ALPHABET,
  type Answer,
  type AnswerInput,
  type AuthoredTierList,
  type AuthoringDraft,
  type Room,
  type RoomMutationResult,
  type SessionResponse,
  type TierListInput
} from "./types.js";
import { answerSchema, createInitialDraft, tierListDraftSchema, tierListSchema } from "./validation.js";

export interface GameStore {
  createRoom(hostUsername: string, maxPlayers: number): RoomMutationResult;
  joinRoom(code: string, username: string): RoomMutationResult;
  rejoinRoom(code: string, username: string): RoomMutationResult;
  subscribePlayer(code: string, playerToken: string, socketId: string): Room;
  disconnectSocket(socketId: string): Room | null;
  getSession(code: string, playerToken: string): SessionResponse;
  startGame(code: string, playerToken: string): Room;
  saveOwnList(code: string, playerToken: string, draft: TierListInput, submit: boolean): Room;
  savePeerAnswer(code: string, playerToken: string, authorId: string, input: AnswerInput, submit: boolean): Room;
  saveReviewAnswer(code: string, playerToken: string, input: AnswerInput): Room;
  advanceReview(code: string, playerToken: string): Room;
  playAgain(code: string, playerToken: string): Room;
}

class HttpError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function createError(statusCode: number, code: string, message: string) {
  return new HttpError(statusCode, code, message);
}

function normalizeCode(code: string) {
  return code.trim().toUpperCase();
}

function normalizeUsername(username: string) {
  return username.trim();
}

function cloneDraftWithTimestamps(draft: AuthoringDraft): AuthoringDraft {
  return {
    ...draft,
    tiers: [...draft.tiers],
    options: [...draft.options],
    placements: [...draft.placements]
  };
}

export class InMemoryGameStore implements GameStore {
  private readonly roomsByCode = new Map<string, Room>();

  createRoom(hostUsername: string, maxPlayers: number): RoomMutationResult {
    if (maxPlayers < MIN_ROOM_PLAYERS || maxPlayers > MAX_ROOM_PLAYERS) {
      throw createError(400, "INVALID_ROOM_SIZE", "Room size is out of range.");
    }

    const code = this.generateRoomCode();
    const hostId = randomUUID();
    const playerToken = randomUUID();
    const room: Room = {
      code,
      hostPlayerId: hostId,
      maxPlayers,
      phase: "lobby",
      players: [
        {
          id: hostId,
          username: normalizeUsername(hostUsername),
          isHost: true,
          connected: true,
          playerToken,
          joinedAt: Date.now()
        }
      ],
      round: null,
      createdAt: Date.now()
    };

    this.roomsByCode.set(code, room);
    return { room, playerToken };
  }

  joinRoom(code: string, username: string): RoomMutationResult {
    const room = this.requireRoom(code);
    const normalizedUsername = normalizeUsername(username);
    const existingPlayer = room.players.find(
      (player) => player.username.toLowerCase() === normalizedUsername.toLowerCase()
    );

    if (existingPlayer) {
      if (!existingPlayer.connected) {
        throw createError(409, "PLAYER_CAN_REJOIN", "That username belongs to a disconnected player. Rejoin instead.");
      }
      throw createError(409, "USERNAME_TAKEN", "That username is already in the room.");
    }

    if (room.players.length >= room.maxPlayers) {
      throw createError(400, "ROOM_FULL", "The room is already full.");
    }

    if (!(room.phase === "lobby" || room.phase === "authoring")) {
      throw createError(400, "JOIN_CLOSED", "This room is no longer accepting new players.");
    }

    const playerToken = randomUUID();
    const playerId = randomUUID();
    room.players.push({
      id: playerId,
      username: normalizedUsername,
      isHost: false,
      connected: true,
      playerToken,
      joinedAt: Date.now()
    });

    if (room.phase === "authoring" && room.round) {
      room.round.draftsByPlayerId[playerId] = createInitialDraft();
    }

    return { room, playerToken };
  }

  rejoinRoom(code: string, username: string): RoomMutationResult {
    const room = this.requireRoom(code);
    const normalizedUsername = normalizeUsername(username);
    const player = room.players.find(
      (candidate) => candidate.username.toLowerCase() === normalizedUsername.toLowerCase()
    );

    if (!player) {
      throw createError(404, "PLAYER_NOT_FOUND", "No disconnected player matches that username.");
    }

    if (player.connected) {
      throw createError(409, "PLAYER_ACTIVE", "That player is already connected.");
    }

    player.connected = true;
    player.playerToken = randomUUID();
    player.socketId = undefined;
    return { room, playerToken: player.playerToken };
  }

  subscribePlayer(code: string, playerToken: string, socketId: string) {
    const room = this.requirePlayerRoom(code, playerToken);
    const player = this.requirePlayer(room, playerToken);
    player.connected = true;
    player.socketId = socketId;
    return room;
  }

  disconnectSocket(socketId: string) {
    for (const room of this.roomsByCode.values()) {
      const player = room.players.find((candidate) => candidate.socketId === socketId);
      if (player) {
        player.connected = false;
        player.socketId = undefined;
        return room;
      }
    }
    return null;
  }

  getSession(code: string, playerToken: string): SessionResponse {
    const room = this.requirePlayerRoom(code, playerToken);
    const player = this.requirePlayer(room, playerToken);
    return serializeSession(room, player.id);
  }

  startGame(code: string, playerToken: string) {
    const room = this.requirePlayerRoom(code, playerToken);
    const player = this.requirePlayer(room, playerToken);
    this.assertHost(room, player.id);

    if (room.phase !== "lobby") {
      throw createError(400, "ROOM_ALREADY_STARTED", "The game has already started.");
    }

    if (room.players.length < MIN_ROOM_PLAYERS) {
      throw createError(400, "NOT_ENOUGH_PLAYERS", "You need at least two players to start.");
    }

    room.phase = "authoring";
    room.round = {
      draftsByPlayerId: Object.fromEntries(room.players.map((candidate) => [candidate.id, createInitialDraft()])),
      authoredListsByPlayerId: {},
      answersByAuthorId: {},
      reviewOrder: [],
      currentReviewIndex: 0
    };

    return room;
  }

  saveOwnList(code: string, playerToken: string, draftInput: TierListInput, submit: boolean) {
    const room = this.requirePlayerRoom(code, playerToken);
    const player = this.requirePlayer(room, playerToken);
    const round = this.requireRound(room);

    if (room.phase !== "authoring") {
      throw createError(400, "NOT_AUTHORING", "The room is not in the authoring phase.");
    }

    const validated = submit ? tierListSchema.parse(draftInput) : tierListDraftSchema.parse(draftInput);
    const normalizedPlacements = validated.placements.slice(0, validated.options.length);
    const draft: AuthoringDraft = {
      title: validated.title,
      tiers: validated.tiers,
      options: validated.options,
      placements: normalizedPlacements,
      submitted: false,
      updatedAt: Date.now()
    };

    if (submit) {
      if (normalizedPlacements.some((value) => value === null)) {
        throw createError(400, "UNFINISHED_SELF_ANSWER", "You need to place every option before submitting.");
      }

      const selfAnswer: Answer = {
        playerId: player.id,
        authorId: player.id,
        placements: [...normalizedPlacements],
        starRating: null,
        submitted: true,
        finalized: false,
        updatedAt: Date.now()
      };

      const authoredList: AuthoredTierList = {
        authorId: player.id,
        title: validated.title,
        tiers: validated.tiers,
        options: validated.options,
        selfAnswer,
        submittedAt: Date.now()
      };

      round.draftsByPlayerId[player.id] = {
        ...draft,
        submitted: true
      };
      round.authoredListsByPlayerId[player.id] = authoredList;
    } else {
      round.draftsByPlayerId[player.id] = draft;
    }

    this.maybeAdvanceFromAuthoring(room);
    return room;
  }

  savePeerAnswer(code: string, playerToken: string, authorId: string, input: AnswerInput, submit: boolean) {
    const room = this.requirePlayerRoom(code, playerToken);
    const player = this.requirePlayer(room, playerToken);
    const round = this.requireRound(room);

    if (room.phase !== "peerAnswering") {
      throw createError(400, "NOT_PEER_PHASE", "The room is not in peer answering.");
    }

    const authoredList = round.authoredListsByPlayerId[authorId];
    if (!authoredList || authorId === player.id) {
      throw createError(404, "LIST_NOT_FOUND", "That tier list is not available.");
    }

    const answer = round.answersByAuthorId[authorId]?.[player.id];
    if (!answer) {
      throw createError(404, "ANSWER_NOT_FOUND", "No answer slot exists for that player.");
    }

    const validated = answerSchema.parse(input);
    if (validated.placements.length !== authoredList.options.length) {
      throw createError(400, "MISMATCHED_PLACEMENTS", "Placements must match the option count.");
    }

    if (submit) {
      if (validated.placements.some((value) => value === null)) {
        throw createError(400, "UNFINISHED_PEER_ANSWER", "Place every option before submitting.");
      }
      if (validated.starRating === null) {
        throw createError(400, "STAR_RATING_REQUIRED", "Give the list a star rating before submitting.");
      }
    }

    answer.placements = [...validated.placements];
    answer.starRating = validated.starRating;
    answer.submitted = submit || answer.submitted;
    answer.updatedAt = Date.now();

    this.maybeAdvanceFromPeerAnswering(room);
    return room;
  }

  saveReviewAnswer(code: string, playerToken: string, input: AnswerInput) {
    const room = this.requirePlayerRoom(code, playerToken);
    const player = this.requirePlayer(room, playerToken);
    const round = this.requireRound(room);

    if (room.phase !== "review") {
      throw createError(400, "NOT_REVIEWING", "The room is not in review.");
    }

    const currentAuthorId = round.reviewOrder[round.currentReviewIndex];
    const authoredList = round.authoredListsByPlayerId[currentAuthorId];
    const answer = round.answersByAuthorId[currentAuthorId]?.[player.id];
    if (!authoredList || !answer) {
      throw createError(404, "REVIEW_TARGET_MISSING", "The current review target could not be found.");
    }

    const validated = answerSchema.parse(input);
    if (validated.placements.length !== authoredList.options.length) {
      throw createError(400, "MISMATCHED_PLACEMENTS", "Placements must match the option count.");
    }
    if (validated.placements.some((value) => value === null)) {
      throw createError(400, "UNFINISHED_REVIEW_ANSWER", "Every option needs a placement during review.");
    }
    if (player.id !== currentAuthorId && validated.starRating === null) {
      throw createError(400, "STAR_RATING_REQUIRED", "A star rating is required for non-self answers.");
    }

    answer.placements = [...validated.placements];
    answer.starRating = player.id === currentAuthorId ? null : validated.starRating;
    answer.updatedAt = Date.now();
    return room;
  }

  advanceReview(code: string, playerToken: string) {
    const room = this.requirePlayerRoom(code, playerToken);
    const player = this.requirePlayer(room, playerToken);
    const round = this.requireRound(room);

    this.assertHost(room, player.id);
    if (room.phase !== "review") {
      throw createError(400, "NOT_REVIEWING", "The room is not in review.");
    }

    const currentAuthorId = round.reviewOrder[round.currentReviewIndex];
    const authoredList = round.authoredListsByPlayerId[currentAuthorId];
    const answers = Object.values(round.answersByAuthorId[currentAuthorId] ?? {});
    for (const answer of answers) {
      if (answer.placements.length !== authoredList.options.length || answer.placements.some((value) => value === null)) {
        throw createError(400, "UNFINISHED_REVIEW_ANSWER", "Every player must have a complete answer before moving on.");
      }
      if (answer.playerId !== currentAuthorId && answer.starRating === null) {
        throw createError(400, "MISSING_REVIEW_STAR", "Every non-author answer needs a star rating before moving on.");
      }
      answer.finalized = true;
      answer.submitted = true;
    }

    if (round.currentReviewIndex >= round.reviewOrder.length - 1) {
      room.phase = "awards";
      round.awards = computeAwards(room);
    } else {
      round.currentReviewIndex += 1;
    }
    return room;
  }

  playAgain(code: string, playerToken: string) {
    const room = this.requirePlayerRoom(code, playerToken);
    const player = this.requirePlayer(room, playerToken);
    this.assertHost(room, player.id);
    if (room.phase !== "awards") {
      throw createError(400, "NOT_FINISHED", "Play again is only available after awards.");
    }

    room.players = room.players.filter((candidate) => candidate.connected);
    const hostStillPresent = room.players.some((candidate) => candidate.id === room.hostPlayerId);
    if (!hostStillPresent) {
      throw createError(400, "HOST_MISSING", "The host must still be connected to play again.");
    }

    room.phase = "lobby";
    room.round = null;
    return room;
  }

  private maybeAdvanceFromAuthoring(room: Room) {
    const round = this.requireRound(room);
    const allSubmitted = room.players.every((player) => round.authoredListsByPlayerId[player.id]);
    if (!allSubmitted) {
      return;
    }

    room.phase = "peerAnswering";
    round.reviewOrder = room.players.map((player) => player.id);
    round.currentReviewIndex = 0;

    for (const authoredList of Object.values(round.authoredListsByPlayerId)) {
      const answersByPlayerId: Record<string, Answer> = {};
      for (const player of room.players) {
        if (player.id === authoredList.authorId) {
          answersByPlayerId[player.id] = {
            ...authoredList.selfAnswer,
            placements: [...authoredList.selfAnswer.placements],
            finalized: false
          };
        } else {
          answersByPlayerId[player.id] = {
            playerId: player.id,
            authorId: authoredList.authorId,
            placements: Array(authoredList.options.length).fill(null),
            starRating: null,
            submitted: false,
            finalized: false,
            updatedAt: Date.now()
          };
        }
      }
      round.answersByAuthorId[authoredList.authorId] = answersByPlayerId;
    }

    this.maybeAdvanceFromPeerAnswering(room);
  }

  private maybeAdvanceFromPeerAnswering(room: Room) {
    const round = this.requireRound(room);
    if (room.phase !== "peerAnswering") {
      return;
    }

    const allSubmitted = Object.values(round.answersByAuthorId).every((answersByPlayerId) =>
      Object.values(answersByPlayerId).every((answer) => answer.playerId === answer.authorId || answer.submitted)
    );

    if (allSubmitted) {
      room.phase = "review";
      round.currentReviewIndex = 0;
    }
  }

  private generateRoomCode() {
    for (let attempt = 0; attempt < 5000; attempt += 1) {
      let code = "";
      for (let index = 0; index < 4; index += 1) {
        code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
      }
      if (!this.roomsByCode.has(code)) {
        return code;
      }
    }
    throw createError(500, "CODE_GENERATION_FAILED", "Unable to generate a room code.");
  }

  private requireRound(room: Room) {
    if (!room.round) {
      throw createError(400, "ROUND_NOT_STARTED", "This room does not have an active round.");
    }
    return room.round;
  }

  private requireRoom(code: string) {
    const room = this.roomsByCode.get(normalizeCode(code));
    if (!room) {
      throw createError(404, "ROOM_NOT_FOUND", "Room not found.");
    }
    return room;
  }

  private requirePlayer(room: Room, playerToken: string) {
    const player = room.players.find((candidate) => candidate.playerToken === playerToken);
    if (!player) {
      throw createError(401, "PLAYER_SESSION_NOT_FOUND", "Player session not found.");
    }
    return player;
  }

  private requirePlayerRoom(code: string, playerToken: string) {
    const room = this.requireRoom(code);
    this.requirePlayer(room, playerToken);
    return room;
  }

  private assertHost(room: Room, playerId: string) {
    if (room.hostPlayerId !== playerId) {
      throw createError(403, "HOST_ONLY", "Only the host can do that.");
    }
  }
}

function serializeSession(room: Room, playerId: string): SessionResponse {
  const currentPlayer = room.players.find((player) => player.id === playerId);
  if (!currentPlayer) {
    throw createError(401, "PLAYER_SESSION_NOT_FOUND", "Player session not found.");
  }

  const round = room.round;
  const playerSummaries = room.players.map((player) => {
    const selfSubmitted = Boolean(round?.authoredListsByPlayerId[player.id]);
    let peerSubmittedCount = 0;
    let peerTotalCount = 0;
    if (round) {
      for (const [authorId, answersByPlayerId] of Object.entries(round.answersByAuthorId)) {
        if (authorId === player.id) {
          continue;
        }
        const answer = answersByPlayerId[player.id];
        if (answer) {
          peerTotalCount += 1;
          if (answer.submitted) {
            peerSubmittedCount += 1;
          }
        }
      }
    }

    return {
      id: player.id,
      username: player.username,
      isHost: player.isHost,
      connected: player.connected,
      selfSubmitted,
      peerSubmittedCount,
      peerTotalCount
    };
  });

  const baseRoom = {
    code: room.code,
    maxPlayers: room.maxPlayers,
    phase: room.phase,
    canStart: room.phase === "lobby" && currentPlayer.isHost && room.players.length >= 2,
    canAdvanceReview: room.phase === "review" && currentPlayer.isHost,
    hostConnected: room.players.some((player) => player.id === room.hostPlayerId && player.connected),
    joinAllowed: room.phase === "lobby" || room.phase === "authoring"
  } as const;

  if (room.phase === "lobby" || !round) {
    return {
      room: baseRoom,
      currentPlayer: {
        id: currentPlayer.id,
        username: currentPlayer.username,
        isHost: currentPlayer.isHost
      },
      players: playerSummaries,
      view: { kind: "lobby" }
    };
  }

  if (room.phase === "authoring") {
    const draft = round.draftsByPlayerId[playerId] ?? createInitialDraft();
    const readyCount = Object.keys(round.authoredListsByPlayerId).length;
    return {
      room: baseRoom,
      currentPlayer: {
        id: currentPlayer.id,
        username: currentPlayer.username,
        isHost: currentPlayer.isHost
      },
      players: playerSummaries,
      view: {
        kind: "authoring",
        submitted: draft.submitted,
        readyCount,
        totalCount: room.players.length,
        draft: cloneDraftWithTimestamps(draft)
      }
    };
  }

  if (room.phase === "peerAnswering") {
    const peerAuthorIds = room.players.map((player) => player.id).filter((candidateId) => candidateId !== playerId);
    const currentAuthorId =
      peerAuthorIds.find((authorId) => !round.answersByAuthorId[authorId]?.[playerId]?.submitted) ?? null;
    const currentList = currentAuthorId ? round.authoredListsByPlayerId[currentAuthorId] : null;
    const currentAnswer = currentAuthorId ? round.answersByAuthorId[currentAuthorId]?.[playerId] ?? null : null;
    const completedCount = peerAuthorIds.filter((authorId) => round.answersByAuthorId[authorId]?.[playerId]?.submitted).length;

    return {
      room: baseRoom,
      currentPlayer: {
        id: currentPlayer.id,
        username: currentPlayer.username,
        isHost: currentPlayer.isHost
      },
      players: playerSummaries,
      view: {
        kind: "peerAnswering",
        waiting: currentAuthorId === null,
        completedCount,
        totalCount: peerAuthorIds.length,
        currentList: currentList
          ? {
              authorId: currentList.authorId,
              authorUsername: room.players.find((player) => player.id === currentList.authorId)?.username ?? "Unknown",
              title: currentList.title,
              tiers: [...currentList.tiers],
              options: [...currentList.options]
            }
          : null,
        answer: currentAnswer
          ? {
              ...currentAnswer,
              placements: [...currentAnswer.placements]
            }
          : null
      }
    };
  }

  if (room.phase === "review") {
    const currentAuthorId = round.reviewOrder[round.currentReviewIndex];
    const currentList = round.authoredListsByPlayerId[currentAuthorId];
    const answerOptions = Object.values(round.answersByAuthorId[currentAuthorId]).map((answer) => ({
      playerId: answer.playerId,
      username: room.players.find((player) => player.id === answer.playerId)?.username ?? "Unknown",
      placements: [...answer.placements],
      starRating: answer.starRating
    }));

    return {
      room: baseRoom,
      currentPlayer: {
        id: currentPlayer.id,
        username: currentPlayer.username,
        isHost: currentPlayer.isHost
      },
      players: playerSummaries,
      view: {
        kind: "review",
        reviewIndex: round.currentReviewIndex,
        totalReviews: round.reviewOrder.length,
        currentList: {
          authorId: currentList.authorId,
          authorUsername: room.players.find((player) => player.id === currentAuthorId)?.username ?? "Unknown",
          title: currentList.title,
          tiers: [...currentList.tiers],
          options: [...currentList.options]
        },
        answerOptions,
        editablePlayerId: playerId
      }
    };
  }

  return {
    room: baseRoom,
    currentPlayer: {
      id: currentPlayer.id,
      username: currentPlayer.username,
      isHost: currentPlayer.isHost
    },
    players: playerSummaries,
    view: {
      kind: "awards",
      awards: round.awards ?? computeAwards(room)
    }
  };
}

export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError;
}
