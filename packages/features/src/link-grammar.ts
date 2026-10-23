import { Schema as EffectSchema, Option } from "effect";
import { isUtcDayKey } from "./admin-wire.js";
import { inAppScheme, isLinkHome, LINK_ORIGIN } from "./link-home.js";
import { parsedUrl } from "./parsed-url.js";

/**
 * link-grammar.ts -- every link the app reads and writes, as the address it is and the Markdown it is written into words as: Luke's own places, GitHub's and Linear's pages, and the older `luke://` forms.
 *
 * This is the one module that knows how an address is spelled. A mention
 * (`mention-link.ts`) names what a link names and reads it through here; a
 * card, a chip, a router, and the service's answers read and write theirs
 * through here too, so no two of them spell one address two ways, and every
 * label is escaped the same way (`markdownLink`).
 *
 * A Luke link is the thing's address on the web, `https://<home>/<workspace>/…`
 * (`link-home.ts`), and the desktop is handed the same address in its own
 * scheme. Each step after the
 * workspace says what kind of thing comes next,
 * and a list is plural where a thing is singular, as GitHub's `/pulls` and
 * `/pull/1` are:
 *
 * - a task, `/plan/<id>`, and its section, `#<anchor>`, its version,
 *   `/plan/<id>/version/<seq>`, a page an agent wrote for it,
 *   `/plan/<id>/page/<pageId>`, and a turn of Luke's own work on it,
 *   `/plan/<id>/work/<at>`;
 * - one of its agents, `/plan/<id>/agent/<agentId>`, and under it a worker,
 *   `/worker/<callId>`, its Changes, `/changes`, one review thread of its
 *   pull request in one of that tab's views,
 *   `/changes/<conversation|files>/thread/<threadId>`, or a message,
 *   `/message/<messageId>`; a worker of Luke's own is `/plan/<id>/worker/<callId>`;
 * - an agent with no task, `/agent/<agentId>`, a message of its own, and a
 *   page it showed, which stands on it rather than a task,
 *   `/agent/<agentId>/page/<pageId>`;
 * - the Inbox, `/inbox`, and an item in it under the task or the agent with
 *   no task that holds it, `/plan/<id>/inbox/<itemId>` or
 *   `/agent/<agentId>/inbox/<itemId>`, since the Inbox is read by its holders;
 * - the Automations page, `/automations`, an automation,
 *   `/automation/<id>`, and one of its runs, `/automation/<id>/run/<runId>`;
 * - a page of Settings, `/settings[/<page>]`;
 * - Chat, `/chat`, and one of its channels, `/chat/<channelId>`, a topic,
 *   a task's channel, or a direct message alike;
 * - a person's page in the workspace, `/person/<userId>`, a member or
 *   someone who left, by the account id the service names them by;
 * - the Admin place, an admin's alone, which reads every workspace's
 *   accounts, so its workspace is only the one the link was copied in:
 *   `/admin`, a section of it, `/admin/<cost|reliability|workspaces|users>`,
 *   an account's page, `/admin/user/<userId>`, and a day's,
 *   `/admin/day/<YYYY-MM-DD>`.
 *
 * An issue's page, `/issue/<issueId>`, is no place now that Luke keeps no
 * issues of its own, and Factory's, `/factory`, none now that Factory is
 * gone, so an old link to either reads as a link it does not know.
 *
 * A picture in a plan, `/plan/<id>/files/<picture>` (`plan-attachment-link.ts`),
 * is read as its task, and a picture in an Inbox item's words, the item's
 * link with `/files/<picture>` after it (`inbox-attachment-link.ts`), as
 * the item, since nothing of a picture is opened by its link.
 *
 * Note that a link carries ids and nothing else: never a name, a token, or
 * any of the thing's words, since a link is pasted where anyone may read it
 * (AGENTS.md's "Never"). The workspace's slug reads well and is never
 * trusted: the id alone finds the thing, and whoever opens the link is
 * checked against it there, so a link says no more than its address does.
 * A task is written `/plan/` and read under `/task/` too, the name the
 * unit of work is taking; a reader takes a trailing slash, a query, and a
 * fragment a kind has no use for, and refuses anything else. A section's
 * anchor is its heading as GitHub spells a Markdown heading's
 * (`mention-link.ts`'s `sectionAnchors`), read in lower case.
 *
 * A page of GitHub's the app reads is a pull request's,
 * `https://github.com/<owner>/<name>/pull/<number>` or any page under it, an
 * issue's, `/issues/<number>`, or a file's or a folder's,
 * `/blob/<ref>/<path>` and `/tree/<ref>/<path>`, read only on `HEAD` or a
 * commit, since a branch's name may hold a slash and leave no telling where
 * it ends and the path begins; a file's lines, `#L3-L5`, are read only at a
 * commit, since a branch's lines drift. A Linear issue's page is
 * `https://linear.app/<workspace>/issue/<KEY-123>`, its slug after it or not.
 *
 * The forms written before Luke's links were settled, `luke://<host>/<path>`,
 * are read forever, and kept for what has no page of its own on the web, an
 * MCP server and a date; what each host's path means is the mention's.
 *
 * A link is written into words as `[label](target)`: its label's brackets
 * and backslashes escaped and its line breaks made spaces, so a title
 * holding `]` stays one label, and its target's parentheses and spaces
 * percent-encoded, so it stays one target.
 */

