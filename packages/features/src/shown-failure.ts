import { Predicate } from "effect";
import { CALL_FAULT, DEADLINE_ERROR_NAME } from "./account-call.js";
import { redactCredentials } from "./credential-redaction.js";
import { PRODUCT_NAME } from "./product-name.js";

export const FAILURE_SURFACE = {
  ACCOUNT_DELETE: "account.delete",
  ACCOUNT_SIGN_IN: "account.sign_in",
  ACCOUNT_SIGN_OUT: "account.sign_out",
  ACCOUNT_TOKEN_READ: "account_token.read",
  ACT: "act",
  ADMIN_GATE: "admin.gate",
  ADMIN_READ: "admin.read",
  ADMIN_REFRESH: "admin.refresh",
  ADMIN_WRITE: "admin.write",
  AGENTS_READ: "agents.read",
  AGENT_ADD_REPOSITORY: "agent_repository.add",
  AGENT_ARCHIVE: "agent.archive",
  AGENT_CHANGES_READ: "agent_changes.read",
  AGENT_CHANGES_REFRESH: "agent_changes.refresh",
  AGENT_CHAPTERS_GENERATE: "agent_chapters.generate",
  AGENT_CHAPTERS_READ: "agent_chapters.read",
  AGENT_COMPOSER: "agent.composer",
  AGENT_DEFAULTS_READ: "agent_defaults.read",
  AGENT_DELETE: "agent.delete",
  AGENT_KEYS_READ: "agent_keys.read",
  AGENT_KEY_REMOVE: "agent_key.remove",
  AGENT_KEY_SAVE: "agent_key.save",
  AGENT_PIN: "agent.pin",
  AGENT_QUEUE_CHANGE: "agent_queue.change",
  AGENT_QUEUE_DELETE: "agent_queue.delete",
  AGENT_RENAME: "agent.rename",
  AGENT_REWIND: "agent.rewind",
  AGENT_SEND: "agent.send",
  AGENT_SERVERS: "agent.servers",
  AGENT_START: "agent.start",
  AGENT_STOP: "agent.stop",
  AGENT_TRANSCRIPT_OLDER_READ: "agent_transcript_older.read",
  AGENT_TRANSCRIPT_READ: "agent_transcript.read",
  AGENT_TURN: "agent.turn",
  AUTOMATIONS_READ: "automations.read",
  AUTOMATIONS_REFRESH: "automations.refresh",
  AUTOMATION_AGENTS_READ: "automation_agents.read",
  AUTOMATION_AGENTS_SEARCH: "automation_agents.search",
  AUTOMATION_DELETE: "automation.delete",
  AUTOMATION_INTEGRATIONS_READ: "automation_integrations.read",
  AUTOMATION_LEAVE: "automation.leave",
  AUTOMATION_READ: "automation.read",
  ATTACHMENT_READ: "attachment.read",
  AUTOMATION_RUN: "automation.run",
  AUTOMATION_RUNS_READ: "automation_runs.read",
  AUTOMATION_SAVE: "automation.save",
  AUTOMATION_SECRET_ROTATE: "automation_secret.rotate",
  AUTOMATION_SENTRY_INSTALL: "automation_sentry.install",
  AUTOMATION_SENTRY_READ: "automation_sentry.read",
  AUTOMATION_TOGGLE: "automation.toggle",
  BROWSER_OPEN: "browser.open",
  BUNDLE_LOAD: "bundle.load",
  CLI_INSTALL: "cli.install",
  COPY: "copy",
  DICTATION: "dictation",
  DIFF_READ: "diff.read",
  FEEDBACK_SEND: "feedback.send",
  FILE_READ: "file.read",
  FILE_SAVE: "file.save",
  FILE_TREE_READ: "file_tree.read",
  GITHUB_ACCOUNT: "github.account",
  GITHUB_TOKEN_REMOVE: "github_token.remove",
  GITHUB_TOKEN_SAVE: "github_token.save",
  HOME_INBOX_READ: "home_inbox.read",
  HOME_TASKS_READ: "home_tasks.read",
  HOSTS_READ: "hosts.read",
  HOST_PAIRING_ANSWER: "host_pairing.answer",
  HOST_PAIRING_READ: "host_pairing.read",
  HOST_REMOVE: "host.remove",
  INBOX_ANSWER: "inbox.answer",
  INBOX_CLOSE: "inbox.close",
  INBOX_CODE_READ: "inbox_code.read",
  INBOX_FILES_READ: "inbox_files.read",
  INBOX_ITEM_READ: "inbox_item.read",
  INBOX_MARK: "inbox.mark",
  INBOX_READ: "inbox.read",
  INTEGRATIONS_READ: "integrations.read",
  INTEGRATION_DISCONNECT: "integration.disconnect",
  INTEGRATION_RECONNECT: "integration.reconnect",
  INTEGRATION_RENAME: "integration.rename",
  MCP_CLIENTS_READ: "mcp_clients.read",
  MCP_CLIENT_REVOKE: "mcp_client.revoke",
  MEMBERS_READ: "members.read",
  MEMORIES_READ: "memories.read",
  MEMORY_FORGET: "memory.forget",
  MENTIONS_READ: "mentions.read",
  MESSAGE_EDIT: "message.edit",
  MESSAGE_REVEAL: "message.reveal",
  MODELS_READ: "models.read",
  PAGE_READ: "page.read",
  PALETTE_READ: "palette.read",
  PERSON_AUTOMATIONS_READ: "person_automations.read",
  PERSON_INBOX_READ: "person_inbox.read",
  PERSON_READ: "person.read",
  PERSON_TASKS_READ: "person_tasks.read",
  PICTURE_KEEP: "picture.keep",
  PICTURE_READ: "picture.read",
  PIN_MOVE: "pin.move",
  DESCRIPTION_ADD: "description.add",
  DESCRIPTION_COMMENTS_READ: "description_comments.read",
  DESCRIPTION_COMMENT_DELETE: "description_comment.delete",
  DESCRIPTION_COMMENT_DISCARD: "description_comment.discard",
  DESCRIPTION_COMMENT_EDIT: "description_comment.edit",
  DESCRIPTION_COMMENT_SEND: "description_comment.send",
  DESCRIPTION_DIAGRAM: "description.diagram",
  DESCRIPTION_HISTORY_OLDER_READ: "description_history_older.read",
  DESCRIPTION_HISTORY_READ: "description_history.read",
  DESCRIPTION_RESTORE: "description.restore",
  DESCRIPTION_SAVE: "description.save",
  DESCRIPTION_THREAD_REOPEN: "description_thread.reopen",
  DESCRIPTION_THREAD_RESOLVE: "description_thread.resolve",
  DESCRIPTION_VERSION_READ: "description_version.read",
  PULL_REQUEST_CHECKS_READ: "pull_request_checks.read",
  PULL_REQUEST_COMMENT_DELETE: "pull_request_comment.delete",
  PULL_REQUEST_CONVERSATION_READ: "pull_request_conversation.read",
  PULL_REQUEST_DEQUEUE: "pull_request.dequeue",
  PULL_REQUEST_DESCRIPTION: "pull_request.description",
  PULL_REQUEST_READ: "pull_request.read",
  PULL_REQUEST_REVIEW_DISCARD: "pull_request_review.discard",
  PULL_REQUEST_THREAD: "pull_request.thread",
  PULL_REQUEST_WRITE: "pull_request.write",
  REPOSITORIES_READ: "repositories.read",
  REPOSITORY_PIN: "repository.pin",
  SECTION_WRITE: "section.write",
  SETTINGS_RESET: "settings.reset",
  SETTING_WRITE: "setting.write",
  SKILLS_READ: "skills.read",
  SKILL_ADD: "skill.add",
  SKILL_PREVIEW: "skill.preview",
  SKILL_READ: "skill.read",
  SKILL_REMOVE: "skill.remove",
  TASKS_READ: "tasks.read",
  TASKS_REFRESH: "tasks.refresh",
  TASK_BLOCK: "task.block",
  TASK_PARENT: "task.parent",
  TASK_RELATION: "task.relation",
  TASK_DELETE: "task.delete",
  TASK_DOCUMENT_READ: "task_document.read",
  TASK_MARK: "task.mark",
  TASK_MOVE: "task.move",
  TASK_RENAME: "task.rename",
  TASK_SETTLE: "task.settle",
  TASK_STANDING: "task.standing",
  TASK_START: "task.start",
  TERMINAL_CREATE: "terminal.create",
  TERMINAL_SHELLS_READ: "terminal_shells.read",
  TERMINAL_STOP: "terminal.stop",
  THIS_MAC_SET: "this_mac.set",
  TRANSCRIPT_COPY: "transcript.copy",
  UPDATE_CHECK: "update.check",
  WINDOW_ZOOM: "window.zoom",
  WORKSPACES_READ: "workspaces.read",
  WORKSPACE_CREATE: "workspace.create",
  WORKSPACE_GITHUB: "workspace.github",
  WORKSPACE_GITHUB_DISCONNECT: "workspace_github.disconnect",
  WORKSPACE_INVITATIONS_READ: "workspace_invitations.read",
  WORKSPACE_INVITATION_CANCEL: "workspace_invitation.cancel",
  WORKSPACE_INVITE: "workspace.invite",
  WORKSPACE_LEAVE: "workspace.leave",
  WORKSPACE_MEMBER: "workspace.member",
  WORKSPACE_MEMBERS_READ: "workspace_members.read",
  WORKSPACE_MEMBER_REMOVE: "workspace_member.remove",
  WORKSPACE_REPOSITORIES_READ: "workspace_repositories.read",
  WORKSPACE_REPOSITORY_REMOVE: "workspace_repository.remove",
  WORKSPACE_SENTRY: "workspace.sentry",
  WORKSPACE_SENTRY_DISCONNECT: "workspace_sentry.disconnect",
  WORKSPACE_SENTRY_READ: "workspace_sentry.read",
  WORKSPACE_SLACK_BOT: "workspace.slack_bot",
  WORKSPACE_SLACK_BOT_CHANNEL: "workspace_slack_bot.channel",
  WORKSPACE_SLACK_BOT_DISCONNECT: "workspace_slack_bot.disconnect",
  WORKSPACE_SLACK_BOT_READ: "workspace_slack_bot.read",
  WORKSPACE_SLACK_BOT_REPOSITORY: "workspace_slack_bot.repository",
  WORKSPACE_TRANSFER: "workspace.transfer",
  WORKSPACE_WRITE: "workspace.write",
} as const;
export type FailureSurface = (typeof FAILURE_SURFACE)[keyof typeof FAILURE_SURFACE];

