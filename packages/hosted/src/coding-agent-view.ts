import { Schema as EffectSchema } from "effect";
import {
  codingAgentMessagesAnswerSchema,
  codingAgentStartRequestSchema,
  codingAgentSummarySchema,
} from "./coding-agent-wire.js";
import { catalogModelSchema, modelChoiceSchema } from "./models-wire.js";

/**
 * coding-agent-view.ts -- a plan's coding agents as one Mac's window hears them: each call's answer whole, or why there is none.
 *
 * The host asks the service for these on the window's behalf and answers
 * the window one of the shapes here, so a window draws an answer or draws
 * why, and nothing the service said beyond that reaches it. The failures
 * are the few a window can act on: the service never answered, the plan or
 * the agent is gone, the plan names no repository yet, the App does not
 * reach it, the account must sign in with GitHub again, or the choice named
 * is not one the service offers.
 */

/** Why a coding-agent call answered nothing a window can draw. */
export const CODING_AGENT_CALL_FAILURE = {
  /** The call never reached an answer: no credential, the network, a refusal, a shape not read. */
  UNANSWERED: "unanswered",
  /** The plan or the agent is not one the account holds: deleted, or never the caller's. */
  NOT_FOUND: "not-found",
  /** The plan names no repository, so there is nothing for an agent to check out. */
  NO_REPOSITORY: "no-repository",
  /** The plan's repository is not one the Luke GitHub App reaches for the account. */
  REPOSITORY_NOT_REACHABLE: "repository-not-reachable",
  /** The account must sign in with GitHub again before the service can read GitHub for it. */
  GITHUB_SIGN_IN_REQUIRED: "github-sign-in-required",
  /** The model or effort named is not one the service offers now. */
  INVALID_CHOICE: "invalid-choice",
} as const;

export type CodingAgentCallFailure =
  (typeof CODING_AGENT_CALL_FAILURE)[keyof typeof CODING_AGENT_CALL_FAILURE];

const failureSchema = EffectSchema.Literals(Object.values(CODING_AGENT_CALL_FAILURE));

/** A failed call, as every answer below spells one. */
const failed = EffectSchema.Struct({ failure: failureSchema });

/** The models the service offers, as the window hears them: the list, or why there is none. */
export const codingAgentModelsAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ models: EffectSchema.Array(catalogModelSchema) }),
  failed,
]);

export type CodingAgentModelsAnswer = typeof codingAgentModelsAnswerSchema.Type;

/** The account's default model and effort, as the window hears them read or written: the choice as kept, or why there is none. */
export const codingAgentDefaultAnswerViewSchema = EffectSchema.Union([
  EffectSchema.Struct({ choice: modelChoiceSchema }),
  failed,
]);

export type CodingAgentDefaultAnswer = typeof codingAgentDefaultAnswerViewSchema.Type;

/** Writing the default, as the window asks it: the choice to keep. */
export const codingAgentDefaultWriteParamsSchema = modelChoiceSchema;

/** One plan's agents, as the window asks them: the plan. */
export const codingAgentListParamsSchema = EffectSchema.Struct({
  planId: EffectSchema.NonEmptyString,
});

export type CodingAgentListParams = typeof codingAgentListParamsSchema.Type;

/** One plan's agents, as the window hears them: each with its status, in the order started, or why there is no list. */
export const codingAgentListAnswerViewSchema = EffectSchema.Union([
  EffectSchema.Struct({ agents: EffectSchema.Array(codingAgentSummarySchema) }),
  failed,
]);

export type CodingAgentListAnswer = typeof codingAgentListAnswerViewSchema.Type;

/** Starting an agent, as the window asks it: the plan, and the Start request the service takes. */
export const codingAgentStartParamsSchema = EffectSchema.Struct({
  planId: EffectSchema.NonEmptyString,
  ...codingAgentStartRequestSchema.fields,
});

export type CodingAgentStartParams = typeof codingAgentStartParamsSchema.Type;

/** An agent started or stopped, as the window hears it: the agent as it then stands, or why it was not. */
export const codingAgentAgentAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ agent: codingAgentSummarySchema }),
  failed,
]);

export type CodingAgentAgentAnswer = typeof codingAgentAgentAnswerSchema.Type;

/** One agent's transcript past a cursor, as the window asks it: the agent, and where the window stands. */
export const codingAgentMessagesParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  after: EffectSchema.NonEmptyString,
});

export type CodingAgentMessagesParams = typeof codingAgentMessagesParamsSchema.Type;

/** The transcript past the cursor, as the window hears it: the page and the cursor to read on from, or why there is none. */
export const codingAgentMessagesAnswerViewSchema = EffectSchema.Union([
  codingAgentMessagesAnswerSchema,
  failed,
]);

export type CodingAgentMessagesAnswerView = typeof codingAgentMessagesAnswerViewSchema.Type;

/** One agent, as the window names it to stop. */
export const codingAgentStopParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
});

export type CodingAgentStopParams = typeof codingAgentStopParamsSchema.Type;
