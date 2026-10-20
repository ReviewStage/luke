import { Schema as EffectSchema, Option } from "effect";
import { inAppScheme, isLinkHome, LINK_ORIGIN } from "./link-home.js";
import { decodeMention, encodeMention, MENTION_KIND } from "./mention-link.js";

/**
 * luke-link.ts -- a place in Luke as the link it is shared by: every thing a teammate can be sent to, written as its address and read back from one.
 *
 * A link is the thing's address on the web, `https://<home>/<workspace>/…`
 * (`link-home.ts`), and the desktop is handed the same address in its own
 * scheme, as a plan's and a section's already are (`mention-link.ts`, which
 * still writes and reads those two, so a plan's link is spelled in one
 * place, and writes a page's and an agent's under a plan as this module
 * does, since a mention names them by these links too). Each step after the
 * workspace says what kind of thing comes next,
 * and a list is plural where a thing is singular, as GitHub's `/pulls` and
 * `/pull/1` are:
 *
 * - a task, `/plan/<id>`, and its section, `#<anchor>`, its version,
 *   `/plan/<id>/version/<seq>`, a page an agent wrote for it,
 *   `/plan/<id>/page/<pageId>`, its Call tab or one call there,
 *   `/plan/<id>/call[/<callId>]`, and a turn of Luke's in its Work,
 *   `/plan/<id>/work/<at>`;
 * - one of its agents, `/plan/<id>/agent/<agentId>`, and under it a worker,
 *   `/worker/<callId>`, its Changes, `/changes`, one review thread of its
 *   pull request in one of that tab's views,
 *   `/changes/<conversation|files>/thread/<threadId>`, or a message,
 *   `/message/<messageId>`; a worker of Luke's own is `/plan/<id>/worker/<callId>`;
 * - an agent with no task, `/agent/<agentId>`, and a message of its own;
 * - the Inbox, `/inbox`, and an item in it under the task or the agent with
 *   no task that holds it, `/plan/<id>/inbox/<itemId>` or
 *   `/agent/<agentId>/inbox/<itemId>`, since the Inbox is read by its holders;
 * - the Automations page, `/automations`, an automation,
 *   `/automation/<id>`, and one of its runs, `/automation/<id>/run/<runId>`;
 * - Factory, `/factory`, and a page of Settings, `/settings[/<page>]`;
 * - Chat, `/chat`, and one of its channels, `/chat/<channelId>`, a topic,
 *   a task's channel, or a direct message alike;
 * - a person's page in the workspace, `/person/<userId>`, a member or
 *   someone who left, by the account id the service names them by.
 *
 * An issue's page, `/issue/<issueId>`, is no place now that Luke keeps no
 * issues of its own, so an old link to one reads as a link it does not know.
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
 * fragment a kind has no use for, and refuses anything else.
 */

export const LINK_PLACE = {
  TASK: "task",
  SECTION: "section",
  /** One comment thread of a task, written as the task's link with the thread in its `comment` query. */
  COMMENT: "comment",
  VERSION: "version",
  PAGE: "page",
  CALL: "call",
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
  FACTORY: "factory",
  SETTINGS: "settings",
  PERSON: "person",
  /** Chat, on For you, or on one of its channels by the id the service mints it. */
  CHAT: "chat",
} as const;

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
  CALL: "call",
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
  FACTORY: "factory",
  SETTINGS: "settings",
  PERSON: "person",
  CHAT: "chat",
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

/** A number spelled whole: a version's, or a moment's in epoch milliseconds. */
const WHOLE = /^\d{1,15}$/u;

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
    anchor: EffectSchema.String.check(EffectSchema.isNonEmpty()),
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
    kind: EffectSchema.Literal(LINK_PLACE.CALL),
    planId: idSchema,
    callId: EffectSchema.optionalKey(idSchema),
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
  EffectSchema.Struct({ kind: EffectSchema.Literal(LINK_PLACE.FACTORY) }),
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