export const FAILURE_CONDITION = {
  GONE: "gone",
  UNREAD: "unread",
  NOT_KEPT: "not-kept",
  REFUSED: "refused",
  CONFLICT: "conflict",
} as const;

export const FAILURE_KIND = { REFUSED: "refused", UNEXPECTED: "unexpected" } as const;
export type FailureKind = (typeof FAILURE_KIND)[keyof typeof FAILURE_KIND];

export interface FailureAbout {
  readonly workspaceId?: string | undefined;
  readonly taskId?: string | undefined;
  readonly agentId?: string | undefined;
  readonly conversationId?: string | undefined;
  readonly turnId?: string | undefined;
  readonly callId?: string | undefined;
  readonly inboxItemId?: string | undefined;
  readonly automationId?: string | undefined;
  readonly pullRequest?: number | undefined;
}

interface FailureState {
  readonly online: boolean;
  readonly account: string;
  readonly live?: string | undefined;
}

export interface ShownFailureReport {
  readonly surface: FailureSurface;
  readonly kind: FailureKind;
  readonly cause: unknown;
  readonly about: FailureAbout;
  readonly act?: string | undefined;
  readonly state: FailureState;
}

type FailureAttributes = Record<string, string | number | boolean>;

const ISSUE_LEVEL = "error";

