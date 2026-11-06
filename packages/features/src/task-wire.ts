import { WireValueSchema } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import {
  AGENT_MACHINE,
  AGENT_STATUS,
  agentPullRequestSchema,
  agentRunsOnRequestSchema,
  agentStartRequestFields,
  agentSummarySchema,
  CHECK_SUMMARY,
  extraRepositoryRefusalSchema,
  localAgentRefusalSchema,
  PULL_REQUEST_STATE,
  startBrief,
  tasklessAgentSchema,
} from "./agent-wire.js";
import { DEVICE_KIND, DEVICE_PLATFORM } from "./device-agent-wire.js";
import { githubRepositoryFullNameSchema } from "./github-repositories-wire.js";
import { modelProviderSchema } from "./models-wire.js";
import { pinPositionSchema } from "./pin-order.js";
import { type ReadMark, readMarkSchema } from "./read-mark.js";
import { chosenIdSchema, countedNumber, memberRefSchema, wireUuidSchema } from "./service-wire.js";
import { trimmedText } from "./text-schema.js";

export const TASK_BOUNDS = {
  MAX_NAME_CHARS: 200,
  MAX_BODY_CHARS: 200_000,
  MAX_ASSUMPTIONS: 200,
  MAX_ASSUMPTION_CHARS: 2_000,
  MAX_WORKSPACE_ID_CHARS: 200,
  MAX_BRIEF_CHARS: 16_000,
  MAX_START_RELATIONS: 20,
} as const;

export const UNTITLED_TASK_NAME = "Untitled";

const PLACEHOLDER_BRACKETS = /^<(.*)>$/u;

export function titlesNothing(title: string): boolean {
  const bare = title.trim().replace(PLACEHOLDER_BRACKETS, "$1").trim();
  return bare.toLowerCase() === UNTITLED_TASK_NAME.toLowerCase();
}

export const TASK_STATUS = {
  BACKLOG: "backlog",
  TODO: "todo",
  IN_PROGRESS: "in-progress",
  DONE: "done",
  CANCELED: "canceled",
} as const;

export type TaskStatus = (typeof TASK_STATUS)[keyof typeof TASK_STATUS];

export const TASK_STATUS_ORDER: readonly TaskStatus[] = [
  TASK_STATUS.BACKLOG,
  TASK_STATUS.TODO,
  TASK_STATUS.IN_PROGRESS,
  TASK_STATUS.DONE,
  TASK_STATUS.CANCELED,
];

export const TASK_PRIORITY = {
  NONE: "none",
  URGENT: "urgent",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
} as const;

export type TaskPriority = (typeof TASK_PRIORITY)[keyof typeof TASK_PRIORITY];

export const TASK_PRIORITY_ORDER: readonly TaskPriority[] = [
  TASK_PRIORITY.URGENT,
  TASK_PRIORITY.HIGH,
  TASK_PRIORITY.MEDIUM,
  TASK_PRIORITY.LOW,
  TASK_PRIORITY.NONE,
];

export const TASK_MODE = {
  AGENT: "agent",
  PILOT: "pilot",
} as const;

export type TaskMode = (typeof TASK_MODE)[keyof typeof TASK_MODE];

export const taskStatusSchema = EffectSchema.Literals(Object.values(TASK_STATUS));

export const taskPrioritySchema = EffectSchema.Literals(Object.values(TASK_PRIORITY));

export const taskModeSchema = EffectSchema.Literals(Object.values(TASK_MODE));

export const taskAssigneeIdSchema = EffectSchema.String.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(200),
);

export const taskNumberSchema = EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(1));

export const workspaceIdSchema = EffectSchema.String.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(TASK_BOUNDS.MAX_WORKSPACE_ID_CHARS),
);

const descriptionAssumptionSchema = EffectSchema.Struct({
  text: trimmedText(TASK_BOUNDS.MAX_ASSUMPTION_CHARS),
});

const descriptionDocumentSchema = EffectSchema.Struct({
  body: EffectSchema.String.check(EffectSchema.isMaxLength(TASK_BOUNDS.MAX_BODY_CHARS)),
  assumptions: EffectSchema.Array(descriptionAssumptionSchema).check(
    EffectSchema.isMaxLength(TASK_BOUNDS.MAX_ASSUMPTIONS),
  ),
});

export type DescriptionDocument = typeof descriptionDocumentSchema.Type;

const repositoryChoiceSchema = EffectSchema.NullOr(githubRepositoryFullNameSchema);

