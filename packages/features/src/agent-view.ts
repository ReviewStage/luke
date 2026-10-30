import { Schema as EffectSchema } from "effect";
import { accountInboxAnswerSchema } from "./account-inbox-wire.js";
import {
  AGENT_ATTACHMENT_TYPE,
  AGENT_BOUNDS,
  agentAnswerSchema,
  agentArchiveRequestSchema,
  agentBeforeSchema,
  agentCallIdSchema,
  agentChangesAnswerSchema,
  agentDeleteAnswerSchema,
  agentMessageAnswerSchema,
  agentMessageRequestSchema,
  agentMessagesAnswerSchema,
  agentOlderAnswerSchema,
  agentOverviewChecksAnswerSchema,
  agentOverviewConversationAnswerSchema,
  agentOverviewPullRequestAnswerSchema,
  agentPageAnswerSchema,
  agentPartAnswerSchema,
  agentPinRequestSchema,
  agentPullRequestAnswerSchema,
  agentQueueAnswerSchema,
  agentQueueChangeSchema,
  agentRenameRequestSchema,
  agentReviewOptionsAnswerSchema,
  agentServersRequestSchema,
  agentStartRequestFields,
  agentSummarySchema,
  localAgentRefusalSchema,
  operatorEnsureAnswerSchema,
  operatorEnsureRequestSchema,
  refusedDeviceSchema,
} from "./agent-wire.js";
import { CONVERSATION_MEDIA_TYPE } from "./conversation-picture-wire.js";
import { dictationAnswerSchema, dictationRequestSchema } from "./dictation-wire.js";
import { failureFactsSchema } from "./failure-facts.js";
import { GITHUB_IMAGE_BOUNDS, GITHUB_IMAGE_TYPE } from "./github-image.js";
import { githubPullRequestNumberSchema } from "./github-repositories-wire.js";
import { githubTokenAnswerSchema, githubTokenSaveRequestSchema } from "./github-token-wire.js";
import {
  devicePresenceAnswerSchema,
  hostDoneAnswerSchema,
  hostIdRequestSchema,
  hostsAnswerSchema,
} from "./host-wire.js";
import {
  inboxAcknowledgeRequestSchema,
  inboxAnsweredSchema,
  inboxAnswerSchema,
  inboxCloseRequestSchema,
  inboxMessagedSchema,
  inboxMessageRequestSchema,
  inboxReadAllRequestSchema,
  inboxReadAllSchema,
  inboxReadStateSchema,
  inboxStartRequestSchema,
} from "./inbox-wire.js";
import { lukeToolsAnswerSchema } from "./luke-tools-wire.js";
import { memoriesAnswerSchema, memoryIdSchema } from "./memory-wire.js";
import { modelChoiceSchema, modelProviderSchema, modelsAnswerSchema } from "./models-wire.js";
import {
  PROVIDER_KEY_PROVIDER,
  providerKeyForAgentsRequestSchema,
  providerKeyKindSchema,
  providerKeySaveRequestSchema,
  providerKeysAnswerSchema,
} from "./provider-key-wire.js";
import {
  pullRequestActionRequestSchema,
  pullRequestViewedAnswerSchema,
  pullRequestWriteAnswerSchema,
} from "./pull-request-write-wire.js";
import { repositoryUnreachedSchema } from "./repository-reach-wire.js";

/**
 * agent-view.ts -- a task's coding agents as one Mac's window hears them: each call's answer whole, or why there is none.
 *
 * The host asks the service for these on the window's behalf and answers
 * the window one of the shapes here, so a window draws an answer or draws
 * why, and nothing the service said beyond that reaches it. The failures
 * are the few a window can act on: the service never answered, the task or
 * the agent is gone, the task names no repository yet, the App does not
 * reach it, the choice named is
 * not one the service offers now, or — for a message, and for an answer to
 * the task's inbox, which may reach the agent as one — the words run past
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
 * back, or why there is none, the account having saved no OpenAI key among
 * the reasons.
 */

