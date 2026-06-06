import { z } from "zod";
import {
  DEFAULT_TIERS,
  MAX_OPTION_TEXT_LENGTH,
  MAX_OPTIONS,
  MAX_ROOM_PLAYERS,
  MAX_TIER_LIST_TITLE_LENGTH,
  MAX_TIER_NAME_LENGTH,
  MAX_TIERS,
  MAX_USERNAME_LENGTH,
  MIN_ROOM_PLAYERS,
  MIN_TIERS
} from "./types.js";

const trimmedString = (maxLength: number, label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(maxLength, `${label} must be ${maxLength} characters or fewer.`);

export const hostAuthorizationSchema = z.object({
  password: z.string().min(1, "Password is required.")
});

export const createRoomSchema = z.object({
  username: trimmedString(MAX_USERNAME_LENGTH, "Username"),
  maxPlayers: z
    .number()
    .int()
    .min(MIN_ROOM_PLAYERS, `Player count must be at least ${MIN_ROOM_PLAYERS}.`)
    .max(MAX_ROOM_PLAYERS, `Player count must be ${MAX_ROOM_PLAYERS} or fewer.`)
});

export const joinRoomSchema = z.object({
  username: trimmedString(MAX_USERNAME_LENGTH, "Username")
});

export const tierListSchema = z
  .object({
    title: trimmedString(MAX_TIER_LIST_TITLE_LENGTH, "Tier list title"),
    tiers: z.array(trimmedString(MAX_TIER_NAME_LENGTH, "Tier name")).min(MIN_TIERS).max(MAX_TIERS),
    options: z
      .array(trimmedString(MAX_OPTION_TEXT_LENGTH, "Option"))
      .min(1)
      .max(MAX_OPTIONS),
    placements: z.array(z.number().int().min(0).max(MAX_TIERS - 1).nullable())
  })
  .superRefine((value, ctx) => {
    if (value.options.length < value.tiers.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `You need at least ${value.tiers.length} options for ${value.tiers.length} tiers.`,
        path: ["options"]
      });
    }

    if (value.placements.length !== value.options.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Placements must line up with the option list.",
        path: ["placements"]
      });
    }

    if (new Set(value.tiers.map((tier) => tier.toLowerCase())).size !== value.tiers.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Tier names must be unique.",
        path: ["tiers"]
      });
    }
  });

export const tierListDraftSchema = z
  .object({
    title: z.string().trim().max(MAX_TIER_LIST_TITLE_LENGTH),
    tiers: z.array(z.string().trim().max(MAX_TIER_NAME_LENGTH)).min(MIN_TIERS).max(MAX_TIERS),
    options: z.array(z.string().trim().max(MAX_OPTION_TEXT_LENGTH)).max(MAX_OPTIONS),
    placements: z.array(z.number().int().min(0).max(MAX_TIERS - 1).nullable())
  })
  .superRefine((value, ctx) => {
    if (value.placements.length !== value.options.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Placements must line up with the option list.",
        path: ["placements"]
      });
    }
  });

export const answerSchema = z.object({
  placements: z.array(z.number().int().min(0).max(MAX_TIERS - 1).nullable()),
  starRating: z.number().int().min(1).max(5).nullable()
});

export function createInitialDraft() {
  const tiers = [...DEFAULT_TIERS];
  return {
    title: "",
    tiers,
    options: ["", "", "", "", "", ""],
    placements: Array(tiers.length).fill(null),
    submitted: false,
    updatedAt: Date.now()
  };
}
