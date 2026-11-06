import { Schema as EffectSchema, Option } from "effect";
import { isUtcDayKey } from "./admin-wire.js";
import { HOST_WIRE, hostConnectPath, hostUserCodeOf } from "./host-wire.js";
import { inAppScheme, isLinkHome, LINK_ORIGIN, RESERVED_WORKSPACE_SLUGS } from "./link-home.js";
import { parsedUrl } from "./parsed-url.js";

export const LINK_PLACE = {
  HOME: "home",
  BOARD: "board",
  TASK: "task",
  SECTION: "section",
  COMMENT: "comment",
  VERSION: "version",
  PAGE: "page",
  AGENT: "agent",
  WORKER: "worker",
  CHANGES: "changes",
  PULL_REQUEST_THREAD: "pull-request-thread",
  MESSAGE: "message",
  INBOX: "inbox",
  INBOX_ITEM: "inbox-item",
  AUTOMATIONS: "automations",
  AUTOMATION: "automation",
  AUTOMATION_RUN: "automation-run",
  SETTINGS: "settings",
  PERSON: "person",
  ADMIN: "admin",
} as const;

export const ADMIN_LINK_SECTION = {
  COST: "cost",
  RELIABILITY: "reliability",
  WORKSPACES: "workspaces",
  USERS: "users",
} as const;

export type AdminLinkSection = (typeof ADMIN_LINK_SECTION)[keyof typeof ADMIN_LINK_SECTION];

const ADMIN_LINK_SECTIONS: ReadonlySet<string> = new Set(Object.values(ADMIN_LINK_SECTION));

export const PULL_REQUEST_THREAD_VIEW = {
  CONVERSATION: "conversation",
  FILES: "files",
} as const;

export type PullRequestThreadView =
  (typeof PULL_REQUEST_THREAD_VIEW)[keyof typeof PULL_REQUEST_THREAD_VIEW];

const THREAD_VIEWS: ReadonlySet<string> = new Set(Object.values(PULL_REQUEST_THREAD_VIEW));

const STEP = {
  PLAN: "plan",
  TASK: "task",
  TASKS: "tasks",
  VERSION: "version",
  PAGE: "page",
  WORK: "work",
  AGENT: "agent",
  WORKER: "worker",
  CHANGES: "changes",
  THREAD: "thread",
  MESSAGE: "message",
  FILES: "files",
  INBOX: "inbox",
  CHANNEL: "channel",
  AUTOMATIONS: "automations",
  AUTOMATION: "automation",
  RUN: "run",
  SETTINGS: "settings",
  PERSON: "person",
  ADMIN: "admin",
  USER: "user",
  WORKSPACE: "workspace",
  DAY: "day",
} as const;

const COMMENT_QUERY = "comment";

const TASK_STEPS: ReadonlySet<string> = new Set([STEP.PLAN, STEP.TASK]);

