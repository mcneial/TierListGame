import type { Answer, AwardsPayload, PairScore, Player, Room } from "./types.js";

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

function pairwiseAverage(scores: number[]) {
  return scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0;
}

function comparePairScoresDescending(a: PairScore, b: PairScore) {
  if (b.score !== a.score) {
    return b.score - a.score;
  }
  return `${a.playerAUsername}-${a.playerBUsername}`.localeCompare(`${b.playerAUsername}-${b.playerBUsername}`);
}

function comparePairScoresAscending(a: PairScore, b: PairScore) {
  if (a.score !== b.score) {
    return a.score - b.score;
  }
  return `${a.playerAUsername}-${a.playerBUsername}`.localeCompare(`${b.playerAUsername}-${b.playerBUsername}`);
}

export function computeAwards(room: Room): AwardsPayload {
  if (!room.round) {
    throw new Error("Cannot compute awards without an active round.");
  }

  const playersById = new Map(room.players.map((player) => [player.id, player]));
  const listEntries = Object.values(room.round.authoredListsByPlayerId);

  const likedCandidates = listEntries.map((list) => {
    const answers = Object.values(room.round!.answersByAuthorId[list.authorId]).filter(
      (answer) => answer.playerId !== list.authorId && answer.starRating !== null
    );
    const score = average(answers.map((answer) => answer.starRating ?? 0));
    const author = playersById.get(list.authorId)!;
    return {
      authorId: author.id,
      authorUsername: author.username,
      title: list.title,
      averageStars: score
    };
  });

  const controversyCandidates = listEntries.map((list) => {
    const answers = Object.values(room.round!.answersByAuthorId[list.authorId]);
    const optionDisagreement: number[] = [];

    for (let optionIndex = 0; optionIndex < list.options.length; optionIndex += 1) {
      const distances: number[] = [];
      for (let i = 0; i < answers.length; i += 1) {
        for (let j = i + 1; j < answers.length; j += 1) {
          const firstPlacement = answers[i].placements[optionIndex];
          const secondPlacement = answers[j].placements[optionIndex];
          if (firstPlacement === null || secondPlacement === null) {
            continue;
          }
          distances.push(normalizedPlacementDistance(firstPlacement, secondPlacement, list.tiers.length));
        }
      }
      optionDisagreement.push(pairwiseAverage(distances));
    }

    const score = average(optionDisagreement);
    const author = playersById.get(list.authorId)!;
    return {
      authorId: author.id,
      authorUsername: author.username,
      title: list.title,
      score
    };
  });

  const finalAnswers: Answer[] = [];
  for (const answersByPlayer of Object.values(room.round.answersByAuthorId)) {
    finalAnswers.push(...Object.values(answersByPlayer));
  }

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

  const agreeable = [...controversyCandidates].sort((a, b) => {
    if (a.score !== b.score) {
      return a.score - b.score;
    }
    return `${a.authorUsername}-${a.title}`.localeCompare(`${b.authorUsername}-${b.title}`);
  })[0] ?? null;

  return {
    mostLikedTierList: likedCandidates.sort(byStarsThenTitle)[0] ?? null,
    mostControversialTierList: controversyCandidates.sort(byStarsThenTitle)[0] ?? null,
    mostAgreeableTierList: agreeable,
    mostAlignedPairs,
    mostDifferentPairs
  };
}