export const LINK_PLACE = {
  TASK: "task",
  SECTION: "section",
  /** One comment thread of a task, written as the task's link with the thread in its `comment` query. */
  COMMENT: "comment",
  VERSION: "version",
  PAGE: "page",
  TURN: "turn",
  AGENT: "agent",
  WORKER: "worker",
  CHANGES: "changes",
  /** One review thread of an agent's pull request, in its Pull request tab's Conversation or Files changed, by GitHub's node id for the thread. */
  PULL_REQUEST_THREAD: "pull-request-thread",
  MESSAGE: "message",
  INBOX: "inbox",
  INBOX_ITEM: "inbox-item",
  AUTOMATIONS: "automations",
  AUTOMATION: "automation",
  AUTOMATION_RUN: "automation-run",
  SETTINGS: "settings",
  PERSON: "person",
  /** Chat, on For you, or on one of its channels by the id the service mints it. */
  CHAT: "chat",
  /** The Admin place: its Overview, a section, an account's page, or a day's. */
  ADMIN: "admin",
} as const;

/** The Admin place's sections a link names past its Overview, which is the place's own link. */
export const ADMIN_LINK_SECTION = {
  COST: "cost",
  RELIABILITY: "reliability",
  WORKSPACES: "workspaces",
  USERS: "users",
} as const;

export type AdminLinkSection = (typeof ADMIN_LINK_SECTION)[keyof typeof ADMIN_LINK_SECTION];

const ADMIN_LINK_SECTIONS: ReadonlySet<string> = new Set(Object.values(ADMIN_LINK_SECTION));

/** Which of a Pull request tab's views a review thread's link opens it in: its Conversation, or Files changed, on its line. */
export const PULL_REQUEST_THREAD_VIEW = {
  CONVERSATION: "conversation",
  FILES: "files",
} as const;

export type PullRequestThreadView =
  (typeof PULL_REQUEST_THREAD_VIEW)[keyof typeof PULL_REQUEST_THREAD_VIEW];

const THREAD_VIEWS: ReadonlySet<string> = new Set(Object.values(PULL_REQUEST_THREAD_VIEW));

/** The steps of a link's path, each naming what the step after it is. */
const STEP = {
  PLAN: "plan",
  TASK: "task",
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
  AUTOMATIONS: "automations",
  AUTOMATION: "automation",
  RUN: "run",
  SETTINGS: "settings",
  PERSON: "person",
  CHAT: "chat",
  ADMIN: "admin",
  USER: "user",
  DAY: "day",
} as const;

/** The query a task's link names one of its comment threads under. */
const COMMENT_QUERY = "comment";

/** The steps a task is read under: the one written, and the name the unit of work is taking. */
const TASK_STEPS: ReadonlySet<string> = new Set([STEP.PLAN, STEP.TASK]);

const LINK_BOUNDS = {
  /** The most characters a link may spell before it is read: a section's at the mention codec's own bound, its anchor a long heading percent-encoded. */
  MAX_LINK_CHARS: 24_000,
  /** The most characters a workspace's slug, or an id, may spell. */
  MAX_STEP_CHARS: 200,
} as const;