export function currentTaskPath(path: string): string {
  const [, workspace, step, rest] = /^\/([^/?#]+)\/([^/?#]+)(.*)$/su.exec(path) ?? [];
  return workspace !== undefined && step === STEP.PLAN
    ? `/${workspace}/${STEP.TASK}${rest ?? ""}`
    : path;
}

const LINK_BOUNDS = {
  MAX_LINK_CHARS: 24_000,
  MAX_STEP_CHARS: 200,
} as const;

const ID = /^[A-Za-z0-9_-]+$/u;

const WORKSPACE_PLACES: ReadonlySet<string> = new Set([LINK_PLACE.HOME, LINK_PLACE.BOARD]);

const SETTINGS_PAGE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

const PICTURE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/u;

const WHOLE = /^\d{1,15}$/u;

const TASK_NUMBER = /^[1-9]\d{0,8}$/u;

const TASK_KEY = /^[\p{Lu}\p{N}]{1,4}-([1-9]\d{0,8})$/u;

const ANCHOR = /^[\p{L}\p{M}\p{N}\p{Pc}-]+$/u;

const GITHUB_HOST = "github.com";

export const GITHUB_ORIGIN = `https://${GITHUB_HOST}`;

export const GITHUB_DEFAULT_BRANCH = "HEAD";

export const GITHUB_REPOSITORY_BOUNDS = {
  MAX_OWNER_CHARS: 39,
  MAX_NAME_CHARS: 100,
} as const;

export const GITHUB_REPOSITORY_PATTERN =
  /^[A-Za-z0-9](?:-?[A-Za-z0-9])*\/(?!\.{1,2}$)[A-Za-z0-9_.-]+$/u;

export const githubRepositoryFullNameSchema = EffectSchema.Trim.check(
  EffectSchema.isMaxLength(
    GITHUB_REPOSITORY_BOUNDS.MAX_OWNER_CHARS + 1 + GITHUB_REPOSITORY_BOUNDS.MAX_NAME_CHARS,
  ),
  EffectSchema.isPattern(GITHUB_REPOSITORY_PATTERN),
);

export const GITHUB_PAGE = {
  PULL_REQUEST: "pull-request",
  ISSUE: "issue",
  FILE: "file",
  FOLDER: "folder",
} as const;

const GITHUB_STEP = {
  [GITHUB_PAGE.PULL_REQUEST]: "pull",
  [GITHUB_PAGE.ISSUE]: "issues",
  [GITHUB_PAGE.FILE]: "blob",
  [GITHUB_PAGE.FOLDER]: "tree",
} as const;

const WEB_PROTOCOLS: ReadonlySet<string> = new Set(["https:", "http:"]);

const COMMIT = /^[0-9a-f]{7,40}$/u;

const LINES_FRAGMENT = /^#L(\d{1,9})(?:-L(\d{1,9}))?$/u;

const PAGE_NUMBER = /^[1-9]\d{0,8}$/u;

const LINEAR_HOST = "linear.app";

const LINEAR_ISSUE_STEP = "issue";

export const LINEAR_IDENTIFIER = /^[A-Z][A-Z0-9_]{0,9}-[1-9]\d{0,8}$/u;

const MENTION_PROTOCOL = "mention:";

const LEGACY_PROTOCOL = "luke:";

const SCHEME_PROTOCOLS: ReadonlySet<string> = new Set([MENTION_PROTOCOL, LEGACY_PROTOCOL]);

export const SCHEME_LINK_HOST = {
  PLAN: "plan",
  FILE: "file",
  FOLDER: "folder",
  MCP: "mcp",
  DATE: "date",
} as const;

export type SchemeLinkHost = (typeof SCHEME_LINK_HOST)[keyof typeof SCHEME_LINK_HOST];

export const MENTION_SIGIL = "@";

const LABEL_SPECIAL = /[[\]\\]/gu;

const LABEL_ESCAPE = /\\([[\]\\])/gu;

const TARGET_BREAKING = /[()<>\s]/gu;

const TARGET_SPECIAL = /[()!'*]/gu;

const SPACE_CODE = 0x20;
const DELETE_CODE = 0x7f;

const idSchema = EffectSchema.String.check(
  EffectSchema.isMaxLength(LINK_BOUNDS.MAX_STEP_CHARS),
  EffectSchema.isPattern(ID),
);

const wholeSchema = EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(0));

const linkPlaceSchema = EffectSchema.Union([
  EffectSchema.Struct({ kind: EffectSchema.Literal(LINK_PLACE.HOME) }),
  EffectSchema.Struct({ kind: EffectSchema.Literal(LINK_PLACE.BOARD) }),
  EffectSchema.Struct({ kind: EffectSchema.Literal(LINK_PLACE.TASK), planId: idSchema }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(LINK_PLACE.SECTION),
    planId: idSchema,
    anchor: EffectSchema.String.check(EffectSchema.isPattern(ANCHOR)),
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(LINK_PLACE.COMMENT),
    planId: idSchema,
    threadId: idSchema,
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(LINK_PLACE.VERSION),
    planId: idSchema,
    revision: wholeSchema,
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(LINK_PLACE.PAGE),
    planId: idSchema,
    pageId: idSchema,
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(LINK_PLACE.PAGE),
    agentId: idSchema,
    pageId: idSchema,
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(LINK_PLACE.AGENT),
    planId: EffectSchema.optionalKey(idSchema),
    agentId: idSchema,
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(LINK_PLACE.WORKER),
    planId: EffectSchema.optionalKey(idSchema),
    agentId: idSchema,
    callId: idSchema,
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(LINK_PLACE.CHANGES),
    planId: EffectSchema.optionalKey(idSchema),
    agentId: idSchema,
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(LINK_PLACE.PULL_REQUEST_THREAD),
    planId: EffectSchema.optionalKey(idSchema),
    agentId: idSchema,
    threadId: idSchema,
    view: EffectSchema.Literals(Object.values(PULL_REQUEST_THREAD_VIEW)),
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(LINK_PLACE.MESSAGE),
    planId: EffectSchema.optionalKey(idSchema),
    agentId: idSchema,
    messageId: idSchema,
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(LINK_PLACE.INBOX),
    planId: EffectSchema.optionalKey(idSchema),
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(LINK_PLACE.INBOX_ITEM),
    planId: idSchema,
    itemId: idSchema,
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(LINK_PLACE.INBOX_ITEM),
    agentId: idSchema,
    itemId: idSchema,
  }),
  EffectSchema.Struct({ kind: EffectSchema.Literal(LINK_PLACE.INBOX_ITEM), itemId: idSchema }),
  EffectSchema.Struct({ kind: EffectSchema.Literal(LINK_PLACE.AUTOMATIONS) }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(LINK_PLACE.AUTOMATION),
    automationId: idSchema,
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(LINK_PLACE.AUTOMATION_RUN),
    automationId: idSchema,
    runId: idSchema,
  }),
  EffectSchema.Struct({ kind: EffectSchema.Literal(LINK_PLACE.PERSON), userId: idSchema }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(LINK_PLACE.SETTINGS),
    page: EffectSchema.optionalKey(
      EffectSchema.String.check(EffectSchema.isPattern(SETTINGS_PAGE)),
    ),
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(LINK_PLACE.ADMIN),
    section: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(ADMIN_LINK_SECTION))),
    userId: EffectSchema.optionalKey(idSchema),
    workspaceId: EffectSchema.optionalKey(idSchema),
    day: EffectSchema.optionalKey(
      EffectSchema.String.check(
        EffectSchema.isPattern(DAY_KEY),
        EffectSchema.makeFilter((value: string) => isUtcDayKey(value)),
      ),
    ),
  }),
]);

