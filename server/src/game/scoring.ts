import type { AwardsPayload, PairScore, Room } from "./types.js";

function normalizedPlacementDistance(a: number, b: number, tierCount: number) {
  if (tierCount <= 1) {
    return 0;
  }
  return Math.abs(a - b) / (tierCount - 1);
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function comparePairScoresDescending(a: PairScore, b: PairScore) {
  if (b.score !== a.score) {
    return b.score - a.score;
  }
  return `${a.playerAUsername}-${a.playerBUsername}`.localeCompare(`${b.playerAUsername}-${b.playerBUsername}`);
}

function getAverageReceivedStars(room: Room, authorId: string) {
  const answers = Object.values(room.round!.answersByAuthorId[authorId]).filter(
    (answer) => answer.playerId !== authorId && answer.starRating !== null
  );
  return average(answers.map((answer) => answer.starRating ?? 0));
}

function getTierListDisagreementScore(room: Room, authorId: string) {
  const authoredList = room.round!.authoredListsByPlayerId[authorId];
  const answers = Object.values(room.round!.answersByAuthorId[authorId]);
  const distances: number[] = [];

  for (let optionIndex = 0; optionIndex < authoredList.options.length; optionIndex += 1) {
    for (let i = 0; i < answers.length; i += 1) {
      for (let j = i + 1; j < answers.length; j += 1) {
        const firstPlacement = answers[i].placements[optionIndex];
        const secondPlacement = answers[j].placements[optionIndex];
        if (firstPlacement === null || secondPlacement === null) {
          continue;
        }
        distances.push(normalizedPlacementDistance(firstPlacement, secondPlacement, authoredList.tiers.length));
      }
    }
  }

  return average(distances);
}

export function computeAwards(room: Room): AwardsPayload {
  if (!room.round) {
    throw new Error("Cannot compute awards without an active round.");
  }

  const playersById = new Map(room.players.map((player) => [player.id, player]));
  const listEntries = Object.values(room.round.authoredListsByPlayerId);

  const likedCandidates = listEntries.map((list) => {
    const author = playersById.get(list.authorId)!;
    return {
      authorId: author.id,
      authorUsername: author.username,
      title: list.title,
      averageStars: getAverageReceivedStars(room, list.authorId)
    };
  });

  const controversyCandidates = listEntries.map((list) => {
    const author = playersById.get(list.authorId)!;
    return {
      authorId: author.id,
      authorUsername: author.username,
      title: list.title,
      score: getTierListDisagreementScore(room, list.authorId),
      averageStars: getAverageReceivedStars(room, list.authorId)
    };
  });

  const pairDifferences: PairScore[] = [];
  for (let i = 0; i < room.players.length; i += 1) {
    for (let j = i + 1; j < room.players.length; j += 1) {
      const playerA = room.players[i];
      const playerB = room.players[j];
      const distances: number[] = [];

      for (const list of listEntries) {
        const answerA = room.round.answersByAuthorId[list.authorId]?.[playerA.id];
        const answerB = room.round.answersByAuthorId[list.authorId]?.[playerB.id];
        if (!answerA || !answerB) {
          continue;
        }

        for (let index = 0; index < list.options.length; index += 1) {
          const placementA = answerA.placements[index];
          const placementB = answerB.placements[index];
          if (placementA === null || placementB === null) {
            continue;
          }
          distances.push(normalizedPlacementDistance(placementA, placementB, list.tiers.length));
        }
      }

      pairDifferences.push({
        playerAId: playerA.id,
        playerAUsername: playerA.username,
        playerBId: playerB.id,
        playerBUsername: playerB.username,
        score: average(distances)
      });
    }
  }

  const mostDifferentPairs = [...pairDifferences].sort(comparePairScoresDescending).slice(0, 5);
  const mostAlignedPairs = [...pairDifferences]
    .map((pair) => ({
      ...pair,
      score: 1 - pair.score
    }))
    .sort(comparePairScoresDescending)
    .slice(0, 5);

  const byStarsThenTitle = (
    a: { averageStars?: number; title: string; score?: number; authorUsername: string },
    b: { averageStars?: number; title: string; score?: number; authorUsername: string }
  ) => {
    if ((b.averageStars ?? b.score ?? 0) !== (a.averageStars ?? a.score ?? 0)) {
      return (b.averageStars ?? b.score ?? 0) - (a.averageStars ?? a.score ?? 0);
    }
    return `${a.authorUsername}-${a.title}`.localeCompare(`${b.authorUsername}-${b.title}`);
  };

  const controversySorter = (
    a: { score: number; averageStars: number; title: string; authorUsername: string },
    b: { score: number; averageStars: number; title: string; authorUsername: string }
  ) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    if (b.averageStars !== a.averageStars) {
      return b.averageStars - a.averageStars;
    }
    return `${a.authorUsername}-${a.title}`.localeCompare(`${b.authorUsername}-${b.title}`);
  };

  const agreeableSorter = (
    a: { score: number; averageStars: number; title: string; authorUsername: string },
    b: { score: number; averageStars: number; title: string; authorUsername: string }
  ) => {
    if (a.score !== b.score) {
      return a.score - b.score;
    }
    if (b.averageStars !== a.averageStars) {
      return b.averageStars - a.averageStars;
    }
    return `${a.authorUsername}-${a.title}`.localeCompare(`${b.authorUsername}-${b.title}`);
  };

  const mostControversialTierList = [...controversyCandidates].sort(controversySorter)[0] ?? null;
  const agreeable = [...controversyCandidates].sort(agreeableSorter)[0] ?? null;

  return {
    mostLikedTierList: likedCandidates.sort(byStarsThenTitle)[0] ?? null,
    mostControversialTierList: mostControversialTierList
      ? {
          authorId: mostControversialTierList.authorId,
          authorUsername: mostControversialTierList.authorUsername,
          title: mostControversialTierList.title,
          score: mostControversialTierList.score
        }
      : null,
    mostAgreeableTierList: agreeable,
    mostAlignedPairs,
    mostDifferentPairs
  };
}
