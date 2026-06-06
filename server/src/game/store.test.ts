import { describe, expect, test } from "vitest";
import { InMemoryGameStore } from "./store.js";

function createStartedRoom() {
  const store = new InMemoryGameStore();
  const host = store.createRoom("Host", 3);
  const second = store.joinRoom(host.room.code, "Blair");
  const third = store.joinRoom(host.room.code, "Casey");
  store.startGame(host.room.code, host.playerToken!);
  return { store, host, second, third };
}

describe("InMemoryGameStore", () => {
  test("requires host auth separately but creates room codes without ambiguous characters", () => {
    const store = new InMemoryGameStore();
    const result = store.createRoom("Host", 4);
    expect(result.room.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/);
  });

  test("moves from authoring to peer answering once all self lists are submitted", () => {
    const { store, host, second, third } = createStartedRoom();
    const payload = {
      title: "Snacks",
      tiers: ["S", "A", "B"],
      options: ["Chips", "Pretzels", "Popcorn"],
      placements: [0, 1, 2]
    };

    store.saveOwnList(host.room.code, host.playerToken!, payload, true);
    store.saveOwnList(host.room.code, second.playerToken!, { ...payload, title: "Movies" }, true);
    const room = store.saveOwnList(host.room.code, third.playerToken!, { ...payload, title: "Songs" }, true);

    expect(room.phase).toBe("peerAnswering");
  });

  test("saves partial authoring drafts before submission", () => {
    const { store, host } = createStartedRoom();
    const room = store.saveOwnList(
      host.room.code,
      host.playerToken!,
      {
        title: "Half-finished list",
        tiers: ["S", "A", "B"],
        options: ["One", "", ""],
        placements: [0, null, null]
      },
      false
    );

    expect(room.round?.draftsByPlayerId[room.hostPlayerId].title).toBe("Half-finished list");
    expect(room.phase).toBe("authoring");
  });

  test("supports rejoining a disconnected player by username", () => {
    const store = new InMemoryGameStore();
    const host = store.createRoom("Host", 4);
    const join = store.joinRoom(host.room.code, "Alex");
    const room = store.subscribePlayer(host.room.code, join.playerToken!, "socket-1");
    expect(room.players.find((player) => player.username === "Alex")?.connected).toBe(true);

    store.disconnectSocket("socket-1");
    const rejoin = store.rejoinRoom(host.room.code, "Alex");
    expect(rejoin.playerToken).toBeTruthy();
    expect(rejoin.room.players.find((player) => player.username === "Alex")?.connected).toBe(true);
  });

  test("computes awards after the review phase finishes", () => {
    const { store, host, second, third } = createStartedRoom();
    const payload = {
      title: "Snacks",
      tiers: ["S", "A", "B"],
      options: ["Chips", "Pretzels", "Popcorn"],
      placements: [0, 1, 2]
    };

    store.saveOwnList(host.room.code, host.playerToken!, payload, true);
    store.saveOwnList(host.room.code, second.playerToken!, { ...payload, title: "Movies" }, true);
    store.saveOwnList(host.room.code, third.playerToken!, { ...payload, title: "Games" }, true);

    for (const [playerToken, authorId, placements, stars] of [
      [host.playerToken!, second.room.players[1].id, [0, 1, 2], 4],
      [host.playerToken!, third.room.players[2].id, [0, 1, 2], 5],
      [second.playerToken!, host.room.players[0].id, [0, 1, 2], 3],
      [second.playerToken!, third.room.players[2].id, [0, 1, 2], 5],
      [third.playerToken!, host.room.players[0].id, [0, 1, 2], 5],
      [third.playerToken!, second.room.players[1].id, [0, 1, 2], 4]
    ] as const) {
      store.savePeerAnswer(host.room.code, playerToken, authorId, { placements, starRating: stars }, true);
    }

    for (let index = 0; index < 3; index += 1) {
      const currentSession = store.getSession(host.room.code, host.playerToken!);
      if (currentSession.view.kind !== "review") {
        throw new Error("Expected review phase.");
      }
      const currentAuthorId = currentSession.view.currentList.authorId;

      store.saveReviewAnswer(host.room.code, host.playerToken!, {
        placements: [0, 1, 2],
        starRating: host.room.players[0].id === currentAuthorId ? null : 4
      });
      store.saveReviewAnswer(host.room.code, second.playerToken!, {
        placements: [0, 1, 2],
        starRating: second.room.players[1].id === currentAuthorId ? null : 4
      });
      store.saveReviewAnswer(host.room.code, third.playerToken!, {
        placements: [0, 1, 2],
        starRating: third.room.players[2].id === currentAuthorId ? null : 5
      });
      store.advanceReview(host.room.code, host.playerToken!);
    }

    const session = store.getSession(host.room.code, host.playerToken!);
    expect(session.view.kind).toBe("awards");
    if (session.view.kind === "awards") {
      expect(session.view.awards.mostLikedTierList).not.toBeNull();
    }
  });
});