export type LinkPlace = typeof linkPlaceSchema.Type;

export type LinkPlaceKind = LinkPlace["kind"];

export interface ReadLink {
  readonly workspace: string;
  readonly place: LinkPlace;
}

const readPlace = EffectSchema.decodeUnknownOption(linkPlaceSchema);

export const isLinkPlace = EffectSchema.is(linkPlaceSchema);

export function encodedStep(step: string): string {
  return encodeURIComponent(step).replace(
    TARGET_SPECIAL,
    (special) => `%${special.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function encodedPath(path: string): string {
  return path.split("/").map(encodedStep).join("/");
}

export function decodedStep(step: string): string | undefined {
  try {
    return decodeURIComponent(step);
  } catch {
    return undefined;
  }
}

function boundedStep(step: string): string | undefined {
  return step.length > LINK_BOUNDS.MAX_STEP_CHARS * 3 ? undefined : decodedStep(step);
}

function namesItemPicture(more: readonly string[]): boolean {
  const [step, id, ...after] = more;
  return step === STEP.FILES && id !== undefined && PICTURE_ID.test(id) && after.length === 0;
}

function taskStepOf(step: string): string {
  return TASK_KEY.exec(step)?.[1] ?? step;
}

function taskFields(taskId: string, rest: readonly string[]) {
  const [step, id, ...more] = rest;
  if (step === STEP.AGENT && id !== undefined) return agentFields(taskId, id, more);
  if (step === STEP.INBOX && id !== undefined && namesItemPicture(more)) {
    return { kind: LINK_PLACE.INBOX_ITEM, planId: taskId, itemId: id };
  }
  if (id === undefined || more.length > 0) return undefined;
  switch (step) {
    case STEP.VERSION:
      return WHOLE.test(id)
        ? { kind: LINK_PLACE.VERSION, planId: taskId, revision: Number(id) }
        : undefined;
    case STEP.PAGE:
      return { kind: LINK_PLACE.PAGE, planId: taskId, pageId: id };
    case STEP.WORK:
      return WHOLE.test(id) ? { kind: LINK_PLACE.TASK, planId: taskId } : undefined;
    case STEP.WORKER:
      return { kind: LINK_PLACE.TASK, planId: taskId };
    case STEP.INBOX:
      return { kind: LINK_PLACE.INBOX_ITEM, planId: taskId, itemId: id };
    case STEP.FILES:
      return PICTURE_ID.test(id) ? { kind: LINK_PLACE.TASK, planId: taskId } : undefined;
    default:
      return undefined;
  }
}

function agentFields(taskId: string | undefined, agentId: string, rest: readonly string[]) {
  const [step, id, ...more] = rest;
  const task = taskId === undefined ? {} : { planId: taskId };
  if (step === undefined) return { kind: LINK_PLACE.AGENT, ...task, agentId };
  if (step === STEP.CHANGES && id === undefined)
    return { kind: LINK_PLACE.CHANGES, ...task, agentId };
  if (step === STEP.CHANGES) return threadFields(task, agentId, rest);
  if (step === STEP.INBOX && taskId === undefined && id !== undefined && namesItemPicture(more)) {
    return { kind: LINK_PLACE.INBOX_ITEM, agentId, itemId: id };
  }
  if (id === undefined || more.length > 0) return undefined;
  if (step === STEP.MESSAGE) return { kind: LINK_PLACE.MESSAGE, ...task, agentId, messageId: id };
  if (step === STEP.PAGE && taskId === undefined)
    return { kind: LINK_PLACE.PAGE, agentId, pageId: id };
  if (step === STEP.INBOX && taskId === undefined) {
    return { kind: LINK_PLACE.INBOX_ITEM, agentId, itemId: id };
  }
  if (step === STEP.WORKER) return { kind: LINK_PLACE.WORKER, ...task, agentId, callId: id };
  return undefined;
}

function threadFields(
  task: { readonly planId?: string },
  agentId: string,
  rest: readonly string[],
) {
  const [, view, step, threadId, ...more] = rest;
  if (view === undefined || !THREAD_VIEWS.has(view) || step !== STEP.THREAD) return undefined;
  if (threadId === undefined || more.length > 0) return undefined;
  return { kind: LINK_PLACE.PULL_REQUEST_THREAD, ...task, agentId, threadId, view };
}

function placeFields(steps: readonly string[]) {
  const [step, id, ...rest] = steps;
  if (step !== undefined && TASK_STEPS.has(step)) {
    return id === undefined ? undefined : taskFields(id, rest);
  }
  switch (step) {
    case undefined:
      return { kind: LINK_PLACE.HOME };
    case STEP.TASKS:
      return id === undefined ? { kind: LINK_PLACE.BOARD } : undefined;
    case STEP.AGENT:
      return id === undefined ? undefined : agentFields(undefined, id, rest);
    case STEP.INBOX:
      return inboxFields(id, rest);
    case STEP.CHANNEL:
      return id === undefined || rest.length > 0 ? undefined : { kind: LINK_PLACE.INBOX };
    case STEP.AUTOMATIONS:
      return id === undefined ? { kind: LINK_PLACE.AUTOMATIONS } : undefined;
    case STEP.AUTOMATION:
      if (id === undefined) return undefined;
      if (rest.length === 0) return { kind: LINK_PLACE.AUTOMATION, automationId: id };
      return rest.length === 2 && rest[0] === STEP.RUN
        ? { kind: LINK_PLACE.AUTOMATION_RUN, automationId: id, runId: rest[1] }
        : undefined;
    case STEP.PERSON:
      return id === undefined || rest.length > 0
        ? undefined
        : { kind: LINK_PLACE.PERSON, userId: id };
    case STEP.SETTINGS:
      if (rest.length > 0) return undefined;
      return id === undefined
        ? { kind: LINK_PLACE.SETTINGS }
        : { kind: LINK_PLACE.SETTINGS, page: id };
    case STEP.ADMIN:
      return adminFields(id, rest);
    default:
      return undefined;
  }
}

function inboxFields(step: string | undefined, rest: readonly string[]) {
  if (step === undefined) return { kind: LINK_PLACE.INBOX };
  if (TASK_STEPS.has(step)) {
    const [taskId, ...more] = rest;
    return taskId === undefined || more.length > 0
      ? undefined
      : { kind: LINK_PLACE.INBOX, planId: taskStepOf(taskId) };
  }
  return rest.length === 0 || namesItemPicture(rest)
    ? { kind: LINK_PLACE.INBOX_ITEM, itemId: step }
    : undefined;
}

function adminFields(step: string | undefined, rest: readonly string[]) {
  if (step === undefined) return { kind: LINK_PLACE.ADMIN };
  const [id, ...more] = rest;
  if (more.length > 0) return undefined;
  if (step === STEP.USER)
    return id === undefined ? undefined : { kind: LINK_PLACE.ADMIN, userId: id };
  if (step === STEP.WORKSPACE)
    return id === undefined ? undefined : { kind: LINK_PLACE.ADMIN, workspaceId: id };
  if (step === STEP.DAY) return id === undefined ? undefined : { kind: LINK_PLACE.ADMIN, day: id };
  return id === undefined && ADMIN_LINK_SECTIONS.has(step)
    ? { kind: LINK_PLACE.ADMIN, section: step }
    : undefined;
}

function workspaceStep(workspace: string): boolean {
  return ID.test(workspace) && !RESERVED_WORKSPACE_SLUGS.has(workspace.toLowerCase());
}

function taskLink(taskId: string, hash: string): LinkPlace | undefined {
  if (hash === "" || hash === "#") {
    return Option.getOrUndefined(readPlace({ kind: LINK_PLACE.TASK, planId: taskId }));
  }
  const anchor = decodedStep(hash.slice(1))?.toLowerCase();
  return Option.getOrUndefined(readPlace({ kind: LINK_PLACE.SECTION, planId: taskId, anchor }));
}

function placePath(place: LinkPlace): readonly string[] {
  switch (place.kind) {
    case LINK_PLACE.HOME:
      return [];
    case LINK_PLACE.BOARD:
      return [STEP.TASKS];
    case LINK_PLACE.TASK:
    case LINK_PLACE.SECTION:
    case LINK_PLACE.COMMENT:
      return [STEP.TASK, place.planId];
    case LINK_PLACE.VERSION:
      return [STEP.TASK, place.planId, STEP.VERSION, String(place.revision)];
    case LINK_PLACE.PAGE:
      return "planId" in place
        ? [STEP.TASK, place.planId, STEP.PAGE, place.pageId]
        : [STEP.AGENT, place.agentId, STEP.PAGE, place.pageId];
    case LINK_PLACE.AGENT:
      return agentPath(place.planId, place.agentId);
    case LINK_PLACE.WORKER:
      return [...agentPath(place.planId, place.agentId), STEP.WORKER, place.callId];
    case LINK_PLACE.CHANGES:
      return [...agentPath(place.planId, place.agentId), STEP.CHANGES];
    case LINK_PLACE.PULL_REQUEST_THREAD:
      return [
        ...agentPath(place.planId, place.agentId),
        STEP.CHANGES,
        place.view,
        STEP.THREAD,
        place.threadId,
      ];
    case LINK_PLACE.MESSAGE:
      return [...agentPath(place.planId, place.agentId), STEP.MESSAGE, place.messageId];
    case LINK_PLACE.INBOX:
      return place.planId === undefined ? [STEP.INBOX] : [STEP.INBOX, STEP.TASK, place.planId];
    case LINK_PLACE.INBOX_ITEM:
      if ("planId" in place) return [STEP.TASK, place.planId, STEP.INBOX, place.itemId];
      return "agentId" in place
        ? [STEP.AGENT, place.agentId, STEP.INBOX, place.itemId]
        : [STEP.INBOX, place.itemId];
    case LINK_PLACE.AUTOMATIONS:
      return [STEP.AUTOMATIONS];
    case LINK_PLACE.AUTOMATION:
      return [STEP.AUTOMATION, place.automationId];
    case LINK_PLACE.AUTOMATION_RUN:
      return [STEP.AUTOMATION, place.automationId, STEP.RUN, place.runId];
    case LINK_PLACE.PERSON:
      return [STEP.PERSON, place.userId];
    case LINK_PLACE.SETTINGS:
      return place.page === undefined ? [STEP.SETTINGS] : [STEP.SETTINGS, place.page];
    case LINK_PLACE.ADMIN:
      if (place.userId !== undefined) return [STEP.ADMIN, STEP.USER, place.userId];
      if (place.workspaceId !== undefined) return [STEP.ADMIN, STEP.WORKSPACE, place.workspaceId];
      if (place.day !== undefined) return [STEP.ADMIN, STEP.DAY, place.day];
      return place.section === undefined ? [STEP.ADMIN] : [STEP.ADMIN, place.section];
  }
}

function agentPath(taskId: string | undefined, agentId: string): readonly string[] {
  return taskId === undefined ? [STEP.AGENT, agentId] : [STEP.TASK, taskId, STEP.AGENT, agentId];
}

export function linkOf(place: LinkPlace, workspace: string): string {
  const link = [LINK_ORIGIN, workspace, ...placePath(place)]
    .map((step, index) => (index === 0 ? step : encodedStep(step)))
    .join("/");
  if (place.kind === LINK_PLACE.SECTION && place.anchor !== "") {
    return `${link}#${encodedStep(place.anchor)}`;
  }
  if (place.kind === LINK_PLACE.COMMENT) {
    return `${link}?${new URLSearchParams({ [COMMENT_QUERY]: place.threadId })}`;
  }
  return link;
}

