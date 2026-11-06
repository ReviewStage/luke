import { Schema as EffectSchema } from "effect";
import { accountInboxAnswerSchema } from "./account-inbox-wire.js";
import {
  AGENT_ATTACHMENT_TYPE,
  AGENT_BOUNDS,
  agentAddRepositoryRequestSchema,
  agentAnswerSchema,
  agentArchiveRequestSchema,
  agentBeforeSchema,
  agentCallIdSchema,
  agentChangesAnswerSchema,
  agentDeleteAnswerSchema,
  agentMessageAnswerSchema,
  agentMessageRequestSchema,
  agentMessagesAnswerSchema,
  agentOverviewChecksAnswerSchema,
  agentOverviewConversationAnswerSchema,
  agentOverviewPullRequestAnswerSchema,
  agentPageAnswerSchema,
  agentPartAnswerSchema,
  agentPinRequestSchema,
  agentPullRequestAnswerSchema,
  agentQueueAnswerSchema,
  agentQueueChangeSchema,
  agentReadRequestSchema,
  agentRenameRequestSchema,
  agentReviewOptionsAnswerSchema,
  agentServersRequestSchema,
  agentStartRequestFields,
  agentSummarySchema,
  extraRepositoryRefusalSchema,
  localAgentRefusalSchema,
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
  inboxItemHomeSchema,
  inboxMessagedSchema,
  inboxMessageRequestSchema,
  inboxReadAllRequestSchema,
  inboxReadAllSchema,
  inboxReadStateSchema,
  inboxStartRequestSchema,
} from "./inbox-wire.js";
import { memoriesAnswerSchema, memoryIdSchema } from "./memory-wire.js";
import { modelChoiceSchema, modelProviderSchema, modelsAnswerSchema } from "./models-wire.js";
import {
  chatGptDeviceLoginRequestSchema,
  chatGptDevicePollAnswerSchema,
  chatGptDeviceStartAnswerSchema,
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
import { countedNumber, wireUuidSchema } from "./service-wire.js";
import { workspaceToolsAnswerSchema } from "./workspace-tools-wire.js";

export const AGENT_CALL_FAILURE = {
  UNANSWERED: "unanswered",
  NOT_FOUND: "not-found",
  NO_REPOSITORY: "no-repository",
  REPOSITORY_NOT_REACHABLE: "repository-not-reachable",
  GITHUB_UNANSWERED: "github-unanswered",
  INVALID_CHOICE: "invalid-choice",
  MESSAGE_TOO_LONG: "message-too-long",
  AGENT_NOT_READY: "agent-not-ready",
  AGENT_RETIRED: "agent-retired",
  DEVICE_REMOVED: "device-removed",
  NOT_PERMITTED: "not-permitted",
  NATIVE_AGENT_NOT_HERE: "native-agent-not-here",
  AGENT_PLAN_SIGNED_OUT: "agent-plan-signed-out",
  AGENT_PLAN_UNREACHABLE: "agent-plan-unreachable",
  AGENT_PLAN_LIMIT_REACHED: "agent-plan-limit-reached",
  AGENT_PLAN_INELIGIBLE: "agent-plan-ineligible",
  AGENT_CREDENTIAL_MISSING: "agent-credential-missing",
  AGENT_API_KEY_UNREADABLE: "agent-api-key-unreadable",
  OPENAI_KEY_MISSING: "openai-key-missing",
  LOCAL_AGENT_REFUSED: "local-agent-refused",
  EXTRA_REPOSITORY_REFUSED: "extra-repository-refused",
} as const;

export type AgentCallFailure = (typeof AGENT_CALL_FAILURE)[keyof typeof AGENT_CALL_FAILURE];

const failureSchema = EffectSchema.Literals(Object.values(AGENT_CALL_FAILURE));

const failed = EffectSchema.Struct({
  failure: failureSchema,
  cause: EffectSchema.optionalKey(failureFactsSchema),
});

const failedReaching = EffectSchema.Struct({
  ...failed.fields,
  unreached: EffectSchema.optionalKey(repositoryUnreachedSchema),
  resetsAt: EffectSchema.optionalKey(EffectSchema.Number),
  provider: EffectSchema.optionalKey(modelProviderSchema),
  localAgentRefusal: EffectSchema.optionalKey(localAgentRefusalSchema),
  refusedDevice: EffectSchema.optionalKey(refusedDeviceSchema),
  extraRepositoryRefusal: EffectSchema.optionalKey(extraRepositoryRefusalSchema),
  refusedRepository: EffectSchema.optionalKey(EffectSchema.String),
});

export const agentModelsAnswerSchema = EffectSchema.Union([modelsAnswerSchema, failed]);

export type AgentModelsAnswer = typeof agentModelsAnswerSchema.Type;

export const agentDefaultAnswerViewSchema = EffectSchema.Union([
  EffectSchema.Struct({
    choice: modelChoiceSchema,
    txid: EffectSchema.optionalKey(EffectSchema.String),
  }),
  failed,
]);

export type AgentDefaultAnswer = typeof agentDefaultAnswerViewSchema.Type;

export const hostsAnswerViewSchema = EffectSchema.Union([hostsAnswerSchema, failed]);

export type HostsAnswerView = typeof hostsAnswerViewSchema.Type;

export const devicePresenceAnswerViewSchema = EffectSchema.Union([
  devicePresenceAnswerSchema,
  failed,
]);

export type DevicePresenceAnswerView = typeof devicePresenceAnswerViewSchema.Type;

export const hostDoneAnswerViewSchema = EffectSchema.Union([hostDoneAnswerSchema, failed]);

export type HostDoneAnswerView = typeof hostDoneAnswerViewSchema.Type;

export const hostIdParamsSchema = hostIdRequestSchema;

export const thisMacHostSetParamsSchema = EffectSchema.Struct({
  on: EffectSchema.Boolean,
  deleteFolders: EffectSchema.optionalKey(EffectSchema.Boolean),
});

export type ThisMacHostSetParams = typeof thisMacHostSetParamsSchema.Type;

export const providerKeysAnswerViewSchema = EffectSchema.Union([providerKeysAnswerSchema, failed]);

export type ProviderKeysAnswerView = typeof providerKeysAnswerViewSchema.Type;

export const chatGptDeviceStartAnswerViewSchema = EffectSchema.Union([
  chatGptDeviceStartAnswerSchema,
  failed,
]);

export type ChatGptDeviceStartAnswerView = typeof chatGptDeviceStartAnswerViewSchema.Type;

export const chatGptDeviceLoginParamsSchema = chatGptDeviceLoginRequestSchema;

export type ChatGptDeviceLoginParams = typeof chatGptDeviceLoginParamsSchema.Type;

const CHATGPT_DEVICE_INTERVAL_MAX_SECONDS = 60;

export const chatGptDeviceWaitParamsSchema = EffectSchema.Struct({
  ...chatGptDeviceLoginRequestSchema.fields,
  intervalSeconds: EffectSchema.Int.check(
    EffectSchema.isGreaterThan(0),
    EffectSchema.isLessThanOrEqualTo(CHATGPT_DEVICE_INTERVAL_MAX_SECONDS),
  ),
});

export type ChatGptDeviceWaitParams = typeof chatGptDeviceWaitParamsSchema.Type;

export const chatGptDevicePollAnswerViewSchema = EffectSchema.Union([
  chatGptDevicePollAnswerSchema,
  failed,
]);

export type ChatGptDevicePollAnswerView = typeof chatGptDevicePollAnswerViewSchema.Type;

export const providerKeySaveParamsSchema = providerKeySaveRequestSchema;

export type ProviderKeySaveParams = typeof providerKeySaveParamsSchema.Type;

export const providerKeyRemoveParamsSchema = EffectSchema.Struct({
  provider: EffectSchema.Literals(Object.values(PROVIDER_KEY_PROVIDER)),
  kind: EffectSchema.optionalKey(providerKeyKindSchema),
});

export type ProviderKeyRemoveParams = typeof providerKeyRemoveParamsSchema.Type;

export const providerKeyForAgentsParamsSchema = providerKeyForAgentsRequestSchema;

export type ProviderKeyForAgentsParams = typeof providerKeyForAgentsParamsSchema.Type;

export const githubTokenAnswerViewSchema = EffectSchema.Union([githubTokenAnswerSchema, failed]);

export type GitHubTokenAnswerView = typeof githubTokenAnswerViewSchema.Type;

export const githubTokenSaveParamsSchema = githubTokenSaveRequestSchema;

export type GitHubTokenSaveParams = typeof githubTokenSaveParamsSchema.Type;

export const memoriesAnswerViewSchema = EffectSchema.Union([memoriesAnswerSchema, failed]);

export type MemoriesAnswerView = typeof memoriesAnswerViewSchema.Type;

export const memoriesFollowParamsSchema = EffectSchema.Struct({
  workspaceId: EffectSchema.NonEmptyString,
});

export type MemoriesFollowParams = typeof memoriesFollowParamsSchema.Type;

export const memoryForgetParamsSchema = EffectSchema.Struct({
  workspaceId: EffectSchema.NonEmptyString,
  id: memoryIdSchema,
});

export type MemoryForgetParams = typeof memoryForgetParamsSchema.Type;

export const agentDefaultWriteParamsSchema = modelChoiceSchema;

export const agentListParamsSchema = EffectSchema.Struct({
  taskId: EffectSchema.NonEmptyString,
  includeArchived: EffectSchema.optionalKey(EffectSchema.Boolean),
});

export type AgentListParams = typeof agentListParamsSchema.Type;

export const agentWorkspaceListParamsSchema = EffectSchema.Struct({
  workspaceId: EffectSchema.NonEmptyString,
  repository: EffectSchema.optionalKey(EffectSchema.NonEmptyString),
  words: EffectSchema.optionalKey(
    EffectSchema.NonEmptyString.check(EffectSchema.isMaxLength(AGENT_BOUNDS.MAX_SEARCH_CHARS)),
  ),
  includeArchived: EffectSchema.optionalKey(EffectSchema.Boolean),
});

export type AgentWorkspaceListParams = typeof agentWorkspaceListParamsSchema.Type;

export const agentListAnswerViewSchema = EffectSchema.Union([
  EffectSchema.Struct({ agents: EffectSchema.Array(agentSummarySchema) }),
  failed,
]);

export type AgentListAnswer = typeof agentListAnswerViewSchema.Type;

export const agentStartParamsSchema = EffectSchema.Struct({
  taskId: EffectSchema.optionalKey(EffectSchema.NonEmptyString),
  ...agentStartRequestFields,
}).check(EffectSchema.makeFilter(({ taskId, from }) => taskId !== undefined || from !== undefined));

export type AgentStartParams = typeof agentStartParamsSchema.Type;

export const agentAgentAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({
    agent: agentSummarySchema,
    txid: agentAnswerSchema.fields.txid,
    notice: agentAnswerSchema.fields.notice,
    addedCheckout: agentAnswerSchema.fields.addedCheckout,
  }),
  failedReaching,
]);

