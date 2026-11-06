import { Schema as EffectSchema } from "effect";
import { agentBrowserTabAnswerSchema, browserTabsPlaceSchema } from "./agent-browser-tab-wire.js";
import { agentAgentAnswerSchema } from "./agent-view.js";
import {
  AGENT_STATUS,
  type ListedAgent,
  listedAgentSchema,
  localAgentRefusalSchema,
  type TasklessAgent,
  tasklessAgentSchema,
} from "./agent-wire.js";
import { failureFactsSchema } from "./failure-facts.js";
import {
  githubRepositoryFullNameSchema,
  workspaceTokenRepositoriesAnswerSchema,
} from "./github-repositories-wire.js";
import {
  pagePlaceSchema,
  pageVersionNumberSchema,
  taskPageVersionAnswerSchema,
} from "./page-wire.js";
import { pictureDataUrlSchema } from "./picture-wire.js";
import { pinPositionSchema } from "./pin-order.js";
import { descriptionAttachmentTypeSchema } from "./description-attachment-wire.js";
import {
  descriptionCommentActionRequestSchema,
  descriptionCommentStartRequestSchema,
  descriptionCommentThreadAnswerSchema,
} from "./description-comment-wire.js";
import {
  DESCRIPTION_EDIT_REFUSAL,
  descriptionEditConflictSchema,
  descriptionEditRequestSchema,
} from "./description-edit.js";
import { readMarkSchema } from "./read-mark.js";
import {
  workspaceSentryAnswerSchema,
  workspaceSentryDisconnectRequestSchema,
} from "./sentry-install-wire.js";
import { wireUuidSchema } from "./service-wire.js";
import {
  workspaceSlackBotAnswerSchema,
  workspaceSlackBotChannelRequestSchema,
  workspaceSlackBotNotificationsRequestSchema,
  workspaceSlackBotRepositoryRequestSchema,
} from "./slack-bot-wire.js";
import { taskSectionsAnswerSchema, taskSectionWriteSchema } from "./task-section-wire.js";
import {
  listedPullRequestSchema,
  descriptionRevisionAnswerSchema,
  descriptionRevisionSeqSchema,
  descriptionRevisionsAnswerSchema,
  repositoryPinRequestSchema,
  repositoryPinSchema,
  type Task,
  taskAgentPinSchema,
  taskAssigneeIdSchema,
  taskBlockRequestSchema,
  taskCreateRequestSchema,
  taskFileRefusalSchema,
  taskFileRequestSchema,
  taskFileTextSchema,
  taskFileWindowSchema,
  taskNumberSchema,
  taskPrioritySchema,
  taskPullRequestsSchema,
  taskRelationChangeRequestSchema,
  taskRenameRequestSchema,
  taskSkillsSchema,
  taskStatusSchema,
  taskSummarySchema,
  taskTreeFolderSchema,
  taskTreeRequestSchema,
  workspaceIdSchema,
} from "./task-wire.js";
import { WORKSPACE_CALL_FAILURE } from "./workspace-call.js";
import {
  workspaceInvitationCancelSchema,
  workspaceInvitationSchema,
  workspaceInviteRequestSchema,
} from "./workspace-invitation-wire.js";
import {
  formerMemberSchema,
  workspaceCreateRequestSchema,
  workspaceGithubRequestSchema,
  workspaceLeaveRequestSchema,
  workspaceMemberRemovalSchema,
  workspaceMemberRoleSchema,
  workspaceMemberSchema,
  workspacePhotoSetRequestSchema,
  workspaceRenameRequestSchema,
  workspaceSchema,
  workspaceSlugSetRequestSchema,
  workspaceTokenRepositoryRequestSchema,
  workspaceTransferSchema,
} from "./workspace-wire.js";

export const TASKS_READ = {
  IDLE: "idle",
  READING: "reading",
  READY: "ready",
  FAILED: "failed",
} as const;

const tasksReadSchema = EffectSchema.Literals(Object.values(TASKS_READ));

export const HOST_LIVE = {
  LIVE: "live",
  CATCHING_UP: "catching-up",
  OFFLINE: "offline",
} as const;

export type HostLive = (typeof HOST_LIVE)[keyof typeof HOST_LIVE];

export type HeldDescriptionDocument = { readonly task: Task } | { readonly gone: true };

const codeTokenSchema = EffectSchema.Struct({
  text: EffectSchema.String,
  color: EffectSchema.optionalKey(EffectSchema.String),
  lightColor: EffectSchema.optionalKey(EffectSchema.String),
});