export function readLink(target: string): ReadLink | undefined {
  if (target.length > LINK_BOUNDS.MAX_LINK_CHARS) return undefined;
  const url = parsedUrl(target);
  if (url === undefined || !isLinkHome(url)) return undefined;
  const [first, ...encoded] = url.pathname.replace(/\/$/u, "").split("/");
  const steps = encoded.map(boundedStep);
  const [workspace, ...after] = steps;
  if (first !== "" || workspace === undefined || workspace === "") return undefined;
  if (workspace.length > LINK_BOUNDS.MAX_STEP_CHARS) return undefined;
  if (!after.every((step): step is string => step !== undefined && step !== "")) return undefined;
  const [step, written, ...rest] = after;
  const taskStep = step !== undefined && TASK_STEPS.has(step);
  const taskId = taskStep && written !== undefined ? taskStepOf(written) : written;
  const taskOwn = taskStep && taskId !== undefined && rest.length === 0;
  const placeSteps = taskStep && taskId !== undefined ? [step, taskId, ...rest] : after;
  const thread = url.searchParams.getAll(COMMENT_QUERY);
  const place =
    taskOwn && thread.length === 1
      ? Option.getOrUndefined(
          readPlace({ kind: LINK_PLACE.COMMENT, planId: taskId, threadId: thread[0] }),
        )
      : taskOwn
        ? taskLink(taskId, url.hash)
        : Option.getOrUndefined(readPlace(placeFields(placeSteps)));
  if (place === undefined) return undefined;
  if (WORKSPACE_PLACES.has(place.kind) && !workspaceStep(workspace)) return undefined;
  return { workspace, place };
}