/** Why a coding-agent call answered nothing a window can draw. */
export const AGENT_CALL_FAILURE = {
  /** The call never reached an answer: no credential, the network, a refusal, a shape not read. */
  UNANSWERED: "unanswered",
  /** The task or the agent is not one the account holds: deleted, or never the caller's. */
  NOT_FOUND: "not-found",
  /** The task names no repository, so there is nothing for an agent to check out. */
  NO_REPOSITORY: "no-repository",
  /** The task's workspace's GitHub installation does not reach the task's repository; why travels beside it where the service said. */
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
  /** The agent ran on a host its starter removed, so no message reaches it again; only a new agent goes on from here. */
  DEVICE_REMOVED: "device-removed",
  /** The agent runs on its starter's own GitHub token, so only its starter messages it or starts an agent from it. */
  NOT_PERMITTED: "not-permitted",
  /** The agent's sandbox image is still being prepared; the same call under its key, a little later, is taken. */
  AGENT_IMAGE_PREPARING: "agent-image-preparing",
  /** The agent runs on Claude Code or Codex, which this part of Luke cannot reach yet. */
  NATIVE_AGENT_NOT_HERE: "native-agent-not-here",
  /** The agent runs on its starter's plan, whose sign-in cannot launch it until the starter signs in again. */
  AGENT_PLAN_SIGNED_OUT: "agent-plan-signed-out",
  /** The agent runs on its starter's plan, whose provider did not answer; the same call a little later may be taken. */
  AGENT_PLAN_UNREACHABLE: "agent-plan-unreachable",
  /** The agent runs on its starter's plan, whose usage limit is reached until it resets. */
  AGENT_PLAN_LIMIT_REACHED: "agent-plan-limit-reached",
  /** The agent runs on its starter's plan, which its provider said is not eligible to run it. */
  AGENT_PLAN_INELIGIBLE: "agent-plan-ineligible",
  /** The account keeps neither the model provider's subscription nor its API key, so no coding agent on that provider starts or takes a message until one is connected in Settings › Agents. */
  AGENT_CREDENTIAL_MISSING: "agent-credential-missing",
  /** The agent runs on its starter's API key, which is saved but cannot be read here, so it is saved again in Settings › Agents. */
  AGENT_API_KEY_UNREADABLE: "agent-api-key-unreadable",
  /** A dictated clip is heard on the account's own OpenAI API key, and the account saved none. */
  OPENAI_KEY_MISSING: "openai-key-missing",
  /** The task runs its agents on a device that would not take this one, for the reason that travels beside it where the service said (`LOCAL_AGENT_REFUSAL`). */
  LOCAL_AGENT_REFUSED: "local-agent-refused",
} as const;

export type AgentCallFailure = (typeof AGENT_CALL_FAILURE)[keyof typeof AGENT_CALL_FAILURE];

const failureSchema = EffectSchema.Literals(Object.values(AGENT_CALL_FAILURE));

/** A failed call, as every answer below spells one, with the facts of what failed beneath it where the host caught it (`failure-facts.ts`), which the window reports and never draws. */
const failed = EffectSchema.Struct({
  failure: failureSchema,
  cause: EffectSchema.optionalKey(failureFactsSchema),
});

/** A failed start or message, with why the repository is out of reach where it is and the service said (`repository-reach-wire.ts`), when a plan's reached limit resets where it is that, the provider whose credential is missing where it is that, and why the task's device would not take the agent, with the device and its owner where it is another member's, where it is that. */
const failedReaching = EffectSchema.Struct({
  ...failed.fields,
  unreached: EffectSchema.optionalKey(repositoryUnreachedSchema),
  resetsAt: EffectSchema.optionalKey(EffectSchema.Number),
  provider: EffectSchema.optionalKey(modelProviderSchema),
  localAgentRefusal: EffectSchema.optionalKey(localAgentRefusalSchema),
  refusedDevice: EffectSchema.optionalKey(refusedDeviceSchema),
});

/** The models the service offers, as the window hears them: the list and the Mac a Start may run on where it offers one (`modelsAnswerSchema`), or why there is none. */
export const agentModelsAnswerSchema = EffectSchema.Union([modelsAnswerSchema, failed]);

export type AgentModelsAnswer = typeof agentModelsAnswerSchema.Type;

/** The account's default model and effort, as the window hears them read or written: the choice as kept, or why there is none. */
export const agentDefaultAnswerViewSchema = EffectSchema.Union([
  EffectSchema.Struct({ choice: modelChoiceSchema }),
  failed,
]);

export type AgentDefaultAnswer = typeof agentDefaultAnswerViewSchema.Type;

/** The account's hosts, as the window hears them read (`host-wire.ts`): the list and the install script's address, or why there is none. */
export const hostsAnswerViewSchema = EffectSchema.Union([hostsAnswerSchema, failed]);

export type HostsAnswerView = typeof hostsAnswerViewSchema.Type;

/** How long ago the reader's devices last beat, as the window hears it read, or why not. */
export const devicePresenceAnswerViewSchema = EffectSchema.Union([
  devicePresenceAnswerSchema,
  failed,
]);

export type DevicePresenceAnswerView = typeof devicePresenceAnswerViewSchema.Type;