const taskRunsOnRequestSchema = agentRunsOnRequestSchema;

export type TaskRunsOnRequest = typeof taskRunsOnRequestSchema.Type;

const taskAgentStartSchema = EffectSchema.Struct({
  idempotencyKey: agentStartRequestFields.idempotencyKey,
  model: agentStartRequestFields.model,
  effort: agentStartRequestFields.effort,
  contextWindow: agentStartRequestFields.contextWindow,
  prompt: agentStartRequestFields.prompt,
  attachments: agentStartRequestFields.attachments,
  disabledServers: agentStartRequestFields.disabledServers,
  runsOn: agentStartRequestFields.runsOn,
  alsoRepositories: agentStartRequestFields.alsoRepositories,
  branch: agentStartRequestFields.branch,
  title: agentStartRequestFields.title,
}).check(startBrief);

export type TaskAgentStart = typeof taskAgentStartSchema.Type;

function agentStartsUnplanned(request: { agent?: TaskAgentStart; planning?: boolean }): boolean {
  return request.agent === undefined || request.planning !== true;
}

export const TASK_BLOCK_RELATION = {
  BLOCKED_BY: "blocked-by",
  BLOCKS: "blocks",
} as const;

export type TaskBlockRelation = (typeof TASK_BLOCK_RELATION)[keyof typeof TASK_BLOCK_RELATION];

export const TASK_CREATE_RELATION_KIND = {
  ...TASK_BLOCK_RELATION,
  SUB_TASK_OF: "sub-task-of",
  PARENT_OF: "parent-of",
} as const;

export type TaskCreateRelationKind =
  (typeof TASK_CREATE_RELATION_KIND)[keyof typeof TASK_CREATE_RELATION_KIND];

const taskCreateRelationSchema = EffectSchema.Struct({
  kind: EffectSchema.Literals(Object.values(TASK_CREATE_RELATION_KIND)),
  taskId: wireUuidSchema,
});

export type TaskCreateRelation = typeof taskCreateRelationSchema.Type;

export function startRelationsOf(request: {
  readonly relation?: TaskCreateRelation;
  readonly relations?: readonly TaskCreateRelation[];
}): readonly TaskCreateRelation[] {
  if (request.relations !== undefined) return request.relations;
  return request.relation === undefined ? [] : [request.relation];
}

function relationsThroughOneDoor(request: {
  relation?: TaskCreateRelation;
  relations?: readonly TaskCreateRelation[];
}): boolean {
  return request.relation === undefined || request.relations === undefined;
}

function relationNamedOnce(request: {
  parentTaskId?: string;
  relation?: TaskCreateRelation;
  relations?: readonly TaskCreateRelation[];
}): boolean {
  return request.parentTaskId === undefined || startRelationsOf(request).length === 0;
}

function relationsEachOnce(request: {
  relation?: TaskCreateRelation;
  relations?: readonly TaskCreateRelation[];
}): boolean {
  const relations = startRelationsOf(request);
  const parents = relations.filter(
    (relation) => relation.kind === TASK_CREATE_RELATION_KIND.SUB_TASK_OF,
  );
  const named = new Set(relations.map((relation) => relation.taskId));
  return parents.length <= 1 && named.size === relations.length;
}

export const taskCreateRequestSchema = EffectSchema.Struct({
  id: EffectSchema.optionalKey(chosenIdSchema),
  name: EffectSchema.optionalKey(
    EffectSchema.Trim.check(EffectSchema.isMaxLength(TASK_BOUNDS.MAX_NAME_CHARS)),
  ),
  workspaceId: EffectSchema.optionalKey(workspaceIdSchema),
  repository: EffectSchema.optionalKey(repositoryChoiceSchema),
  linearIssueId: EffectSchema.optionalKey(WireValueSchema),
  issues: EffectSchema.optionalKey(WireValueSchema),
  planning: EffectSchema.optionalKey(EffectSchema.Boolean),
  agent: EffectSchema.optionalKey(taskAgentStartSchema),
  runsOn: EffectSchema.optionalKey(taskRunsOnRequestSchema),
  brief: EffectSchema.optionalKey(
    EffectSchema.Trim.check(EffectSchema.isMaxLength(TASK_BOUNDS.MAX_BRIEF_CHARS)),
  ),
  status: EffectSchema.optionalKey(taskStatusSchema),
  priority: EffectSchema.optionalKey(taskPrioritySchema),
  assigneeId: EffectSchema.optionalKey(taskAssigneeIdSchema),
  parentTaskId: EffectSchema.optionalKey(wireUuidSchema),
  relation: EffectSchema.optionalKey(taskCreateRelationSchema),
  relations: EffectSchema.optionalKey(
    EffectSchema.Array(taskCreateRelationSchema).check(
      EffectSchema.isMaxLength(TASK_BOUNDS.MAX_START_RELATIONS),
    ),
  ),
  mode: EffectSchema.optionalKey(taskModeSchema),
}).check(
  EffectSchema.makeFilter(agentStartsUnplanned),
  EffectSchema.makeFilter(relationsThroughOneDoor),
  EffectSchema.makeFilter(relationNamedOnce),
  EffectSchema.makeFilter(relationsEachOnce),
);