export function taskNumberOf(place: LinkPlace): number | undefined {
  return "planId" in place && place.planId !== undefined && TASK_NUMBER.test(place.planId)
    ? Number(place.planId)
    : undefined;
}

export function withTaskId(place: LinkPlace, taskId: string): LinkPlace {
  return "planId" in place ? { ...place, planId: taskId } : place;
}

export function taskLinkStep(task: {
  readonly id: string;
  readonly number?: number | undefined;
}): string {
  return task.number === undefined ? task.id : String(task.number);
}

export const ACCOUNT_PLACE = {
  CONNECT: "connect",
} as const;

const accountPlaceSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(ACCOUNT_PLACE.CONNECT),
  code: EffectSchema.String.check(
    EffectSchema.makeFilter((value: string) => hostUserCodeOf(value) === value),
  ),
});

export type AccountPlace = typeof accountPlaceSchema.Type;

export type AccountPlaceKind = AccountPlace["kind"];

export const isAccountPlace = EffectSchema.is(accountPlaceSchema);

export interface AccountLink {
  readonly place: AccountPlace;
}

export type ShownLink = ReadLink | AccountLink;

const CONNECT_PREFIX = `${HOST_WIRE.CONNECT_PATH}/`;

function readAccountLink(target: string): AccountLink | undefined {
  if (target.length > LINK_BOUNDS.MAX_LINK_CHARS) return undefined;
  const url = parsedUrl(target);
  if (url === undefined || !isLinkHome(url)) return undefined;
  const path = url.pathname.replace(/\/$/u, "");
  if (!path.startsWith(CONNECT_PREFIX)) return undefined;
  const typed = boundedStep(path.slice(CONNECT_PREFIX.length));
  const code = typed === undefined ? undefined : hostUserCodeOf(typed);
  return code === undefined ? undefined : { place: { kind: ACCOUNT_PLACE.CONNECT, code } };
}