export type CodeToken = typeof codeTokenSchema.Type;

export const codeLinesSchema = EffectSchema.Array(EffectSchema.Array(codeTokenSchema));

export type CodeLines = typeof codeLinesSchema.Type;

export const githubConnectionSchema = EffectSchema.Struct({
  connected: EffectSchema.Boolean,
  login: EffectSchema.NullOr(EffectSchema.String),
});

export const tasksViewSchema = EffectSchema.Struct({
  tasks: EffectSchema.Array(taskSummarySchema),
  tasklessAgents: EffectSchema.optionalKey(EffectSchema.Array(tasklessAgentSchema)),
  taskAgents: EffectSchema.optionalKey(EffectSchema.Array(listedAgentSchema)),
  taskPullRequests: EffectSchema.optionalKey(EffectSchema.Array(taskPullRequestsSchema)),
  agentPullRequests: EffectSchema.optionalKey(EffectSchema.Array(listedPullRequestSchema)),
  taskAgentPins: EffectSchema.optionalKey(EffectSchema.Array(taskAgentPinSchema)),
  pendingTasks: EffectSchema.optionalKey(EffectSchema.Array(EffectSchema.String)),
  listStatus: tasksReadSchema,
  live: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(HOST_LIVE))),
  workspaces: EffectSchema.Array(workspaceSchema),
  workspacesStatus: EffectSchema.optionalKey(tasksReadSchema),
  github: EffectSchema.optionalKey(githubConnectionSchema),
  repositoryPins: EffectSchema.optionalKey(EffectSchema.Array(repositoryPinSchema)),
  taskSections: EffectSchema.optionalKey(taskSectionsAnswerSchema),
  activeTaskId: EffectSchema.optionalKey(EffectSchema.String),
});

export type TasksView = typeof tasksViewSchema.Type;

export const IDLE_TASKS_VIEW: TasksView = {
  tasks: [],
  listStatus: TASKS_READ.IDLE,
  workspaces: [],
};

export function workingAgentCount(view: TasksView): number {
  const listed = [...(view.taskAgents ?? []), ...(view.tasklessAgents ?? [])];
  return listed.filter(
    (agent) => agent.status === AGENT_STATUS.STARTING || agent.status === AGENT_STATUS.RUNNING,
  ).length;
}

export function summaryOfTaskless({ automationId, ...agent }: TasklessAgent): ListedAgent {
  return automationId === null ? agent : { ...agent, automationId };
}

export const tasksStartRequestSchema = EffectSchema.Struct({
  ...taskCreateRequestSchema.fields,
  quiet: EffectSchema.optionalKey(EffectSchema.Boolean),
});

export type TasksStartRequest = typeof tasksStartRequestSchema.Type;

export const tasksRepositoriesParamsSchema = EffectSchema.Struct({
  workspaceId: EffectSchema.optionalKey(workspaceSchema.fields.id),
});

export type TasksRepositoriesParams = typeof tasksRepositoriesParamsSchema.Type;

export const tasksRenameParamsSchema = EffectSchema.Struct({
  taskId: EffectSchema.NonEmptyString,
  ...taskRenameRequestSchema.fields,
});

export type TasksRenameParams = typeof tasksRenameParamsSchema.Type;

export const tasksPinParamsSchema = EffectSchema.Struct({
  taskId: EffectSchema.NonEmptyString,
  pinned: EffectSchema.Boolean,
  position: EffectSchema.optionalKey(pinPositionSchema),
});

export type TasksPinParams = typeof tasksPinParamsSchema.Type;

export const tasksMarkReadParamsSchema = EffectSchema.Struct({
  taskId: EffectSchema.NonEmptyString,
  readMark: readMarkSchema,
});

export type TasksMarkReadParams = typeof tasksMarkReadParamsSchema.Type;

export const tasksPinRepositoryParamsSchema = repositoryPinRequestSchema;

export type TasksPinRepositoryParams = typeof tasksPinRepositoryParamsSchema.Type;

export const tasksWriteSectionParamsSchema = EffectSchema.Struct({
  writes: EffectSchema.NonEmptyArray(taskSectionWriteSchema),
});

export type TasksWriteSectionParams = typeof tasksWriteSectionParamsSchema.Type;

export const tasksSetRepositoryParamsSchema = EffectSchema.Struct({
  taskId: EffectSchema.NonEmptyString,
  repository: EffectSchema.NullOr(githubRepositoryFullNameSchema),
});

