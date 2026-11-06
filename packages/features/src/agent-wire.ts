import {
  keepIdentity,
  LEGACY_APP_WORD,
  literalsReadingLegacy,
  MESSAGE_ROLE,
  TURN_ORIGIN,
  WireValueSchema,
} from "@repo/wire";
import { readEither, verbatimJsonSchema, wireKeys } from "@repo/wire/effect";
import { Schema as EffectSchema, Result, SchemaTransformation } from "effect";
import { AGENT_QUEUE_BOUNDS, agentQueueSchema } from "./agent-queue-wire.js";
import { DEVICE_LAUNCH_STEP, DEVICE_LAUNCH_UNSTARTED } from "./device-agent-wire.js";
import { integrationConnectionNameSchema, integrationConnectionOf } from "./integration-wire.js";
import { githubRepositoryFullNameSchema } from "./link-grammar.js";
import { pinPositionSchema } from "./pin-order.js";
import {
  mergeMethodSchema,
  PULL_REQUEST_WRITE_BOUNDS,
  REACTION,
} from "./pull-request-write-wire.js";
import { readMarkSchema } from "./read-mark.js";
import { countedNumber, memberRefSchema, wireUuidSchema } from "./service-wire.js";
import { trimmedText } from "./text-schema.js";

export const AGENT_BOUNDS = {
  MAX_KEY_CHARS: 128,
  MAX_CHOICE_CHARS: 200,
  MAX_BRANCH_CHARS: 255,
  MAX_ALSO_REPOSITORIES: 9,
  MAX_MESSAGE_CHARS: 16_000,
  MAX_START_WORDS_CHARS: 64_000,
  MAX_CALL_ID_CHARS: 128,
  MAX_LINE_ID_CHARS: 128,
  MAX_TITLE_CHARS: 80,
  MAX_ARCHIVE_REASON_CHARS: 500,
  MAX_SEARCH_CHARS: 200,
  MAX_WORKSPACE_AGENTS: 50,
  MAX_SERVERS: 32,
  MAX_SERVER_CHARS: 64,
  MESSAGES_PAGE: 200,
  MAX_PART_CHARS: 4_096,
  MAX_TODOS: 40,
  MAX_TODO_CHARS: 300,
  MAX_ATTACHMENTS: 10,
  MAX_ATTACHMENT_NAME_CHARS: 255,
  MAX_IMAGE_BYTES: 1_500_000,
  MAX_PDF_BYTES: 3_000_000,
  MAX_TEXT_BYTES: 100_000,
  MAX_ATTACHMENTS_BYTES: 3_000_000,
} as const;

export const CONTEXT_WINDOW = {
  STANDARD: "standard",
  LONG: "long",
} as const;

export type ContextWindow = (typeof CONTEXT_WINDOW)[keyof typeof CONTEXT_WINDOW];

export const contextWindowSchema = EffectSchema.Literals(Object.values(CONTEXT_WINDOW));

export const AGENT_AUTHOR = {
  DEVELOPER: "developer",
  APP_UNLINKED: "app-unlinked",
  APP_NO_PUSH: "app-no-push",
  APP_AUTOMATION: "app-automation",
  APP_UNREAD: "app-unread",
  TOKEN: "token",
  APP_CHOSEN: "app-chosen",
} as const;

export type AgentAuthor = (typeof AGENT_AUTHOR)[keyof typeof AGENT_AUTHOR];

export const AGENT_PAYER = {
  CLAUDE_SUBSCRIPTION: "claude_plan",
  CHATGPT_SUBSCRIPTION: "chatgpt_plan",
  API_KEY: "api_key",
  APP: "app",
  MAC_SIGN_IN: "mac_sign_in",
} as const;

export type AgentPayer = (typeof AGENT_PAYER)[keyof typeof AGENT_PAYER];

export const agentPayerSchema = literalsReadingLegacy(
  Object.values(AGENT_PAYER),
  LEGACY_APP_WORD,
  AGENT_PAYER.APP,
);

export const AGENT_RUNTIME = {
  EVE: "eve",
  CLAUDE_CODE: "claude_code",
  CODEX: "codex",
} as const;

export type AgentRuntime = (typeof AGENT_RUNTIME)[keyof typeof AGENT_RUNTIME];

export const NATIVE_AGENT_RUNTIMES = [AGENT_RUNTIME.CLAUDE_CODE, AGENT_RUNTIME.CODEX] as const;

export type NativeAgentRuntime = (typeof NATIVE_AGENT_RUNTIMES)[number];

export const AGENT_KIND = {
  CODER: "coder",
  PILOT: "pilot",
} as const;

export type AgentKind = (typeof AGENT_KIND)[keyof typeof AGENT_KIND];

export const AGENT_SOURCE = {
  SLACK: "slack",
} as const;

const AGENT_SOURCE_URL_CHARS = 2_048;

export const agentSourceSchema = EffectSchema.Struct({
  kind: EffectSchema.Literals(Object.values(AGENT_SOURCE)),
  url: EffectSchema.optionalKey(
    EffectSchema.String.check(EffectSchema.isMaxLength(AGENT_SOURCE_URL_CHARS)),
  ),
});

export type AgentSource = typeof agentSourceSchema.Type;

export const AGENT_MACHINE = {
  VERCEL: "vercel",
  DEVICE: "device",
} as const;

export type AgentMachineKind = (typeof AGENT_MACHINE)[keyof typeof AGENT_MACHINE];

export const LOCAL_AGENT_REFUSAL = {
  MAC_AWAY: "mac-away",
  CODEX: "codex",
  NO_HARNESS: "no-harness",
  PREPARING: "preparing",
  SETUP_FAILED: "setup-failed",
  NOT_OWNER: "not-owner",
  GITHUB_SIGN_IN: "github-sign-in",
} as const;

export type LocalAgentRefusal = (typeof LOCAL_AGENT_REFUSAL)[keyof typeof LOCAL_AGENT_REFUSAL];

export const localAgentRefusalSchema = EffectSchema.Literals(Object.values(LOCAL_AGENT_REFUSAL));

export const EXTRA_REPOSITORY_REFUSAL = {
  NO_REPOSITORY: "no-repository",
  DEVICE: "device",
  TOKEN: "token",
  OTHER_INSTALLATION: "other-installation",
  ALREADY: "already",
  FULL: "full",
  HEARD_ANOTHER_ACCOUNT: "heard-another-account",
} as const;

export type ExtraRepositoryRefusal =
  (typeof EXTRA_REPOSITORY_REFUSAL)[keyof typeof EXTRA_REPOSITORY_REFUSAL];

export const extraRepositoryRefusalSchema = EffectSchema.Literals(
  Object.values(EXTRA_REPOSITORY_REFUSAL),
);

export const refusedDeviceSchema = EffectSchema.Struct({
  name: EffectSchema.String,
  owner: EffectSchema.optionalKey(EffectSchema.String),
});

export type RefusedDevice = typeof refusedDeviceSchema.Type;

export const DEVICE_BEAT = {
  EVERY_MS: 15_000,
  MISSED_BEATS: 4,
} as const;

export const MAC_PRESENCE = {
  FRESH_MS: DEVICE_BEAT.EVERY_MS * DEVICE_BEAT.MISSED_BEATS,
  POLL_MS: (DEVICE_BEAT.EVERY_MS * 4) / 3,
  READ_TIMEOUT_MS: 12_000,
} as const;

export const PRESENCE_READ_STANDS_MS = MAC_PRESENCE.POLL_MS + MAC_PRESENCE.READ_TIMEOUT_MS;

export const DEVICE_LEASE = {
  MS: 5 * 60 * 1_000,
} as const;

export const DEVICE_STANDING = {
  ONLINE: "online",
  OFFLINE: "offline",
  UNKNOWN: "unknown",
  CHECKING: "checking",
} as const;

export type DeviceStanding = (typeof DEVICE_STANDING)[keyof typeof DEVICE_STANDING];

export interface BeatReading {
  readonly sinceBeatMs: number;
  readonly sinceReadMs: number;
}