function accountLinkOf(place: AccountPlace): string {
  return `${LINK_ORIGIN}${hostConnectPath(place.code)}`;
}

export function readShownLink(target: string): ShownLink | undefined {
  return readAccountLink(target) ?? readLink(target);
}

export function appLinkOf(target: string): string | undefined {
  const read = readShownLink(target);
  if (read === undefined) return undefined;
  return inAppScheme(
    "workspace" in read ? linkOf(read.place, read.workspace) : accountLinkOf(read.place),
  );
}

interface GitHubLines {
  readonly startLine: number;
  readonly endLine: number;
}

export interface NumberedAddress {
  readonly repository: string;
  readonly number: number;
}

export type GitHubPage =
  | ({ readonly kind: typeof GITHUB_PAGE.PULL_REQUEST } & NumberedAddress)
  | ({ readonly kind: typeof GITHUB_PAGE.ISSUE } & NumberedAddress)
  | {
      readonly kind: typeof GITHUB_PAGE.FILE;
      readonly repository: string;
      readonly ref: string;
      readonly path: string;
      readonly lines?: GitHubLines;
    }
  | {
      readonly kind: typeof GITHUB_PAGE.FOLDER;
      readonly repository: string;
      readonly ref: string;
      readonly path: string;
    };

function isGitHubRepository(words: string): boolean {
  const { MAX_OWNER_CHARS, MAX_NAME_CHARS } = GITHUB_REPOSITORY_BOUNDS;
  return (
    words.length <= MAX_OWNER_CHARS + 1 + MAX_NAME_CHARS && GITHUB_REPOSITORY_PATTERN.test(words)
  );
}