export type TasksSetRepositoryParams = typeof tasksSetRepositoryParamsSchema.Type;

function namesAStanding(params: {
  status?: unknown;
  priority?: unknown;
  assigneeId?: unknown;
}): boolean {
  return (
    params.status !== undefined || params.priority !== undefined || params.assigneeId !== undefined
  );
}

export const tasksSetStandingParamsSchema = EffectSchema.Struct({
  taskId: EffectSchema.NonEmptyString,
  status: EffectSchema.optionalKey(taskStatusSchema),
  priority: EffectSchema.optionalKey(taskPrioritySchema),
  assigneeId: EffectSchema.optionalKey(EffectSchema.NullOr(taskAssigneeIdSchema)),
  assigneeName: EffectSchema.optionalKey(EffectSchema.String),
}).check(EffectSchema.makeFilter(namesAStanding));

export type TasksSetStandingParams = typeof tasksSetStandingParamsSchema.Type;

export const tasksMoveParamsSchema = EffectSchema.Struct({
  taskId: EffectSchema.NonEmptyString,
  workspaceId: workspaceIdSchema,
});

export type TasksMoveParams = typeof tasksMoveParamsSchema.Type;

export const tasksBlockParamsSchema = EffectSchema.Struct({
  taskId: EffectSchema.NonEmptyString,
  block: taskBlockRequestSchema,
});

export type TasksBlockParams = typeof tasksBlockParamsSchema.Type;

export const tasksSetParentParamsSchema = EffectSchema.Struct({
  taskId: EffectSchema.NonEmptyString,
  parentTaskId: EffectSchema.NullOr(wireUuidSchema),
});

export type TasksSetParentParams = typeof tasksSetParentParamsSchema.Type;

export const tasksChangeRelationParamsSchema = EffectSchema.Struct({
  taskId: EffectSchema.NonEmptyString,
  relation: taskRelationChangeRequestSchema,
});

export type TasksChangeRelationParams = typeof tasksChangeRelationParamsSchema.Type;

export const TASK_CALL_FAILURE = {
  UNANSWERED: "unanswered",
  NOT_FOUND: "not-found",
  REPOSITORY_NOT_REACHABLE: "repository-not-reachable",
  LOCAL_AGENT_REFUSED: "local-agent-refused",
} as const;

export type TaskCallFailure = (typeof TASK_CALL_FAILURE)[keyof typeof TASK_CALL_FAILURE];

const REPOSITORY_CALL_FAILURES = [
  TASK_CALL_FAILURE.UNANSWERED,
  TASK_CALL_FAILURE.REPOSITORY_NOT_REACHABLE,
] as const;

export type RepositoryCallFailure = (typeof REPOSITORY_CALL_FAILURES)[number];

const repositoryCallFailureSchema = EffectSchema.Literals(REPOSITORY_CALL_FAILURES);

export const TASK_PARENT_FAILURE = {
  CYCLE: "parent-cycle",
  REPOSITORY_DIFFERS: "parent-repository-differs",
  HELD: "parent-held",
} as const;

const START_CALL_FAILURES = [
  ...REPOSITORY_CALL_FAILURES,
  TASK_CALL_FAILURE.NOT_FOUND,
  TASK_CALL_FAILURE.LOCAL_AGENT_REFUSED,
  TASK_PARENT_FAILURE.REPOSITORY_DIFFERS,
  TASK_PARENT_FAILURE.HELD,
] as const;

export type StartCallFailure = (typeof START_CALL_FAILURES)[number];

export const tasksStartAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({
    planId: EffectSchema.String,
    agentStart: EffectSchema.optionalKey(agentAgentAnswerSchema),
  }),
  EffectSchema.Struct({
    failure: EffectSchema.Literals(START_CALL_FAILURES),
    localAgentRefusal: EffectSchema.optionalKey(localAgentRefusalSchema),
    cause: EffectSchema.optionalKey(failureFactsSchema),
  }),
]);

export type TasksStartAnswer = typeof tasksStartAnswerSchema.Type;

const REPOSITORY_LIST_FAILURES = [TASK_CALL_FAILURE.UNANSWERED] as const;

export type RepositoryListFailure = (typeof REPOSITORY_LIST_FAILURES)[number];

export const tasksSetRepositoryAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ repository: EffectSchema.NullOr(EffectSchema.String) }),
  EffectSchema.Struct({ failure: repositoryCallFailureSchema }),
]);