export function deviceStanding(beat: BeatReading, readFailed: boolean): DeviceStanding {
  if (beat.sinceBeatMs <= MAC_PRESENCE.FRESH_MS) return DEVICE_STANDING.ONLINE;
  if (readFailed) return DEVICE_STANDING.UNKNOWN;
  const ageAtRead = beat.sinceBeatMs - beat.sinceReadMs;
  return beat.sinceReadMs <= PRESENCE_READ_STANDS_MS && ageAtRead > MAC_PRESENCE.FRESH_MS
    ? DEVICE_STANDING.OFFLINE
    : DEVICE_STANDING.UNKNOWN;
}

export const AGENT_BRIEF = {
  DESCRIPTION: "plan",
  PROMPT: "task",
  BLANK: "blank",
} as const;

export type AgentBrief = (typeof AGENT_BRIEF)[keyof typeof AGENT_BRIEF];

export const AGENT_STATUS = {
  STARTING: "starting",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELED: "cancelled",
} as const;

export type AgentStatus = (typeof AGENT_STATUS)[keyof typeof AGENT_STATUS];

export const AGENT_FAILURE = {
  MODEL: "model",
  SANDBOX: "sandbox",
  GITHUB: "github",
  ABANDONED: "abandoned",
  PROVIDER_KEY: "provider_key",
  NOT_STARTED: "not_started",
  FAST_ON_OWN_KEY: "fast_own_key",
  FAST_NOT_ENABLED: "fast_not_enabled",
  CONTEXT_OVERFLOW: "context_overflow",
  SESSION_ENDED: "session_ended",
  OTHER: "other",
} as const;

export type AgentFailure = (typeof AGENT_FAILURE)[keyof typeof AGENT_FAILURE];

export const AGENT_ATTACHMENT_TYPE = {
  PNG: "image/png",
  JPEG: "image/jpeg",
  WEBP: "image/webp",
  PDF: "application/pdf",
  TEXT: "text/plain",
} as const;

export type AgentAttachmentType =
  (typeof AGENT_ATTACHMENT_TYPE)[keyof typeof AGENT_ATTACHMENT_TYPE];

const AGENT_ATTACHMENT_BYTES = {
  [AGENT_ATTACHMENT_TYPE.PNG]: AGENT_BOUNDS.MAX_IMAGE_BYTES,
  [AGENT_ATTACHMENT_TYPE.JPEG]: AGENT_BOUNDS.MAX_IMAGE_BYTES,
  [AGENT_ATTACHMENT_TYPE.WEBP]: AGENT_BOUNDS.MAX_IMAGE_BYTES,
  [AGENT_ATTACHMENT_TYPE.PDF]: AGENT_BOUNDS.MAX_PDF_BYTES,
  [AGENT_ATTACHMENT_TYPE.TEXT]: AGENT_BOUNDS.MAX_TEXT_BYTES,
} as const satisfies Record<AgentAttachmentType, number>;

export function base64Chars(bytes: number): number {
  return 4 * Math.ceil(bytes / 3);
}

export const MAXIMUM_ATTACHMENTS_BODY_BYTES =
  base64Chars(AGENT_BOUNDS.MAX_ATTACHMENTS_BYTES) +
  AGENT_BOUNDS.MAX_ATTACHMENTS * (6 * AGENT_BOUNDS.MAX_ATTACHMENT_NAME_CHARS + 128);

export const MAXIMUM_START_BODY_BYTES =
  6 * AGENT_BOUNDS.MAX_MESSAGE_CHARS + MAXIMUM_ATTACHMENTS_BODY_BYTES + 4_096;

export function base64Bytes(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor(base64.length / 4) * 3 - padding;
}

const ONE_LINE_PATTERN = /^[^\r\n]*$/u;

const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/u;

function spellsUtf8(base64: string): boolean {
  try {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function attachmentIsReadable(attachment: {
  readonly mediaType: AgentAttachmentType;
  readonly data: string;
}): boolean {
  if (attachment.data.length > base64Chars(AGENT_ATTACHMENT_BYTES[attachment.mediaType])) {
    return false;
  }
  return attachment.mediaType !== AGENT_ATTACHMENT_TYPE.TEXT || spellsUtf8(attachment.data);
}

const agentAttachmentSchema = EffectSchema.Struct({
  name: EffectSchema.Trim.check(
    EffectSchema.isNonEmpty(),
    EffectSchema.isMaxLength(AGENT_BOUNDS.MAX_ATTACHMENT_NAME_CHARS),
    EffectSchema.isPattern(ONE_LINE_PATTERN),
  ),
  mediaType: EffectSchema.Literals(Object.values(AGENT_ATTACHMENT_TYPE)),
  data: EffectSchema.String.check(
    EffectSchema.isNonEmpty(),
    EffectSchema.isPattern(BASE64_PATTERN),
  ),
}).check(EffectSchema.makeFilter(attachmentIsReadable));

export type AgentAttachment = typeof agentAttachmentSchema.Type;

export const agentAttachmentsSchema = EffectSchema.Array(agentAttachmentSchema).check(
  EffectSchema.isMaxLength(AGENT_BOUNDS.MAX_ATTACHMENTS),
  EffectSchema.makeFilter(
    (attachments) =>
      attachments.reduce((sum, attachment) => sum + base64Bytes(attachment.data), 0) <=
      AGENT_BOUNDS.MAX_ATTACHMENTS_BYTES,
  ),
);

export const messageWordsSchema = EffectSchema.Trim.check(
  EffectSchema.isMaxLength(AGENT_BOUNDS.MAX_MESSAGE_CHARS),
);

export function hasWordsOrFiles(
  words: string,
  attachments: readonly AgentAttachment[] | undefined,
): boolean {
  return words !== "" || (attachments ?? []).length > 0;
}

export const disabledServersSchema = EffectSchema.Array(
  EffectSchema.String.check(EffectSchema.isMaxLength(AGENT_BOUNDS.MAX_SERVER_CHARS)),
).pipe(
  EffectSchema.check(EffectSchema.isMaxLength(AGENT_BOUNDS.MAX_SERVERS)),
  EffectSchema.decodeTo(
    EffectSchema.Array(integrationConnectionNameSchema),
    SchemaTransformation.transform({
      decode: (named): readonly string[] =>
        named.filter((name) => integrationConnectionOf(name) !== undefined),
      encode: (servers): readonly string[] => servers,
    }),
  ),
);

const agentStartFromSchema = EffectSchema.Struct({
  agentId: wireUuidSchema,
  messageId: EffectSchema.optionalKey(wireUuidSchema),
  messageSteps: EffectSchema.optionalKey(
    EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(1)),
  ),
  messageStepParts: EffectSchema.optionalKey(
    EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(0)),
  ),
}).check(
  EffectSchema.makeFilter(
    ({ messageId, messageSteps, messageStepParts }) =>
      (messageSteps === undefined || messageId !== undefined) &&
      (messageStepParts === undefined || messageSteps !== undefined),
  ),
);

export type AgentStartFrom = typeof agentStartFromSchema.Type;

export const agentRunsOnRequestSchema = EffectSchema.Union([
  EffectSchema.Struct({ machine: EffectSchema.Literal(AGENT_MACHINE.VERCEL) }),
  EffectSchema.Struct({
    machine: EffectSchema.Literal(AGENT_MACHINE.DEVICE),
    deviceId: wireUuidSchema,
  }),
]);

export type AgentRunsOnRequest = typeof agentRunsOnRequestSchema.Type;

export const startBranchSchema = EffectSchema.String.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(AGENT_BOUNDS.MAX_BRANCH_CHARS),
  EffectSchema.isPattern(/^[^\s~^:?*[\\]+$/u),
);

export const agentAlsoRepositorySchema = EffectSchema.Struct({
  repository: githubRepositoryFullNameSchema,
  branch: EffectSchema.optionalKey(startBranchSchema),
});

export type AgentAlsoRepository = typeof agentAlsoRepositorySchema.Type;

export const agentAlsoRepositoriesSchema = EffectSchema.Array(agentAlsoRepositorySchema).check(
  EffectSchema.isMinLength(1),
  EffectSchema.isMaxLength(AGENT_BOUNDS.MAX_ALSO_REPOSITORIES),
  EffectSchema.makeFilter(
    (named: readonly AgentAlsoRepository[]) =>
      new Set(named.map((each) => each.repository.toLowerCase())).size === named.length,
  ),
);