export type TaskCreateRequest = typeof taskCreateRequestSchema.Type;

export const taskRenameRequestSchema = EffectSchema.Struct({
  name: trimmedText(TASK_BOUNDS.MAX_NAME_CHARS),
});

export type TaskRenameRequest = typeof taskRenameRequestSchema.Type;

function updateNamesAChange(update: {
  name?: string;
  repository?: string | null;
  pinned?: boolean;
  pinPosition?: string;
  readMark?: ReadMark;
  archived?: boolean;
  workspaceId?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeId?: string | null;
  runsOn?: TaskRunsOnRequest;
}): boolean {
  return Object.keys(update).length > 0;
}

function positionIsPinned(update: { pinned?: boolean; pinPosition?: string }): boolean {
  return update.pinPosition === undefined || update.pinned === true;
}

export const taskUpdateRequestSchema = EffectSchema.Struct({
  name: EffectSchema.optionalKey(trimmedText(TASK_BOUNDS.MAX_NAME_CHARS)),
  repository: EffectSchema.optionalKey(repositoryChoiceSchema),
  pinned: EffectSchema.optionalKey(EffectSchema.Boolean),
  pinPosition: EffectSchema.optionalKey(pinPositionSchema),
  readMark: EffectSchema.optionalKey(readMarkSchema),
  archived: EffectSchema.optionalKey(EffectSchema.Boolean),
  workspaceId: EffectSchema.optionalKey(workspaceIdSchema),
  status: EffectSchema.optionalKey(taskStatusSchema),
  priority: EffectSchema.optionalKey(taskPrioritySchema),
  assigneeId: EffectSchema.optionalKey(EffectSchema.NullOr(taskAssigneeIdSchema)),
  runsOn: EffectSchema.optionalKey(taskRunsOnRequestSchema),
}).check(EffectSchema.makeFilter(updateNamesAChange), EffectSchema.makeFilter(positionIsPinned));

export type TaskUpdateRequest = typeof taskUpdateRequestSchema.Type;

export type TaskStanding = Pick<TaskUpdateRequest, "status" | "priority" | "assigneeId">;

export const TASK_BLOCK_CHANGE = {
  ADD: "add",
  REMOVE: "remove",
} as const;

export type TaskBlockChange = (typeof TASK_BLOCK_CHANGE)[keyof typeof TASK_BLOCK_CHANGE];

export const taskBlockRequestSchema = EffectSchema.Struct({
  change: EffectSchema.Literals(Object.values(TASK_BLOCK_CHANGE)),
  relation: EffectSchema.Literals(Object.values(TASK_BLOCK_RELATION)),
  taskId: wireUuidSchema,
});

export type TaskBlockRequest = typeof taskBlockRequestSchema.Type;

export const taskParentRequestSchema = EffectSchema.Struct({
  parentTaskId: EffectSchema.NullOr(wireUuidSchema),
});

export type TaskParentRequest = typeof taskParentRequestSchema.Type;

export const TASK_RELATION_KIND = {
  ...TASK_BLOCK_RELATION,
  SUB_TASK: "sub-task",
  PARENT: "parent",
} as const;

export type TaskRelationKind = (typeof TASK_RELATION_KIND)[keyof typeof TASK_RELATION_KIND];

function kindsDiffer(change: { readonly from: TaskRelationKind; readonly to: TaskRelationKind }) {
  return change.from !== change.to;
}

export const taskRelationChangeRequestSchema = EffectSchema.Struct({
  taskId: wireUuidSchema,
  from: EffectSchema.Literals(Object.values(TASK_RELATION_KIND)),
  to: EffectSchema.Literals(Object.values(TASK_RELATION_KIND)),
}).check(EffectSchema.makeFilter(kindsDiffer));