/** A host removed, as the window hears it: done, or why not. */
export const hostDoneAnswerViewSchema = EffectSchema.Union([hostDoneAnswerSchema, failed]);

export type HostDoneAnswerView = typeof hostDoneAnswerViewSchema.Type;

/** What removing a host names: its id. */
export const hostIdParamsSchema = hostIdRequestSchema;

/** The account's own provider keys, as the window hears them read, saved, or removed: the keys as they stand, or why there are none. */
export const providerKeysAnswerViewSchema = EffectSchema.Union([providerKeysAnswerSchema, failed]);

export type ProviderKeysAnswerView = typeof providerKeysAnswerViewSchema.Type;

/**
 * A ChatGPT sign-in, as the window hears it end: the keys as they then
 * stand, the sign-in among their subscriptions; why nothing was kept, in a
 * sentence for the row; that the developer withdrew it; or why there was no
 * answer. Never a token: the sign-in's credentials go from the host to the
 * service and nowhere else.
 */
export const chatGptSignInAnswerViewSchema = EffectSchema.Union([
  providerKeysAnswerSchema,
  EffectSchema.Struct({ refused: EffectSchema.String }),
  EffectSchema.Struct({ cancelled: EffectSchema.Literal(true) }),
  failed,
]);

export type ChatGptSignInAnswerView = typeof chatGptSignInAnswerViewSchema.Type;

/** Saving a key, as the window asks it: the provider and the key, once. */
export const providerKeySaveParamsSchema = providerKeySaveRequestSchema;

export type ProviderKeySaveParams = typeof providerKeySaveParamsSchema.Type;

/** Removing a key, as the window asks it: the provider, and the kind where it is no API key. */
export const providerKeyRemoveParamsSchema = EffectSchema.Struct({
  provider: EffectSchema.Literals(Object.values(PROVIDER_KEY_PROVIDER)),
  kind: EffectSchema.optionalKey(providerKeyKindSchema),
});

export type ProviderKeyRemoveParams = typeof providerKeyRemoveParamsSchema.Type;

/** Turning a plan's default for the account's coding agents, as the window asks it: the provider, the plan's kind, and on or off. */
export const providerKeyForAgentsParamsSchema = providerKeyForAgentsRequestSchema;

export type ProviderKeyForAgentsParams = typeof providerKeyForAgentsParamsSchema.Type;

/** The member's own GitHub token, as the window hears it read, saved, or removed: what it is, or why there is no answer. */
export const githubTokenAnswerViewSchema = EffectSchema.Union([githubTokenAnswerSchema, failed]);

export type GitHubTokenAnswerView = typeof githubTokenAnswerViewSchema.Type;

/** Saving a token, as the window asks it: the token, once. */
export const githubTokenSaveParamsSchema = githubTokenSaveRequestSchema;

export type GitHubTokenSaveParams = typeof githubTokenSaveParamsSchema.Type;

/** A workspace's memories, as the window hears them read or one forgotten: the memories as they stand, or why there are none. */
export const memoriesAnswerViewSchema = EffectSchema.Union([memoriesAnswerSchema, failed]);

export type MemoriesAnswerView = typeof memoriesAnswerViewSchema.Type;

/** Reading a workspace's memories, as the window asks it: the workspace Settings shows. */
export const memoriesReadParamsSchema = EffectSchema.Struct({
  workspaceId: EffectSchema.NonEmptyString,
});

export type MemoriesReadParams = typeof memoriesReadParamsSchema.Type;

/** Forgetting a memory, as the window asks it: its workspace and the memory's id. */
export const memoryForgetParamsSchema = EffectSchema.Struct({
  workspaceId: EffectSchema.NonEmptyString,
  id: memoryIdSchema,
});

export type MemoryForgetParams = typeof memoryForgetParamsSchema.Type;

/** Writing the default, as the window asks it: the choice to keep. */
export const agentDefaultWriteParamsSchema = modelChoiceSchema;

/** One task's agents, as the window asks them: the task, and whether the archived agents are listed among the rest. */
export const agentListParamsSchema = EffectSchema.Struct({
  taskId: EffectSchema.NonEmptyString,
  includeArchived: EffectSchema.optionalKey(EffectSchema.Boolean),
});

export type AgentListParams = typeof agentListParamsSchema.Type;

