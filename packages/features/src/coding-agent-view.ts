import { Schema as EffectSchema } from "effect";
import { accountInboxAnswerSchema } from "./account-inbox-wire.js";
import {
  codingAgentArchiveRequestSchema,
  codingAgentCallIdSchema,
  codingAgentChangesAnswerSchema,
  codingAgentMessageRequestSchema,
  codingAgentMessagesAnswerSchema,
  codingAgentOverviewAnswerSchema,
  codingAgentPageAnswerSchema,
  codingAgentPinRequestSchema,
  codingAgentPullRequestAnswerSchema,
  codingAgentRenameRequestSchema,
  codingAgentServersRequestSchema,
  codingAgentStartRequestFields,
  codingAgentSummarySchema,
} from "./coding-agent-wire.js";
import { dictationAnswerSchema, dictationRequestSchema } from "./dictation-wire.js";
import {
  inboxAnsweredSchema,
  inboxAnswerRequestSchema,
  inboxAnswerSchema,
  inboxImageTypeSchema,
} from "./inbox-wire.js";
import { catalogModelSchema, modelChoiceSchema } from "./models-wire.js";
import {
  planTemplateAnswerSchema,
  planTemplateRevisionAnswerSchema,
  planTemplateRevisionsAnswerSchema,
  planTemplateWriteRequestSchema,
} from "./plan-document-template.js";
import { planRevisionSeqSchema } from "./plan-wire.js";
import {
  PROVIDER_KEY_PROVIDER,
  providerKeySaveRequestSchema,
  providerKeysAnswerSchema,
} from "./provider-key-wire.js";
import { repositoryUnreachedSchema } from "./repository-reach-wire.js";

/**
 * coding-agent-view.ts -- a plan's coding agents as one Mac's window hears them: each call's answer whole, or why there is none.
 *
 * The host asks the service for these on the window's behalf and answers
 * the window one of the shapes here, so a window draws an answer or draws
 * why, and nothing the service said beyond that reaches it. The failures
 * are the few a window can act on: the service never answered, the plan or
 * the agent is gone, the plan names no repository yet, the App does not
 * reach it, the choice named is
 * not one the service offers now, or — for a message, and for an answer to
 * the plan's inbox, which may reach the agent as one — the words run past
 * the bound, the agent's session is still coming up, or it has ended for
 * good.
 *
 * The account's own provider keys travel here too, since they are what an
 * agent runs on: the keys as hints and statuses, a save, and a removal. A
 * save's params carry the key once, into the host and on to the service;
 * no answer here carries one.
 *
 * A clip dictated into an agent's message box travels here too, since the
 * box is an agent's: the clip and its words to listen for, and the text
 * back, or why there is none.
 *
 * The account's plan template travels here too, since it is the account's
 * own on the service as the default and the keys are, and Settings asks for
 * all three the same way: the template read, and one kept or reset.
 */

/** Why a coding-agent call answered nothing a window can draw. */
export const CODING_AGENT_CALL_FAILURE = {
  /** The call never reached an answer: no credential, the network, a refusal, a shape not read. */
  UNANSWERED: "unanswered",
  /** The plan or the agent is not one the account holds: deleted, or never the caller's. */
  NOT_FOUND: "not-found",
  /** The plan names no repository, so there is nothing for an agent to check out. */
  NO_REPOSITORY: "no-repository",
  /** The plan's workspace's GitHub installation does not reach the plan's repository; why travels beside it where the service said. */
  REPOSITORY_NOT_REACHABLE: "repository-not-reachable",
  /** GitHub did not answer whether the workspace reaches the repository; the same call a moment later may be taken. */
  GITHUB_UNANSWERED: "github-unanswered",
  /** The model or effort named is not one the service offers now. */
  INVALID_CHOICE: "invalid-choice",
  /** The message spells more characters than one message to an agent may; shortened, it is taken. */
  MESSAGE_TOO_LONG: "message-too-long",
  /** The agent's session is still coming up and could not take the message yet; the same message a moment later is taken. */
  AGENT_NOT_READY: "agent-not-ready",
  /** The agent's session has ended for good, so no message reaches it; only a new agent goes on from here. */
  AGENT_RETIRED: "agent-retired",
  /** The plan is archived, so no agent starts on it and none of its agents is sent a message until it is brought back. */
  PLAN_ARCHIVED: "plan-archived",
} as const;

export type CodingAgentCallFailure =
  (typeof CODING_AGENT_CALL_FAILURE)[keyof typeof CODING_AGENT_CALL_FAILURE];

const failureSchema = EffectSchema.Literals(Object.values(CODING_AGENT_CALL_FAILURE));