export type TasksSetRepositoryAnswer = typeof tasksSetRepositoryAnswerSchema.Type;

export const tasksMoveAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ workspaceId: EffectSchema.String }),
  EffectSchema.Struct({ failure: EffectSchema.Literals(Object.values(TASK_CALL_FAILURE)) }),
]);

export type TasksMoveAnswer = typeof tasksMoveAnswerSchema.Type;

export const TASK_BLOCK_FAILURE = {
  CYCLE: "block-cycle",
} as const;

const BLOCK_CALL_FAILURES = [
  TASK_CALL_FAILURE.UNANSWERED,
  TASK_CALL_FAILURE.NOT_FOUND,
  TASK_BLOCK_FAILURE.CYCLE,
] as const;

export type BlockCallFailure = (typeof BLOCK_CALL_FAILURES)[number];

export const tasksBlockAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({
    blockedBy: EffectSchema.Array(EffectSchema.String),
    blocks: EffectSchema.Array(EffectSchema.String),
  }),
  EffectSchema.Struct({ failure: EffectSchema.Literals(BLOCK_CALL_FAILURES) }),
]);

export type TasksBlockAnswer = typeof tasksBlockAnswerSchema.Type;

const PARENT_CALL_FAILURES = [
  TASK_CALL_FAILURE.UNANSWERED,
  TASK_CALL_FAILURE.NOT_FOUND,
  TASK_PARENT_FAILURE.CYCLE,
  TASK_PARENT_FAILURE.REPOSITORY_DIFFERS,
] as const;

export type ParentCallFailure = (typeof PARENT_CALL_FAILURES)[number];

export const tasksSetParentAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ parentTaskId: EffectSchema.NullOr(EffectSchema.String) }),
  EffectSchema.Struct({ failure: EffectSchema.Literals(PARENT_CALL_FAILURES) }),
]);

export type TasksSetParentAnswer = typeof tasksSetParentAnswerSchema.Type;

const RELATION_CALL_FAILURES = [...BLOCK_CALL_FAILURES, ...PARENT_CALL_FAILURES] as const;

export type RelationCallFailure = (typeof RELATION_CALL_FAILURES)[number];

export const tasksChangeRelationAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({
    blockedBy: EffectSchema.Array(EffectSchema.String),
    blocks: EffectSchema.Array(EffectSchema.String),
    parentTaskId: EffectSchema.NullOr(EffectSchema.String),
  }),
  EffectSchema.Struct({ failure: EffectSchema.Literals(RELATION_CALL_FAILURES) }),
]);

export type TasksChangeRelationAnswer = typeof tasksChangeRelationAnswerSchema.Type;

export const tasksEditParamsSchema = EffectSchema.Struct({
  taskId: EffectSchema.NonEmptyString,
  edit: descriptionEditRequestSchema,
});

export type TasksEditParams = typeof tasksEditParamsSchema.Type;

const EDIT_FAILURES = [
  TASK_CALL_FAILURE.UNANSWERED,
  TASK_CALL_FAILURE.NOT_FOUND,
  DESCRIPTION_EDIT_REFUSAL.TOO_LONG,
] as const;

export type TasksEditFailure = (typeof EDIT_FAILURES)[number];

export const tasksEditAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ saved: EffectSchema.Literal(true) }),
  EffectSchema.Struct({ conflict: descriptionEditConflictSchema }),
  EffectSchema.Struct({ failure: EffectSchema.Literals(EDIT_FAILURES) }),
]);

export type TasksEditAnswer = typeof tasksEditAnswerSchema.Type;

const repositoryPlaceFields = {
  workspaceId: workspaceIdSchema,
  repository: githubRepositoryFullNameSchema,
};

export const tasksFileParamsSchema = EffectSchema.Union([
  EffectSchema.Struct({ taskId: EffectSchema.NonEmptyString, ...taskFileRequestSchema.fields }),
  EffectSchema.Struct({ ...repositoryPlaceFields, ...taskFileRequestSchema.fields }),
]);

export type TasksFileParams = typeof tasksFileParamsSchema.Type;

export const tasksFileAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ file: taskFileWindowSchema }),
  EffectSchema.Struct({ text: taskFileTextSchema }),
  taskFileRefusalSchema,
  EffectSchema.Struct({ failure: EffectSchema.Literal(TASK_CALL_FAILURE.UNANSWERED) }),
]);

export type TasksFileAnswer = typeof tasksFileAnswerSchema.Type;