export type AgentAgentAnswer = typeof agentAgentAnswerSchema.Type;

const agentMessageAnswerViewSchema = EffectSchema.Union([agentMessageAnswerSchema, failedReaching]);

export type AgentMessageAnswerView = typeof agentMessageAnswerViewSchema.Type;

export const agentQueueParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  change: agentQueueChangeSchema,
  pictures: EffectSchema.optionalKey(
    EffectSchema.Array(wireUuidSchema).check(
      EffectSchema.isMaxLength(AGENT_BOUNDS.MAX_ATTACHMENTS),
    ),
  ),
});

export type AgentQueueParams = typeof agentQueueParamsSchema.Type;

export const agentQueueAnswerViewSchema = EffectSchema.Union([
  agentQueueAnswerSchema,
  failedReaching,
]);

export type AgentQueueAnswerView = typeof agentQueueAnswerViewSchema.Type;

export const agentDeleteAnswerViewSchema = EffectSchema.Union([agentDeleteAnswerSchema, failed]);

export type AgentDeleteAnswerView = typeof agentDeleteAnswerViewSchema.Type;

export const agentMessagesParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  after: EffectSchema.NonEmptyString,
  callId: EffectSchema.optionalKey(agentCallIdSchema),
});

export type AgentMessagesParams = typeof agentMessagesParamsSchema.Type;