/** A workspace's agents asked for, narrowed to one repository where one is named: what an automation's Same agent is chosen from. */
export const agentWorkspaceListParamsSchema = EffectSchema.Struct({
  workspaceId: EffectSchema.NonEmptyString,
  repository: EffectSchema.optionalKey(EffectSchema.NonEmptyString),
  /** Only the agents whose shown name (`agentName`) or task's name holds these words, whatever their case. */
  words: EffectSchema.optionalKey(
    EffectSchema.NonEmptyString.check(EffectSchema.isMaxLength(AGENT_BOUNDS.MAX_SEARCH_CHARS)),
  ),
  /** Lists the archived agents among the rest, each carrying its `archivedAt`. */
  includeArchived: EffectSchema.optionalKey(EffectSchema.Boolean),
});

export type AgentWorkspaceListParams = typeof agentWorkspaceListParamsSchema.Type;

/** One task's agents, as the window hears them: each with its status, in the order started, or why there is no list. */
export const agentListAnswerViewSchema = EffectSchema.Union([
  EffectSchema.Struct({ agents: EffectSchema.Array(agentSummarySchema) }),
  failed,
]);

export type AgentListAnswer = typeof agentListAnswerViewSchema.Type;

/**
 * Starting an agent, as the window asks it: the task, and the Start request
 * the service takes; or, for a Start from another agent, no task, the new
 * agent going where that agent is, its task or its workspace where it has
 * none. A Start naming neither a task nor an agent to start from starts
 * nowhere, and is refused.
 */
export const agentStartParamsSchema = EffectSchema.Struct({
  taskId: EffectSchema.optionalKey(EffectSchema.NonEmptyString),
  ...agentStartRequestFields,
}).check(EffectSchema.makeFilter(({ taskId, from }) => taskId !== undefined || from !== undefined));

export type AgentStartParams = typeof agentStartParamsSchema.Type;

/** An agent started, messaged, or stopped, as the window hears it: the agent as it then stands, or why it was not. */
export const agentAgentAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({
    agent: agentSummarySchema,
    txid: agentAnswerSchema.fields.txid,
    notice: agentAnswerSchema.fields.notice,
  }),
  failedReaching,
]);

export type AgentAgentAnswer = typeof agentAgentAnswerSchema.Type;

/** A message handed to an agent, as the host hears the service answer it: the agent, and the transaction that wrote its row where one did; or why there is none. */
const agentMessageAnswerViewSchema = EffectSchema.Union([agentMessageAnswerSchema, failedReaching]);

export type AgentMessageAnswerView = typeof agentMessageAnswerViewSchema.Type;

/** One change of an agent's queue, as the window asks it: the agent and the change. */
export const agentQueueParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  change: agentQueueChangeSchema,
});

export type AgentQueueParams = typeof agentQueueParamsSchema.Type;

/** A change of an agent's queue, as the window hears the service answer it: the queue as it then stands, or why it did not change. */
export const agentQueueAnswerViewSchema = EffectSchema.Union([
  agentQueueAnswerSchema,
  failedReaching,
]);

export type AgentQueueAnswerView = typeof agentQueueAnswerViewSchema.Type;

/** An agent deleted for good, as the window hears it: that it was, or why it was not. */
export const agentDeleteAnswerViewSchema = EffectSchema.Union([agentDeleteAnswerSchema, failed]);

export type AgentDeleteAnswerView = typeof agentDeleteAnswerViewSchema.Type;

/** The account's operator in a workspace ensured, as the window hears it: its id, or why there is none. */
export const agentOperatorEnsureAnswerViewSchema = EffectSchema.Union([
  operatorEnsureAnswerSchema,
  failed,
]);

export type AgentOperatorEnsureAnswerView = typeof agentOperatorEnsureAnswerViewSchema.Type;

/** One agent's transcript past a cursor, as the window asks it: the agent, and where the window stands; or, naming the delegation call that started one, a worker's transcript under the agent. */
export const agentMessagesParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  after: EffectSchema.NonEmptyString,
  callId: EffectSchema.optionalKey(agentCallIdSchema),
});

export type AgentMessagesParams = typeof agentMessagesParamsSchema.Type;

/** The transcript past the cursor, as the window hears it: the page and the cursor to read on from, or why there is none. */
export const agentMessagesAnswerViewSchema = EffectSchema.Union([
  agentMessagesAnswerSchema,
  failed,
]);

export type AgentMessagesAnswerView = typeof agentMessagesAnswerViewSchema.Type;

/** Whose transcript a window follows: a coding agent's, or a worker's of it. */
export const TRANSCRIPT_KIND = {
  AGENT: "agent",
} as const;

/** One transcript as a window follows it: an agent's own, or one of its workers' by the delegation call that started it. */
export const agentTranscriptKeySchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(TRANSCRIPT_KIND.AGENT),
  agentId: EffectSchema.NonEmptyString,
  callId: EffectSchema.optionalKey(agentCallIdSchema),
});