export type TaskRelationChangeRequest = typeof taskRelationChangeRequestSchema.Type;

export const repositoryPinSchema = EffectSchema.Struct({
  repository: githubRepositoryFullNameSchema,
  pinnedAt: countedNumber,
});

export type RepositoryPin = typeof repositoryPinSchema.Type;

export const REPOSITORY_PIN_BOUNDS = {
  MAX_PINS: 50,
} as const;

export const repositoryPinsAnswerSchema = EffectSchema.Struct({
  pins: EffectSchema.Array(repositoryPinSchema),
});

export const repositoryPinsWrittenSchema = EffectSchema.Struct({
  ...repositoryPinsAnswerSchema.fields,
  txid: EffectSchema.optionalKey(EffectSchema.String),
});

export type RepositoryPinsWritten = typeof repositoryPinsWrittenSchema.Type;

export const repositoryPinRequestSchema = EffectSchema.Struct({
  repository: githubRepositoryFullNameSchema,
  pinned: EffectSchema.Boolean,
});

export const TASK_LIST_QUERY = {
  ARCHIVED: "archived",
} as const;

export const TASK_LIST_ARCHIVED = {
  INCLUDE: "include",
} as const;

export const DESCRIPTION_ACTOR = {
  DEVELOPER: "developer",
  NOTETAKER: "notetaker",
  AGENT: "agent",
  EARLIER: "earlier",
} as const;

export type DescriptionActor = (typeof DESCRIPTION_ACTOR)[keyof typeof DESCRIPTION_ACTOR];

export type TaskCreatorActor = Exclude<DescriptionActor, typeof DESCRIPTION_ACTOR.EARLIER>;

const taskOriginSchema = EffectSchema.Struct({
  actor: EffectSchema.Literals([DESCRIPTION_ACTOR.NOTETAKER, DESCRIPTION_ACTOR.AGENT]),
  agentId: EffectSchema.optionalKey(wireUuidSchema),
});

export type TaskOrigin = typeof taskOriginSchema.Type;

const taskRunsOnSchema = EffectSchema.Struct({
  machine: EffectSchema.Literal(AGENT_MACHINE.DEVICE),
  deviceId: EffectSchema.optionalKey(wireUuidSchema),
  owner: EffectSchema.optionalKey(memberRefSchema),
  device: EffectSchema.optionalKey(
    EffectSchema.Struct({
      name: EffectSchema.String,
      kind: EffectSchema.Literals(Object.values(DEVICE_KIND)),
      platform: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(DEVICE_PLATFORM))),
      seenAt: countedNumber,
    }),
  ),
});

export type TaskRunsOn = typeof taskRunsOnSchema.Type;

const taskSummaryFields = {
  id: wireUuidSchema,
  workspaceId: workspaceIdSchema,
  name: trimmedText(TASK_BOUNDS.MAX_NAME_CHARS),
  createdAt: countedNumber,
  updatedAt: countedNumber,
  repository: repositoryChoiceSchema,
  openedAt: EffectSchema.optionalKey(countedNumber),
  pinnedAt: EffectSchema.optionalKey(countedNumber),
  pinPosition: EffectSchema.optionalKey(EffectSchema.String),
  readThrough: EffectSchema.optionalKey(countedNumber),
  markedUnread: EffectSchema.optionalKey(EffectSchema.Boolean),
  ownerId: EffectSchema.optionalKey(EffectSchema.String),
  createdBy: EffectSchema.optionalKey(memberRefSchema),
  origin: EffectSchema.optionalKey(taskOriginSchema),
  status: EffectSchema.optionalKey(taskStatusSchema),
  completedAt: EffectSchema.optionalKey(countedNumber),
  priority: EffectSchema.optionalKey(taskPrioritySchema),
  number: EffectSchema.optionalKey(taskNumberSchema),
  assignee: EffectSchema.optionalKey(memberRefSchema),
  runsOn: EffectSchema.optionalKey(taskRunsOnSchema),
  parentTaskId: EffectSchema.optionalKey(wireUuidSchema),
  mode: EffectSchema.optionalKey(taskModeSchema),
  blocked: EffectSchema.optionalKey(EffectSchema.Literal(true)),
  madeByRun: EffectSchema.optionalKey(EffectSchema.Literal(true)),
};

export const TASK_AGENTS_BOUNDS = {
  MAX_AGENTS: 3,
  MAX_PULL_REQUESTS: 3,
} as const;

const taskAgentLineSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  title: EffectSchema.NullOr(EffectSchema.String),
  model: EffectSchema.String,
  effort: EffectSchema.String,
  status: EffectSchema.Literals(Object.values(AGENT_STATUS)),
  at: EffectSchema.optionalKey(countedNumber),
  startedBy: EffectSchema.optionalKey(memberRefSchema),
  automationId: EffectSchema.optionalKey(wireUuidSchema),
});

export type TaskAgentLine = typeof taskAgentLineSchema.Type;

export const taskPullRequestLineSchema = EffectSchema.Struct({
  number: countedNumber,
  title: EffectSchema.String,
  state: EffectSchema.Literals(Object.values(PULL_REQUEST_STATE)),
  checks: EffectSchema.Literals(Object.values(CHECK_SUMMARY)),
  additions: countedNumber,
  deletions: countedNumber,
  url: EffectSchema.optionalKey(EffectSchema.String),
  agentId: EffectSchema.optionalKey(wireUuidSchema),
  queued: EffectSchema.optionalKey(EffectSchema.Literal(true)),
  author: EffectSchema.optionalKey(EffectSchema.String),
  authorAvatarUrl: EffectSchema.optionalKey(EffectSchema.String),
  authorBot: EffectSchema.optionalKey(EffectSchema.Boolean),
});

export type TaskPullRequestLine = typeof taskPullRequestLineSchema.Type;

export const taskPullRequestsSchema = EffectSchema.Struct({
  taskId: EffectSchema.String,
  pullRequests: EffectSchema.Array(taskPullRequestLineSchema),
});

export type TaskPullRequests = typeof taskPullRequestsSchema.Type;

export const listedPullRequestSchema = EffectSchema.Struct({
  agentId: EffectSchema.String,
  taskId: EffectSchema.NullOr(EffectSchema.String),
  pullRequest: agentPullRequestSchema,
});

export type ListedPullRequest = typeof listedPullRequestSchema.Type;

export const taskAgentPinSchema = EffectSchema.Struct({
  agentId: EffectSchema.String,
  taskId: EffectSchema.String,
  pinnedAt: countedNumber,
  pinPosition: EffectSchema.optionalKey(EffectSchema.String),
});

export type TaskAgentPin = typeof taskAgentPinSchema.Type;

const taskAgentsSummarySchema = EffectSchema.Struct({
  total: countedNumber,
  working: countedNumber,
  failed: EffectSchema.optionalKey(countedNumber),
  activityAt: EffectSchema.optionalKey(countedNumber),
  agents: EffectSchema.Array(taskAgentLineSchema).check(
    EffectSchema.isMaxLength(TASK_AGENTS_BOUNDS.MAX_AGENTS),
  ),
  pullRequestTotal: countedNumber,
  pullRequests: EffectSchema.Array(taskPullRequestLineSchema).check(
    EffectSchema.isMaxLength(TASK_AGENTS_BOUNDS.MAX_PULL_REQUESTS),
  ),
});

export type TaskAgentsSummary = typeof taskAgentsSummarySchema.Type;

export const taskSummarySchema = EffectSchema.Struct({
  ...taskSummaryFields,
  agents: EffectSchema.optionalKey(taskAgentsSummarySchema),
});

export type TaskSummary = typeof taskSummarySchema.Type;

const MAX_AGENT_EDITS = 50;

const agentEditLineSchema = EffectSchema.Struct({
  agentId: wireUuidSchema,
  label: trimmedText(TASK_BOUNDS.MAX_NAME_CHARS),
  at: countedNumber,
});

export const descriptionEditorSchema = memberRefSchema;

export type DescriptionEditor = typeof descriptionEditorSchema.Type;

export const descriptionLastEditSchema = EffectSchema.Struct({
  actor: EffectSchema.Literals(Object.values(DESCRIPTION_ACTOR)),
  by: EffectSchema.optionalKey(descriptionEditorSchema),
  label: EffectSchema.optionalKey(trimmedText(TASK_BOUNDS.MAX_NAME_CHARS)),
  agentId: EffectSchema.optionalKey(wireUuidSchema),
  at: countedNumber,
  duringCall: EffectSchema.Boolean,
});

export type DescriptionLastEdit = typeof descriptionLastEditSchema.Type;

export const DESCRIPTION_SECTION_BOUNDS = {
  MAX_HEADING_CHARS: 1_000,
  MAX_SECTIONS: 500,
} as const;