export const agentStartRequestFields = {
  idempotencyKey: trimmedText(AGENT_BOUNDS.MAX_KEY_CHARS),
  model: EffectSchema.optionalKey(trimmedText(AGENT_BOUNDS.MAX_CHOICE_CHARS)),
  effort: EffectSchema.optionalKey(trimmedText(AGENT_BOUNDS.MAX_CHOICE_CHARS)),
  contextWindow: EffectSchema.optionalKey(contextWindowSchema),
  prompt: EffectSchema.optionalKey(messageWordsSchema),
  attachments: EffectSchema.optionalKey(agentAttachmentsSchema),
  disabledServers: EffectSchema.optionalKey(disabledServersSchema),
  from: EffectSchema.optionalKey(agentStartFromSchema),
  note: EffectSchema.optionalKey(messageWordsSchema),
  blank: EffectSchema.optionalKey(EffectSchema.Boolean),
  call: EffectSchema.optionalKey(EffectSchema.Boolean),
  runsOn: EffectSchema.optionalKey(agentRunsOnRequestSchema),
  alsoRepositories: EffectSchema.optionalKey(agentAlsoRepositoriesSchema),
  branch: EffectSchema.optionalKey(startBranchSchema),
  title: EffectSchema.optionalKey(trimmedText(AGENT_BOUNDS.MAX_TITLE_CHARS)),
};

function carriesFiles(
  words: string | undefined,
  attachments: readonly AgentAttachment[] | undefined,
): boolean {
  return words === undefined ? attachments === undefined : hasWordsOrFiles(words, attachments);
}

export const startBrief = EffectSchema.makeFilter(
  ({
    prompt,
    attachments,
    from,
    note,
    blank,
  }: {
    readonly prompt?: string;
    readonly attachments?: readonly AgentAttachment[];
    readonly from?: AgentStartFrom;
    readonly note?: string;
    readonly blank?: boolean;
  }) => {
    if (blank === true) {
      return [prompt, attachments, from, note].every((each) => each === undefined);
    }
    return from === undefined
      ? note === undefined && carriesFiles(prompt, attachments)
      : prompt === undefined && carriesFiles(note, attachments);
  },
);

const startBranchAfresh = EffectSchema.makeFilter(
  ({ from, branch }: { readonly from?: AgentStartFrom; readonly branch?: string }) =>
    from === undefined || branch === undefined,
);

const agentStartRequestValueSchema = EffectSchema.Struct(agentStartRequestFields).check(
  startBrief,
  startBranchAfresh,
);

export const agentStartRequestSchema = EffectSchema.Struct(agentStartRequestFields)
  .pipe(wireKeys({ prompt: "task" }))
  .check(startBrief, startBranchAfresh);

export type AgentStartRequest = typeof agentStartRequestSchema.Type;

export const agentStartRequestOnWire = (request: AgentStartRequest) =>
  Result.flatMap(
    readEither(agentStartRequestValueSchema)(request),
    EffectSchema.encodeUnknownResult(agentStartRequestSchema),
  );

export const agentMessageRequestSchema = EffectSchema.Struct({
  text: messageWordsSchema,
  clientKey: trimmedText(AGENT_BOUNDS.MAX_KEY_CHARS),
  attachments: EffectSchema.optionalKey(agentAttachmentsSchema),
}).check(EffectSchema.makeFilter(({ text, attachments }) => hasWordsOrFiles(text, attachments)));

export type AgentMessageRequest = typeof agentMessageRequestSchema.Type;

export const QUEUE_CHANGE = {
  ADD: "add",
  EDIT: "edit",
  HOLD: "hold",
  DELETE: "delete",
  STEER: "steer",
  REORDER: "reorder",
  RESUME: "resume",
} as const;

const queuedMessageIdSchema = wireUuidSchema;

export const agentQueueChangeSchema = EffectSchema.Union([
  EffectSchema.Struct({
    change: EffectSchema.Literal(QUEUE_CHANGE.ADD),
    id: queuedMessageIdSchema,
    text: messageWordsSchema,
    attachments: EffectSchema.optionalKey(agentAttachmentsSchema),
  }).check(EffectSchema.makeFilter(({ text, attachments }) => hasWordsOrFiles(text, attachments))),
  EffectSchema.Struct({
    change: EffectSchema.Literal(QUEUE_CHANGE.EDIT),
    messageId: queuedMessageIdSchema,
    text: messageWordsSchema,
    attachments: EffectSchema.optionalKey(agentAttachmentsSchema),
  }).check(EffectSchema.makeFilter(({ text, attachments }) => hasWordsOrFiles(text, attachments))),
  EffectSchema.Struct({
    change: EffectSchema.Literal(QUEUE_CHANGE.DELETE),
    messageId: queuedMessageIdSchema,
  }),
  EffectSchema.Struct({
    change: EffectSchema.Literal(QUEUE_CHANGE.STEER),
    messageId: queuedMessageIdSchema,
    text: EffectSchema.optionalKey(messageWordsSchema),
    attachments: EffectSchema.optionalKey(agentAttachmentsSchema),
  }).check(
    EffectSchema.makeFilter(({ text, attachments }) =>
      text === undefined ? attachments === undefined : hasWordsOrFiles(text, attachments),
    ),
  ),
  EffectSchema.Struct({
    change: EffectSchema.Literal(QUEUE_CHANGE.HOLD),
    messageId: queuedMessageIdSchema,
    held: EffectSchema.Boolean,
  }),
  EffectSchema.Struct({
    change: EffectSchema.Literal(QUEUE_CHANGE.REORDER),
    order: EffectSchema.Array(queuedMessageIdSchema).check(
      EffectSchema.isMaxLength(AGENT_QUEUE_BOUNDS.MAX_MESSAGES),
    ),
  }),
  EffectSchema.Struct({ change: EffectSchema.Literal(QUEUE_CHANGE.RESUME) }),
]);

export type AgentQueueChange = typeof agentQueueChangeSchema.Type;

export const agentQueueAnswerSchema = EffectSchema.Struct({ queue: agentQueueSchema });

export type AgentQueueAnswer = typeof agentQueueAnswerSchema.Type;

export const agentRewindRequestSchema = EffectSchema.Struct({
  messageId: trimmedText(AGENT_BOUNDS.MAX_KEY_CHARS),
});

export const agentRenameRequestSchema = EffectSchema.Struct({
  title: EffectSchema.Trim.check(EffectSchema.isMaxLength(AGENT_BOUNDS.MAX_TITLE_CHARS)),
});

export type AgentRenameRequest = typeof agentRenameRequestSchema.Type;

export const agentArchiveRequestSchema = EffectSchema.Struct({
  archived: EffectSchema.Boolean,
  reason: EffectSchema.optionalKey(trimmedText(AGENT_BOUNDS.MAX_ARCHIVE_REASON_CHARS)),
}).check(EffectSchema.makeFilter(({ archived, reason }) => archived || reason === undefined));

export type AgentArchiveRequest = typeof agentArchiveRequestSchema.Type;

export const agentPinRequestSchema = EffectSchema.Struct({
  pinned: EffectSchema.Boolean,
  position: EffectSchema.optionalKey(pinPositionSchema),
}).check(
  EffectSchema.makeFilter(
    (request: { pinned: boolean; position?: string }) =>
      request.position === undefined || request.pinned,
  ),
);

export type AgentPinRequest = typeof agentPinRequestSchema.Type;

export const agentReadRequestSchema = EffectSchema.Struct({ readMark: readMarkSchema });

export type AgentReadRequest = typeof agentReadRequestSchema.Type;

export const agentServersRequestSchema = EffectSchema.Struct({
  disabledServers: disabledServersSchema,
});

export type AgentServersRequest = typeof agentServersRequestSchema.Type;

export const ADDED_REPOSITORY_CHECKOUT = {
  NOW: "now",
  NEXT_TURN: "next_turn",
} as const;

export type AddedRepositoryCheckout =
  (typeof ADDED_REPOSITORY_CHECKOUT)[keyof typeof ADDED_REPOSITORY_CHECKOUT];

export const addedRepositoryCheckoutSchema = EffectSchema.Literals(
  Object.values(ADDED_REPOSITORY_CHECKOUT),
);

export const agentAddRepositoryRequestSchema = EffectSchema.Struct({
  addRepository: agentAlsoRepositorySchema,
});