/** An id as the service mints one, or as a call's id is spelled: letters, digits, `_`, and `-`. */
const ID = /^[A-Za-z0-9_-]+$/u;

/** A page of Settings as its link spells it: lower case, words joined by hyphens. */
const SETTINGS_PAGE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

/** A picture's id as the service mints one, a UUID in lower case (`plan-attachment-link.ts`). */
const PICTURE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** A UTC day as the Admin place's day page names it, `YYYY-MM-DD`; whether it is a real day is `isUtcDayKey`'s. */
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/u;

/** A number spelled whole: a version's, or a moment's in epoch milliseconds. */
const WHOLE = /^\d{1,15}$/u;

/** An anchor as a heading's is spelled: letters, marks, digits, underscores, and hyphens. */
const ANCHOR = /^[\p{L}\p{M}\p{N}\p{Pc}-]+$/u;

/** GitHub's own host, whose pages are its pull requests, issues, files, and folders. */
const GITHUB_HOST = "github.com";

/** GitHub's own address, by the scheme its pages are written in. */
export const GITHUB_ORIGIN = `https://${GITHUB_HOST}`;

/** The branch a file's or a folder's page names the default one by, which follows it. */
export const GITHUB_DEFAULT_BRANCH = "HEAD";

/** GitHub's own bounds on a repository's `owner/name`. */
export const GITHUB_REPOSITORY_BOUNDS = {
  /** GitHub's own bound on an owner's login. */
  MAX_OWNER_CHARS: 39,
  /** GitHub's own bound on a repository's name. */
  MAX_NAME_CHARS: 100,
} as const;

/**
 * `owner/name`: a login, which GitHub spells in letters, digits, and single
 * hyphens between them, one slash, and a name in letters, digits, dots,
 * underscores, and hyphens, which GitHub never lets be `.` or `..`. Nothing
 * else, so a path cannot ride in a repository's name.
 */
export const GITHUB_REPOSITORY_PATTERN =
  /^[A-Za-z0-9](?:-?[A-Za-z0-9])*\/(?!\.{1,2}$)[A-Za-z0-9_.-]+$/u;

/** The kinds of GitHub's pages the app reads. */
export const GITHUB_PAGE = {
  PULL_REQUEST: "pull-request",
  ISSUE: "issue",
  FILE: "file",
  FOLDER: "folder",
} as const;

/** The step before what a GitHub page's path names next: a pull request's number, an issue's, or a file's or a folder's ref. */
const GITHUB_STEP = {
  [GITHUB_PAGE.PULL_REQUEST]: "pull",
  [GITHUB_PAGE.ISSUE]: "issues",
  [GITHUB_PAGE.FILE]: "blob",
  [GITHUB_PAGE.FOLDER]: "tree",
} as const;

/** The schemes a page on the web is read by. */
const WEB_PROTOCOLS: ReadonlySet<string> = new Set(["https:", "http:"]);

/** A commit as a link pins one: seven to forty hexadecimal digits. */
const COMMIT = /^[0-9a-f]{7,40}$/u;

/** A GitHub page's lines: `#L3`, or `#L3-L5`. */
const LINES_FRAGMENT = /^#L(\d{1,9})(?:-L(\d{1,9}))?$/u;

/** A pull request's or an issue's number as its page's path spells it: whole, from one. */
const PAGE_NUMBER = /^[1-9]\d{0,8}$/u;

/** Linear's own host, whose `/<workspace>/issue/<identifier>` pages are its issues. */
const LINEAR_HOST = "linear.app";

/** The step before an issue's identifier in a Linear page's path. */
const LINEAR_ISSUE_STEP = "issue";

/** A Linear issue's identifier, its team's key and its number, `ENG-123`, as Linear spells it. */
export const LINEAR_IDENTIFIER = /^[A-Z][A-Z0-9_]{0,9}-[1-9]\d{0,8}$/u;

/** The scheme of the forms written before Luke's links were settled. */
const LEGACY_PROTOCOL = "luke:";

/** What a `luke://` address's host says its path names. */
export const LEGACY_LINK_HOST = {
  PLAN: "plan",
  FILE: "file",
  FOLDER: "folder",
  MCP: "mcp",
  DATE: "date",
} as const;