export type AgentTranscriptKey = typeof agentTranscriptKeySchema.Type;

/**
 * A followed transcript's page as the window hears it pushed, with where the
 * agent stands as it was read; or why there is none. The follow opens with
 * the transcript's `newest` page, which carries `before`, where the next
 * older page is read below (absent where nothing older stands), and each
 * later page is what moved past the last. A newest page that is `held`
 * came from the host's own memory of the transcript, not a read. `caughtUp` says the page came
 * back short, so every message written by then is told.
 */
const agentTranscriptPageSchema = EffectSchema.Union([
  EffectSchema.Struct({
    ...agentMessagesAnswerSchema.fields,
    newest: EffectSchema.optionalKey(EffectSchema.Literal(true)),
    /** The newest page is the window the host held from the last time the transcript was followed, told before the service was asked anything. */
    held: EffectSchema.optionalKey(EffectSchema.Literal(true)),
    before: EffectSchema.optionalKey(agentBeforeSchema),
    caughtUp: EffectSchema.Boolean,
  }),
  failed,
]);

export type AgentTranscriptPage = typeof agentTranscriptPageSchema.Type;

/** A followed transcript's next page, as the window hears it pushed. */
export const agentTranscriptChangedSchema = EffectSchema.Struct({
  transcript: agentTranscriptKeySchema,
  page: agentTranscriptPageSchema,
});

export type AgentTranscriptChanged = typeof agentTranscriptChangedSchema.Type;

/** The page of a followed transcript below the oldest message a window holds, as the window asks it: the transcript, and the `before` its last page named. */
export const agentTranscriptOlderParamsSchema = EffectSchema.Struct({
  ...agentTranscriptKeySchema.fields,
  before: agentBeforeSchema,
});

export type AgentTranscriptOlderParams = typeof agentTranscriptOlderParamsSchema.Type;

/** An older page of a transcript, as the window hears it: its messages, oldest first, and where the page older still is read below; or why there is none. */
export const agentTranscriptOlderAnswerSchema = EffectSchema.Union([
  agentOlderAnswerSchema,
  failed,
]);

export type AgentTranscriptOlderAnswer = typeof agentTranscriptOlderAnswerSchema.Type;

/** Messaging an agent, as the window asks it: the agent, and the message request the service takes, its key the window's own. */
export const agentMessageParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  ...agentMessageRequestSchema.fields,
});

export type AgentMessageParams = typeof agentMessageParamsSchema.Type;

/** One agent's model and effort changed for its next step, as the window asks it: the agent and the choice. */
export const agentChooseParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  ...modelChoiceSchema.fields,
});

export type AgentChooseParams = typeof agentChooseParamsSchema.Type;

/** One agent renamed, as the window asks it: the agent and the title, empty to clear it. */
export const agentRenameParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  ...agentRenameRequestSchema.fields,
});

export type AgentRenameParams = typeof agentRenameParamsSchema.Type;

/** One agent's MCP servers switched, as the window asks it: the agent and the whole list of those off. */
export const agentServersParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  ...agentServersRequestSchema.fields,
});

export type AgentServersParams = typeof agentServersParamsSchema.Type;

/**
 * When an archive is drawn: at once, before the service answers, or once
 * it has, as a dialog that asked does, since the agent leaving would take
 * the dialog, and the refusal it would say, with it.
 */
export const ARCHIVE_DRAWN = {
  AT_ONCE: "at-once",
  ON_ANSWER: "on-answer",
} as const;

export type ArchiveDrawn = (typeof ARCHIVE_DRAWN)[keyof typeof ARCHIVE_DRAWN];

/** One agent archived or brought back, as the window asks it: the agent, which, and when it is drawn, at once where it says none. */
export const agentArchiveParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  ...agentArchiveRequestSchema.fields,
  drawn: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(ARCHIVE_DRAWN))),
});

export type AgentArchiveParams = typeof agentArchiveParamsSchema.Type;

/** One agent pinned or unpinned, as the window asks it: the agent and which. */
export const agentPinParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  ...agentPinRequestSchema.fields,
});

export type AgentPinParams = typeof agentPinParamsSchema.Type;

/** The account's operator in a workspace ensured, as the window asks it: the workspace, and whether a fresh one replaces the one standing. */
export const agentOperatorEnsureParamsSchema = EffectSchema.Struct({
  workspaceId: EffectSchema.NonEmptyString,
  ...operatorEnsureRequestSchema.fields,
});

export type AgentOperatorEnsureParams = typeof agentOperatorEnsureParamsSchema.Type;

/** One agent, as the window names it to stop or to delete. */
export const agentStopParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
});