export const agentMessagesAnswerViewSchema = EffectSchema.Union([
  agentMessagesAnswerSchema,
  failed,
]);

export type AgentMessagesAnswerView = typeof agentMessagesAnswerViewSchema.Type;

export const TRANSCRIPT_KIND = {
  AGENT: "agent",
} as const;

export const agentTranscriptKeySchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(TRANSCRIPT_KIND.AGENT),
  agentId: EffectSchema.NonEmptyString,
  callId: EffectSchema.optionalKey(agentCallIdSchema),
});

export type AgentTranscriptKey = typeof agentTranscriptKeySchema.Type;

const agentTranscriptPageSchema = EffectSchema.Union([
  EffectSchema.Struct({
    ...agentMessagesAnswerSchema.fields,
    newest: EffectSchema.optionalKey(EffectSchema.Literal(true)),
    before: EffectSchema.optionalKey(agentBeforeSchema),
    caughtUp: EffectSchema.Boolean,
  }),
  failed,
]);

export type AgentTranscriptPage = typeof agentTranscriptPageSchema.Type;

export const agentTranscriptOlderParamsSchema = EffectSchema.Struct({
  ...agentTranscriptKeySchema.fields,
  before: agentBeforeSchema,
});

export type AgentTranscriptOlderParams = typeof agentTranscriptOlderParamsSchema.Type;