const descriptionSectionEditSchema = EffectSchema.Struct({
  section: EffectSchema.String.check(
    EffectSchema.isMaxLength(DESCRIPTION_SECTION_BOUNDS.MAX_HEADING_CHARS),
  ),
  ...descriptionLastEditSchema.fields,
});

export type DescriptionSectionEdit = typeof descriptionSectionEditSchema.Type;

export const taskSchema = EffectSchema.Struct({
  ...taskSummaryFields,
  document: descriptionDocumentSchema,
  agentEdits: EffectSchema.optionalKey(
    EffectSchema.Array(agentEditLineSchema).check(EffectSchema.isMaxLength(MAX_AGENT_EDITS)),
  ),
  lastEdit: EffectSchema.optionalKey(descriptionLastEditSchema),
  sectionEdits: EffectSchema.optionalKey(
    EffectSchema.Array(descriptionSectionEditSchema).check(
      EffectSchema.isMaxLength(DESCRIPTION_SECTION_BOUNDS.MAX_SECTIONS),
    ),
  ),
  blockedBy: EffectSchema.optionalKey(EffectSchema.Array(wireUuidSchema)),
  blocks: EffectSchema.optionalKey(EffectSchema.Array(wireUuidSchema)),
});

export type Task = typeof taskSchema.Type;

export const taskListAnswerSchema = EffectSchema.Struct({
  plans: EffectSchema.Array(taskSummarySchema),
  planlessAgents: EffectSchema.optionalKey(EffectSchema.Array(tasklessAgentSchema)),
});

export type TaskListAnswer = typeof taskListAnswerSchema.Type;

export const taskTxidSchema = EffectSchema.String.check(EffectSchema.isPattern(/^[0-9]+$/u));

export const taskAnswerSchema = EffectSchema.Struct({
  plan: taskSchema,
  txid: EffectSchema.optionalKey(taskTxidSchema),
  brief: EffectSchema.optionalKey(EffectSchema.String),
});

export const taskRestoreAnswerSchema = EffectSchema.Struct({
  ...taskAnswerSchema.fields,
  txid: EffectSchema.optionalKey(EffectSchema.String),
});

const taskAgentRefusalSchema = EffectSchema.Struct({
  error: EffectSchema.String,
  resetsAt: EffectSchema.optionalKey(EffectSchema.Number),
  provider: EffectSchema.optionalKey(modelProviderSchema),
  localAgentRefusal: EffectSchema.optionalKey(localAgentRefusalSchema),
  extraRepositoryRefusal: EffectSchema.optionalKey(extraRepositoryRefusalSchema),
  refusedRepository: EffectSchema.optionalKey(EffectSchema.String),
});

export type TaskAgentRefusal = typeof taskAgentRefusalSchema.Type;

export const taskStartAnswerSchema = EffectSchema.Struct({
  plan: taskSchema,
  agent: EffectSchema.optionalKey(agentSummarySchema),
  notice: EffectSchema.optionalKey(EffectSchema.String),
  agentRefusal: EffectSchema.optionalKey(taskAgentRefusalSchema),
  txid: EffectSchema.optionalKey(taskTxidSchema),
});

export type TaskStartAnswer = typeof taskStartAnswerSchema.Type;

export const taskFoundAnswerSchema = EffectSchema.Struct({ taskId: EffectSchema.String });

export type TaskFoundAnswer = typeof taskFoundAnswerSchema.Type;

export const taskDeleteAnswerSchema = EffectSchema.Struct({
  deleted: EffectSchema.Literal(true),
  txid: EffectSchema.optionalKey(taskTxidSchema),
});

export const UNKNOWN_AGENT_LABEL = "an agent";

export const DESCRIPTION_HISTORY_BOUNDS = {
  PAGE: 50,
} as const;

export const descriptionRevisionSeqSchema = EffectSchema.Int.check(
  EffectSchema.isGreaterThanOrEqualTo(1),
);

const descriptionRevisionLineSchema = EffectSchema.Struct({
  seq: descriptionRevisionSeqSchema,
  lastEdit: descriptionLastEditSchema,
  agentId: EffectSchema.optionalKey(wireUuidSchema),
  startedAt: countedNumber,
  changes: countedNumber,
  restoredFrom: EffectSchema.optionalKey(
    EffectSchema.Struct({ seq: descriptionRevisionSeqSchema, at: countedNumber }),
  ),
});

export type DescriptionRevisionLine = typeof descriptionRevisionLineSchema.Type;