export type AgentStopParams = typeof agentStopParamsSchema.Type;

/** One agent taken back to just before one of the developer's lines, as the window names the line by its message id. */
export const agentRewindParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  messageId: EffectSchema.NonEmptyString,
});

export type AgentRewindParams = typeof agentRewindParamsSchema.Type;

/** One agent, as the window asks to read it whole as its own page, on a task or with none. */
export const agentPageParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
});

export type AgentPageParams = typeof agentPageParamsSchema.Type;

/** One agent as its own page, as the window hears it: the agent, or why there is no answer. */
export const agentPageAnswerViewSchema = EffectSchema.Union([agentPageAnswerSchema, failed]);

export type AgentPageAnswerView = typeof agentPageAnswerViewSchema.Type;

/** One agent, as the window asks what it published. */
export const agentPullRequestParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
});

export type AgentPullRequestParams = typeof agentPullRequestParamsSchema.Type;

/**
 * One agent's Pull request tab, as the window reads its pull request: the
 * agent, and the pull request of its repository by number where the tab
 * shows one other than the one from the agent's branch.
 */
export const agentPullRequestReadParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  number: EffectSchema.optionalKey(githubPullRequestNumberSchema),
});

export type AgentPullRequestReadParams = typeof agentPullRequestReadParamsSchema.Type;

/** What the agent published, as the window hears it: its branch and pull request as GitHub holds them, or why there is no answer. */
export const agentPullRequestAnswerViewSchema = EffectSchema.Union([
  agentPullRequestAnswerSchema,
  failed,
]);

export type AgentPullRequestAnswerView = typeof agentPullRequestAnswerViewSchema.Type;

/** One agent's changes, as the window hears them: its pull request's files, why there are none yet, or why there is no answer. */
export const agentChangesAnswerViewSchema = EffectSchema.Union([agentChangesAnswerSchema, failed]);

export type AgentChangesAnswerView = typeof agentChangesAnswerViewSchema.Type;

/** One agent's pull request itself as its overview draws it, as the window hears it: the pull request, why there is none yet, or why there is no answer. */
export const agentOverviewPullRequestAnswerViewSchema = EffectSchema.Union([
  agentOverviewPullRequestAnswerSchema,
  failed,
]);

export type AgentOverviewPullRequestAnswerView =
  typeof agentOverviewPullRequestAnswerViewSchema.Type;

/** The checks on one agent's pull request's head, as the window hears them: the checks, why there are none yet, or why there is no answer. */
export const agentOverviewChecksAnswerViewSchema = EffectSchema.Union([
  agentOverviewChecksAnswerSchema,
  failed,
]);

export type AgentOverviewChecksAnswerView = typeof agentOverviewChecksAnswerViewSchema.Type;

/** One agent's pull request's conversation, as the window hears it: the conversation, why there is none yet, or why there is no answer. */
export const agentOverviewConversationAnswerViewSchema = EffectSchema.Union([
  agentOverviewConversationAnswerSchema,
  failed,
]);

export type AgentOverviewConversationAnswerView =
  typeof agentOverviewConversationAnswerViewSchema.Type;

/** Which of Luke's own tools an agent is offered and where its `run_on_mac` stands, as the window hears it: the answer, or why there is none. */
export const agentLukeToolsAnswerViewSchema = EffectSchema.Union([lukeToolsAnswerSchema, failed]);

export type AgentLukeToolsAnswerView = typeof agentLukeToolsAnswerViewSchema.Type;

/** What the reviewer and label pickers of an agent's Pull request tab offer, as the window hears it: the labels, users, and teams, or why there is no answer. */
export const agentReviewOptionsAnswerViewSchema = EffectSchema.Union([
  agentReviewOptionsAnswerSchema,
  failed,
]);

export type AgentReviewOptionsAnswerView = typeof agentReviewOptionsAnswerViewSchema.Type;

/** One change to an agent's pull request, as the window asks it made: the agent, and the change (`pull-request-write-wire.ts`). */
export const agentPullRequestActionParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  number: EffectSchema.optionalKey(githubPullRequestNumberSchema),
  request: pullRequestActionRequestSchema,
});

export type AgentPullRequestActionParams = typeof agentPullRequestActionParamsSchema.Type;

/** How GitHub took a change to an agent's pull request, as the window hears it: made, the member to sign in with GitHub again, GitHub's refusal in its words, or why there is no answer. */
export const agentPullRequestWriteAnswerViewSchema = EffectSchema.Union([
  pullRequestWriteAnswerSchema,
  failed,
]);