export const tasksTreeParamsSchema = EffectSchema.Union([
  EffectSchema.Struct({ planId: EffectSchema.NonEmptyString, ...taskTreeRequestSchema.fields }),
  EffectSchema.Struct({ ...repositoryPlaceFields, ...taskTreeRequestSchema.fields }),
]);

export type TasksTreeParams = typeof tasksTreeParamsSchema.Type;

export const tasksTreeAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ folder: taskTreeFolderSchema }),
  taskFileRefusalSchema,
  EffectSchema.Struct({ failure: EffectSchema.Literal(TASK_CALL_FAILURE.UNANSWERED) }),
]);

export type TasksTreeAnswer = typeof tasksTreeAnswerSchema.Type;

export const tasksSkillsParamsSchema = EffectSchema.Union([
  EffectSchema.Struct({ planId: EffectSchema.NonEmptyString }),
  EffectSchema.Struct({
    workspaceId: repositoryPlaceFields.workspaceId,
    repository: EffectSchema.optionalKey(repositoryPlaceFields.repository),
  }),
]);

export type TasksSkillsParams = typeof tasksSkillsParamsSchema.Type;

export const tasksSkillsAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ skills: taskSkillsSchema }),
  taskFileRefusalSchema,
  EffectSchema.Struct({ failure: EffectSchema.Literal(TASK_CALL_FAILURE.UNANSWERED) }),
]);

export type TasksSkillsAnswer = typeof tasksSkillsAnswerSchema.Type;

const LINK_ADDRESS_MAX_CHARS = 2_048;

export const tasksLinkStandingParamsSchema = EffectSchema.Struct({
  workspaceId: workspaceSchema.fields.id,
  address: EffectSchema.String.check(
    EffectSchema.isMinLength(1),
    EffectSchema.isMaxLength(LINK_ADDRESS_MAX_CHARS),
  ),
});

export type TasksLinkStandingParams = typeof tasksLinkStandingParamsSchema.Type;

export const BROWSER_TAB_OPEN_FAILURE = {
  UNANSWERED: TASK_CALL_FAILURE.UNANSWERED,
  NOT_FOUND: TASK_CALL_FAILURE.NOT_FOUND,
  NOT_PERMITTED: "not-permitted",
  INVALID_ADDRESS: "invalid-address",
  NOT_READY: "not-ready",
  RETIRED: "retired",
  UNREACHABLE: "unreachable",
} as const;

export type BrowserTabOpenFailure =
  (typeof BROWSER_TAB_OPEN_FAILURE)[keyof typeof BROWSER_TAB_OPEN_FAILURE];

export const tasksBrowserTabOpenParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  address: EffectSchema.NonEmptyString,
});

export type TasksBrowserTabOpenParams = typeof tasksBrowserTabOpenParamsSchema.Type;

export const tasksBrowserTabOpenAnswerSchema = EffectSchema.Union([
  agentBrowserTabAnswerSchema,
  EffectSchema.Struct({
    failure: EffectSchema.Literals(Object.values(BROWSER_TAB_OPEN_FAILURE)),
  }),
]);

export type TasksBrowserTabOpenAnswer = typeof tasksBrowserTabOpenAnswerSchema.Type;

export const taskBrowserTabsFollowSchema = browserTabsPlaceSchema;

export type TaskBrowserTabsFollow = typeof taskBrowserTabsFollowSchema.Type;

export const tasksFindParamsSchema = EffectSchema.Struct({
  workspace: EffectSchema.NonEmptyString,
  number: taskNumberSchema,
});

export type TasksFindParams = typeof tasksFindParamsSchema.Type;

export const tasksFindAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ taskId: EffectSchema.NonEmptyString }),
  EffectSchema.Struct({ failure: EffectSchema.Literal(TASK_CALL_FAILURE.UNANSWERED) }),
]);

export type TasksFindAnswer = typeof tasksFindAnswerSchema.Type;

export const tasksRevisionsParamsSchema = EffectSchema.Struct({
  taskId: EffectSchema.NonEmptyString,
  before: EffectSchema.optionalKey(descriptionRevisionSeqSchema),
});

export type TasksRevisionsParams = typeof tasksRevisionsParamsSchema.Type;

export const tasksRevisionsAnswerSchema = EffectSchema.Union([
  descriptionRevisionsAnswerSchema,
  EffectSchema.Struct({ failure: EffectSchema.Literal(TASK_CALL_FAILURE.UNANSWERED) }),
]);

