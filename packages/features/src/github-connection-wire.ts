import { Schema as EffectSchema } from "effect";
import { githubConnectionSchema } from "./tasks-view.js";

export const githubConnectAnswerSchema = EffectSchema.Struct({ url: EffectSchema.String });

export type GitHubConnectAnswer = typeof githubConnectAnswerSchema.Type;

export const githubConnectionAnswerSchema = githubConnectionSchema;

export type GitHubConnection = typeof githubConnectionAnswerSchema.Type;

export const GITHUB_CONNECT_PAGE = {
  PATH: "/connect-github",
  INTENT_PARAM: "intent",
  DONE_PARAM: "done",
  ERROR_PARAM: "error",
  FLAG: "1",
} as const;

export const githubConnectClaimRequestSchema = EffectSchema.Struct({
  intent: EffectSchema.String.check(EffectSchema.isNonEmpty()),
});

export const GITHUB_CONNECT_CLAIM = {
  CLAIMED: "claimed",
  OTHER_ACCOUNT: "other-account",
  EXPIRED: "expired",
} as const;

export type GitHubConnectClaim = (typeof GITHUB_CONNECT_CLAIM)[keyof typeof GITHUB_CONNECT_CLAIM];

export const githubConnectClaimAnswerSchema = EffectSchema.Struct({
  claim: EffectSchema.Literals(Object.values(GITHUB_CONNECT_CLAIM)),
});