/** A failed call, as every answer below spells one. */
const failed = EffectSchema.Struct({ failure: failureSchema });

/** A failed start or message, with why the repository is out of reach where it is and the service said (`repository-reach-wire.ts`). */
const failedReaching = EffectSchema.Struct({
  failure: failureSchema,
  unreached: EffectSchema.optionalKey(repositoryUnreachedSchema),
});

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

/** The account's own provider keys, as the window hears them read, saved, or removed: the keys as they stand, or why there are none. */
export const providerKeysAnswerViewSchema = EffectSchema.Union([providerKeysAnswerSchema, failed]);

export type ProviderKeysAnswerView = typeof providerKeysAnswerViewSchema.Type;

/** Saving a key, as the window asks it: the provider and the key, once. */
export const providerKeySaveParamsSchema = providerKeySaveRequestSchema;

export type ProviderKeySaveParams = typeof providerKeySaveParamsSchema.Type;

/** Removing a key, as the window asks it: the provider. */
export const providerKeyRemoveParamsSchema = EffectSchema.Struct({
  provider: EffectSchema.Literals(Object.values(PROVIDER_KEY_PROVIDER)),
});

export type ProviderKeyRemoveParams = typeof providerKeyRemoveParamsSchema.Type;

/** The account's plan template, as the window hears it read or written: the template as kept and whether the account wrote it, or why there is none. */
export const planTemplateAnswerViewSchema = EffectSchema.Union([planTemplateAnswerSchema, failed]);

export type PlanTemplateAnswerView = typeof planTemplateAnswerViewSchema.Type;

/** Writing the template, as the window asks it: the text to keep verbatim, or null for the default. */
export const planTemplateWriteParamsSchema = planTemplateWriteRequestSchema;

export type PlanTemplateWriteParams = typeof planTemplateWriteParamsSchema.Type;

/** A page of the template's history, as the window asks it: the newest, or the one before a revision. */
export const planTemplateRevisionsParamsSchema = EffectSchema.Struct({
  before: EffectSchema.optionalKey(planRevisionSeqSchema),
});

export type PlanTemplateRevisionsParams = typeof planTemplateRevisionsParamsSchema.Type;

/** A page of the template's history, as the window hears it read: the page, or why there is none. */
export const planTemplateRevisionsAnswerViewSchema = EffectSchema.Union([
  planTemplateRevisionsAnswerSchema,
  failed,
]);

export type PlanTemplateRevisionsAnswerView = typeof planTemplateRevisionsAnswerViewSchema.Type;

/** One revision of the template, as the window asks it read or restored: its number. */
export const planTemplateRevisionParamsSchema = EffectSchema.Struct({ seq: planRevisionSeqSchema });

export type PlanTemplateRevisionParams = typeof planTemplateRevisionParamsSchema.Type;

/** One revision of the template, as the window hears it read: the revision beside the one before it, or why there is none. */
export const planTemplateRevisionAnswerViewSchema = EffectSchema.Union([
  planTemplateRevisionAnswerSchema,
  failed,
]);

export type PlanTemplateRevisionAnswerView = typeof planTemplateRevisionAnswerViewSchema.Type;

/** Writing the default, as the window asks it: the choice to keep. */
export const codingAgentDefaultWriteParamsSchema = modelChoiceSchema;

/** One plan's agents, as the window asks them: the plan, and whether the archived agents are listed among the rest. */
export const codingAgentListParamsSchema = EffectSchema.Struct({
  planId: EffectSchema.NonEmptyString,
  includeArchived: EffectSchema.optionalKey(EffectSchema.Boolean),
});

export type CodingAgentListParams = typeof codingAgentListParamsSchema.Type;

/** A workspace's agents asked for, narrowed to one repository where one is named: what an automation's Same agent is chosen from. */
export const codingAgentWorkspaceListParamsSchema = EffectSchema.Struct({
  workspaceId: EffectSchema.NonEmptyString,
  repository: EffectSchema.optionalKey(EffectSchema.NonEmptyString),
});

export type CodingAgentWorkspaceListParams = typeof codingAgentWorkspaceListParamsSchema.Type;

/** One plan's agents, as the window hears them: each with its status, in the order started, or why there is no list. */
export const codingAgentListAnswerViewSchema = EffectSchema.Union([
  EffectSchema.Struct({ agents: EffectSchema.Array(codingAgentSummarySchema) }),
  failed,
]);

export type CodingAgentListAnswer = typeof codingAgentListAnswerViewSchema.Type;

