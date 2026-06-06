import { ensurePlacementLength, normalizeDraft } from "./draftUtils";

describe("draftUtils", () => {
  test("normalizes blank options away and matches placements", () => {
    const result = normalizeDraft({
      title: " Snacks ",
      tiers: [" S ", "A"],
      options: [" Chips ", "", " Popcorn "],
      placements: [0, 1, 1]
    });

    expect(result).toEqual({
      title: "Snacks",
      tiers: ["S", "A"],
      options: ["Chips", "Popcorn"],
      placements: [0, 1]
    });
  });

  test("extends placement arrays with null values", () => {
    expect(ensurePlacementLength([0], 3)).toEqual([0, null, null]);
  });
});