export type LegacyLinkHost = (typeof LEGACY_LINK_HOST)[keyof typeof LEGACY_LINK_HOST];

/** What marks a link's label as a mention's: `[@Rollout](<target>)`. */
export const MENTION_SIGIL = "@";

/** The characters a markdown link's label must escape to stay one label. */
const LABEL_SPECIAL = /[[\]\\]/gu;

/** A label's escaped character, read back. */
const LABEL_ESCAPE = /\\([[\]\\])/gu;

/** What would end a markdown link's target early: a parenthesis, an angle bracket, or white space. */
const TARGET_BREAKING = /[()<>\s]/gu;

/** The characters `encodeURIComponent` leaves that would end or break a markdown link's target. */
const TARGET_SPECIAL = /[()!'*]/gu;

/** The code of a space, below which, and at delete, a character is a control one. */
const SPACE_CODE = 0x20;
const DELETE_CODE = 0x7f;

const idSchema = EffectSchema.String.check(
  EffectSchema.isMaxLength(LINK_BOUNDS.MAX_STEP_CHARS),
  EffectSchema.isPattern(ID),
);

const wholeSchema = EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(0));

const linkPlaceSchema = EffectSchema.Union([
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
    kind: EffectSchema.Literal(LINK_PLACE.TURN),
    planId: idSchema,
    at: wholeSchema,
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(LINK_PLACE.AGENT),
    planId: EffectSchema.optionalKey(idSchema),
    agentId: idSchema,
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(LINK_PLACE.WORKER),
    planId: idSchema,
    agentId: EffectSchema.optionalKey(idSchema),
    callId: idSchema,
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(LINK_PLACE.CHANGES),
    planId: idSchema,
    agentId: idSchema,
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(LINK_PLACE.PULL_REQUEST_THREAD),
    planId: idSchema,
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
  EffectSchema.Struct({ kind: EffectSchema.Literal(LINK_PLACE.INBOX) }),
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
    kind: EffectSchema.Literal(LINK_PLACE.CHAT),
    channelId: EffectSchema.optionalKey(idSchema),
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(LINK_PLACE.SETTINGS),
    page: EffectSchema.optionalKey(
      EffectSchema.String.check(EffectSchema.isPattern(SETTINGS_PAGE)),
    ),
  }),
  // One struct with every view optional, as Settings' and Chat's are, so a
  // section the schema does not know is refused rather than read as the
  // Overview by a struct naming none.
  EffectSchema.Struct({
    kind: EffectSchema.Literal(LINK_PLACE.ADMIN),
    section: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(ADMIN_LINK_SECTION))),
    userId: EffectSchema.optionalKey(idSchema),
    day: EffectSchema.optionalKey(
      EffectSchema.String.check(
        EffectSchema.isPattern(DAY_KEY),
        EffectSchema.makeFilter((value: string) => isUtcDayKey(value)),
      ),
    ),
  }),
]);

/** A place in Luke a link can send someone to, by the ids that find it. */
export type LinkPlace = typeof linkPlaceSchema.Type;

/** The kind of place a link sends someone to. */
export type LinkPlaceKind = LinkPlace["kind"];

/** A link read: the place it names, and the workspace it was written under, which a reader may show and never trusts. */
export interface ReadLink {
  readonly workspace: string;
  readonly place: LinkPlace;
}

const readPlace = EffectSchema.decodeUnknownOption(linkPlaceSchema);

/** Whether a value is a place a link can name, as one crossing from main to a window is checked. */
export const isLinkPlace = EffectSchema.is(linkPlaceSchema);