export type AgentPullRequestWriteAnswerView = typeof agentPullRequestWriteAnswerViewSchema.Type;

/** Which of an agent's pull request's files the member marked viewed on GitHub, as the window hears it: each file's mark, the member to sign in with GitHub again, GitHub's refusal in its words, or why there is no answer. */
export const agentPullRequestViewedAnswerViewSchema = EffectSchema.Union([
  pullRequestViewedAnswerSchema,
  failed,
]);

export type AgentPullRequestViewedAnswerView = typeof agentPullRequestViewedAnswerViewSchema.Type;

/** A dictated clip, as the window asks for its words: the clip once, its length, and the words to listen for. */
export const dictationTranscribeParamsSchema = dictationRequestSchema;

export type DictationTranscribeParams = typeof dictationTranscribeParamsSchema.Type;

/** A dictated clip's words, as the window hears them: the text, or why there is none. */
export const dictationTranscribeAnswerViewSchema = EffectSchema.Union([
  dictationAnswerSchema,
  failed,
]);

export type DictationTranscribeAnswerView = typeof dictationTranscribeAnswerViewSchema.Type;

/** Whose inbox is followed: a plan's, or one agent's. */
export const INBOX_SCOPE_KIND = {
  PLAN: "plan",
  AGENT: "agent",
} as const;

/** One plan's inbox, or one agent's, as the window follows it: which kind, and the plan's or agent's id. */
export const agentInboxScopeSchema = EffectSchema.Struct({
  kind: EffectSchema.Literals(Object.values(INBOX_SCOPE_KIND)),
  id: EffectSchema.NonEmptyString,
});

export type AgentInboxScope = typeof agentInboxScopeSchema.Type;

/** The task's inbox, as the window hears it: every item its agents posted and the cursor to read on from, or why there is none. */
const agentInboxAnswerViewSchema = EffectSchema.Union([inboxAnswerSchema, failed]);

export type AgentInboxAnswerView = typeof agentInboxAnswerViewSchema.Type;

/** A nod on one notice of the inbox, Got it, as the window asks it: the item, and the acknowledgement the service takes, its key the window's own. */
export const agentInboxAnswerParamsSchema = EffectSchema.Struct({
  itemId: EffectSchema.NonEmptyString,
  ...inboxAcknowledgeRequestSchema.fields,
});

export type AgentInboxAnswerParams = typeof agentInboxAnswerParamsSchema.Type;

/** A nod or a close, as the window hears it: the item as it then stands and whether it was taken, or why there is no answer. */
export const agentInboxAnsweredViewSchema = EffectSchema.Union([inboxAnsweredSchema, failed]);

export type AgentInboxAnsweredView = typeof agentInboxAnsweredViewSchema.Type;

/** A close of one item without an answer, as the window asks it: the item, and the close request the service takes, its key the window's own. It is heard as an answer is (`agentInboxAnsweredViewSchema`). */
export const agentInboxCloseParamsSchema = EffectSchema.Struct({
  itemId: EffectSchema.NonEmptyString,
  ...inboxCloseRequestSchema.fields,
});

export type AgentInboxCloseParams = typeof agentInboxCloseParamsSchema.Type;

/** A message on one item's thread, as the window asks it: the item, and the message request the service takes, its key the window's own. */
export const agentInboxMessageParamsSchema = EffectSchema.Struct({
  itemId: EffectSchema.NonEmptyString,
  ...inboxMessageRequestSchema.fields,
});

export type AgentInboxMessageParams = typeof agentInboxMessageParamsSchema.Type;

/** A message on an item's thread, as the window hears it: the item as it then stands, its thread with the message on it, or why there is no answer. */
export const agentInboxMessagedViewSchema = EffectSchema.Union([inboxMessagedSchema, failed]);

export type AgentInboxMessagedView = typeof agentInboxMessagedViewSchema.Type;

/** A thread the window starts with one agent: the start request the service takes whole, its key the window's own. It is heard as a message on a thread is (`agentInboxMessagedViewSchema`). */
export const agentInboxStartParamsSchema = inboxStartRequestSchema;

export type AgentInboxStartParams = typeof agentInboxStartParamsSchema.Type;

/** One item marked read or unread for the account, as the window asks it: the item, and whether it is to read as unread. */
export const agentInboxReadStateParamsSchema = EffectSchema.Struct({
  itemId: EffectSchema.NonEmptyString,
  unread: EffectSchema.Boolean,
});

export type AgentInboxReadStateParams = typeof agentInboxReadStateParamsSchema.Type;

/** One item marked read or unread, as the window hears it: the item's id and its read state for the account, or why there is no answer. */
export const agentInboxReadStateViewSchema = EffectSchema.Union([inboxReadStateSchema, failed]);