export type AgentAddRepositoryRequest = typeof agentAddRepositoryRequestSchema.Type;

export const AGENT_LIST_QUERY = {
  ARCHIVED: "archived",
} as const;

export const AGENT_WORKSPACE_QUERY = {
  WORKSPACE_ID: "workspaceId",
  REPOSITORY: "repository",
  WORDS: "words",
  ARCHIVED: AGENT_LIST_QUERY.ARCHIVED,
  OFFSET: "offset",
} as const;

export const AGENT_LIST_ARCHIVED = {
  INCLUDE: "include",
} as const;

export const AGENT_ARCHIVER = {
  MEMBER: "member",
  APP: "app",
  AGENT: "agent",
} as const;

export type AgentArchiver = (typeof AGENT_ARCHIVER)[keyof typeof AGENT_ARCHIVER];

export const agentArchiverSchema = literalsReadingLegacy(
  Object.values(AGENT_ARCHIVER),
  LEGACY_APP_WORD,
  AGENT_ARCHIVER.APP,
);

const agentArchivedBySchema = EffectSchema.Struct({
  by: agentArchiverSchema,
  member: EffectSchema.optionalKey(memberRefSchema),
  agent: EffectSchema.optionalKey(
    EffectSchema.Struct({ id: wireUuidSchema, name: EffectSchema.String }),
  ),
  reason: EffectSchema.optionalKey(EffectSchema.String),
  withTask: EffectSchema.optionalKey(EffectSchema.Boolean),
});

export type AgentArchivedBy = typeof agentArchivedBySchema.Type;

export const AGENT_OWNER = {
  TASK: "task",
  RUN: "run",
} as const;

export const agentOwnerSchema = EffectSchema.Union([
  EffectSchema.Struct({ kind: EffectSchema.Literal(AGENT_OWNER.TASK), taskId: wireUuidSchema }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(AGENT_OWNER.RUN),
    automationId: wireUuidSchema,
    runId: wireUuidSchema,
  }),
]);

export type AgentOwner = typeof agentOwnerSchema.Type;

export interface AgentOwnerRead {
  readonly taskId: string | null;
  readonly runId: string | null;
  readonly runAutomationId: string | null;
}

export function agentOwnerOf(read: AgentOwnerRead): AgentOwner | undefined {
  if (read.taskId !== null) return { kind: AGENT_OWNER.TASK, taskId: read.taskId };
  if (read.runId !== null && read.runAutomationId !== null) {
    return { kind: AGENT_OWNER.RUN, automationId: read.runAutomationId, runId: read.runId };
  }
  return undefined;
}

export const agentSummarySchema = EffectSchema.Struct({
  id: wireUuidSchema,
  planId: EffectSchema.NullOr(wireUuidSchema),
  model: EffectSchema.String,
  effort: EffectSchema.String,
  contextWindow: EffectSchema.optionalKey(contextWindowSchema),
  runtime: EffectSchema.optionalKey(EffectSchema.Literals(NATIVE_AGENT_RUNTIMES)),
  title: EffectSchema.NullOr(EffectSchema.String),
  pilot: EffectSchema.optionalKey(EffectSchema.Literal(true)),
  machine: EffectSchema.optionalKey(EffectSchema.Literal(AGENT_MACHINE.DEVICE)),
  mac: EffectSchema.optionalKey(
    EffectSchema.Struct({
      name: EffectSchema.String,
      seenAt: EffectSchema.optionalKey(countedNumber),
      deviceId: EffectSchema.optionalKey(wireUuidSchema),
    }),
  ),
  createdAt: countedNumber,
  status: EffectSchema.Literals(Object.values(AGENT_STATUS)),
  turnId: EffectSchema.NullOr(wireUuidSchema),
  runStartedAt: EffectSchema.optionalKey(countedNumber),
  stoppable: EffectSchema.optionalKey(EffectSchema.Literal(false)),
  brief: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(AGENT_BRIEF))),
  archivedAt: EffectSchema.optionalKey(countedNumber),
  archivedBy: EffectSchema.optionalKey(agentArchivedBySchema),
  disabledServers: EffectSchema.optionalKey(disabledServersSchema),
  startedBy: EffectSchema.optionalKey(memberRefSchema),
  startedByPilot: EffectSchema.optionalKey(
    EffectSchema.Struct({
      agentId: wireUuidSchema,
      taskId: wireUuidSchema,
      title: EffectSchema.NullOr(EffectSchema.String),
      model: EffectSchema.String,
    }),
  ),
  automationId: EffectSchema.optionalKey(wireUuidSchema),
  automationName: EffectSchema.optionalKey(EffectSchema.String),
  source: EffectSchema.optionalKey(agentSourceSchema),
  owner: EffectSchema.optionalKey(agentOwnerSchema),
  from: EffectSchema.optionalKey(
    EffectSchema.Struct({
      agentId: wireUuidSchema,
      messageId: EffectSchema.optionalKey(wireUuidSchema),
      messageSteps: EffectSchema.optionalKey(countedNumber),
      messageStepParts: EffectSchema.optionalKey(countedNumber),
      steps: countedNumber,
      totalSteps: countedNumber,
      branch: EffectSchema.optionalKey(EffectSchema.String),
    }),
  ),
  continuedBy: EffectSchema.optionalKey(
    EffectSchema.Array(
      EffectSchema.Struct({
        agentId: wireUuidSchema,
        title: EffectSchema.NullOr(EffectSchema.String),
        forked: EffectSchema.Boolean,
        messageId: EffectSchema.optionalKey(wireUuidSchema),
      }),
    ),
  ),
});

export type AgentSummary = typeof agentSummarySchema.Type;

const agentTxidSchema = EffectSchema.String.check(EffectSchema.isPattern(/^[0-9]+$/u));

export const agentAnswerSchema = EffectSchema.Struct({
  agent: agentSummarySchema,
  txid: EffectSchema.optionalKey(agentTxidSchema),
  addedCheckout: EffectSchema.optionalKey(addedRepositoryCheckoutSchema),
  notice: EffectSchema.optionalKey(EffectSchema.String),
});

export const agentMessageAnswerSchema = EffectSchema.Struct({
  agent: agentSummarySchema,
  txid: EffectSchema.optionalKey(EffectSchema.String),
});

export const agentDeleteAnswerSchema = EffectSchema.Struct({
  deleted: EffectSchema.Literal(true),
  txid: EffectSchema.optionalKey(agentTxidSchema),
});

const agentOriginSchema = EffectSchema.Struct({
  prompt: EffectSchema.String,
  subject: EffectSchema.optionalKey(
    EffectSchema.Struct({
      number: countedNumber,
      title: EffectSchema.optionalKey(EffectSchema.String),
      url: EffectSchema.optionalKey(EffectSchema.String),
    }),
  ),
  body: EffectSchema.optionalKey(EffectSchema.String),
  runBy: EffectSchema.optionalKey(memberRefSchema),
});

export type AgentOrigin = typeof agentOriginSchema.Type;

const agentPageSchema = EffectSchema.Struct({
  ...agentSummarySchema.fields,
  automationId: EffectSchema.NullOr(wireUuidSchema),
  origin: EffectSchema.optionalKey(agentOriginSchema),
  workspaceId: EffectSchema.String,
  repository: EffectSchema.NullOr(EffectSchema.String),
  branch: EffectSchema.optionalKey(EffectSchema.String),
});

export type AgentPage = typeof agentPageSchema.Type;

export const agentPageAnswerSchema = EffectSchema.Struct({ agent: agentPageSchema });

export const agentListAnswerSchema = EffectSchema.Struct({
  agents: EffectSchema.Array(agentSummarySchema),
});

export const agentWorkspaceListAnswerSchema = EffectSchema.Struct({
  ...agentListAnswerSchema.fields,
  nextOffset: EffectSchema.optionalKey(EffectSchema.Int),
});

export const PULL_REQUEST_STATE = {
  OPEN: "open",
  DRAFT: "draft",
  MERGED: "merged",
  CLOSED: "closed",
} as const;

export type PullRequestState = (typeof PULL_REQUEST_STATE)[keyof typeof PULL_REQUEST_STATE];