export const descriptionRevisionsAnswerSchema = EffectSchema.Struct({
  revisions: EffectSchema.Array(descriptionRevisionLineSchema).check(
    EffectSchema.isMaxLength(DESCRIPTION_HISTORY_BOUNDS.PAGE),
  ),
  earlier: EffectSchema.optionalKey(descriptionRevisionSeqSchema),
});

export type DescriptionRevisionsAnswer = typeof descriptionRevisionsAnswerSchema.Type;

export const descriptionRevisionAnswerSchema = EffectSchema.Struct({
  revision: EffectSchema.Struct({
    seq: descriptionRevisionSeqSchema,
    document: descriptionDocumentSchema,
    previous: EffectSchema.NullOr(descriptionDocumentSchema),
  }),
});

export type DescriptionRevisionAnswer = typeof descriptionRevisionAnswerSchema.Type;

const CODE_REF_MAX_LINES = 200;

export const CODE_PATH_MAX_CHARS = 1_024;

export const codeLineSchema = EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(1));

export const commitShaSchema = EffectSchema.String.check(
  EffectSchema.isMinLength(40),
  EffectSchema.isMaxLength(40),
  EffectSchema.isPattern(/^[0-9a-f]{40}$/u),
);

function codeRangeIsReadable(ref: { startLine?: number; endLine?: number }): boolean {
  if (ref.startLine === undefined || ref.endLine === undefined) {
    return ref.startLine === ref.endLine;
  }
  return ref.endLine >= ref.startLine && ref.endLine - ref.startLine < CODE_REF_MAX_LINES;
}

export const codeRefSchema = EffectSchema.Struct({
  path: EffectSchema.String.check(
    EffectSchema.isNonEmpty(),
    EffectSchema.isMaxLength(CODE_PATH_MAX_CHARS),
  ),
  startLine: EffectSchema.optionalKey(codeLineSchema),
  endLine: EffectSchema.optionalKey(codeLineSchema),
}).check(EffectSchema.makeFilter(codeRangeIsReadable));

export type CodeRef = typeof codeRefSchema.Type;

const SECRET_FILE = /(^|\/)\.env[^/]*$/u;

export function isSecretFile(path: string): boolean {
  return SECRET_FILE.test(path);
}

export const TASK_FILE_BOUNDS = {
  WINDOW_LINES: 500,
  MAX_LINE_CHARS: 400,
  MAX_TEXT_CHARS: 1024 * 1024,
} as const;

export const TASK_FILE_REFUSAL = {
  SECRET: "secret",
  MISSING: "missing",
  NOT_TEXT: "not-text",
  NO_REPOSITORY: "no-repository",
  NOT_REACHABLE: "not-reachable",
  UNAVAILABLE: "unavailable",
} as const;

export type TaskFileRefusal = (typeof TASK_FILE_REFUSAL)[keyof typeof TASK_FILE_REFUSAL];

function fileWindowIsReadable(window: { firstLine: number; lastLine: number }): boolean {
  return (
    window.lastLine >= window.firstLine &&
    window.lastLine - window.firstLine < TASK_FILE_BOUNDS.WINDOW_LINES
  );
}

export const taskFileRequestSchema = EffectSchema.Struct({
  path: EffectSchema.String.check(
    EffectSchema.isNonEmpty(),
    EffectSchema.isMaxLength(CODE_PATH_MAX_CHARS),
  ),
  firstLine: codeLineSchema,
  lastLine: codeLineSchema,
  raw: EffectSchema.optionalKey(EffectSchema.Boolean),
  ref: EffectSchema.optionalKey(commitShaSchema),
}).check(EffectSchema.makeFilter(fileWindowIsReadable));

export type TaskFileRequest = typeof taskFileRequestSchema.Type;

export const taskFileWindowSchema = EffectSchema.Struct({
  path: EffectSchema.String,
  repository: githubRepositoryFullNameSchema,
  branch: EffectSchema.String,
  commit: EffectSchema.optionalKey(commitShaSchema),
  firstLine: codeLineSchema,
  lineCount: EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(1)),
  lines: EffectSchema.Array(
    EffectSchema.String.check(EffectSchema.isMaxLength(TASK_FILE_BOUNDS.MAX_LINE_CHARS)),
  ).check(EffectSchema.isMaxLength(TASK_FILE_BOUNDS.WINDOW_LINES)),
});

export const taskFileRefusalSchema = EffectSchema.Struct({
  refusal: EffectSchema.Literals(Object.values(TASK_FILE_REFUSAL)),
  branch: EffectSchema.optionalKey(EffectSchema.String),
});

