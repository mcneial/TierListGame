export const DEFAULT_TIERS = ["S", "A", "B", "C", "D", "F"] as const;
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const MAX_ROOM_PLAYERS = 16;
export const MIN_ROOM_PLAYERS = 2;
export const MAX_USERNAME_LENGTH = 20;
export const MAX_TIER_NAME_LENGTH = 64;
export const MAX_TIER_LIST_TITLE_LENGTH = 80;
export const MAX_OPTION_TEXT_LENGTH = 120;
export const MAX_OPTIONS = 100;
export const MIN_TIERS = 2;
export const MAX_TIERS = 10;

export type RoomPhase = "lobby" | "authoring" | "peerAnswering" | "review" | "awards";

export interface Player {
  id: string;
  username: string;
  isHost: boolean;
  connected: boolean;
  playerToken: string;
  socketId?: string;
  joinedAt: number;
}

export interface Answer {
  playerId: string;
  authorId: string;
  placements: Array<number | null>;
  starRating: number | null;
  submitted: boolean;
  finalized: boolean;
  updatedAt: number;
}

export interface AuthoredTierList {
  authorId: string;
  title: string;
  tiers: string[];
  options: string[];
  selfAnswer: Answer;
  submittedAt: number;
}

export interface AuthoringDraft {
  title: string;
  tiers: string[];
  options: string[];
  placements: Array<number | null>;
  submitted: boolean;
  updatedAt: number;
}

export interface RoundState {
  draftsByPlayerId: Record<string, AuthoringDraft>;
  authoredListsByPlayerId: Record<string, AuthoredTierList>;
  answersByAuthorId: Record<string, Record<string, Answer>>;
  reviewOrder: string[];
  currentReviewIndex: number;
  awards?: AwardsPayload;
}

export interface Room {
  code: string;
  hostPlayerId: string;
  maxPlayers: number;
  phase: RoomPhase;
  players: Player[];
  round: RoundState | null;
  createdAt: number;
}

export interface PairScore {
  playerAId: string;
  playerAUsername: string;
  playerBId: string;
  playerBUsername: string;
  score: number;
}

export interface AwardsPayload {
  mostLikedTierList: {
    authorId: string;
    authorUsername: string;
    title: string;
    averageStars: number;
  } | null;
  mostControversialTierList: {
    authorId: string;
    authorUsername: string;
    title: string;
    score: number;
  } | null;
  mostAgreeableTierList: {
    authorId: string;
    authorUsername: string;
    title: string;
    score: number;
  } | null;
  mostAlignedPairs: PairScore[];
  mostDifferentPairs: PairScore[];
}

export interface SerializedPlayerSummary {
  id: string;
  username: string;
  isHost: boolean;
  connected: boolean;
  selfSubmitted: boolean;
  peerSubmittedCount: number;
  peerTotalCount: number;
}

export interface SerializedTierList {
  authorId: string;
  authorUsername: string;
  title: string;
  tiers: string[];
  options: string[];
}

export interface SerializedAnswerView {
  playerId: string;
  username: string;
  placements: Array<number | null>;
  starRating: number | null;
}

export interface SessionResponse {
  room: {
    code: string;
    maxPlayers: number;
    phase: RoomPhase;
    canStart: boolean;
    canAdvanceReview: boolean;
    hostConnected: boolean;
    joinAllowed: boolean;
  };
  currentPlayer: {
    id: string;
    username: string;
    isHost: boolean;
  };
  players: SerializedPlayerSummary[];
  view:
    | {
        kind: "lobby";
      }
    | {
        kind: "authoring";
        submitted: boolean;
        readyCount: number;
        totalCount: number;
        draft: AuthoringDraft;
      }
    | {
        kind: "peerAnswering";
        waiting: boolean;
        completedCount: number;
        totalCount: number;
        currentList: SerializedTierList | null;
        answer: Answer | null;
      }
    | {
        kind: "review";
        reviewIndex: number;
        totalReviews: number;
        currentList: SerializedTierList;
        answerOptions: SerializedAnswerView[];
        editablePlayerId: string;
      }
    | {
        kind: "awards";
        awards: AwardsPayload;
      };
}

export interface TierListInput {
  title: string;
  tiers: string[];
  options: string[];
  placements: Array<number | null>;
}

export interface AnswerInput {
  placements: Array<number | null>;
  starRating: number | null;
}

export interface RoomMutationResult {
  room: Room;
  playerToken?: string;
}