export const CHECK_SUMMARY = {
  PENDING: "pending",
  PASSING: "passing",
  FAILING: "failing",
  NONE: "none",
} as const;

export type CheckSummary = (typeof CHECK_SUMMARY)[keyof typeof CHECK_SUMMARY];

export const agentPullRequestSchema = EffectSchema.Struct({
  number: countedNumber,
  title: EffectSchema.String,
  url: EffectSchema.String,
  state: EffectSchema.Literals(Object.values(PULL_REQUEST_STATE)),
  checks: EffectSchema.Literals(Object.values(CHECK_SUMMARY)),
  additions: countedNumber,
  deletions: countedNumber,
  changedFiles: countedNumber,
  queued: EffectSchema.optionalKey(EffectSchema.Literal(true)),
  headSha: EffectSchema.optionalKey(
    EffectSchema.String.check(EffectSchema.isMaxLength(PULL_REQUEST_WRITE_BOUNDS.MAX_COMMIT_CHARS)),
  ),
  author: EffectSchema.optionalKey(EffectSchema.String),
  authorAvatarUrl: EffectSchema.optionalKey(EffectSchema.String),
  authorBot: EffectSchema.optionalKey(EffectSchema.Boolean),
});

export type AgentPullRequest = typeof agentPullRequestSchema.Type;

type PullRequestAuthor = Pick<AgentPullRequest, "author" | "authorAvatarUrl" | "authorBot">;

export function pullRequestAuthorOf(pullRequest: PullRequestAuthor): PullRequestAuthor {
  const { author, authorAvatarUrl, authorBot } = pullRequest;
  return {
    ...(author === undefined ? undefined : { author }),
    ...(authorAvatarUrl === undefined ? undefined : { authorAvatarUrl }),
    ...(authorBot === undefined ? undefined : { authorBot }),
  };
}

export const agentPullRequestAnswerSchema = EffectSchema.Struct({
  repository: EffectSchema.NullOr(EffectSchema.String),
  branch: EffectSchema.NullOr(EffectSchema.String),
  pullRequest: EffectSchema.NullOr(agentPullRequestSchema),
});

export type AgentPullRequestAnswer = typeof agentPullRequestAnswerSchema.Type;

export const listedAgentSchema = EffectSchema.Struct({
  ...agentSummarySchema.fields,
  workspaceId: agentPageSchema.fields.workspaceId,
  repository: agentPageSchema.fields.repository,
});

export type ListedAgent = typeof listedAgentSchema.Type;

export const tasklessAgentSchema = EffectSchema.Struct({
  ...agentSummarySchema.fields,
  automationId: agentPageSchema.fields.automationId,
  workspaceId: agentPageSchema.fields.workspaceId,
  repository: agentPageSchema.fields.repository,
  activityAt: countedNumber,
  pinnedAt: EffectSchema.optionalKey(countedNumber),
  pinPosition: EffectSchema.optionalKey(EffectSchema.String),
  readThrough: EffectSchema.optionalKey(countedNumber),
  markedUnread: EffectSchema.optionalKey(EffectSchema.Boolean),
  pullRequest: EffectSchema.optionalKey(
    EffectSchema.Struct({
      number: agentPullRequestSchema.fields.number,
      title: agentPullRequestSchema.fields.title,
      url: agentPullRequestSchema.fields.url,
      state: agentPullRequestSchema.fields.state,
      checks: agentPullRequestSchema.fields.checks,
      queued: agentPullRequestSchema.fields.queued,
    }),
  ),
});

export type TasklessAgent = typeof tasklessAgentSchema.Type;

export const CHANGED_FILE_STATUS = {
  ADDED: "added",
  MODIFIED: "modified",
  DELETED: "deleted",
  RENAMED: "renamed",
} as const;

export type ChangedFileStatus = (typeof CHANGED_FILE_STATUS)[keyof typeof CHANGED_FILE_STATUS];

export const PATCH_OMITTED = {
  BINARY: "binary",
  TOO_LARGE: "too-large",
} as const;

export const CHANGES_BOUNDS = {
  MAX_FILES: 300,
  MAX_PATCH_CHARS: 100_000,
  MAX_PEOPLE: 50,
  MAX_EXCERPT_CHARS: 280,
} as const;

const commitShaSchema = EffectSchema.String.check(EffectSchema.isPattern(/^[0-9a-f]{40}$/u));

const changedFileSchema = EffectSchema.Struct({
  path: EffectSchema.String,
  previousPath: EffectSchema.NullOr(EffectSchema.String),
  status: EffectSchema.Literals(Object.values(CHANGED_FILE_STATUS)),
  additions: countedNumber,
  deletions: countedNumber,
  patch: EffectSchema.NullOr(EffectSchema.String),
  omitted: EffectSchema.NullOr(EffectSchema.Literals(Object.values(PATCH_OMITTED))),
  blobSha: EffectSchema.optionalKey(commitShaSchema),
});

export type AgentChangedFile = typeof changedFileSchema.Type;

export const REVIEW_STATE = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes-requested",
  DISMISSED: "dismissed",
  COMMENTED: "commented",
  REQUESTED: "requested",
} as const;

const githubPersonSchema = EffectSchema.Struct({
  login: EffectSchema.String,
  avatarUrl: EffectSchema.optionalKey(EffectSchema.String),
  bot: EffectSchema.Boolean,
  userId: EffectSchema.optionalKey(EffectSchema.String),
});

export type GitHubPerson = typeof githubPersonSchema.Type;

export type ReviewState = (typeof REVIEW_STATE)[keyof typeof REVIEW_STATE];

const reviewStateSchema = EffectSchema.Literals(Object.values(REVIEW_STATE));

const pullRequestReviewerSchema = EffectSchema.Struct({
  by: githubPersonSchema,
  state: reviewStateSchema,
});

const reviewCommentSchema = EffectSchema.Struct({
  by: githubPersonSchema,
  state: reviewStateSchema,
  excerpt: EffectSchema.String.check(EffectSchema.isMaxLength(CHANGES_BOUNDS.MAX_EXCERPT_CHARS)),
  at: countedNumber,
});

export const agentChangesAnswerSchema = EffectSchema.Struct({
  pullRequest: EffectSchema.NullOr(
    EffectSchema.Struct({
      url: EffectSchema.String,
      headSha: EffectSchema.optionalKey(commitShaSchema),
      baseSha: EffectSchema.optionalKey(commitShaSchema),
      files: EffectSchema.Array(changedFileSchema).check(
        EffectSchema.isMaxLength(CHANGES_BOUNDS.MAX_FILES),
      ),
      truncated: EffectSchema.Boolean,
      author: EffectSchema.optionalKey(githubPersonSchema),
      writtenAs: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(AGENT_AUTHOR))),
      reviewers: EffectSchema.optionalKey(
        EffectSchema.Array(pullRequestReviewerSchema).check(
          EffectSchema.isMaxLength(CHANGES_BOUNDS.MAX_PEOPLE),
        ),
      ),
      comments: EffectSchema.optionalKey(
        EffectSchema.Array(reviewCommentSchema).check(
          EffectSchema.isMaxLength(CHANGES_BOUNDS.MAX_PEOPLE),
        ),
      ),
    }),
  ),
});

type AgentChanges = NonNullable<(typeof agentChangesAnswerSchema.Type)["pullRequest"]>;

export type AgentChangesPeople = Pick<
  AgentChanges,
  "author" | "writtenAs" | "reviewers" | "comments"
>;

export const MERGE_STATE = {
  CLEAN: "clean",
  UNSTABLE: "unstable",
  BLOCKED: "blocked",
  BEHIND: "behind",
  CONFLICTS: "conflicts",
  DRAFT: "draft",
  UNKNOWN: "unknown",
} as const;

export type MergeState = (typeof MERGE_STATE)[keyof typeof MERGE_STATE];

export const REVIEW_DECISION = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes-requested",
  REVIEW_REQUIRED: "review-required",
} as const;

export type ReviewDecision = (typeof REVIEW_DECISION)[keyof typeof REVIEW_DECISION];