function repositoryPath(encoded: readonly string[]): string | undefined {
  const steps = encoded.map(decodedStep);
  const whole = steps.every(
    (step): step is string => step !== undefined && step !== "" && step !== "." && step !== "..",
  );
  return whole && steps.length > 0 ? steps.join("/") : undefined;
}

function fragmentLines(ref: string, hash: string): GitHubLines | false | undefined {
  const lines = LINES_FRAGMENT.exec(hash);
  if (lines === null || !COMMIT.test(ref)) return undefined;
  const startLine = Number(lines[1]);
  const endLine = lines[2] === undefined ? startLine : Number(lines[2]);
  return startLine >= 1 && startLine <= endLine ? { startLine, endLine } : false;
}

function repositoryPageOf(
  repository: string,
  step: string,
  [ref, ...encoded]: readonly string[],
  hash: string,
): GitHubPage | undefined {
  if (ref === undefined) return undefined;
  if (step === GITHUB_STEP[GITHUB_PAGE.FOLDER]) {
    const path = repositoryPath(encoded.at(-1) === "" ? encoded.slice(0, -1) : encoded);
    return path === undefined ? undefined : { kind: GITHUB_PAGE.FOLDER, repository, ref, path };
  }
  const path = repositoryPath(encoded);
  const lines = fragmentLines(ref, hash);
  if (path === undefined || lines === false) return undefined;
  const file = { kind: GITHUB_PAGE.FILE, repository, ref, path } as const;
  return lines === undefined ? file : { ...file, lines };
}

function gitHubStepsOf(target: string) {
  const url = parsedUrl(target);
  if (url === undefined || url.hostname !== GITHUB_HOST || !WEB_PROTOCOLS.has(url.protocol)) {
    return undefined;
  }
  const [first, owner, name, step, ...rest] = url.pathname.split("/");
  const repository = `${owner}/${name}`;
  if (first !== "" || step === undefined || !isGitHubRepository(repository)) return undefined;
  return { repository, step, rest, hash: url.hash };
}

function namesRepositoryPage(step: string, ref: string | undefined): boolean {
  const kind = step === GITHUB_STEP[GITHUB_PAGE.FILE] || step === GITHUB_STEP[GITHUB_PAGE.FOLDER];
  return kind && ref !== undefined && (ref === GITHUB_DEFAULT_BRANCH || COMMIT.test(ref));
}