export type TasksRevisionsAnswer = typeof tasksRevisionsAnswerSchema.Type;

export const taskDocumentFollowSchema = EffectSchema.Struct({
  taskId: EffectSchema.NonEmptyString,
});

export type TaskDocumentFollow = typeof taskDocumentFollowSchema.Type;

export const taskHistoryFollowSchema = EffectSchema.Struct({ taskId: EffectSchema.NonEmptyString });

export type TaskHistoryFollow = typeof taskHistoryFollowSchema.Type;

export const tasksRevisionParamsSchema = EffectSchema.Struct({
  taskId: EffectSchema.NonEmptyString,
  seq: descriptionRevisionSeqSchema,
});

export type TasksRevisionParams = typeof tasksRevisionParamsSchema.Type;

export const tasksRevisionAnswerSchema = EffectSchema.Union([
  descriptionRevisionAnswerSchema,
  EffectSchema.Struct({ failure: EffectSchema.Literal(TASK_CALL_FAILURE.UNANSWERED) }),
]);

export type TasksRevisionAnswer = typeof tasksRevisionAnswerSchema.Type;

export const tasksPictureParamsSchema = EffectSchema.Struct({
  planId: EffectSchema.NonEmptyString,
  attachmentId: EffectSchema.NonEmptyString,
});

export type TasksPictureParams = typeof tasksPictureParamsSchema.Type;

export const tasksPictureAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({
    contentType: descriptionAttachmentTypeSchema,
    base64: EffectSchema.String,
  }),
  EffectSchema.Struct({
    failure: EffectSchema.Literals([TASK_CALL_FAILURE.NOT_FOUND, TASK_CALL_FAILURE.UNANSWERED]),
  }),
]);

export type TasksPictureAnswer = typeof tasksPictureAnswerSchema.Type;

export const tasksPictureKeepParamsSchema = EffectSchema.Struct({
  planId: EffectSchema.NonEmptyString,
  picture: pictureDataUrlSchema,
});

export type TasksPictureKeepParams = typeof tasksPictureKeepParamsSchema.Type;

export const PICTURE_KEEP_FAILURE = {
  TOO_MANY: "too-many",
  TOO_MANY_VIDEOS: "too-many-videos",
  NOT_FOUND: TASK_CALL_FAILURE.NOT_FOUND,
  UNANSWERED: TASK_CALL_FAILURE.UNANSWERED,
} as const;

export const tasksPictureKeepAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ id: EffectSchema.NonEmptyString }),
  EffectSchema.Struct({ failure: EffectSchema.Literals(Object.values(PICTURE_KEEP_FAILURE)) }),
]);

export type TasksPictureKeepAnswer = typeof tasksPictureKeepAnswerSchema.Type;

export const tasksPageParamsSchema = EffectSchema.Union([
  EffectSchema.Struct({
    taskId: EffectSchema.NonEmptyString,
    pageId: EffectSchema.NonEmptyString,
    version: pageVersionNumberSchema,
  }),
  EffectSchema.Struct({
    agentId: EffectSchema.NonEmptyString,
    pageId: EffectSchema.NonEmptyString,
    version: pageVersionNumberSchema,
  }),
]);

export type TasksPageParams = typeof tasksPageParamsSchema.Type;

export const tasksPageAnswerSchema = EffectSchema.Union([
  taskPageVersionAnswerSchema,
  EffectSchema.Struct({ failure: EffectSchema.Literal(TASK_CALL_FAILURE.UNANSWERED) }),
]);

export type TasksPageAnswer = typeof tasksPageAnswerSchema.Type;

export const taskPagesFollowSchema = pagePlaceSchema;

export type TaskPagesFollow = typeof taskPagesFollowSchema.Type;

export const tasksPageSourceAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ lines: codeLinesSchema }),
  EffectSchema.Struct({ failure: EffectSchema.Literal(TASK_CALL_FAILURE.UNANSWERED) }),
]);

export type TasksPageSourceAnswer = typeof tasksPageSourceAnswerSchema.Type;

const workspaceCallFailureSchema = EffectSchema.Struct({
  failure: EffectSchema.Literals(Object.values(WORKSPACE_CALL_FAILURE)),
});

export const tasksWorkspaceCreateParamsSchema = workspaceCreateRequestSchema;

export type TasksWorkspaceCreateParams = typeof tasksWorkspaceCreateParamsSchema.Type;

export const tasksWorkspaceRenameParamsSchema = workspaceRenameRequestSchema;