/** Starting an agent, as the window asks it: the plan, and the Start request the service takes. */
export const codingAgentStartParamsSchema = EffectSchema.Struct({
  planId: EffectSchema.NonEmptyString,
  ...codingAgentStartRequestFields,
});

export type CodingAgentStartParams = typeof codingAgentStartParamsSchema.Type;

/** An agent started, messaged, or stopped, as the window hears it: the agent as it then stands, or why it was not. */
export const codingAgentAgentAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ agent: codingAgentSummarySchema }),
  failedReaching,
]);

export type CodingAgentAgentAnswer = typeof codingAgentAgentAnswerSchema.Type;

/** One agent's transcript past a cursor, as the window asks it: the agent, and where the window stands; or, naming the delegation call that started one, a worker's transcript under the agent. */
export const codingAgentMessagesParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  after: EffectSchema.NonEmptyString,
  callId: EffectSchema.optionalKey(codingAgentCallIdSchema),
});

export type CodingAgentMessagesParams = typeof codingAgentMessagesParamsSchema.Type;

/** The transcript past the cursor, as the window hears it: the page and the cursor to read on from, or why there is none. */
export const codingAgentMessagesAnswerViewSchema = EffectSchema.Union([
  codingAgentMessagesAnswerSchema,
  failed,
]);

export type CodingAgentMessagesAnswerView = typeof codingAgentMessagesAnswerViewSchema.Type;

/** Messaging an agent, as the window asks it: the agent, and the message request the service takes, its key the window's own. */
export const codingAgentMessageParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  ...codingAgentMessageRequestSchema.fields,
});

export type CodingAgentMessageParams = typeof codingAgentMessageParamsSchema.Type;

/** One agent's model and effort changed for its next step, as the window asks it: the agent and the choice. */
export const codingAgentChooseParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  ...modelChoiceSchema.fields,
});

export type CodingAgentChooseParams = typeof codingAgentChooseParamsSchema.Type;

/** One agent renamed, as the window asks it: the agent and the title, empty to clear it. */
export const codingAgentRenameParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  ...codingAgentRenameRequestSchema.fields,
});

export type CodingAgentRenameParams = typeof codingAgentRenameParamsSchema.Type;

/** One agent's MCP servers switched, as the window asks it: the agent and the whole list of those off. */
export const codingAgentServersParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  ...codingAgentServersRequestSchema.fields,
});

export type CodingAgentServersParams = typeof codingAgentServersParamsSchema.Type;

/** One agent archived or brought back, as the window asks it: the agent and which. */
export const codingAgentArchiveParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  ...codingAgentArchiveRequestSchema.fields,
});

export type CodingAgentArchiveParams = typeof codingAgentArchiveParamsSchema.Type;

/** One agent pinned or unpinned, as the window asks it: the agent and which. */
export const codingAgentPinParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  ...codingAgentPinRequestSchema.fields,
});

export type CodingAgentPinParams = typeof codingAgentPinParamsSchema.Type;

/** One agent, as the window names it to stop. */
export const codingAgentStopParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
});

export type CodingAgentStopParams = typeof codingAgentStopParamsSchema.Type;

/** One agent, as the window asks to read it whole as its own page, on a plan or with none. */
export const codingAgentPageParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
});

export type CodingAgentPageParams = typeof codingAgentPageParamsSchema.Type;

/** One agent as its own page, as the window hears it: the agent, or why there is no answer. */
export const codingAgentPageAnswerViewSchema = EffectSchema.Union([
  codingAgentPageAnswerSchema,
  failed,
]);

export type CodingAgentPageAnswerView = typeof codingAgentPageAnswerViewSchema.Type;

/** One agent, as the window asks what it published. */
export const codingAgentPullRequestParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
});

export type CodingAgentPullRequestParams = typeof codingAgentPullRequestParamsSchema.Type;

/** What the agent published, as the window hears it: its branch and pull request as GitHub holds them, or why there is no answer. */
export const codingAgentPullRequestAnswerViewSchema = EffectSchema.Union([
  codingAgentPullRequestAnswerSchema,
  failed,
]);

export type CodingAgentPullRequestAnswerView = typeof codingAgentPullRequestAnswerViewSchema.Type;

/** One agent's changes, as the window hears them: its pull request's files, why there are none yet, or why there is no answer. */
export const codingAgentChangesAnswerViewSchema = EffectSchema.Union([
  codingAgentChangesAnswerSchema,
  failed,
]);

export type CodingAgentChangesAnswerView = typeof codingAgentChangesAnswerViewSchema.Type;

