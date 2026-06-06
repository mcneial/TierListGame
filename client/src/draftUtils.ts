import type { AuthoringDraft, TierListDraftPayload } from "./types";

export function createDefaultDraft(): AuthoringDraft {
  return {
    title: "",
    tiers: ["S", "A", "B", "C", "D", "F"],
    options: ["", "", "", "", "", ""],
    placements: [null, null, null, null, null, null],
    submitted: false,
    updatedAt: Date.now()
  };
}

export function normalizeDraft(draft: TierListDraftPayload): TierListDraftPayload {
  const options = draft.options.map((option) => option.trim()).filter((option) => option.length > 0);
  const placements = options.map((_, index) => draft.placements[index] ?? null);
  return {
    title: draft.title.trim(),
    tiers: draft.tiers.map((tier) => tier.trim()).filter((tier) => tier.length > 0),
    options,
    placements
  };
}

export function serializeDraftForAutosave(draft: TierListDraftPayload): TierListDraftPayload {
  const options = draft.options.map((option) => option.trim());
  return {
    title: draft.title.trim(),
    tiers: draft.tiers.map((tier) => tier.trim()),
    options,
    placements: ensurePlacementLength(draft.placements, options.length)
  };
}

export function ensurePlacementLength(placements: Array<number | null>, optionCount: number) {
  return Array.from({ length: optionCount }, (_, index) => placements[index] ?? null);
}