const pullRequestMergingSchema = EffectSchema.Struct({
  methods: EffectSchema.Array(mergeMethodSchema),
  autoMergeAllowed: EffectSchema.Boolean,
  queue: EffectSchema.Boolean,
  queued: EffectSchema.NullOr(EffectSchema.Struct({ position: countedNumber })),
  autoMerge: EffectSchema.NullOr(
    EffectSchema.Struct({ method: EffectSchema.NullOr(mergeMethodSchema) }),
  ),
  headSha: EffectSchema.String.check(
    EffectSchema.isMaxLength(PULL_REQUEST_WRITE_BOUNDS.MAX_COMMIT_CHARS),
  ),
  review: EffectSchema.NullOr(EffectSchema.Literals(Object.values(REVIEW_DECISION))),
  checks: EffectSchema.Literals(Object.values(CHECK_SUMMARY)),
});

export type PullRequestMerging = typeof pullRequestMergingSchema.Type;

export const CHECK_STATE = {
  PENDING: "pending",
  PASSED: "passed",
  FAILED: "failed",
  SKIPPED: "skipped",
} as const;

export type CheckState = (typeof CHECK_STATE)[keyof typeof CHECK_STATE];

export const DEPLOYMENT_STATE = {
  READY: "ready",
  PENDING: "pending",
  FAILED: "failed",
  INACTIVE: "inactive",
} as const;

export type DeploymentState = (typeof DEPLOYMENT_STATE)[keyof typeof DEPLOYMENT_STATE];

export const CONVERSATION_ENTRY = {
  COMMENT: "comment",
  REVIEW: "review",
} as const;

export const OVERVIEW_BOUNDS = {
  MAX_CHECKS: 100,
  MAX_DEPLOYMENTS: 10,
  MAX_ENTRIES: 100,
  MAX_NAME_CHARS: 255,
  MAX_THREADS: 100,
  MAX_THREAD_COMMENTS: 50,
  MAX_LABELS: 100,
  MAX_STACK: 30,
  MAX_REACTORS: 10,
  MAX_OPTIONS: 300,
  MAX_PENDING_COMMENTS: 100,
} as const;

export const DIFF_SIDE = {
  LEFT: "left",
  RIGHT: "right",
} as const;

export type DiffSide = (typeof DIFF_SIDE)[keyof typeof DIFF_SIDE];

const overviewName = EffectSchema.String.check(
  EffectSchema.isMaxLength(OVERVIEW_BOUNDS.MAX_NAME_CHARS),
);

const pullRequestCheckSchema = EffectSchema.Struct({
  name: overviewName,
  app: EffectSchema.NullOr(overviewName),
  state: EffectSchema.Literals(Object.values(CHECK_STATE)),
  url: EffectSchema.NullOr(EffectSchema.String),
  startedAt: EffectSchema.NullOr(countedNumber),
  completedAt: EffectSchema.NullOr(countedNumber),
  avatarUrl: EffectSchema.optionalKey(EffectSchema.String),
});

export type PullRequestCheck = typeof pullRequestCheckSchema.Type;

const pullRequestDeploymentSchema = EffectSchema.Struct({
  environment: overviewName,
  state: EffectSchema.Literals(Object.values(DEPLOYMENT_STATE)),
  url: EffectSchema.NullOr(EffectSchema.String),
  avatarUrl: EffectSchema.optionalKey(EffectSchema.String),
});

export type PullRequestDeployment = typeof pullRequestDeploymentSchema.Type;

const reactionGroupSchema = EffectSchema.Struct({
  content: EffectSchema.Literals(Object.values(REACTION)),
  count: countedNumber,
  by: EffectSchema.optionalKey(
    EffectSchema.Array(githubPersonSchema).check(
      EffectSchema.isMaxLength(OVERVIEW_BOUNDS.MAX_REACTORS),
    ),
  ),
  mine: EffectSchema.optionalKey(EffectSchema.Boolean),
});

const reactionSubjectSchema = EffectSchema.optionalKey(
  EffectSchema.String.check(EffectSchema.isMaxLength(OVERVIEW_BOUNDS.MAX_NAME_CHARS)),
);

export type ReactionGroup = typeof reactionGroupSchema.Type;

const reactionsSchema = EffectSchema.Array(reactionGroupSchema).check(
  EffectSchema.isMaxLength(Object.values(REACTION).length),
);

const reviewThreadCommentSchema = EffectSchema.Struct({
  by: githubPersonSchema,
  html: EffectSchema.NullOr(EffectSchema.String),
  body: EffectSchema.String,
  at: countedNumber,
  url: EffectSchema.String,
  reactions: EffectSchema.optionalKey(reactionsSchema),
  subject: reactionSubjectSchema,
});

const diffSideSchema = EffectSchema.Literals(Object.values(DIFF_SIDE));

const reviewThreadSchema = EffectSchema.Struct({
  path: EffectSchema.String,
  line: EffectSchema.NullOr(countedNumber),
  startLine: EffectSchema.NullOr(countedNumber),
  originalLine: EffectSchema.NullOr(countedNumber),
  originalStartLine: EffectSchema.NullOr(countedNumber),
  side: diffSideSchema,
  startSide: EffectSchema.NullOr(diffSideSchema),
  diffHunk: EffectSchema.String,
  resolved: EffectSchema.Boolean,
  outdated: EffectSchema.Boolean,
  comments: EffectSchema.Array(reviewThreadCommentSchema).check(
    EffectSchema.isMaxLength(OVERVIEW_BOUNDS.MAX_THREAD_COMMENTS),
  ),
  more: countedNumber,
  id: EffectSchema.optionalKey(EffectSchema.String),
});

export type ReviewThread = typeof reviewThreadSchema.Type;

const pendingReviewCommentSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  threadId: EffectSchema.optionalKey(EffectSchema.String),
  by: githubPersonSchema,
  path: EffectSchema.String,
  line: EffectSchema.NullOr(countedNumber),
  startLine: EffectSchema.NullOr(countedNumber),
  side: diffSideSchema,
  startSide: EffectSchema.NullOr(diffSideSchema),
  html: EffectSchema.NullOr(EffectSchema.String),
  body: EffectSchema.String,
  at: countedNumber,
});

export type PendingReviewComment = typeof pendingReviewCommentSchema.Type;

const conversationEntrySchema = EffectSchema.Struct({
  kind: EffectSchema.Literals(Object.values(CONVERSATION_ENTRY)),
  by: githubPersonSchema,
  state: EffectSchema.optionalKey(reviewStateSchema),
  html: EffectSchema.NullOr(EffectSchema.String),
  body: EffectSchema.String,
  at: countedNumber,
  url: EffectSchema.String,
  threads: EffectSchema.optionalKey(
    EffectSchema.Array(reviewThreadSchema).check(
      EffectSchema.isMaxLength(OVERVIEW_BOUNDS.MAX_THREADS),
    ),
  ),
  reactions: EffectSchema.optionalKey(reactionsSchema),
  subject: reactionSubjectSchema,
});

export type ConversationEntry = typeof conversationEntrySchema.Type;

const pullRequestLabelSchema = EffectSchema.Struct({
  name: overviewName,
  color: EffectSchema.String,
});

export type PullRequestLabel = typeof pullRequestLabelSchema.Type;

const reviewTeamSchema = EffectSchema.Struct({
  slug: overviewName,
  name: EffectSchema.String,
});

export type PullRequestReviewTeam = typeof reviewTeamSchema.Type;

const stackAgentSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  taskId: EffectSchema.NullOr(wireUuidSchema),
});

const stackEntrySchema = EffectSchema.Struct({
  number: countedNumber,
  title: EffectSchema.String,
  url: EffectSchema.String,
  draft: EffectSchema.Boolean,
  queued: EffectSchema.optionalKey(EffectSchema.Literal(true)),
  agent: EffectSchema.optionalKey(stackAgentSchema),
});

export type PullRequestStackEntry = typeof stackEntrySchema.Type;