export const agentTranscriptOlderAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ landed: EffectSchema.Boolean }),
  failed,
]);

export type AgentTranscriptOlderAnswer = typeof agentTranscriptOlderAnswerSchema.Type;

export const agentMessageParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  ...agentMessageRequestSchema.fields,
});

export type AgentMessageParams = typeof agentMessageParamsSchema.Type;

export const agentChooseParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  ...modelChoiceSchema.fields,
});

export type AgentChooseParams = typeof agentChooseParamsSchema.Type;

export const agentRenameParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  ...agentRenameRequestSchema.fields,
});

export type AgentRenameParams = typeof agentRenameParamsSchema.Type;

export const agentServersParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  ...agentServersRequestSchema.fields,
});

export type AgentServersParams = typeof agentServersParamsSchema.Type;

export const agentAddRepositoryParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  ...agentAddRepositoryRequestSchema.fields,
});

export type AgentAddRepositoryParams = typeof agentAddRepositoryParamsSchema.Type;

export const agentArchiveParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  ...agentArchiveRequestSchema.fields,
});

export type AgentArchiveParams = typeof agentArchiveParamsSchema.Type;

export const agentPinParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  ...agentPinRequestSchema.fields,
});

export type AgentPinParams = typeof agentPinParamsSchema.Type;

export const agentMarkReadParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  ...agentReadRequestSchema.fields,
});

export type AgentMarkReadParams = typeof agentMarkReadParamsSchema.Type;

export const agentStopParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
});

export type AgentStopParams = typeof agentStopParamsSchema.Type;

export const agentRewindParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  messageId: EffectSchema.NonEmptyString,
});

export type AgentRewindParams = typeof agentRewindParamsSchema.Type;

export const agentPageParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
});

export type AgentPageParams = typeof agentPageParamsSchema.Type;

export const agentPageAnswerViewSchema = EffectSchema.Union([agentPageAnswerSchema, failed]);

export type AgentPageAnswerView = typeof agentPageAnswerViewSchema.Type;

export const agentPullRequestParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
});

export type AgentPullRequestParams = typeof agentPullRequestParamsSchema.Type;

export const agentPullRequestReadParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  number: EffectSchema.optionalKey(githubPullRequestNumberSchema),
});

export type AgentPullRequestReadParams = typeof agentPullRequestReadParamsSchema.Type;

export const PULL_REQUEST_PART = {
  PULL_REQUEST: "pullRequest",
  CHECKS: "checks",
  CONVERSATION: "conversation",
  PUBLISHED: "published",
  REVIEW_OPTIONS: "reviewOptions",
  VIEWED: "viewed",
} as const;

export type PullRequestPart = (typeof PULL_REQUEST_PART)[keyof typeof PULL_REQUEST_PART];

export const pullRequestPartParamsSchema = EffectSchema.Struct({
  part: EffectSchema.Literals(Object.values(PULL_REQUEST_PART)),
  ...agentPullRequestReadParamsSchema.fields,
});

export type PullRequestPartParams = typeof pullRequestPartParamsSchema.Type;

export const agentPullRequestAnswerViewSchema = EffectSchema.Union([
  agentPullRequestAnswerSchema,
  failed,
]);

export type AgentPullRequestAnswerView = typeof agentPullRequestAnswerViewSchema.Type;

export const agentChangesAnswerViewSchema = EffectSchema.Union([agentChangesAnswerSchema, failed]);