interface ShownFailureHint {
  readonly mechanism: { readonly type: string; readonly handled: boolean };
  readonly captureContext: {
    readonly level: typeof ISSUE_LEVEL;
    readonly fingerprint: string[];
    readonly tags: FailureAttributes;
    readonly contexts: Record<string, FailureAttributes>;
  };
}

export interface ShownFailureSentry {
  readonly captureException: (error: Error, hint: ShownFailureHint) => string;
  readonly getActiveSpan: () =>
    | { readonly spanContext: () => { readonly traceId: string } }
    | undefined;
  readonly getCurrentScope: () => {
    readonly getPropagationContext: () => { readonly traceId: string };
  };
  readonly logger: {
    readonly warn: (message: string, attributes: FailureAttributes) => void;
    readonly error: (message: string, attributes: FailureAttributes) => void;
  };
}

export interface ShownFailureSent {
  readonly eventId?: string | undefined;
  readonly traceId?: string | undefined;
}

interface ShownFailureTold {
  readonly at: number;
  readonly version?: string | undefined;
  readonly sent?: ShownFailureSent | undefined;
}

interface CauseFacts {
  readonly name?: string | undefined;
  readonly tag?: string | undefined;
  readonly code?: string | undefined;
  readonly status?: number | undefined;
  readonly fault?: string | undefined;
  readonly message?: string | undefined;
}