export const taskFileTextSchema = EffectSchema.Struct({
  path: EffectSchema.String,
  repository: githubRepositoryFullNameSchema,
  branch: EffectSchema.String,
  text: EffectSchema.String.check(EffectSchema.isMaxLength(TASK_FILE_BOUNDS.MAX_TEXT_CHARS)),
});

export const taskFileAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ file: taskFileWindowSchema }),
  EffectSchema.Struct({ text: taskFileTextSchema }),
  taskFileRefusalSchema,
]);

export type TaskFileAnswer = typeof taskFileAnswerSchema.Type;

export const TASK_TREE_ENTRY = {
  FILE: "file",
  FOLDER: "folder",
} as const;

export const TASK_TREE_BOUNDS = {
  MAX_ENTRIES: 5_000,
  MAX_RECURSIVE_ENTRIES: 50_000,
} as const;

export const taskTreeRequestSchema = EffectSchema.Struct({
  path: EffectSchema.String.check(EffectSchema.isMaxLength(CODE_PATH_MAX_CHARS)),
  recursive: EffectSchema.optionalKey(EffectSchema.Boolean),
});

export type TaskTreeRequest = typeof taskTreeRequestSchema.Type;

const taskTreeEntrySchema = EffectSchema.Struct({
  name: EffectSchema.String.check(
    EffectSchema.isNonEmpty(),
    EffectSchema.isMaxLength(CODE_PATH_MAX_CHARS),
  ),
  kind: EffectSchema.Literals(Object.values(TASK_TREE_ENTRY)),
});

export type TaskTreeEntry = typeof taskTreeEntrySchema.Type;

export const taskTreeFolderSchema = EffectSchema.Struct({
  path: EffectSchema.String,
  repository: githubRepositoryFullNameSchema,
  branch: EffectSchema.String,
  entries: EffectSchema.Array(taskTreeEntrySchema).check(
    EffectSchema.isMaxLength(TASK_TREE_BOUNDS.MAX_RECURSIVE_ENTRIES),
  ),
  truncated: EffectSchema.Boolean,
});

export const taskTreeAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ folder: taskTreeFolderSchema }),
  taskFileRefusalSchema,
]);

export type TaskTreeAnswer = typeof taskTreeAnswerSchema.Type;

export const TASK_SKILL_BOUNDS = {
  MAX_SKILLS: 64,
  MAX_NAME_CHARS: 64,
  MAX_DESCRIPTION_CHARS: 1024,
} as const;

export const TASK_SKILL_SOURCE = {
  REPOSITORY: "repository",
  WORKSPACE: "workspace",
  PERSONAL: "personal",
} as const;

export type TaskSkillSource = (typeof TASK_SKILL_SOURCE)[keyof typeof TASK_SKILL_SOURCE];

const taskSkillSchema = EffectSchema.Struct({
  name: EffectSchema.String.check(
    EffectSchema.isNonEmpty(),
    EffectSchema.isMaxLength(TASK_SKILL_BOUNDS.MAX_NAME_CHARS),
  ),
  description: EffectSchema.String.check(
    EffectSchema.isMaxLength(TASK_SKILL_BOUNDS.MAX_DESCRIPTION_CHARS),
  ),
  source: EffectSchema.Literals(Object.values(TASK_SKILL_SOURCE)),
  path: EffectSchema.optionalKey(
    EffectSchema.String.check(
      EffectSchema.isNonEmpty(),
      EffectSchema.isMaxLength(CODE_PATH_MAX_CHARS),
    ),
  ),
});

export const taskSkillsSchema = EffectSchema.Struct({
  repository: EffectSchema.NullOr(githubRepositoryFullNameSchema),
  branch: EffectSchema.NullOr(EffectSchema.String),
  skills: EffectSchema.Array(taskSkillSchema).check(
    EffectSchema.isMaxLength(TASK_SKILL_BOUNDS.MAX_SKILLS),
  ),
});

type TaskSkills = typeof taskSkillsSchema.Type;

export const TASK_SKILLS_INSTALLED = "1";

export const taskSkillsQueryFields = {
  installed: EffectSchema.optionalKey(EffectSchema.Literal(TASK_SKILLS_INSTALLED)),
};

export type TaskSkill = TaskSkills["skills"][number];

export const taskSkillsAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ skills: taskSkillsSchema }),
  taskFileRefusalSchema,
]);

export type TaskSkillsAnswer = typeof taskSkillsAnswerSchema.Type;