export type TasksWorkspaceRenameParams = typeof tasksWorkspaceRenameParamsSchema.Type;

export const tasksWorkspaceSlugSetParamsSchema = workspaceSlugSetRequestSchema;

export type TasksWorkspaceSlugSetParams = typeof tasksWorkspaceSlugSetParamsSchema.Type;

export const tasksWorkspacePhotoSetParamsSchema = workspacePhotoSetRequestSchema;

export type TasksWorkspacePhotoSetParams = typeof tasksWorkspacePhotoSetParamsSchema.Type;

export const tasksWorkspaceParamsSchema = workspaceGithubRequestSchema;

export type TasksWorkspaceParams = typeof tasksWorkspaceParamsSchema.Type;

export const tasksWorkspaceAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ workspace: workspaceSchema }),
  workspaceCallFailureSchema,
]);

export type TasksWorkspaceAnswer = typeof tasksWorkspaceAnswerSchema.Type;

export const tasksWorkspaceGitHubConnectAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ url: EffectSchema.String }),
  workspaceCallFailureSchema,
]);

export type TasksWorkspaceGitHubConnectAnswer = typeof tasksWorkspaceGitHubConnectAnswerSchema.Type;

export const tasksWorkspaceSentryDisconnectParamsSchema = workspaceSentryDisconnectRequestSchema;

export type TasksWorkspaceSentryDisconnectParams =
  typeof tasksWorkspaceSentryDisconnectParamsSchema.Type;

export const tasksWorkspaceSentryAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ sentry: workspaceSentryAnswerSchema }),
  workspaceCallFailureSchema,
]);

export type TasksWorkspaceSentryAnswer = typeof tasksWorkspaceSentryAnswerSchema.Type;

export const tasksWorkspaceSlackBotAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ slackBot: workspaceSlackBotAnswerSchema }),
  workspaceCallFailureSchema,
]);

export type TasksWorkspaceSlackBotAnswer = typeof tasksWorkspaceSlackBotAnswerSchema.Type;

export const tasksWorkspaceSlackBotNotificationsParamsSchema =
  workspaceSlackBotNotificationsRequestSchema;

export type TasksWorkspaceSlackBotNotificationsParams =
  typeof tasksWorkspaceSlackBotNotificationsParamsSchema.Type;

export const tasksWorkspaceSlackBotRepositoryParamsSchema =
  workspaceSlackBotRepositoryRequestSchema;

export type TasksWorkspaceSlackBotRepositoryParams =
  typeof tasksWorkspaceSlackBotRepositoryParamsSchema.Type;

export const tasksWorkspaceSlackBotChannelParamsSchema = workspaceSlackBotChannelRequestSchema;

export type TasksWorkspaceSlackBotChannelParams =
  typeof tasksWorkspaceSlackBotChannelParamsSchema.Type;

export const tasksWorkspaceMemberRemoveParamsSchema = workspaceMemberRemovalSchema;

export type TasksWorkspaceMemberRemoveParams = typeof tasksWorkspaceMemberRemoveParamsSchema.Type;

export const tasksWorkspaceMemberRoleParamsSchema = workspaceMemberRoleSchema;

export type TasksWorkspaceMemberRoleParams = typeof tasksWorkspaceMemberRoleParamsSchema.Type;

export const tasksWorkspaceTransferParamsSchema = workspaceTransferSchema;

export type TasksWorkspaceTransferParams = typeof tasksWorkspaceTransferParamsSchema.Type;

export const tasksWorkspaceMembersAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({
    members: EffectSchema.Array(workspaceMemberSchema),
    former: EffectSchema.optionalKey(EffectSchema.Array(formerMemberSchema)),
  }),
  workspaceCallFailureSchema,
]);

export type TasksWorkspaceMembersAnswer = typeof tasksWorkspaceMembersAnswerSchema.Type;

export const workspacePeopleFollowSchema = EffectSchema.Struct({ workspaceId: workspaceIdSchema });

export type WorkspacePeopleFollow = typeof workspacePeopleFollowSchema.Type;

export const tasksWorkspaceTokenRepositoriesParamsSchema = workspaceLeaveRequestSchema;

export type TasksWorkspaceTokenRepositoriesParams =
  typeof tasksWorkspaceTokenRepositoriesParamsSchema.Type;

export const tasksWorkspaceTokenRepositorySetParamsSchema = workspaceTokenRepositoryRequestSchema;