export const agentOverviewPullRequestAnswerSchema = EffectSchema.Struct({
  pullRequest: EffectSchema.NullOr(
    EffectSchema.Struct({
      number: countedNumber,
      title: EffectSchema.String,
      url: EffectSchema.String,
      state: EffectSchema.Literals(Object.values(PULL_REQUEST_STATE)),
      body: EffectSchema.optionalKey(EffectSchema.String),
      html: EffectSchema.String,
      canEditDescription: EffectSchema.optionalKey(EffectSchema.Boolean),
      base: overviewName,
      head: overviewName,
      headOwner: EffectSchema.optionalKey(overviewName),
      createdAt: countedNumber,
      mergedAt: EffectSchema.NullOr(countedNumber),
      merge: EffectSchema.Literals(Object.values(MERGE_STATE)),
      author: EffectSchema.optionalKey(githubPersonSchema),
      writtenAs: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(AGENT_AUTHOR))),
      requested: EffectSchema.Array(githubPersonSchema).check(
        EffectSchema.isMaxLength(CHANGES_BOUNDS.MAX_PEOPLE),
      ),
      merging: EffectSchema.optionalKey(pullRequestMergingSchema),
      requestedTeams: EffectSchema.optionalKey(
        EffectSchema.Array(reviewTeamSchema).check(
          EffectSchema.isMaxLength(CHANGES_BOUNDS.MAX_PEOPLE),
        ),
      ),
      labels: EffectSchema.optionalKey(
        EffectSchema.Array(pullRequestLabelSchema).check(
          EffectSchema.isMaxLength(OVERVIEW_BOUNDS.MAX_LABELS),
        ),
      ),
      stack: EffectSchema.optionalKey(
        EffectSchema.Array(stackEntrySchema).check(
          EffectSchema.isMaxLength(OVERVIEW_BOUNDS.MAX_STACK),
        ),
      ),
    }),
  ),
});

export const agentReviewOptionsAnswerSchema = EffectSchema.Struct({
  labels: EffectSchema.Array(pullRequestLabelSchema).check(
    EffectSchema.isMaxLength(OVERVIEW_BOUNDS.MAX_OPTIONS),
  ),
  users: EffectSchema.Array(githubPersonSchema).check(
    EffectSchema.isMaxLength(OVERVIEW_BOUNDS.MAX_OPTIONS),
  ),
  teams: EffectSchema.Array(reviewTeamSchema).check(
    EffectSchema.isMaxLength(OVERVIEW_BOUNDS.MAX_OPTIONS),
  ),
});

export type AgentReviewOptions = typeof agentReviewOptionsAnswerSchema.Type;

export type AgentOverviewPullRequest = NonNullable<
  (typeof agentOverviewPullRequestAnswerSchema.Type)["pullRequest"]
>;

export const agentOverviewChecksAnswerSchema = EffectSchema.Struct({
  pullRequest: EffectSchema.NullOr(
    EffectSchema.Struct({
      checks: EffectSchema.Array(pullRequestCheckSchema).check(
        EffectSchema.isMaxLength(OVERVIEW_BOUNDS.MAX_CHECKS),
      ),
      deployments: EffectSchema.optionalKey(
        EffectSchema.Array(pullRequestDeploymentSchema).check(
          EffectSchema.isMaxLength(OVERVIEW_BOUNDS.MAX_DEPLOYMENTS),
        ),
      ),
    }),
  ),
});

export type AgentOverviewChecks = NonNullable<
  (typeof agentOverviewChecksAnswerSchema.Type)["pullRequest"]
>;

export const agentOverviewConversationAnswerSchema = EffectSchema.Struct({
  pullRequest: EffectSchema.NullOr(
    EffectSchema.Struct({
      reviewers: EffectSchema.Array(pullRequestReviewerSchema).check(
        EffectSchema.isMaxLength(CHANGES_BOUNDS.MAX_PEOPLE),
      ),
      conversation: EffectSchema.Array(conversationEntrySchema).check(
        EffectSchema.isMaxLength(OVERVIEW_BOUNDS.MAX_ENTRIES),
      ),
      earlier: countedNumber,
      descriptionReactions: EffectSchema.optionalKey(reactionsSchema),
      descriptionSubject: reactionSubjectSchema,
      pendingReview: EffectSchema.optionalKey(
        EffectSchema.NullOr(
          EffectSchema.Struct({
            comments: countedNumber,
            drafts: EffectSchema.optionalKey(
              EffectSchema.Array(pendingReviewCommentSchema).check(
                EffectSchema.isMaxLength(OVERVIEW_BOUNDS.MAX_PENDING_COMMENTS),
              ),
            ),
          }),
        ),
      ),
    }),
  ),
});

export type AgentOverviewConversation = NonNullable<
  (typeof agentOverviewConversationAnswerSchema.Type)["pullRequest"]
>;

export type PullRequestReviewer = typeof pullRequestReviewerSchema.Type;

export const AGENT_DELEGATE_TOOL = "delegate";

export const AGENT_MESSAGE_TOOL = "message_agent";

export const AGENT_MESSAGE_LEAD = "Message";

export function agentMessageReplyLine(agentId: string): string {
  return `Reply with ${AGENT_MESSAGE_TOOL}({ agentId: "${agentId}", text }).`;
}

const AGENT_MESSAGE_HEAD = new RegExp(`^${AGENT_MESSAGE_LEAD} · .+ to you:$`, "u");

const AGENT_MESSAGE_REPLY = new RegExp(
  `^Reply with ${AGENT_MESSAGE_TOOL}\\(\\{ agentId: "[0-9a-f-]+", text \\}\\)\\.$`,
  "u",
);

export function agentMessageWords(text: string): string | undefined {
  const [head, ...rest] = text.split("\n\n");
  if (head === undefined || !AGENT_MESSAGE_HEAD.test(head)) return undefined;
  const last = rest.at(-1);
  const words = last !== undefined && AGENT_MESSAGE_REPLY.test(last) ? rest.slice(0, -1) : rest;
  return words.join("\n\n").trim();
}

export const agentCallIdSchema = trimmedText(AGENT_BOUNDS.MAX_CALL_ID_CHARS);

export const AGENT_TODOS_TOOL = "write_todos";

export const AGENT_TODO_STATUS = {
  PENDING: "pending",
  IN_PROGRESS: "in_progress",
  DONE: "done",
} as const;

export type AgentTodoStatus = (typeof AGENT_TODO_STATUS)[keyof typeof AGENT_TODO_STATUS];

export const agentTodosInputSchema = EffectSchema.Struct({
  todos: EffectSchema.Array(
    EffectSchema.Struct({
      content: EffectSchema.String.check(
        EffectSchema.isNonEmpty(),
        EffectSchema.isMaxLength(AGENT_BOUNDS.MAX_TODO_CHARS),
      ),
      status: EffectSchema.Literals(Object.values(AGENT_TODO_STATUS)),
    }),
  ).check(EffectSchema.isMaxLength(AGENT_BOUNDS.MAX_TODOS)),
});

export type AgentTodos = typeof agentTodosInputSchema.Type;

export const storedObjectSchema = verbatimJsonSchema(WireValueSchema, {
  type: "object",
  additionalProperties: true,
});

export const TURN_ENDING = {
  STOPPED: "stopped",
  FAILED: "failed",
  ABANDONED: "abandoned",
} as const;

export type TurnEnding = (typeof TURN_ENDING)[keyof typeof TURN_ENDING];

const turnTokensSchema = EffectSchema.Struct({
  inputTokens: countedNumber,
  outputTokens: countedNumber,
  cachedInputTokens: countedNumber,
  cacheWriteTokens: EffectSchema.optionalKey(countedNumber),
});

export type TurnTokens = typeof turnTokensSchema.Type;

const recordedChoice = EffectSchema.String.check(
  EffectSchema.isMaxLength(AGENT_BOUNDS.MAX_CHOICE_CHARS),
);

const turnRecordFields = {
  model: EffectSchema.optionalKey(recordedChoice),
  effort: EffectSchema.optionalKey(recordedChoice),
  tokens: EffectSchema.optionalKey(turnTokensSchema),
  ending: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(TURN_ENDING))),
  fastRefused: EffectSchema.optionalKey(EffectSchema.Boolean),
};

const turnRecordSchema = EffectSchema.Struct(turnRecordFields);

export type TurnRecord = typeof turnRecordSchema.Type;

export const MESSAGE_SENDER = {
  MEMBER: "member",
  APP: "app",
  AUTOMATION: "automation",
  GITHUB: "github",
  AGENT: "agent",
} as const;

export type MessageSender = (typeof MESSAGE_SENDER)[keyof typeof MESSAGE_SENDER];

export const messageSenderSchema = literalsReadingLegacy(
  Object.values(MESSAGE_SENDER),
  LEGACY_APP_WORD,
  MESSAGE_SENDER.APP,
);

