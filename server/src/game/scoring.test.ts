import { describe, expect, test } from "vitest";
import { computeAwards } from "./scoring.js";
import type { Room } from "./types.js";

function createRoomForScoring(): Room {
  return {
    code: "TEST",
    hostPlayerId: "a",
    maxPlayers: 3,
    phase: "awards",
    createdAt: 0,
    players: [
      { id: "a", username: "Alex", isHost: true, connected: true, playerToken: "a-token", joinedAt: 1 },
      { id: "b", username: "Blair", isHost: false, connected: true, playerToken: "b-token", joinedAt: 2 },
      { id: "c", username: "Casey", isHost: false, connected: true, playerToken: "c-token", joinedAt: 3 }
    ],
    round: {
      draftsByPlayerId: {},
      reviewOrder: ["a", "b"],
      currentReviewIndex: 1,
      authoredListsByPlayerId: {
        a: {
          authorId: "a",
          title: "Alpha List",
          tiers: ["S", "A", "B"],
          options: ["One", "Two"],
          submittedAt: 1,
          selfAnswer: {
            playerId: "a",
            authorId: "a",
            placements: [0, 0],
            starRating: null,
            submitted: true,
            finalized: true,
            updatedAt: 1
          }
        },
        b: {
          authorId: "b",
          title: "Beta List",
          tiers: ["S", "A", "B"],
          options: ["Three", "Four"],
          submittedAt: 2,
          selfAnswer: {
            playerId: "b",
            authorId: "b",
            placements: [1, 1],
            starRating: null,
            submitted: true,
            finalized: true,
            updatedAt: 1
          }
        }
      },
      answersByAuthorId: {
        a: {
          a: {
            playerId: "a",
            authorId: "a",
            placements: [0, 0],
            starRating: 5,
            submitted: true,
            finalized: true,
            updatedAt: 1
          },
          b: {
            playerId: "b",
            authorId: "a",
            placements: [0, 1],
            starRating: 2,
            submitted: true,
            finalized: true,
            updatedAt: 1
          },
          c: {
            playerId: "c",
            authorId: "a",
            placements: [2, 1],
            starRating: 4,
            submitted: true,
            finalized: true,
            updatedAt: 1
          }
        },
        b: {
          a: {
            playerId: "a",
            authorId: "b",
            placements: [1, 1],
            starRating: 5,
            submitted: true,
            finalized: true,
            updatedAt: 1
          },
          b: {
            playerId: "b",
            authorId: "b",
            placements: [1, 1],
            starRating: 5,
            submitted: true,
            finalized: true,
            updatedAt: 1
          },
          c: {
            playerId: "c",
            authorId: "b",
            placements: [1, 1],
            starRating: 4,
            submitted: true,
            finalized: true,
            updatedAt: 1
          }
        }
      },
      awards: undefined
    }
  };
}

describe("computeAwards", () => {
  test("matches the intended disagreement and agreement math", () => {
    const awards = computeAwards(createRoomForScoring());

    expect(awards.mostLikedTierList).toEqual({
      authorId: "b",
      authorUsername: "Blair",
      title: "Beta List",
      averageStars: 4.5
    });

    expect(awards.mostControversialTierList?.authorId).toBe("a");
    expect(awards.mostControversialTierList?.title).toBe("Alpha List");
    expect(awards.mostControversialTierList?.score).toBeCloseTo(0.5, 6);

    expect(awards.mostAgreeableTierList?.authorId).toBe("b");
    expect(awards.mostAgreeableTierList?.score).toBeCloseTo(0, 6);

    expect(awards.mostAlignedPairs).toEqual([
      {
        playerAId: "a",
        playerAUsername: "Alex",
        playerBId: "b",
        playerBUsername: "Blair",
        score: 0.875
      },
      {
        playerAId: "b",
        playerAUsername: "Blair",
        playerBId: "c",
        playerBUsername: "Casey",
        score: 0.75
      },
      {
        playerAId: "a",
        playerAUsername: "Alex",
        playerBId: "c",
        playerBUsername: "Casey",
        score: 0.625
      }
    ]);

    expect(awards.mostDifferentPairs).toEqual([
      {
        playerAId: "a",
        playerAUsername: "Alex",
        playerBId: "c",
        playerBUsername: "Casey",
        score: 0.375
      },
      {
        playerAId: "b",
        playerAUsername: "Blair",
        playerBId: "c",
        playerBUsername: "Casey",
        score: 0.25
      },
      {
        playerAId: "a",
        playerAUsername: "Alex",
        playerBId: "b",
        playerBUsername: "Blair",
        score: 0.125
      }
    ]);
  });

  test("ignores an author's own star rating when picking most liked", () => {
    const room = createRoomForScoring();
    room.round!.answersByAuthorId.a.a.starRating = 5;
    room.round!.answersByAuthorId.a.b.starRating = 1;
    room.round!.answersByAuthorId.a.c.starRating = 1;
    room.round!.answersByAuthorId.b.a.starRating = 2;
    room.round!.answersByAuthorId.b.c.starRating = 2;

    const awards = computeAwards(room);
    expect(awards.mostLikedTierList?.authorId).toBe("b");
    expect(awards.mostLikedTierList?.averageStars).toBe(2);
  });
});