export type TasksWorkspaceTokenRepositorySetParams =
  typeof tasksWorkspaceTokenRepositorySetParamsSchema.Type;

export const tasksWorkspaceTokenRepositoriesAnswerSchema = EffectSchema.Union([
  workspaceTokenRepositoriesAnswerSchema,
  workspaceCallFailureSchema,
]);

export type TasksWorkspaceTokenRepositoriesAnswer =
  typeof tasksWorkspaceTokenRepositoriesAnswerSchema.Type;

export const tasksWorkspaceLeaveParamsSchema = workspaceLeaveRequestSchema;

export type TasksWorkspaceLeaveParams = typeof tasksWorkspaceLeaveParamsSchema.Type;

export const tasksWorkspaceLeaveAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ left: EffectSchema.Literal(true) }),
  workspaceCallFailureSchema,
]);

export type TasksWorkspaceLeaveAnswer = typeof tasksWorkspaceLeaveAnswerSchema.Type;

export const tasksWorkspaceInviteParamsSchema = workspaceInviteRequestSchema;

export type TasksWorkspaceInviteParams = typeof tasksWorkspaceInviteParamsSchema.Type;

export const tasksWorkspaceInvitationAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ invitation: workspaceInvitationSchema }),
  workspaceCallFailureSchema,
]);

export type TasksWorkspaceInvitationAnswer = typeof tasksWorkspaceInvitationAnswerSchema.Type;

export const tasksWorkspaceInvitationCancelParamsSchema = workspaceInvitationCancelSchema;

export type TasksWorkspaceInvitationCancelParams =
  typeof tasksWorkspaceInvitationCancelParamsSchema.Type;

export const tasksWorkspaceInvitationsAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ invitations: EffectSchema.Array(workspaceInvitationSchema) }),
  workspaceCallFailureSchema,
]);

export type TasksWorkspaceInvitationsAnswer = typeof tasksWorkspaceInvitationsAnswerSchema.Type;

export const tasksGitHubPageAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ url: EffectSchema.String }),
  EffectSchema.Struct({ failure: EffectSchema.Literal(TASK_CALL_FAILURE.UNANSWERED) }),
]);

export type TasksGitHubPageAnswer = typeof tasksGitHubPageAnswerSchema.Type;

export const GITHUB_DISCONNECT_FAILURE = {
  UNANSWERED: TASK_CALL_FAILURE.UNANSWERED,
  NOT_PERMITTED: "not-permitted",
} as const;

export const tasksGitHubDisconnectAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ connection: githubConnectionSchema }),
  EffectSchema.Struct({
    failure: EffectSchema.Literals(Object.values(GITHUB_DISCONNECT_FAILURE)),
  }),
]);

export type TasksGitHubDisconnectAnswer = typeof tasksGitHubDisconnectAnswerSchema.Type;

export const DESCRIPTION_COMMENT_CALL_FAILURE = {
  UNANSWERED: TASK_CALL_FAILURE.UNANSWERED,
  NOT_FOUND: TASK_CALL_FAILURE.NOT_FOUND,
} as const;

const descriptionCommentFailedSchema = EffectSchema.Struct({
  failure: EffectSchema.Literals(Object.values(DESCRIPTION_COMMENT_CALL_FAILURE)),
});

export const COMMENT_SUBJECT = {
  DESCRIPTION: "description",
  PAGE: "page",
} as const;

export const tasksCommentsFollowSchema = EffectSchema.Struct({
  taskId: EffectSchema.NonEmptyString,
  pageId: EffectSchema.optionalKey(EffectSchema.NonEmptyString),
});

export type TasksCommentsFollow = typeof tasksCommentsFollowSchema.Type;

export const tasksCommentStartParamsSchema = EffectSchema.Struct({
  planId: EffectSchema.NonEmptyString,
  start: descriptionCommentStartRequestSchema,
});

export type TasksCommentStartParams = typeof tasksCommentStartParamsSchema.Type;

export const tasksCommentActParamsSchema = EffectSchema.Struct({
  planId: EffectSchema.NonEmptyString,
  threadId: EffectSchema.NonEmptyString,
  action: descriptionCommentActionRequestSchema,
});

export type TasksCommentActParams = typeof tasksCommentActParamsSchema.Type;

export const tasksCommentAnswerSchema = EffectSchema.Union([
  descriptionCommentThreadAnswerSchema,
  descriptionCommentFailedSchema,
]);

export type TasksCommentAnswer = typeof tasksCommentAnswerSchema.Type;