/** A step of a path written percent-encoded, parentheses included, so a link pasted into markdown stays one target. */
export function encodedStep(step: string): string {
  return encodeURIComponent(step).replace(
    TARGET_SPECIAL,
    (special) => `%${special.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** A path written percent-encoded step by step, its slashes kept. */
export function encodedPath(path: string): string {
  return path.split("/").map(encodedStep).join("/");
}

/** A step of a path read back, or nothing where its encoding is broken. */
export function decodedStep(step: string): string | undefined {
  try {
    return decodeURIComponent(step);
  } catch {
    return undefined;
  }
}

/** A step of a Luke link read back, or nothing where its encoding is broken or it is too long to be one. */
function boundedStep(step: string): string | undefined {
  return step.length > LINK_BOUNDS.MAX_STEP_CHARS * 3 ? undefined : decodedStep(step);
}

/** Whether the steps after an Inbox item's id name one of its pictures, `files/<picture>`, which opens the item. */
function namesItemPicture(more: readonly string[]): boolean {
  const [step, id, ...after] = more;
  return step === STEP.FILES && id !== undefined && PICTURE_ID.test(id) && after.length === 0;
}

/** The steps after a task's id: a version, a page, a turn, an agent's, or a worker of Luke's. */
function taskFields(taskId: string, rest: readonly string[]) {
  const [step, id, ...more] = rest;
  if (step === STEP.AGENT && id !== undefined) return agentFields(taskId, id, more);
  // A picture in an item's words opens the item, and nothing of the picture.
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
      return WHOLE.test(id) ? { kind: LINK_PLACE.TURN, planId: taskId, at: Number(id) } : undefined;
    case STEP.WORKER:
      return { kind: LINK_PLACE.WORKER, planId: taskId, callId: id };
    case STEP.INBOX:
      return { kind: LINK_PLACE.INBOX_ITEM, planId: taskId, itemId: id };
    // A picture of the task's plan opens the task, and nothing of the picture.
    case STEP.FILES:
      return PICTURE_ID.test(id) ? { kind: LINK_PLACE.TASK, planId: taskId } : undefined;
    default:
      return undefined;
  }
}

/** The steps after an agent's id, under its task where it has one: the agent itself, a worker, its Changes, a message, or, on no task, a page of its own. */
function agentFields(taskId: string | undefined, agentId: string, rest: readonly string[]) {
  const [step, id, ...more] = rest;
  const task = taskId === undefined ? {} : { planId: taskId };
  if (step === undefined) return { kind: LINK_PLACE.AGENT, ...task, agentId };
  if (step === STEP.CHANGES && id === undefined && taskId !== undefined) {
    return { kind: LINK_PLACE.CHANGES, planId: taskId, agentId };
  }
  if (step === STEP.CHANGES && taskId !== undefined) return threadFields(taskId, agentId, rest);
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
  if (step === STEP.WORKER && taskId !== undefined) {
    return { kind: LINK_PLACE.WORKER, planId: taskId, agentId, callId: id };
  }
  return undefined;
}

/** A review thread's steps after its agent's Changes, `<view>/thread/<threadId>`; nothing for any other. */
function threadFields(taskId: string, agentId: string, rest: readonly string[]) {
  const [, view, step, threadId, ...more] = rest;
  if (view === undefined || !THREAD_VIEWS.has(view) || step !== STEP.THREAD) return undefined;
  if (threadId === undefined || more.length > 0) return undefined;
  return { kind: LINK_PLACE.PULL_REQUEST_THREAD, planId: taskId, agentId, threadId, view };
}

/** The fields a link's steps after its workspace spell, for the schema to read; nothing where they name no place. */
function placeFields(steps: readonly string[]) {
  const [step, id, ...rest] = steps;
  if (step !== undefined && TASK_STEPS.has(step)) {
    return id === undefined ? undefined : taskFields(id, rest);
  }
  switch (step) {
    case STEP.AGENT:
      return id === undefined ? undefined : agentFields(undefined, id, rest);
    case STEP.INBOX:
      return id === undefined ? { kind: LINK_PLACE.INBOX } : undefined;
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
    case STEP.CHAT:
      if (rest.length > 0) return undefined;
      return id === undefined
        ? { kind: LINK_PLACE.CHAT }
        : { kind: LINK_PLACE.CHAT, channelId: id };
    case STEP.ADMIN:
      return adminFields(id, rest);
    default:
      return undefined;
  }
}

/** The Admin place's fields past its step: its Overview, a section, an account's page, or a day's. */
function adminFields(step: string | undefined, rest: readonly string[]) {
  if (step === undefined) return { kind: LINK_PLACE.ADMIN };
  const [id, ...more] = rest;
  if (more.length > 0) return undefined;
  if (step === STEP.USER)
    return id === undefined ? undefined : { kind: LINK_PLACE.ADMIN, userId: id };
  if (step === STEP.DAY) return id === undefined ? undefined : { kind: LINK_PLACE.ADMIN, day: id };
  return id === undefined && ADMIN_LINK_SECTIONS.has(step)
    ? { kind: LINK_PLACE.ADMIN, section: step }
    : undefined;
}

/** A task's link, or a section's by its fragment, an empty one the task's own; the anchor read in lower case. */
function taskLink(taskId: string, hash: string): LinkPlace | undefined {
  if (hash === "" || hash === "#") {
    return Option.getOrUndefined(readPlace({ kind: LINK_PLACE.TASK, planId: taskId }));
  }
  const anchor = decodedStep(hash.slice(1))?.toLowerCase();
  return Option.getOrUndefined(readPlace({ kind: LINK_PLACE.SECTION, planId: taskId, anchor }));
}

/** The path a place is written at under its workspace, each id percent-encoded. */
function placePath(place: LinkPlace): readonly string[] {
  switch (place.kind) {
    case LINK_PLACE.TASK:
    case LINK_PLACE.SECTION:
    case LINK_PLACE.COMMENT:
      return [STEP.PLAN, place.planId];
    case LINK_PLACE.VERSION:
      return [STEP.PLAN, place.planId, STEP.VERSION, String(place.revision)];
    case LINK_PLACE.PAGE:
      return "planId" in place
        ? [STEP.PLAN, place.planId, STEP.PAGE, place.pageId]
        : [STEP.AGENT, place.agentId, STEP.PAGE, place.pageId];
    case LINK_PLACE.TURN:
      return [STEP.PLAN, place.planId, STEP.WORK, String(place.at)];
    case LINK_PLACE.AGENT:
      return agentPath(place.planId, place.agentId);
    case LINK_PLACE.WORKER:
      return place.agentId === undefined
        ? [STEP.PLAN, place.planId, STEP.WORKER, place.callId]
        : [...agentPath(place.planId, place.agentId), STEP.WORKER, place.callId];
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
      return [STEP.INBOX];
    case LINK_PLACE.INBOX_ITEM:
      return "planId" in place
        ? [STEP.PLAN, place.planId, STEP.INBOX, place.itemId]
        : [STEP.AGENT, place.agentId, STEP.INBOX, place.itemId];
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
    case LINK_PLACE.CHAT:
      return place.channelId === undefined ? [STEP.CHAT] : [STEP.CHAT, place.channelId];
    case LINK_PLACE.ADMIN:
      if (place.userId !== undefined) return [STEP.ADMIN, STEP.USER, place.userId];
      if (place.day !== undefined) return [STEP.ADMIN, STEP.DAY, place.day];
      return place.section === undefined ? [STEP.ADMIN] : [STEP.ADMIN, place.section];
  }
}

/** An agent's path: under its task where it has one, else under the workspace. */
function agentPath(taskId: string | undefined, agentId: string): readonly string[] {
  return taskId === undefined ? [STEP.AGENT, agentId] : [STEP.PLAN, taskId, STEP.AGENT, agentId];
}

/**
 * The link a place is shared by, under its workspace by slug, or by id
 * where the slug is not yet known, by its ids alone: a section's with its
 * anchor as the fragment, the task's own where the anchor is empty, and a
 * comment thread's in the task's query.
 */
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

/**
 * The place a link names and the workspace it was written under, by the
 * web's scheme or the desktop's, on Luke's home or a host it once had;
 * nothing for any other address, or one naming no place.
 */
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
  // A task's own link, or a section's, is read by the codec that writes a mention of either.
  const [step, taskId, ...rest] = after;
  const taskOwn =
    step !== undefined && TASK_STEPS.has(step) && taskId !== undefined && rest.length === 0;
  // Note that a task's link naming one of its comment threads opens the thread; any other query is the address's own, which the place has no use for.
  const thread = url.searchParams.getAll(COMMENT_QUERY);
  const place =
    taskOwn && thread.length === 1
      ? Option.getOrUndefined(
          readPlace({ kind: LINK_PLACE.COMMENT, planId: taskId, threadId: thread[0] }),
        )
      : taskOwn
        ? taskLink(taskId, url.hash)
        : Option.getOrUndefined(readPlace(placeFields(after)));
  return place === undefined ? undefined : { workspace, place };
}

/**
 * A link spelled in the desktop's own scheme, which the system hands the
 * app: written again from the place it names, so nothing else the address
 * carried reaches the app; nothing for an address naming no place.
 */
export function appLinkOf(target: string): string | undefined {
  const read = readLink(target);
  return read === undefined ? undefined : inAppScheme(linkOf(read.place, read.workspace));
}

/** A file's lines a GitHub page names, the first through the last, counted from one. */
export interface GitHubLines {
  readonly startLine: number;
  readonly endLine: number;
}

/** A pull request or an issue a page's address names: its repository, `owner/name`, and its number. */
export interface NumberedAddress {
  readonly repository: string;
  readonly number: number;
}

/** A page of GitHub's the app reads, by what finds it: a pull request, an issue, or a file or a folder of a repository at a ref. */
export type GitHubPage =
  | ({ readonly kind: typeof GITHUB_PAGE.PULL_REQUEST } & NumberedAddress)
  | ({ readonly kind: typeof GITHUB_PAGE.ISSUE } & NumberedAddress)
  | {
      readonly kind: typeof GITHUB_PAGE.FILE;
      readonly repository: string;
      /** `HEAD`, or a commit; a written page may name a branch. */
      readonly ref: string;
      /** From the repository's root, its steps joined by slashes. */
      readonly path: string;
      readonly lines?: GitHubLines;
    }
  | {
      readonly kind: typeof GITHUB_PAGE.FOLDER;
      readonly repository: string;
      readonly ref: string;
      readonly path: string;
    };

/** Whether words are a repository's `owner/name` as GitHub spells one, within its bounds. */
export function isGitHubRepository(words: string): boolean {
  const { MAX_OWNER_CHARS, MAX_NAME_CHARS } = GITHUB_REPOSITORY_BOUNDS;
  return (
    words.length <= MAX_OWNER_CHARS + 1 + MAX_NAME_CHARS && GITHUB_REPOSITORY_PATTERN.test(words)
  );
}

/** A repository's path read back from its steps, or nothing where a step's encoding is broken, a step is empty, or it climbs. */
function repositoryPath(encoded: readonly string[]): string | undefined {
  const steps = encoded.map(decodedStep);
  const whole = steps.every(
    (step): step is string => step !== undefined && step !== "" && step !== "." && step !== "..",
  );
  return whole && steps.length > 0 ? steps.join("/") : undefined;
}

/** The lines a file's fragment names at a commit; none where it names none or the ref is no commit, and `false` where it names lines no file has. */
function fragmentLines(ref: string, hash: string): GitHubLines | false | undefined {
  const lines = LINES_FRAGMENT.exec(hash);
  if (lines === null || !COMMIT.test(ref)) return undefined;
  const startLine = Number(lines[1]);
  const endLine = lines[2] === undefined ? startLine : Number(lines[2]);
  return startLine >= 1 && startLine <= endLine ? { startLine, endLine } : false;
}

/** A file's or a folder's page past its repository at the ref named; nothing for a page naming no path, or lines no file has. */
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

/** The steps of a page of GitHub's past its repository, and the repository, `owner/name`; nothing for any other address. */
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

/** Whether a page's steps name a file or a folder at a ref a reader reads one at, `HEAD` or a commit. */
function namesRepositoryPage(step: string, ref: string | undefined): boolean {
  const kind = step === GITHUB_STEP[GITHUB_PAGE.FILE] || step === GITHUB_STEP[GITHUB_PAGE.FOLDER];
  return kind && ref !== undefined && (ref === GITHUB_DEFAULT_BRANCH || COMMIT.test(ref));
}

/**
 * The page of GitHub's an address is: a pull request's or any page under
 * it, an issue's, or a file's or a folder's on `HEAD` or a commit, a file's
 * lines with it at a commit; nothing for any other address, a branch's file
 * among them.
 */
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

/**
 * The repository an address names a file or a folder of, on `HEAD` or a
 * commit, whether or not its path and lines read as one's, so a reader that
 * holds such a page of its own repository to a file can say a broken one
 * names nothing, rather than read it as a page of GitHub's.
 */
export function gitHubFilePageRepositoryOf(target: string): string | undefined {
  const page = gitHubStepsOf(target);
  return page !== undefined && namesRepositoryPage(page.step, page.rest[0])
    ? page.repository
    : undefined;
}

/** The address a page of GitHub's is written by: each step percent-encoded, a ref's slashes kept, and a file's lines as its fragment. */
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

/**
 * The pull request a page of GitHub's is, `acme/relay` and `42` from
 * `https://github.com/acme/relay/pull/42` or any page under it, its Files
 * tab say; nothing for any other address.
 */
export function pullRequestAddressOf(target: string): NumberedAddress | undefined {
  const page = readGitHubPage(target);
  return page?.kind === GITHUB_PAGE.PULL_REQUEST
    ? { repository: page.repository, number: page.number }
    : undefined;
}

/**
 * The issue a page of GitHub's is, `acme/relay` and `7` from
 * `https://github.com/acme/relay/issues/7`; nothing for any other address,
 * the repository's list of issues among them.
 */
export function issueAddressOf(target: string): NumberedAddress | undefined {
  const page = readGitHubPage(target);
  return page?.kind === GITHUB_PAGE.ISSUE
    ? { repository: page.repository, number: page.number }
    : undefined;
}

/**
 * The identifier of the issue a page of Linear's is, `ENG-123` from
 * `https://linear.app/acme/issue/ENG-123/its-title`, in capitals; nothing
 * for any other address, another of Linear's pages among them.
 */
export function readLinearIssue(target: string): string | undefined {
  const url = parsedUrl(target);
  if (url === undefined || url.hostname !== LINEAR_HOST) return undefined;
  const [first, , step, identifier] = url.pathname.split("/");
  if (first !== "" || step !== LINEAR_ISSUE_STEP || identifier === undefined) return undefined;
  const upper = identifier.toUpperCase();
  return LINEAR_IDENTIFIER.test(upper) ? upper : undefined;
}

/** A `luke://` address read: its host, its path's steps still percent-encoded, and its fragment and query as written. */
export interface LegacyLink {
  readonly host: string;
  readonly steps: readonly string[];
  readonly hash: string;
  readonly search: string;
}

/** The parts of an address in the form written before Luke's links were settled; nothing for any other address. */
export function readLegacyLink(target: string): LegacyLink | undefined {
  const url = parsedUrl(target);
  if (url?.protocol !== LEGACY_PROTOCOL) return undefined;
  const steps = url.pathname.replace(/^\//u, "").split("/");
  return { host: url.host, steps, hash: url.hash, search: url.search };
}

/** An address in the app's own form, `luke://<host>/<path>`, its path already spelled as its host reads it. */
export function legacyLinkOf(host: LegacyLinkHost, path: string): string {
  return `${LEGACY_PROTOCOL}//${host}/${path}`;
}

/** Words as a markdown link's label holds them: each control character, a line break among them, a space, and each bracket and backslash escaped. */
export function escapedLabel(words: string): string {
  const oneLine = [...words]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < SPACE_CODE || code === DELETE_CODE ? " " : character;
    })
    .join("");
  return oneLine.replace(LABEL_SPECIAL, (special) => `\\${special}`);
}

/** A markdown link's label as written read back, its escaped brackets and backslashes as themselves. */
export function readLabel(written: string): string {
  return written.replace(LABEL_ESCAPE, "$1");
}

/** An address as a markdown link's target holds it: each parenthesis, angle bracket, and space percent-encoded, so it stays one target and reads back the same. */
export function linkTarget(address: string): string {
  return address.replace(TARGET_BREAKING, (special) => {
    if (special === "(") return "%28";
    if (special === ")") return "%29";
    return encodeURIComponent(special);
  });
}

/** A link written into markdown, `[label](target)`, its label escaped and its target kept one. */
export function markdownLink(label: string, target: string): string {
  return `[${escapedLabel(label)}](${linkTarget(target)})`;
}

/** A mention written into markdown, `[@name](target)`, as `markdownLink` writes a link. */
export function mentionMarkdownLink(name: string, target: string): string {
  return markdownLink(`${MENTION_SIGIL}${name}`, target);
}