export function readGitHubPage(target: string): GitHubPage | undefined {
  const page = gitHubStepsOf(target);
  if (page === undefined) return undefined;
  const { repository, step, rest, hash } = page;
  if (step === GITHUB_STEP[GITHUB_PAGE.PULL_REQUEST] || step === GITHUB_STEP[GITHUB_PAGE.ISSUE]) {
    const number = rest[0];
    if (number === undefined || !PAGE_NUMBER.test(number)) return undefined;
    const kind =
      step === GITHUB_STEP[GITHUB_PAGE.ISSUE] ? GITHUB_PAGE.ISSUE : GITHUB_PAGE.PULL_REQUEST;
    return { kind, repository, number: Number(number) };
  }
  if (!namesRepositoryPage(step, rest[0])) return undefined;
  return repositoryPageOf(repository, step, rest, hash);
}

export function gitHubFilePageRepositoryOf(target: string): string | undefined {
  const page = gitHubStepsOf(target);
  return page !== undefined && namesRepositoryPage(page.step, page.rest[0])
    ? page.repository
    : undefined;
}

export function gitHubPageLink(page: GitHubPage): string {
  const repository = `${GITHUB_ORIGIN}/${encodedPath(page.repository)}/${GITHUB_STEP[page.kind]}`;
  if (page.kind === GITHUB_PAGE.PULL_REQUEST || page.kind === GITHUB_PAGE.ISSUE) {
    return `${repository}/${page.number}`;
  }
  const at = `${repository}/${encodedPath(page.ref)}/${encodedPath(page.path)}`;
  if (page.kind === GITHUB_PAGE.FOLDER || page.lines === undefined) return at;
  const { startLine, endLine } = page.lines;
  return startLine === endLine ? `${at}#L${startLine}` : `${at}#L${startLine}-L${endLine}`;
}

export function pullRequestAddressOf(target: string): NumberedAddress | undefined {
  const page = readGitHubPage(target);
  return page?.kind === GITHUB_PAGE.PULL_REQUEST
    ? { repository: page.repository, number: page.number }
    : undefined;
}

export function issueAddressOf(target: string): NumberedAddress | undefined {
  const page = readGitHubPage(target);
  return page?.kind === GITHUB_PAGE.ISSUE
    ? { repository: page.repository, number: page.number }
    : undefined;
}

export function readLinearIssue(target: string): string | undefined {
  const url = parsedUrl(target);
  if (url === undefined || url.hostname !== LINEAR_HOST) return undefined;
  const [first, , step, identifier] = url.pathname.split("/");
  if (first !== "" || step !== LINEAR_ISSUE_STEP || identifier === undefined) return undefined;
  const upper = identifier.toUpperCase();
  return LINEAR_IDENTIFIER.test(upper) ? upper : undefined;
}

export interface SchemeLink {
  readonly host: string;
  readonly steps: readonly string[];
  readonly hash: string;
  readonly search: string;
}

export function readSchemeLink(target: string): SchemeLink | undefined {
  const url = parsedUrl(target);
  if (url === undefined || !SCHEME_PROTOCOLS.has(url.protocol)) return undefined;
  const steps = url.pathname.replace(/^\//u, "").split("/");
  return { host: url.host, steps, hash: url.hash, search: url.search };
}

export function schemeLinkOf(host: SchemeLinkHost, path: string): string {
  return `${MENTION_PROTOCOL}//${host}/${path}`;
}

export function escapedLabel(words: string): string {
  const oneLine = [...words]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < SPACE_CODE || code === DELETE_CODE ? " " : character;
    })
    .join("");
  return oneLine.replace(LABEL_SPECIAL, (special) => `\\${special}`);
}

export function readLabel(written: string): string {
  return written.replace(LABEL_ESCAPE, "$1");
}

export function linkTarget(address: string): string {
  return address.replace(TARGET_BREAKING, (special) => {
    if (special === "(") return "%28";
    if (special === ")") return "%29";
    return encodeURIComponent(special);
  });
}

export function markdownLink(label: string, target: string): string {
  return `[${escapedLabel(label)}](${linkTarget(target)})`;
}

export function mentionMarkdownLink(name: string, target: string): string {
  return markdownLink(`${MENTION_SIGIL}${name}`, target);
}