const FAILURE_CONDITIONS: ReadonlySet<unknown> = new Set(Object.values(FAILURE_CONDITION));

const ABOUT_ATTRIBUTE = {
  workspaceId: "workspace.id",
  taskId: "task.id",
  agentId: "agent.id",
  conversationId: "conversation.id",
  turnId: "turn.id",
  callId: "call.id",
  inboxItemId: "inbox_item.id",
  automationId: "automation.id",
  pullRequest: "pull_request.number",
} as const satisfies { readonly [Key in keyof Required<FailureAbout>]: string };

const ERROR_ATTRIBUTE = {
  name: "error.name",
  tag: "error.tag",
  code: "error.code",
  status: "error.status",
  fault: "error.fault",
  message: "error.message",
} as const satisfies { readonly [Key in keyof Required<CauseFacts>]: string };

const ROOT_ATTRIBUTE = {
  name: "error.root.name",
  tag: "error.root.tag",
  code: "error.root.code",
  status: "error.root.status",
  fault: "error.root.fault",
  message: "error.root.message",
} as const satisfies { readonly [Key in keyof Required<CauseFacts>]: string };

const FAILURE_ATTRIBUTE = {
  SURFACE: "failure.surface",
  KIND: "failure.kind",
  CODE: "failure.code",
  ACT: "failure.act",
  ONLINE: "app.online",
  ACCOUNT: "app.account",
  LIVE: "app.live",
  HOSTED_TRACE: "hosted.trace_id",
} as const;

const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/;

const DETAIL_KEY = {
  TIME: "time",
  VERSION: "app.version",
  EVENT: "sentry.event_id",
  TRACE: "sentry.trace_id",
} as const;

const DETAILS_HEADING = `${PRODUCT_NAME} error details. Include these when you report this problem:`;

const SHOWN_FAILURE_CONTEXT = "shown_failure";

const SHOWN_FAILURE_MECHANISM = "auto.vespin.shown_failure";

const SHOWN_FAILURE_FINGERPRINT = "shown-failure";

const UNNAMED_CODE = "unnamed";

const TEXT_BOUND = 500;

const CHAIN_BOUND = 5;

const CAUSE_KEY = "cause";

function stringOf(value: unknown, key: string): string | undefined {
  if (!Predicate.hasProperty(value, key)) return undefined;
  const read = value[key];
  return Predicate.isString(read) ? read : undefined;
}

function numberOf(value: unknown, key: string): number | undefined {
  if (!Predicate.hasProperty(value, key)) return undefined;
  const read = value[key];
  return Predicate.isNumber(read) ? read : undefined;
}

function sendableText(text: string): string {
  const redacted = redactCredentials(text);
  return redacted.length > TEXT_BOUND ? `${redacted.slice(0, TEXT_BOUND)}…` : redacted;
}

function sendableOf(value: unknown, key: string): string | undefined {
  const read = stringOf(value, key);
  return read === undefined ? undefined : sendableText(read);
}

