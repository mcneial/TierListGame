export type RoomPhase = "lobby" | "authoring" | "peerAnswering" | "review" | "awards";

export interface PlayerSummary {
  id: string;
  username: string;
  isHost: boolean;
  connected: boolean;
  selfSubmitted: boolean;
  peerSubmittedCount: number;
  peerTotalCount: number;
}

export interface AuthoringDraft {
  title: string;
  tiers: string[];
  options: string[];
  placements: Array<number | null>;
  submitted: boolean;
  updatedAt: number;
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

export interface TierListSummary {
  authorId: string;
  authorUsername: string;
  title: string;
  tiers: string[];
  options: string[];
}

export interface AnswerView {
  playerId: string;
  username: string;
  placements: Array<number | null>;
  starRating: number | null;
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
  mostAlignedPairs: Array<{
    playerAId: string;
    playerAUsername: string;
    playerBId: string;
    playerBUsername: string;
    score: number;
  }>;
  mostDifferentPairs: Array<{
    playerAId: string;
    playerAUsername: string;
    playerBId: string;
    playerBUsername: string;
    score: number;
  }>;
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
  players: PlayerSummary[];
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
        currentList: TierListSummary | null;
        answer: Answer | null;
      }
    | {
        kind: "review";
        reviewIndex: number;
        totalReviews: number;
        currentList: TierListSummary;
        answerOptions: AnswerView[];
        editablePlayerId: string;
      }
    | {
        kind: "awards";
        awards: AwardsPayload;
      };
}

export interface StoredSession {
  roomCode: string;
  playerToken: string;
}

export interface TierListDraftPayload {
  title: string;
  tiers: string[];
  options: string[];
  placements: Array<number | null>;
}