export type AgentChangesAnswerView = typeof agentChangesAnswerViewSchema.Type;

export const agentOverviewPullRequestAnswerViewSchema = EffectSchema.Union([
  agentOverviewPullRequestAnswerSchema,
  failed,
]);

export type AgentOverviewPullRequestAnswerView =
  typeof agentOverviewPullRequestAnswerViewSchema.Type;

export const agentOverviewChecksAnswerViewSchema = EffectSchema.Union([
  agentOverviewChecksAnswerSchema,
  failed,
]);

export type AgentOverviewChecksAnswerView = typeof agentOverviewChecksAnswerViewSchema.Type;

export const agentOverviewConversationAnswerViewSchema = EffectSchema.Union([
  agentOverviewConversationAnswerSchema,
  failed,
]);

export type AgentOverviewConversationAnswerView =
  typeof agentOverviewConversationAnswerViewSchema.Type;

export const agentWorkspaceToolsAnswerViewSchema = EffectSchema.Union([
  workspaceToolsAnswerSchema,
  failed,
]);

export type AgentWorkspaceToolsAnswerView = typeof agentWorkspaceToolsAnswerViewSchema.Type;

export const agentReviewOptionsAnswerViewSchema = EffectSchema.Union([
  agentReviewOptionsAnswerSchema,
  failed,
]);

export type AgentReviewOptionsAnswerView = typeof agentReviewOptionsAnswerViewSchema.Type;

export const agentPullRequestActionParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  number: EffectSchema.optionalKey(githubPullRequestNumberSchema),
  request: pullRequestActionRequestSchema,
});

export type AgentPullRequestActionParams = typeof agentPullRequestActionParamsSchema.Type;

export const agentPullRequestWriteAnswerViewSchema = EffectSchema.Union([
  pullRequestWriteAnswerSchema,
  failed,
]);

export type AgentPullRequestWriteAnswerView = typeof agentPullRequestWriteAnswerViewSchema.Type;

export const agentPullRequestViewedAnswerViewSchema = EffectSchema.Union([
  pullRequestViewedAnswerSchema,
  failed,
]);

export type AgentPullRequestViewedAnswerView = typeof agentPullRequestViewedAnswerViewSchema.Type;

export const dictationTranscribeParamsSchema = dictationRequestSchema;

export type DictationTranscribeParams = typeof dictationTranscribeParamsSchema.Type;

export const dictationTranscribeAnswerViewSchema = EffectSchema.Union([
  dictationAnswerSchema,
  failed,
]);

export type DictationTranscribeAnswerView = typeof dictationTranscribeAnswerViewSchema.Type;

export const INBOX_SCOPE_KIND = {
  PLAN: "plan",
  AGENT: "agent",
} as const;

export const agentInboxScopeSchema = EffectSchema.Struct({
  kind: EffectSchema.Literals(Object.values(INBOX_SCOPE_KIND)),
  id: EffectSchema.NonEmptyString,
});

export type AgentInboxScope = typeof agentInboxScopeSchema.Type;

const agentInboxAnswerViewSchema = EffectSchema.Union([inboxAnswerSchema, failed]);

export type AgentInboxAnswerView = typeof agentInboxAnswerViewSchema.Type;

export const agentInboxAnswerParamsSchema = EffectSchema.Struct({
  itemId: EffectSchema.NonEmptyString,
  ...inboxAcknowledgeRequestSchema.fields,
});

export type AgentInboxAnswerParams = typeof agentInboxAnswerParamsSchema.Type;

export const agentInboxAnsweredViewSchema = EffectSchema.Union([inboxAnsweredSchema, failed]);

export type AgentInboxAnsweredView = typeof agentInboxAnsweredViewSchema.Type;

export const agentInboxCloseParamsSchema = EffectSchema.Struct({
  itemId: EffectSchema.NonEmptyString,
  ...inboxCloseRequestSchema.fields,
});

export type AgentInboxCloseParams = typeof agentInboxCloseParamsSchema.Type;

export const agentInboxMessageParamsSchema = EffectSchema.Struct({
  itemId: EffectSchema.NonEmptyString,
  ...inboxMessageRequestSchema.fields,
});

export type AgentInboxMessageParams = typeof agentInboxMessageParamsSchema.Type;

export const agentInboxMessagedViewSchema = EffectSchema.Union([inboxMessagedSchema, failed]);