/** One agent's pull request as its Pull request tab draws it, as the window hears it: the pull request, why there is none yet, or why there is no answer. */
export const codingAgentOverviewAnswerViewSchema = EffectSchema.Union([
  codingAgentOverviewAnswerSchema,
  failed,
]);

export type CodingAgentOverviewAnswerView = typeof codingAgentOverviewAnswerViewSchema.Type;

/** A dictated clip, as the window asks for its words: the clip once, its length, and the words to listen for. */
export const dictationTranscribeParamsSchema = dictationRequestSchema;

export type DictationTranscribeParams = typeof dictationTranscribeParamsSchema.Type;

/** A dictated clip's words, as the window hears them: the text, or why there is none. */
export const dictationTranscribeAnswerViewSchema = EffectSchema.Union([
  dictationAnswerSchema,
  failed,
]);

export type DictationTranscribeAnswerView = typeof dictationTranscribeAnswerViewSchema.Type;

/** One plan's inbox past a cursor, as the window asks it: the plan, and where the window stands. */
export const codingAgentInboxParamsSchema = EffectSchema.Struct({
  planId: EffectSchema.NonEmptyString,
  after: EffectSchema.NonEmptyString,
});

export type CodingAgentInboxParams = typeof codingAgentInboxParamsSchema.Type;

/** One agent's inbox past a cursor, as the window asks it: the agent, and where the window stands; it is heard as a plan's inbox is. */
export const codingAgentAgentInboxParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  after: EffectSchema.NonEmptyString,
});

export type CodingAgentAgentInboxParams = typeof codingAgentAgentInboxParamsSchema.Type;

/** The plan's inbox, as the window hears it: every item its agents posted and the cursor to read on from, or why there is none. */
export const codingAgentInboxAnswerViewSchema = EffectSchema.Union([inboxAnswerSchema, failed]);

export type CodingAgentInboxAnswerView = typeof codingAgentInboxAnswerViewSchema.Type;

/** An answer to one item of the inbox, as the window asks it: the item, and the answer request the service takes, its key the window's own. */
export const codingAgentInboxAnswerParamsSchema = EffectSchema.Struct({
  itemId: EffectSchema.NonEmptyString,
  ...inboxAnswerRequestSchema.fields,
});

export type CodingAgentInboxAnswerParams = typeof codingAgentInboxAnswerParamsSchema.Type;

/** The answer, as the window hears it: the item as it then stands and whether the answer was taken, or why there is no answer. */
export const codingAgentInboxAnsweredViewSchema = EffectSchema.Union([inboxAnsweredSchema, failed]);

export type CodingAgentInboxAnsweredView = typeof codingAgentInboxAnsweredViewSchema.Type;

/** What waits across the account past a cursor, as main asks it: where it stands. */
export const codingAgentAccountInboxParamsSchema = EffectSchema.Struct({
  after: EffectSchema.NonEmptyString,
});

export type CodingAgentAccountInboxParams = typeof codingAgentAccountInboxParamsSchema.Type;

/** What waits across the account, as main hears it: every open item and the cursor to read on from, or why there is none. */
export const codingAgentAccountInboxAnswerViewSchema = EffectSchema.Union([
  accountInboxAnswerSchema,
  failed,
]);

export type CodingAgentAccountInboxAnswerView = typeof codingAgentAccountInboxAnswerViewSchema.Type;
/** One image of an inbox item, as the window asks it: the item and the attachment its block names. */
export const codingAgentInboxAttachmentParamsSchema = EffectSchema.Struct({
  itemId: EffectSchema.NonEmptyString,
  attachmentId: EffectSchema.NonEmptyString,
});

export type CodingAgentInboxAttachmentParams = typeof codingAgentInboxAttachmentParamsSchema.Type;

/** One picture a tool answered an agent, or one of its workers where `callId` names the delegation call that started it. */
export const codingAgentPictureParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  pictureId: EffectSchema.NonEmptyString,
  callId: EffectSchema.optionalKey(EffectSchema.NonEmptyString),
});

export type CodingAgentPictureParams = typeof codingAgentPictureParamsSchema.Type;

/**
 * The image, as the window hears it: its bytes in base64 under the media
 * type the service sniffed and kept, which the window draws from a `data:`
 * URL of its own making, or why there is none. The host fetched it under
 * the account, so the window holds no bearer and no address.
 */
export const codingAgentInboxAttachmentViewSchema = EffectSchema.Union([
  EffectSchema.Struct({
    contentType: inboxImageTypeSchema,
    base64: EffectSchema.String,
  }),
  failed,
]);

export type CodingAgentInboxAttachmentView = typeof codingAgentInboxAttachmentViewSchema.Type;