/** The characters `encodeURIComponent` leaves that would end or break a markdown link's target. */
const TARGET_SPECIAL = /[()!'*]/gu;

/** A step of a path written percent-encoded, parentheses included, so a link pasted into markdown stays one target. */
function encodedStep(step: string): string {
  return encodeURIComponent(step).replace(
    TARGET_SPECIAL,
    (special) => `%${special.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** A step of a path read back, or nothing where its encoding is broken or it is too long to be one. */
function decodedStep(step: string): string | undefined {
  if (step.length > LINK_BOUNDS.MAX_STEP_CHARS * 3) return undefined;
  try {
    return decodeURIComponent(step);
  } catch {
    return undefined;
  }
}

/** A target read as an address, or nothing where it is none; `new URL` caught, since Safari before 18 has no `URL.parse`. */
function parsedUrl(target: string): URL | undefined {
  try {
    return new URL(target);
  } catch {
    return undefined;
  }
}

/** Whether the steps after an Inbox item's id name one of its pictures, `files/<picture>`, which opens the item. */
function namesItemPicture(more: readonly string[]): boolean {
  const [step, id, ...after] = more;
  return step === STEP.FILES && id !== undefined && PICTURE_ID.test(id) && after.length === 0;
}

/** The steps after a task's id: a version, a page, the Call tab or a call, a turn, an agent's, or a worker of Luke's. */
function taskFields(taskId: string, rest: readonly string[]) {
  const [step, id, ...more] = rest;
  if (step === STEP.CALL && id === undefined) return { kind: LINK_PLACE.CALL, planId: taskId };
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
    case STEP.CALL:
      return { kind: LINK_PLACE.CALL, planId: taskId, callId: id };
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

/** The steps after an agent's id, under its task where it has one: the agent itself, a worker, its Changes, or a message. */
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
    case STEP.FACTORY:
      return id === undefined ? { kind: LINK_PLACE.FACTORY } : undefined;
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
    default:
      return undefined;
  }
}

/**
 * A task's or a section's link, read by the codec that writes a mention of
 * either, as the form it writes: `/plan/`, whichever step named the task,
 * with no slash after the id, and the fragment as it came.
 */
function taskLink(workspace: string, taskId: string, hash: string): LinkPlace | undefined {
  const written = `${LINK_ORIGIN}/${encodedStep(workspace)}/${STEP.PLAN}/${encodedStep(taskId)}${hash}`;
  const mention = decodeMention(written, null);
  // Note that the place is read again as every place is, so a task's id is held to the ids the service mints, as any other's is, where a mention takes any.
  if (mention?.kind === MENTION_KIND.TASK) {
    return Option.getOrUndefined(readPlace({ kind: LINK_PLACE.TASK, planId: mention.taskId }));
  }
  if (mention?.kind === MENTION_KIND.SECTION) {
    return Option.getOrUndefined(
      readPlace({ kind: LINK_PLACE.SECTION, planId: mention.taskId, anchor: mention.anchor }),
    );
  }
  return undefined;
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
      return [STEP.PLAN, place.planId, STEP.PAGE, place.pageId];
    case LINK_PLACE.CALL:
      return place.callId === undefined
        ? [STEP.PLAN, place.planId, STEP.CALL]
        : [STEP.PLAN, place.planId, STEP.CALL, place.callId];
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
    case LINK_PLACE.FACTORY:
      return [STEP.FACTORY];
    case LINK_PLACE.PERSON:
      return [STEP.PERSON, place.userId];
    case LINK_PLACE.SETTINGS:
      return place.page === undefined ? [STEP.SETTINGS] : [STEP.SETTINGS, place.page];
    case LINK_PLACE.CHAT:
      return place.channelId === undefined ? [STEP.CHAT] : [STEP.CHAT, place.channelId];
  }
}

/** An agent's path: under its task where it has one, else under the workspace. */
function agentPath(taskId: string | undefined, agentId: string): readonly string[] {
  return taskId === undefined ? [STEP.AGENT, agentId] : [STEP.PLAN, taskId, STEP.AGENT, agentId];
}

/**
 * The link a place is shared by, under its workspace by slug, or by id
 * where the slug is not yet known: a task's and a section's as a mention of
 * either is written, every other place's by its ids alone.
 */
export function linkOf(place: LinkPlace, workspace: string): string {
  const where = { workspace, repository: null };
  if (place.kind === LINK_PLACE.TASK) {
    return encodeMention({ kind: MENTION_KIND.TASK, taskId: place.planId }, where);
  }
  if (place.kind === LINK_PLACE.SECTION) {
    return encodeMention(
      { kind: MENTION_KIND.SECTION, taskId: place.planId, anchor: place.anchor },
      where,
    );
  }
  if (place.kind === LINK_PLACE.COMMENT) {
    const task = encodeMention({ kind: MENTION_KIND.TASK, taskId: place.planId }, where);
    return `${task}?${new URLSearchParams({ [COMMENT_QUERY]: place.threadId })}`;
  }
  return [LINK_ORIGIN, workspace, ...placePath(place)]
    .map((step, index) => (index === 0 ? step : encodedStep(step)))
    .join("/");
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
  const steps = encoded.map(decodedStep);
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
        ? taskLink(workspace, taskId, url.hash)
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