export const AGENT_SENDER = {
  MEMBER: "member",
  FORMER: "former",
  APP: "app",
  AUTOMATION: "automation",
  GITHUB: "github",
} as const;

const agentSenderSchema = EffectSchema.Struct({
  name: EffectSchema.String,
  userId: EffectSchema.optionalKey(EffectSchema.String),
  kind: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(AGENT_SENDER))),
  agent: EffectSchema.optionalKey(EffectSchema.Literal(true)),
  model: EffectSchema.optionalKey(recordedChoice),
  agentId: EffectSchema.optionalKey(wireUuidSchema),
  automationId: EffectSchema.optionalKey(wireUuidSchema),
});

export type AgentSender = typeof agentSenderSchema.Type;

export const PART_CUT_FIELD = {
  OUTPUT: "output",
  TEXT: "text",
} as const;

export type PartCutField = (typeof PART_CUT_FIELD)[keyof typeof PART_CUT_FIELD];

export const TRANSCRIPT_PARTS_QUERY = { PARTS: "parts", CUT: "cut" } as const;

const partCutSchema = EffectSchema.Struct({
  index: countedNumber,
  field: EffectSchema.Literals(Object.values(PART_CUT_FIELD)),
  bytes: countedNumber,
  head: EffectSchema.String,
  tail: EffectSchema.String,
});

export type PartCut = typeof partCutSchema.Type;

export const agentPartAnswerSchema = EffectSchema.Struct({
  part: storedObjectSchema,
});

export type AgentPartAnswer = typeof agentPartAnswerSchema.Type;

const agentTranscriptMessageSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  origin: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(TURN_ORIGIN))),
  earlierOmitted: EffectSchema.optionalKey(EffectSchema.Boolean),
  role: EffectSchema.Literals(Object.values(MESSAGE_ROLE)),
  parts: EffectSchema.Array(storedObjectSchema),
  cutParts: EffectSchema.optionalKey(EffectSchema.Array(partCutSchema)),
  metadata: EffectSchema.optionalKey(storedObjectSchema),
  sentBy: EffectSchema.optionalKey(agentSenderSchema),
  clientId: EffectSchema.optionalKey(
    EffectSchema.String.check(EffectSchema.isMaxLength(AGENT_BOUNDS.MAX_LINE_ID_CHARS)),
  ),
  sentAt: EffectSchema.optionalKey(countedNumber),
  arrivedIn: EffectSchema.optionalKey(
    EffectSchema.Struct({ journalId: EffectSchema.String, afterStep: countedNumber }),
  ),
  startedAt: EffectSchema.optionalKey(countedNumber),
  finishedAt: EffectSchema.optionalKey(countedNumber),
  ...turnRecordFields,
});

export type AgentTranscriptMessage = typeof agentTranscriptMessageSchema.Type;

const CURSOR_PATTERN = /^\d+:\d+$/u;

export const agentCursorSchema = EffectSchema.String.check(EffectSchema.isPattern(CURSOR_PATTERN));

export const AGENT_CURSOR_START = "0:0";

const agentUsageSchema = EffectSchema.Struct({
  inputTokens: countedNumber,
  outputTokens: countedNumber,
  cachedInputTokens: EffectSchema.optionalKey(countedNumber),
  costUsd: EffectSchema.optionalKey(countedNumber),
  payer: EffectSchema.optionalKey(agentPayerSchema),
});

export type AgentUsage = typeof agentUsageSchema.Type;

const agentContextSchema = EffectSchema.Struct({
  windowTokens: countedNumber,
  compactionThresholdTokens: countedNumber,
  inputTokens: countedNumber,
  outputTokens: countedNumber,
  cachedInputTokens: EffectSchema.optionalKey(countedNumber),
  cacheWriteTokens: EffectSchema.optionalKey(countedNumber),
  estimated: EffectSchema.Struct({
    systemPromptTokens: countedNumber,
    toolDefinitionTokens: countedNumber,
    briefTokens: EffectSchema.optionalKey(countedNumber),
  }),
  measuredAt: countedNumber,
  compactedAt: EffectSchema.optionalKey(countedNumber),
});

export type AgentContext = typeof agentContextSchema.Type;

const agentDelegationStartSchema = EffectSchema.Struct({
  callId: agentCallIdSchema,
  startedAt: countedNumber,
});

export type AgentDelegationStart = typeof agentDelegationStartSchema.Type;

const agentSubagentStandingSchema = EffectSchema.Struct({
  callId: agentCallIdSchema,
  status: EffectSchema.Literals(Object.values(AGENT_STATUS)),
  model: EffectSchema.String,
  effort: EffectSchema.String,
  startedAt: countedNumber,
});

export type AgentSubagentStanding = typeof agentSubagentStandingSchema.Type;

const agentSubagentTitleSchema = EffectSchema.Struct({
  callId: agentCallIdSchema,
  title: EffectSchema.String,
});

export type AgentSubagentTitle = typeof agentSubagentTitleSchema.Type;

export const AGENT_LAUNCH = {
  WAITING: "waiting",
  ...DEVICE_LAUNCH_STEP,
} as const;

export type AgentLaunch = (typeof AGENT_LAUNCH)[keyof typeof AGENT_LAUNCH];

export const agentMessagesAnswerSchema = EffectSchema.Struct({
  messages: EffectSchema.Array(agentTranscriptMessageSchema),
  cursor: agentCursorSchema,
  queue: EffectSchema.optionalKey(agentQueueSchema),
  earlier: EffectSchema.optionalKey(EffectSchema.String),
  status: EffectSchema.Literals(Object.values(AGENT_STATUS)),
  runStartedAt: EffectSchema.optionalKey(countedNumber),
  launch: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(AGENT_LAUNCH))),
  launchUnstarted: EffectSchema.optionalKey(
    EffectSchema.Literals(Object.values(DEVICE_LAUNCH_UNSTARTED)),
  ),
  delegations: EffectSchema.optionalKey(EffectSchema.Array(agentDelegationStartSchema)),
  subagentTitles: EffectSchema.optionalKey(EffectSchema.Array(agentSubagentTitleSchema)),
  subagents: EffectSchema.optionalKey(EffectSchema.Array(agentSubagentStandingSchema)),
  title: EffectSchema.NullOr(EffectSchema.String),
  failureReason: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(AGENT_FAILURE))),
  hostLost: EffectSchema.optionalKey(EffectSchema.Struct({ host: EffectSchema.String })),
  usage: EffectSchema.optionalKey(agentUsageSchema),
  payer: EffectSchema.optionalKey(agentPayerSchema),
  turnUsage: EffectSchema.optionalKey(agentUsageSchema),
  context: EffectSchema.optionalKey(agentContextSchema),
  rewound: EffectSchema.optionalKey(countedNumber),
});

export type AgentMessagesAnswer = typeof agentMessagesAnswerSchema.Type;

export const agentBeforeSchema = EffectSchema.String.check(EffectSchema.isPattern(/^\d+$/u));

export const agentNewestAnswerSchema = EffectSchema.Struct({
  ...agentMessagesAnswerSchema.fields,
  before: EffectSchema.optionalKey(agentBeforeSchema),
});

export type AgentNewestAnswer = typeof agentNewestAnswerSchema.Type;

export const agentOlderAnswerSchema = EffectSchema.Struct({
  messages: EffectSchema.Array(agentTranscriptMessageSchema),
  before: EffectSchema.optionalKey(agentBeforeSchema),
});

export type AgentOlderAnswer = typeof agentOlderAnswerSchema.Type;

export function applyMessagesPage(
  held: readonly AgentTranscriptMessage[],
  page: readonly AgentTranscriptMessage[],
): readonly AgentTranscriptMessage[] {
  if (page.length === 0) return held;
  const heard = new Map(page.map((message) => [message.id, message]));
  const joined = held.map((message) => {
    const again = heard.get(message.id);
    return again === undefined ? message : keepIdentity(message, again);
  });
  const known = new Set(held.map((message) => message.id));
  const appended = page.filter((message) => !known.has(message.id));
  const unchanged =
    appended.length === 0 && joined.every((message, index) => message === held[index]);
  return unchanged ? held : [...joined, ...appended];
}