export type AgentInboxMessagedView = typeof agentInboxMessagedViewSchema.Type;

export const agentInboxStartParamsSchema = inboxStartRequestSchema;

export type AgentInboxStartParams = typeof agentInboxStartParamsSchema.Type;

export const agentInboxItemHomeParamsSchema = EffectSchema.Struct({
  itemId: EffectSchema.NonEmptyString,
});

export type AgentInboxItemHomeParams = typeof agentInboxItemHomeParamsSchema.Type;

export const agentInboxItemHomeViewSchema = EffectSchema.Union([inboxItemHomeSchema, failed]);

export type AgentInboxItemHomeView = typeof agentInboxItemHomeViewSchema.Type;

export const agentInboxReadStateParamsSchema = EffectSchema.Struct({
  itemId: EffectSchema.NonEmptyString,
  unread: EffectSchema.Boolean,
});

export type AgentInboxReadStateParams = typeof agentInboxReadStateParamsSchema.Type;

export const agentInboxRemindParamsSchema = EffectSchema.Struct({
  itemId: EffectSchema.NonEmptyString,
  until: EffectSchema.NullOr(countedNumber),
});

export type AgentInboxRemindParams = typeof agentInboxRemindParamsSchema.Type;

export const agentInboxReadStateViewSchema = EffectSchema.Union([inboxReadStateSchema, failed]);

export type AgentInboxReadStateView = typeof agentInboxReadStateViewSchema.Type;

export const agentInboxReadAllParamsSchema = EffectSchema.Struct({
  ...inboxReadAllRequestSchema.fields,
  itemIds: EffectSchema.Array(EffectSchema.NonEmptyString),
});

export type AgentInboxReadAllParams = typeof agentInboxReadAllParamsSchema.Type;

export const agentInboxReadAllViewSchema = EffectSchema.Union([inboxReadAllSchema, failed]);

export type AgentInboxReadAllView = typeof agentInboxReadAllViewSchema.Type;

export const agentAccountInboxAnswerViewSchema = EffectSchema.Union([
  accountInboxAnswerSchema,
  failed,
]);

export type AgentAccountInboxAnswerView = typeof agentAccountInboxAnswerViewSchema.Type;

export const agentInboxAttachmentParamsSchema = EffectSchema.Struct({
  itemId: EffectSchema.NonEmptyString,
  attachmentId: EffectSchema.NonEmptyString,
});

export type AgentInboxAttachmentParams = typeof agentInboxAttachmentParamsSchema.Type;

export const agentPictureParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  pictureId: EffectSchema.NonEmptyString,
  callId: EffectSchema.optionalKey(EffectSchema.NonEmptyString),
});

export type AgentPictureParams = typeof agentPictureParamsSchema.Type;

export const agentPartParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  messageId: EffectSchema.NonEmptyString,
  index: EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(0)),
  callId: EffectSchema.optionalKey(EffectSchema.NonEmptyString),
});

export type AgentPartParams = typeof agentPartParamsSchema.Type;

export const agentPartViewSchema = EffectSchema.Union([agentPartAnswerSchema, failed]);

export type AgentPartView = typeof agentPartViewSchema.Type;

export const agentInboxAttachmentViewSchema = EffectSchema.Union([
  EffectSchema.Struct({
    contentType: EffectSchema.Literals([
      ...Object.values(AGENT_ATTACHMENT_TYPE),
      CONVERSATION_MEDIA_TYPE.WEBM,
    ]),
    base64: EffectSchema.String,
  }),
  failed,
]);

export type AgentInboxAttachmentView = typeof agentInboxAttachmentViewSchema.Type;

export const agentGitHubImageParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  src: EffectSchema.NonEmptyString.check(
    EffectSchema.isMaxLength(GITHUB_IMAGE_BOUNDS.MAX_URL_CHARS),
  ),
});

export type AgentGitHubImageParams = typeof agentGitHubImageParamsSchema.Type;

export const githubImageTypeSchema = EffectSchema.Literals(Object.values(GITHUB_IMAGE_TYPE));

export const agentGitHubImageViewSchema = EffectSchema.Union([
  EffectSchema.Struct({
    contentType: githubImageTypeSchema,
    base64: EffectSchema.String,
  }),
  failed,
]);

export type AgentGitHubImageView = typeof agentGitHubImageViewSchema.Type;