export type AgentInboxReadStateView = typeof agentInboxReadStateViewSchema.Type;

/**
 * Every item of the Inbox marked read, as the window asks it: the workspace
 * the service marks, as its request names it, and the items the window
 * lists there, which the host draws read the moment it is asked.
 */
export const agentInboxReadAllParamsSchema = EffectSchema.Struct({
  ...inboxReadAllRequestSchema.fields,
  itemIds: EffectSchema.Array(EffectSchema.NonEmptyString),
});

export type AgentInboxReadAllParams = typeof agentInboxReadAllParamsSchema.Type;

/** Every item of the Inbox marked read, as the window hears it: how many were unread, or why there is no answer. */
export const agentInboxReadAllViewSchema = EffectSchema.Union([inboxReadAllSchema, failed]);

export type AgentInboxReadAllView = typeof agentInboxReadAllViewSchema.Type;

/** What waits across the account, as main hears it each time it moves: every open item, or why there is none. */
export const agentAccountInboxAnswerViewSchema = EffectSchema.Union([
  accountInboxAnswerSchema,
  failed,
]);

export type AgentAccountInboxAnswerView = typeof agentAccountInboxAnswerViewSchema.Type;

/** One image of an inbox item, as the window asks it: the item and the attachment its block names. */
export const agentInboxAttachmentParamsSchema = EffectSchema.Struct({
  itemId: EffectSchema.NonEmptyString,
  attachmentId: EffectSchema.NonEmptyString,
});

export type AgentInboxAttachmentParams = typeof agentInboxAttachmentParamsSchema.Type;

/** One picture a tool answered an agent, or one of its workers where `callId` names the delegation call that started it. */
export const agentPictureParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  pictureId: EffectSchema.NonEmptyString,
  callId: EffectSchema.optionalKey(EffectSchema.NonEmptyString),
});

export type AgentPictureParams = typeof agentPictureParamsSchema.Type;

/** One part of a message of an agent's transcript, or one of its workers' where `callId` names the delegation call that started it, by the message's id and the part's index among its parts: what the page carried cut (`cutParts`). */
export const agentPartParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  messageId: EffectSchema.NonEmptyString,
  index: EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(0)),
  callId: EffectSchema.optionalKey(EffectSchema.NonEmptyString),
});

export type AgentPartParams = typeof agentPartParamsSchema.Type;

/** The part whole, as the window hears it, or why there is none. */
export const agentPartViewSchema = EffectSchema.Union([agentPartAnswerSchema, failed]);

export type AgentPartView = typeof agentPartViewSchema.Type;

/**
 * The image, or the file an inbox answer carried, as the window hears it:
 * its bytes in base64 under the media type the service sniffed and kept, or
 * the type the file travelled as, which the window draws or opens from a
 * `data:` URL of its own making, or why there is none. The host fetched it under
 * the account, so the window holds no bearer and no address.
 */
export const agentInboxAttachmentViewSchema = EffectSchema.Union([
  EffectSchema.Struct({
    // A transcript's picture may be a WebM an agent recorded, read through this same view.
    contentType: EffectSchema.Literals([
      ...Object.values(AGENT_ATTACHMENT_TYPE),
      CONVERSATION_MEDIA_TYPE.WEBM,
    ]),
    base64: EffectSchema.String,
  }),
  failed,
]);

export type AgentInboxAttachmentView = typeof agentInboxAttachmentViewSchema.Type;

/** One image an agent's pull request's overview names, as the window asks for it: the agent, and the address GitHub's rendering spelled. */
export const agentGitHubImageParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  src: EffectSchema.NonEmptyString.check(
    EffectSchema.isMaxLength(GITHUB_IMAGE_BOUNDS.MAX_URL_CHARS),
  ),
});

export type AgentGitHubImageParams = typeof agentGitHubImageParamsSchema.Type;

/** The media types an image read from GitHub may be. */
export const githubImageTypeSchema = EffectSchema.Literals(Object.values(GITHUB_IMAGE_TYPE));

/**
 * That image, as the window hears it: its bytes in base64 under the type
 * GitHub served, which the window draws from a `data:` URL of its own
 * making, or why there is none. The service read it on the App's token, so
 * the window holds no signed address and asks GitHub nothing itself.
 */
export const agentGitHubImageViewSchema = EffectSchema.Union([
  EffectSchema.Struct({
    contentType: githubImageTypeSchema,
    base64: EffectSchema.String,
  }),
  failed,
]);

export type AgentGitHubImageView = typeof agentGitHubImageViewSchema.Type;