function factsOf(cause: unknown): CauseFacts {
  if (FAILURE_CONDITIONS.has(cause) && Predicate.isString(cause)) return { code: cause };
  if (Predicate.isString(cause)) return { message: sendableText(cause) };
  const code = numberOf(cause, "code")?.toString() ?? sendableOf(cause, "code");
  const message = stringOf(cause, "message") ?? stringOf(cause, "reason");
  return {
    name:
      sendableOf(cause, "errorName") ??
      (cause instanceof Error ? sendableText(cause.name) : sendableOf(cause, "name")),
    tag: sendableOf(cause, "_tag"),
    code:
      code ??
      sendableOf(cause, "failure") ??
      sendableOf(cause, "refusal") ??
      sendableOf(cause, "status"),
    status: numberOf(cause, "status") ?? numberOf(cause, "statusCode"),
    fault: sendableOf(cause, "fault"),
    message: message === undefined || message === "" ? undefined : sendableText(message),
  };
}

function chainOf(cause: unknown): readonly unknown[] {
  const chain = [cause];
  let next = cause;
  while (chain.length < CHAIN_BOUND && Predicate.hasProperty(next, CAUSE_KEY)) {
    next = next[CAUSE_KEY];
    if (next === undefined || next === null || chain.includes(next)) break;
    chain.push(next);
  }
  return chain;
}

function codeOf(chain: readonly CauseFacts[]): string {
  const named = chain.find((facts) => (facts.code ?? facts.fault ?? facts.tag) !== undefined);
  return named?.code ?? named?.fault ?? named?.tag ?? chain.at(-1)?.name ?? UNNAMED_CODE;
}

function factAttributes(
  facts: CauseFacts,
  names: { readonly [Key in keyof Required<CauseFacts>]: string },
): FailureAttributes {
  const attributes: FailureAttributes = {};
  for (const key of Object.keys(names) as (keyof CauseFacts)[]) {
    const value = facts[key];
    if (value !== undefined) attributes[names[key]] = value;
  }
  return attributes;
}

function aboutAttributes(about: FailureAbout): FailureAttributes {
  const attributes: FailureAttributes = {};
  for (const key of Object.keys(ABOUT_ATTRIBUTE) as (keyof FailureAbout)[]) {
    const value = about[key];
    if (value !== undefined) attributes[ABOUT_ATTRIBUTE[key]] = value;
  }
  return attributes;
}

function hostedTraceOf(chain: readonly unknown[]): string | undefined {
  for (const cause of chain) {
    const traceId = stringOf(cause, "traceId");
    if (traceId !== undefined && TRACE_ID_PATTERN.test(traceId)) return traceId;
  }
  return undefined;
}

function attributesOf(
  report: ShownFailureReport,
  chain: readonly CauseFacts[],
  code: string,
  trace: string | undefined,
) {
  const root = chain.length > 1 ? chain.at(-1) : undefined;
  return {
    [FAILURE_ATTRIBUTE.SURFACE]: report.surface,
    [FAILURE_ATTRIBUTE.KIND]: report.kind,
    [FAILURE_ATTRIBUTE.CODE]: code,
    ...(report.act === undefined ? {} : { [FAILURE_ATTRIBUTE.ACT]: report.act }),
    ...factAttributes(chain[0] ?? {}, ERROR_ATTRIBUTE),
    ...(root === undefined ? {} : factAttributes(root, ROOT_ATTRIBUTE)),
    ...(trace === undefined ? {} : { [FAILURE_ATTRIBUTE.HOSTED_TRACE]: trace }),
    ...aboutAttributes(report.about),
    [FAILURE_ATTRIBUTE.ONLINE]: report.state.online,
    [FAILURE_ATTRIBUTE.ACCOUNT]: report.state.account,
    ...(report.state.live === undefined ? {} : { [FAILURE_ATTRIBUTE.LIVE]: report.state.live }),
  } satisfies FailureAttributes;
}

function sendableStack(cause: Error, sent: Error): string | undefined {
  const stack = cause.stack;
  if (stack === undefined) return undefined;
  const header = cause.message === "" ? cause.name : `${cause.name}: ${cause.message}`;
  if (!stack.startsWith(header)) {
    return cause.message !== "" && stack.includes(cause.message) ? undefined : stack;
  }
  const sentHeader = sent.message === "" ? sent.name : `${sent.name}: ${sent.message}`;
  return `${sentHeader}${stack.slice(header.length)}`;
}

function sendableError(chain: readonly unknown[], facts: readonly CauseFacts[]): Error {
  const [cause, ...beneath] = chain;
  const [own, ...beneathFacts] = facts;
  const linked = beneath.length === 0 ? undefined : { cause: sendableError(beneath, beneathFacts) };
  const sent = new Error(own?.message ?? "", linked);
  sent.name = own?.tag ?? own?.name ?? UNNAMED_CODE;
  const stack = cause instanceof Error ? sendableStack(cause, sent) : undefined;
  if (stack !== undefined) sent.stack = stack;
  return sent;
}

function unansweredOf(chain: readonly CauseFacts[]): boolean {
  return chain.some(
    (facts) => facts.fault === CALL_FAULT.NETWORK || facts.name === DEADLINE_ERROR_NAME,
  );
}

function readReport(report: ShownFailureReport) {
  const chain = chainOf(report.cause);
  const facts = chain.map(factsOf);
  const code = codeOf(facts);
  const trace = hostedTraceOf(chain);
  return { chain, facts, code, trace, attributes: attributesOf(report, facts, code, trace) };
}

export function failureAboutOf(payload: unknown): FailureAbout {
  return {
    workspaceId: stringOf(payload, "workspaceId"),
    taskId: stringOf(payload, "taskId"),
    agentId: stringOf(payload, "agentId"),
    conversationId: stringOf(payload, "conversationId"),
    turnId: stringOf(payload, "turnId"),
    inboxItemId: stringOf(payload, "inboxItemId"),
    automationId: stringOf(payload, "automationId"),
    pullRequest: numberOf(payload, "pullRequest"),
  };
}

export function sendShownFailure(
  sentry: ShownFailureSentry,
  report: ShownFailureReport,
): ShownFailureSent {
  const { chain, facts, code, trace, attributes } = readReport(report);
  const line = `A failure was shown on ${report.surface}: ${code}`;
  const traceId =
    sentry.getActiveSpan()?.spanContext().traceId ??
    sentry.getCurrentScope().getPropagationContext().traceId;
  if (report.kind === FAILURE_KIND.REFUSED || !report.state.online || unansweredOf(facts)) {
    sentry.logger.warn(line, attributes);
    return { traceId };
  }
  sentry.logger.error(line, attributes);
  const eventId = sentry.captureException(sendableError(chain, facts), {
    mechanism: { type: SHOWN_FAILURE_MECHANISM, handled: true },
    captureContext: {
      level: ISSUE_LEVEL,
      fingerprint: [SHOWN_FAILURE_FINGERPRINT, report.surface, code],
      tags: {
        [FAILURE_ATTRIBUTE.SURFACE]: report.surface,
        [FAILURE_ATTRIBUTE.CODE]: code,
        ...(trace === undefined ? {} : { [FAILURE_ATTRIBUTE.HOSTED_TRACE]: trace }),
        ...aboutAttributes(report.about),
      },
      contexts: { [SHOWN_FAILURE_CONTEXT]: attributes },
    },
  });
  return { eventId: eventId === "" ? undefined : eventId, traceId };
}

export function shownFailureDetails(report: ShownFailureReport, told: ShownFailureTold): string {
  const { attributes } = readReport(report);
  const lines: Record<string, string | number | boolean | undefined> = {
    [DETAIL_KEY.TIME]: new Date(told.at).toISOString(),
    [DETAIL_KEY.VERSION]: told.version,
    ...attributes,
    [DETAIL_KEY.EVENT]: told.sent?.eventId,
    [DETAIL_KEY.TRACE]: told.sent?.traceId,
  };
  const said = Object.entries(lines).flatMap(([key, value]) =>
    value === undefined || value === "" ? [] : [`${key}: ${value}`],
  );
  return [DETAILS_HEADING, ...said].join("\n");
}
