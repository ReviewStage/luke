import { Schema as EffectSchema, Option } from "effect";
import { dateLabel, isDateMoment, isDateRange } from "./date-mention.js";
import {
  INTEGRATION_NAME,
  integrationConnectionNameSchema,
  integrationConnectionOf,
  integrationOfHost,
  integrationProviderSchema,
} from "./integration-wire.js";
import {
  decodedStep,
  encodedPath,
  encodedStep,
  GITHUB_DEFAULT_BRANCH,
  GITHUB_ORIGIN,
  GITHUB_PAGE,
  gitHubFilePageRepositoryOf,
  gitHubPageLink,
  LEGACY_LINK_HOST,
  type LegacyLink,
  LINK_PLACE,
  type LinkPlace,
  legacyLinkOf,
  linkOf,
  linkTarget,
  MENTION_SIGIL,
  mentionMarkdownLink,
  readGitHubPage,
  readLabel,
  readLegacyLink,
  readLink,
} from "./link-grammar.js";
import { isLinkHome } from "./link-home.js";
import { LINK_SITE_LIST, linkSiteName, linkSiteOf } from "./link-site.js";
import { parsedUrl } from "./parsed-url.js";
import { PLAN_SECTION_BOUNDS } from "./task-wire.js";

/**
 * mention-link.ts -- a mention as what it names, and the link it is written into words as: the one module that knows the link's form.
 *
 * A mention is written into a message's or a plan's markdown as a link
 * whose label starts with `@` (`[@Rollout](<target>)`), so the words stay
 * one string that reads as plain markdown anywhere chips are not drawn,
 * and the `@` is what marks the link as a mention rather than a link.
 * Which target a mention is written with is decided here: every caller
 * holds a `Mention`, which names its subject and nothing of the form, and
 * goes through `encodeMention` and `decodeMention` to write and read one.
 * How each address is spelled, Luke's, GitHub's, and the `luke:` form, is
 * `link-grammar.ts`'s, which this reads and writes every target through.
 *
 * Drawn, the `@` is not asked for: wherever Luke draws words a person,
 * Luke, or an agent wrote, any link whose target names a mention is drawn
 * as its chip (`linkMention`), a bare address among them, so an agent that
 * writes a file's GitHub page or a Linear issue's address is drawn as a
 * developer's mention of it is. The `@` still says which links a developer
 * placed, which a writer must keep (`mentionLinksIn`). An agent is handed
 * those and, of Luke's own kinds alone, a bare address too
 * (`handedMentionsIn`), since a plan's or a section's address pasted among
 * words is drawn as its chip and means the same; a bare GitHub page or a
 * Linear issue's address is the words' own, and is handed nothing.
 *
 * The target is the address the thing has on the web, so a mention copied
 * out of Luke, into Slack, a pull request or a mail, still leads somewhere:
 *
 * - A task is `https://tryluke.dev/<workspace>/plan/<id>`, and one of its
 *   sections that with `#<anchor>` after it. Only the id finds the task: the
 *   workspace's slug reads well and is never trusted, so a slug spelled
 *   another way later breaks no link. The desktop's own scheme is the same
 *   address with `tryluke:` for `https:`, which reads as the same mention.
 * - A page an agent showed on a plan is the plan's address with
 *   `/page/<pageId>` after it, and one of the plan's coding agents with
 *   `/agent/<agentId>`, the links the window already opens them by
 *   (`link-grammar.ts`): ids alone, never the page's title or the agent's. A
 *   coding agent on no task, as an automation's run or a one-off starts
 *   one, is the workspace's address with `/agent/<agentId>` after it, its
 *   own link, so any agent of the workspace can be mentioned, and a page
 *   it showed, which stands on it rather than a task, is that address with
 *   `/page/<pageId>` after it.
 * - A person is their page in the workspace, the workspace's address with
 *   `/person/<userId>` after it, the link their page is opened and copied
 *   by (`link-grammar.ts`): the account's id alone, never their name or email,
 *   so a mention of someone who renames themselves still names them.
 * - A section's anchor is its heading as GitHub spells a Markdown heading's
 *   (`sectionAnchors`): lower case, its punctuation dropped, a space a
 *   hyphen, and `-1`, `-2` after a heading the plan already held, so the
 *   anchor names one section, and one of a heading since renamed or
 *   deleted names nothing, which its reader says.
 * - A file or a folder of the task's repository is its GitHub page on the
 *   default branch, `https://github.com/<owner>/<name>/blob/HEAD/<path>`
 *   (`/tree/` for a folder), and a file's lines are pinned to the commit
 *   they were read at, `/blob/<commit>/<path>#L3-L5`, since lines drift and
 *   a branch's would point at whatever moved into them. Its path is from
 *   the repository's root and never climbs out of it: no leading `/`, no
 *   `..` step, no backslash. A GitHub page is a file of the task only when
 *   it is of the task's own repository, which a reader is handed, and only
 *   on `HEAD` or a commit, since a branch's name may hold a slash and leave
 *   no telling where it ends and the path begins; it is read as that before
 *   anything else a GitHub address might name.
 *
 * The forms written before the link was settled, `luke://plan/<id>`
 * (`#<heading>` after it, the heading's own words), `luke://file/<path>`,
 * and `luke://folder/<path>/`, stand in plans and messages already, so
 * they are read forever, as the same mention the settled form names. A
 * thing with no page of its own on the web keeps the `luke:` form, which
 * nothing outside the app opens: an MCP server, `luke://mcp/<connection>`,
 * and one of its tools, `luke://mcp/<connection>/<tool>`, where the
 * connection is one account at the provider (`notion`, or `notion-2` for a
 * second account, the first account's name being its provider's, so every
 * address written before a second account was possible keeps its meaning),
 * the tool's own name
 * as the server lists it.
 *
 * A date has no page of its own either, so it keeps the `luke:` form too:
 * `luke://date/<start>`, and `luke://date/<start>/<end>` for a range, each
 * end ISO 8601 as Notion holds a date's (`date-mention.ts`): a day,
 * `2026-10-20`, or a time on one with its offset, `2026-10-20T15:00-07:00`.
 * Its label is the date in full, so the words read as it anywhere.
 *
 * A page of one of the integrations, a Linear issue or a pull request, is
 * named by its own web address, which a host of the integration's
 * (`INTEGRATION_HOSTS`) says it is the integration's. A page of one of the
 * well-known sites no integration stands behind, a place on Google Maps, is
 * named the same way, by its site (`link-site.ts`) rather than a provider.
 * They are read last, after every form above, so a GitHub page that is a
 * file of the task stays one; a link to any other page is a link, never a
 * mention, whatever its label says.
 */

export const MENTION_KIND = {
  TASK: "plan",
  SECTION: "section",
  FILE: "file",
  FOLDER: "folder",
  SERVER: "server",
  TOOL: "tool",
  LINK: "link",
  PAGE: "page",
  AGENT: "agent",
  PERSON: "person",
  /** Luke on one task, whom a comment's mention sends its thread. */
  LUKE: "luke",
  /** A day, a time on one, or a range of either. */
  DATE: "date",
} as const;

const MENTION_BOUNDS = {
  /** The most characters a mention's target may spell: an anchor or a path at its bound, every character encoded as UTF-8's widest, and the task's id. */
  MAX_TARGET_CHARS: 24_000,
  /** The most characters an anchor may spell: a heading at its bound, each character lowered into as many as two, and a suffix telling it from an earlier one. */
  MAX_ANCHOR_CHARS: PLAN_SECTION_BOUNDS.MAX_HEADING_CHARS * 2 + 16,
  /** The most characters a task's id may spell; the service mints them far shorter. */
  MAX_TASK_ID_CHARS: 200,
  /** The most characters a repository path may spell. */
  MAX_PATH_CHARS: 1_000,
  /** The most characters a page's web address may spell. */
  MAX_URL_CHARS: 2_000,
  /** The most characters of a page's address its readable name keeps, from its end. */
  MAX_LINK_NAME_CHARS: 60,
  /** The most mentions one message is read for; any past them stay words. */
  MAX_MENTIONS: 20,
} as const;

/** The step after a task's address that names Luke on it: `/luke`, a place of no link's own. */
const LUKE_STEP = "luke";

/** A tool's name as an MCP server lists it, which is the name the agent's connection runs it by. */
const TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/u;

/** A path's steps an address resolves away, which no tool's name can be, since its link would lose it. */
const DOT_STEPS: ReadonlySet<string> = new Set([".", ".."]);

/** The schemes a page of an integration's is addressed by. */
const WEB_PROTOCOLS: ReadonlySet<string> = new Set(["https:", "http:"]);

/** A query parameter whose name says it may carry a credential, which a page's address is never kept with. */
const SECRET_PARAM = /token|secret|key|sig|auth|pass|code|session|credential/iu;

/** A step of a page's path that says what kind of page the next one is (`pull`, `issues`), read with the step before it. */
const KIND_STEP = /^[a-z]{1,8}$/u;

/** An anchor as `sectionAnchors` spells one: letters, marks, digits, underscores, and hyphens. */
const ANCHOR = /^[\p{L}\p{M}\p{N}\p{Pc}-]+$/u;

/** What a heading's anchor drops, as GitHub's does: everything but letters, marks, digits, connector punctuation, spaces, and hyphens. */
const ANCHOR_DROPPED = /[^\p{L}\p{M}\p{N}\p{Pc} -]/gu;

/** A commit as a link pins one: seven to forty hexadecimal digits. */
const COMMIT = /^[0-9a-f]{7,40}$/u;

/** A line that opens a fenced block: up to three spaces, then three or more backticks or tildes, and perhaps an info string. */
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/u;

/** A line that closes a fenced block: its run alone, as CommonMark has it, with no info string after it. */
const CLOSING_FENCE_LINE = /^ {0,3}(`{3,}|~{3,})[ \t]*\r?$/u;

/** A run of backticks, which opens a code span the next run of the same length on its line closes. */
const TICKS = /`+/gu;

/** The code of a space, below which, and at delete, no character of a repository's path is spelled. */
const SPACE_CODE = 0x20;
const DELETE_CODE = 0x7f;

/** A slash, a backslash, or a dot still percent-encoded once a target is read, which a reader decoding again would turn into a step. */
const ENCODED_STEP = /%(?:2[Ff]|5[Cc]|2[Ee])/u;

/** A line that starts a block of its own, a heading or a list's item, which ends any code span left open before it. */
const BLOCK_START_LINE = /^ {0,3}(?:#{1,6}(?:\s|$)|[-*+](?:\s|$)|\d{1,9}[.)](?:\s|$))/u;

/** A line's quote markers, however deep the quote, each up to three spaces after the one before and its own space: a quote's blank line is a line of markers alone. */
const QUOTE_MARKERS = /^(?: {0,3}> ?)+/u;

/** A line indented as code: four spaces, or a tab, before anything. */
const INDENTED_LINE = /^(?: {4}|\t)/u;

/** A line that opens an item of a list, whose following indented lines are the item's rather than code. */
const LIST_ITEM_LINE = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:\s|$)/u;

/** An autolink as CommonMark reads one, `<scheme:address>`: a scheme of two to thirty-two characters, and no space or angle bracket after it. */
const AUTOLINK = /<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*)>/gu;

/** An address written bare, as GFM's autolinks read one: `http://` or `https://` at a line's start or after a space, an emphasis mark, or a `(`, up to a space or a `<`. */
const BARE_ADDRESS = /(?<![^\s*_~(])https?:\/\/[^\s<]+/gu;

/** The punctuation GFM leaves off a bare address's end, as the sentence's rather than the address's. */
const TRAILING_PUNCTUATION: ReadonlySet<string> = new Set(["?", "!", ".", ",", ":", "*", "_", "~"]);

const taskIdSchema = EffectSchema.String.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(MENTION_BOUNDS.MAX_TASK_ID_CHARS),
);

/** A page's or an agent's id as the service mints one, as a Luke link holds it: letters, digits, `_`, and `-`. */
const thingIdSchema = EffectSchema.String.check(
  EffectSchema.isMaxLength(MENTION_BOUNDS.MAX_TASK_ID_CHARS),
  EffectSchema.isPattern(/^[A-Za-z0-9_-]+$/u),
);

/** A path from the repository's root that stays inside it. */
const pathSchema = EffectSchema.String.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(MENTION_BOUNDS.MAX_PATH_CHARS),
  EffectSchema.makeFilter(
    (path) =>
      !path.startsWith("/") &&
      !path.includes("\\") &&
      ![...path].some((character) => {
        const code = character.codePointAt(0) ?? 0;
        return code < SPACE_CODE || code === DELETE_CODE;
      }) &&
      // Note that a separator or a dot still spelled percent-encoded once read is
      // refused, so no reader decoding the path again finds a step back in it,
      // while a name that merely holds a percent sign, `report%20final.md`, stands.
      !ENCODED_STEP.test(path) &&
      path.split("/").every((step) => step !== ".." && step !== "." && step !== ""),
  ),
);

/** A line of a file, counted from one. */
const lineSchema = EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(1));

/** A file's lines, the first through the last, at the commit they were read at, named as a `CodeRef` names them. */
const linesSchema = EffectSchema.Struct({
  commit: EffectSchema.String.check(EffectSchema.isPattern(COMMIT)),
  startLine: lineSchema,
  endLine: lineSchema,
}).check(EffectSchema.makeFilter(({ startLine, endLine }) => startLine <= endLine));

/** One end of a date: a day, or a time on one with its offset (`date-mention.ts`). */
const dateMomentSchema = EffectSchema.String.check(EffectSchema.makeFilter(isDateMoment));

/** A page's web address as a link mention holds it. */
const linkUrlSchema = EffectSchema.String.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(MENTION_BOUNDS.MAX_URL_CHARS),
);

const mentionSchema = EffectSchema.Union([
  EffectSchema.Struct({
    kind: EffectSchema.Literal(MENTION_KIND.TASK),
    taskId: taskIdSchema,
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(MENTION_KIND.SECTION),
    taskId: taskIdSchema,
    anchor: EffectSchema.String.check(
      EffectSchema.isMaxLength(MENTION_BOUNDS.MAX_ANCHOR_CHARS),
      EffectSchema.isPattern(ANCHOR),
    ),
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(MENTION_KIND.FILE),
    path: pathSchema,
    lines: EffectSchema.optionalKey(linesSchema),
  }),
  EffectSchema.Struct({ kind: EffectSchema.Literal(MENTION_KIND.FOLDER), path: pathSchema }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(MENTION_KIND.SERVER),
    provider: integrationProviderSchema,
    /** The account at the provider by its connection name, where it is not the provider's first. */
    connection: EffectSchema.optionalKey(integrationConnectionNameSchema),
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(MENTION_KIND.TOOL),
    provider: integrationProviderSchema,
    connection: EffectSchema.optionalKey(integrationConnectionNameSchema),
    tool: EffectSchema.String.check(
      EffectSchema.isPattern(TOOL_NAME),
      EffectSchema.makeFilter((name) => !DOT_STEPS.has(name)),
    ),
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(MENTION_KIND.LINK),
    provider: integrationProviderSchema,
    url: linkUrlSchema,
  }),
  // A page of a well-known site stands on no integration, so it names its site rather than a provider.
  EffectSchema.Struct({
    kind: EffectSchema.Literal(MENTION_KIND.LINK),
    site: EffectSchema.Literals(LINK_SITE_LIST),
    url: linkUrlSchema,
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(MENTION_KIND.PAGE),
    taskId: taskIdSchema,
    pageId: thingIdSchema,
  }),
  // A page a coding agent on no task showed stands on the agent rather than a task.
  EffectSchema.Struct({
    kind: EffectSchema.Literal(MENTION_KIND.PAGE),
    agentId: thingIdSchema,
    pageId: thingIdSchema,
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(MENTION_KIND.AGENT),
    /** The task the agent works on; absent for an agent on none. */
    taskId: EffectSchema.optionalKey(taskIdSchema),
    agentId: thingIdSchema,
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(MENTION_KIND.PERSON),
    /** The person's account id, as the service names a member by. */
    userId: thingIdSchema,
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(MENTION_KIND.LUKE),
    taskId: taskIdSchema,
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(MENTION_KIND.DATE),
    start: dateMomentSchema,
    /** A range's end: both ends days or both times, the end after the start. */
    end: EffectSchema.optionalKey(dateMomentSchema),
  }).check(
    EffectSchema.makeFilter(({ start, end }) => end === undefined || isDateRange(start, end)),
  ),
]);

export type Mention = typeof mentionSchema.Type;

/** A mention of the task or one of its sections. */
export type PlanMention = Extract<
  Mention,
  { readonly kind: typeof MENTION_KIND.TASK | typeof MENTION_KIND.SECTION }
>;

/** A mention of something the workspace holds beside a plan's words: a page an agent showed on a plan, or a coding agent, on a task or on none. */
export type TaskMention = Extract<
  Mention,
  { readonly kind: typeof MENTION_KIND.PAGE | typeof MENTION_KIND.AGENT }
>;

/** A mention of a person: a member of the workspace, or someone who left it. */
export type PersonMention = Extract<Mention, { readonly kind: typeof MENTION_KIND.PERSON }>;

/** A mention of an MCP server or one of its tools, or a page of its provider's. */
export type ServerMention = Extract<Mention, { readonly provider: string }>;

/** Whether a tool's name, as an MCP server lists it, is one a mention of the tool can carry. */
export function isMentionableTool(name: string): boolean {
  return TOOL_NAME.test(name) && !DOT_STEPS.has(name);
}

/** A file's lines a mention names, at the commit they were read at. */
export type MentionLines = typeof linesSchema.Type;

/** Where a mention is written: the task's workspace, by its slug, and the repository the task is about, `owner/name`, or null before one is chosen. */
export interface MentionPlace {
  readonly workspace: string;
  readonly repository: string | null;
}

/** A link whose label starts with `@`, written into words: where it stands, its label, `@` and all, and its target as written. */
export interface MentionLink {
  readonly start: number;
  readonly end: number;
  readonly label: string;
  readonly target: string;
}

/** A mention written into words: its link, and what it names. */
export interface MentionInWords extends MentionLink {
  readonly mention: Mention;
}

const readMention = EffectSchema.decodeUnknownOption(mentionSchema);

/** Steps of a path read back and joined, or nothing where one's encoding is broken. */
function decodedSteps(steps: readonly string[]): string | undefined {
  const read = steps.map(decodedStep);
  return read.every((step) => step !== undefined) ? read.join("/") : undefined;
}

/** A legacy target's path read back from its steps, a folder's trailing slash taken off. */
function decodedPath(steps: readonly string[]): string | undefined {
  return decodedSteps(steps.at(-1) === "" ? steps.slice(0, -1) : steps);
}

/** A heading's anchor before it is told apart from an earlier heading's: GitHub's spelling of it. */
function headingAnchor(heading: string): string {
  return heading.toLowerCase().replace(ANCHOR_DROPPED, "").replace(/ /gu, "-");
}

/**
 * The server a `luke://mcp/` address's first segment names: a connection
 * name, whose provider is the server's and which is kept where it names an
 * account past the provider's first; any other segment is handed on as the
 * provider for the schema to refuse.
 */
function serverOfSegment(segment: string) {
  const account = integrationConnectionOf(segment);
  if (account === undefined) return { provider: segment };
  return account.place === 1
    ? { provider: account.provider }
    : { provider: account.provider, connection: segment };
}

/** The fields a legacy `luke:` target spells, for the schema to read; nothing where it is none. */
function legacyFields({ host, steps, hash, search }: LegacyLink) {
  switch (host) {
    case LEGACY_LINK_HOST.FILE:
      return { kind: MENTION_KIND.FILE, path: decodedPath(steps) };
    case LEGACY_LINK_HOST.FOLDER:
      return { kind: MENTION_KIND.FOLDER, path: decodedPath(steps) };
    case LEGACY_LINK_HOST.MCP: {
      const [segment, tool, ...rest] = steps;
      if (rest.length > 0 || hash !== "" || search !== "") return undefined;
      const server = serverOfSegment(segment ?? "");
      if (tool === undefined) return { kind: MENTION_KIND.SERVER, ...server };
      return { kind: MENTION_KIND.TOOL, ...server, tool: decodedStep(tool) };
    }
    case LEGACY_LINK_HOST.DATE: {
      const [start, end, ...rest] = steps;
      if (rest.length > 0 || hash !== "" || search !== "") return undefined;
      const moments = { kind: MENTION_KIND.DATE, start: decodedStep(start ?? "") };
      return end === undefined ? moments : { ...moments, end: decodedStep(end) };
    }
    case LEGACY_LINK_HOST.PLAN: {
      const taskId = decodedStep(steps.join("/"));
      if (hash === "") return { kind: MENTION_KIND.TASK, taskId };
      // Note that a heading's words name the first section under them, as its anchor without a suffix does.
      const heading = decodedStep(hash.slice(1));
      if (heading === undefined || heading === "") return undefined;
      return { kind: MENTION_KIND.SECTION, taskId, anchor: headingAnchor(heading) };
    }
    default:
      return undefined;
  }
}

/** The fields a place of Luke's own spells as a mention: a task, a section, a page, an agent, or a person; nothing for a place no mention names. */
function placeFields(place: LinkPlace, hash: string) {
  // Note that only a task's address takes a fragment, its section's anchor; a fragment past any other's names nothing.
  if (hash !== "" && place.kind !== LINK_PLACE.TASK && place.kind !== LINK_PLACE.SECTION) {
    return undefined;
  }
  switch (place.kind) {
    // Note that a task's link naming a comment thread names the task, as it did before threads had links.
    case LINK_PLACE.TASK:
    case LINK_PLACE.COMMENT:
      return { kind: MENTION_KIND.TASK, taskId: place.planId };
    case LINK_PLACE.SECTION:
      return { kind: MENTION_KIND.SECTION, taskId: place.planId, anchor: place.anchor };
    case LINK_PLACE.PAGE:
      return "planId" in place
        ? { kind: MENTION_KIND.PAGE, taskId: place.planId, pageId: place.pageId }
        : { kind: MENTION_KIND.PAGE, agentId: place.agentId, pageId: place.pageId };
    case LINK_PLACE.AGENT:
      return place.planId === undefined
        ? { kind: MENTION_KIND.AGENT, agentId: place.agentId }
        : { kind: MENTION_KIND.AGENT, taskId: place.planId, agentId: place.agentId };
    case LINK_PLACE.PERSON:
      return { kind: MENTION_KIND.PERSON, userId: place.userId };
    default:
      return undefined;
  }
}

/** The fields an address on Luke's home spells as a mention: a place of Luke's own, or Luke on a task, its address with `/luke` after it. */
function lukeFields(url: URL) {
  const luke = `/${LUKE_STEP}`;
  if (url.pathname.endsWith(luke) && url.hash === "") {
    const task = new URL(url.href);
    task.pathname = url.pathname.slice(0, -luke.length);
    task.search = "";
    const place = readLink(task.href)?.place;
    return place?.kind === LINK_PLACE.TASK
      ? { kind: MENTION_KIND.LUKE, taskId: place.planId }
      : undefined;
  }
  const place = readLink(url.href)?.place;
  return place === undefined ? undefined : placeFields(place, url.hash);
}

/**
 * The fields a page of the task's repository on GitHub spells, a file's or a
 * folder's on `HEAD` or a commit; a broken one's for the schema to refuse,
 * a path that climbs or lines no file has, so it names nothing rather than a
 * page of GitHub's; nothing for any other page.
 */
function repositoryFields(target: string, repository: string | null) {
  // GitHub reads an owner and a name in any case, so a link spelled in another names the same repository.
  const own = (named: string) => named.toLowerCase() === repository?.toLowerCase();
  const page = readGitHubPage(target);
  if (page?.kind === GITHUB_PAGE.FOLDER && own(page.repository)) {
    return { kind: MENTION_KIND.FOLDER, path: page.path };
  }
  if (page?.kind === GITHUB_PAGE.FILE && own(page.repository)) {
    const file = { kind: MENTION_KIND.FILE, path: page.path };
    return page.lines === undefined
      ? file
      : { ...file, lines: { commit: page.ref, ...page.lines } };
  }
  const claimed = gitHubFilePageRepositoryOf(target);
  return claimed !== undefined && own(claimed) ? { kind: MENTION_KIND.FILE } : undefined;
}

/**
 * A page's address with nothing in it that may be a credential: no user or
 * password before its host, and no query parameter whose name says it holds
 * one. Note that the rest of the query stays, since a thread or a view is
 * often named there (`?thread_ts=`).
 */
function withoutCredentials(url: URL): string {
  const kept = new URL(url.href);
  kept.username = "";
  kept.password = "";
  for (const name of [...kept.searchParams.keys()]) {
    if (SECRET_PARAM.test(name)) kept.searchParams.delete(name);
  }
  return kept.href;
}

/** The fields a page of an integration's or a well-known site's spells, its address kept without credentials; nothing for a page of neither. */
function linkFields(url: URL) {
  if (!WEB_PROTOCOLS.has(url.protocol)) return undefined;
  const address = linkTarget(withoutCredentials(url));
  const provider = integrationOfHost(url.hostname);
  if (provider !== undefined) return { kind: MENTION_KIND.LINK, provider, url: address };
  const site = linkSiteOf(url);
  return site === undefined ? undefined : { kind: MENTION_KIND.LINK, site, url: address };
}

/**
 * The fields a target spells, for the schema to read; nothing where it is
 * no target of a mention. A GitHub page is read as a file or a folder of
 * the task's repository first, so a page of it is never read as anything
 * else a GitHub address names.
 */
function fieldsOf(target: string, repository: string | null) {
  const legacy = readLegacyLink(target);
  if (legacy !== undefined) return legacyFields(legacy);
  const url = parsedUrl(target);
  if (url === undefined) return undefined;
  if (isLinkHome(url)) return lukeFields(url);
  // Note that a page of an integration's is read last, so a GitHub page that is a file of the task stays one.
  return repositoryFields(target, repository) ?? linkFields(url);
}
/** Whether the line holding the index stands inside a fenced block, its fence lines included. */
function insideFence(text: string, at: number): boolean {
  let open: string | undefined;
  let start = 0;
  for (const line of text.split("\n")) {
    const end = start + line.length;
    const fence = FENCE_LINE.exec(line)?.[1];
    if (at >= start && at <= end) return open !== undefined || fence !== undefined;
    // A fence closes on a bare run of its own character at least as long as the one that opened it.
    const closing = CLOSING_FENCE_LINE.exec(line)?.[1];
    if (open === undefined) open = fence;
    else if (closing !== undefined && closing[0] === open[0] && closing.length >= open.length) {
      open = undefined;
    }
    start = end + 1;
  }
  return false;
}

/** A stretch of the words, from its first character to the one after its last. */
interface TextStretch {
  readonly start: number;
  readonly end: number;
}

/**
 * The block of words holding the index, which a code span cannot leave: from
 * the line after the last blank line or the line that starts the block, to
 * the line before the next one, as CommonMark's spans stay inside their block.
 * A quoted line is read past its markers, so a quote's blank line and a
 * heading or an item inside it end a block as they would outside it, and a
 * line quoted deeper or shallower than the one before starts a block.
 */
function paragraphAt(text: string, at: number): TextStretch {
  let start = 0;
  let end = text.length;
  let lineStart = 0;
  let depth = 0;
  for (const line of text.split("\n")) {
    const lineEnd = lineStart + line.length;
    const markers = QUOTE_MARKERS.exec(line)?.[0] ?? "";
    const inner = line.slice(markers.length);
    const lineDepth = [...markers].filter((character) => character === ">").length;
    const blank = inner.trim() === "";
    const opens = BLOCK_START_LINE.test(inner) || lineDepth !== depth;
    depth = lineDepth;
    if (lineStart <= at) {
      if (blank) start = lineEnd + 1;
      else if (opens) start = lineStart;
    } else if (blank || opens) {
      end = lineStart - 1;
      break;
    }
    lineStart = lineEnd + 1;
  }
  return { start, end: Math.max(start, end) };
}

/** Whether the index stands inside a code span: between a run of backticks and the next run of the same length in its paragraph, across its lines. */
function insideSpan(text: string, at: number): boolean {
  const paragraph = paragraphAt(text, at);
  const words = text.slice(paragraph.start, paragraph.end);
  const runs = [...words.matchAll(TICKS)].map((run) => ({
    start: run.index,
    end: run.index + run[0].length,
  }));
  const offset = at - paragraph.start;
  for (let index = 0; index < runs.length; index += 1) {
    const opening = runs[index];
    if (opening === undefined) continue;
    const length = opening.end - opening.start;
    const closing = runs.findIndex((run, later) => later > index && run.end - run.start === length);
    // A run no later run closes is backticks as words.
    if (closing === -1) continue;
    if (offset >= opening.end && offset < (runs[closing]?.start ?? 0)) return true;
    index = closing;
  }
  return false;
}

/**
 * Whether the index stands on an indented code block's line: indented by
 * four spaces or a tab, at the text's start or after a blank line or another
 * such line, since an indented line cannot interrupt a paragraph but has none
 * to interrupt on the first line, and not under a list's item, whose
 * indented lines are the item's own.
 */
function insideIndented(text: string, at: number): boolean {
  const lines = text.split("\n");
  let start = 0;
  let open = true;
  let inList = false;
  for (const line of lines) {
    const end = start + line.length;
    const blank = line.trim() === "";
    const indented = !blank && INDENTED_LINE.test(line);
    if (!blank && !indented) inList = LIST_ITEM_LINE.test(line);
    const code: boolean = indented && !inList && open;
    if (at >= start && at <= end) return code;
    // A blank line or a code line lets the next indented line be code; any other line ends it.
    open = blank || code;
    start = end + 1;
  }
  return false;
}

/** Whether the index stands in code, where markdown draws no link and no picture: a fenced block, an indented block, or a code span. */
export function insideCode(text: string, at: number): boolean {
  return insideFence(text, at) || insideIndented(text, at) || insideSpan(text, at);
}

/** Where a link's label that opens at the index closes, an escaped bracket passed over; nothing where it does not close on its line. */
function labelEnd(text: string, open: number): number | undefined {
  for (let at = open + 1; at < text.length; at += 1) {
    const character = text[at];
    if (character === "\\") at += 1;
    else if (character === "]") return at;
    else if (character === "\n") return undefined;
  }
  return undefined;
}

/**
 * Each heading's anchor, in the order the headings stand: GitHub's spelling
 * of it, with `-1`, `-2` after one an earlier heading already took, so each
 * names one section. A heading that spells no anchor, the words before the
 * first heading among them, has an empty one, which names no section.
 */
export function sectionAnchors(headings: readonly string[]): readonly string[] {
  const taken = new Map<string, number>();
  return headings.map((heading) => {
    const spelled = headingAnchor(heading);
    if (spelled === "") return "";
    let anchor = spelled;
    while (taken.has(anchor)) {
      const count = (taken.get(spelled) ?? 0) + 1;
      taken.set(spelled, count);
      anchor = `${spelled}-${count}`;
    }
    taken.set(anchor, 0);
    return anchor;
  });
}

/** A file's or a folder's page on GitHub, or the legacy form where the task has no repository to name it under. */
function repositoryTarget(
  kind: typeof MENTION_KIND.FILE | typeof MENTION_KIND.FOLDER,
  path: string,
  place: MentionPlace,
  lines: MentionLines | undefined,
): string {
  if (place.repository === null) {
    const host = kind === MENTION_KIND.FOLDER ? LEGACY_LINK_HOST.FOLDER : LEGACY_LINK_HOST.FILE;
    return legacyLinkOf(host, `${encodedPath(path)}${kind === MENTION_KIND.FOLDER ? "/" : ""}`);
  }
  const repository = place.repository;
  if (kind === MENTION_KIND.FOLDER) {
    return gitHubPageLink({
      kind: GITHUB_PAGE.FOLDER,
      repository,
      ref: GITHUB_DEFAULT_BRANCH,
      path,
    });
  }
  if (lines === undefined) {
    return gitHubPageLink({ kind: GITHUB_PAGE.FILE, repository, ref: GITHUB_DEFAULT_BRANCH, path });
  }
  const { commit, startLine, endLine } = lines;
  return gitHubPageLink({
    kind: GITHUB_PAGE.FILE,
    repository,
    ref: commit,
    path,
    lines: { startLine, endLine },
  });
}

/** The target a mention is written with, in the task's workspace and of its repository. */
export function encodeMention(mention: Mention, place: MentionPlace): string {
  const workspace = place.workspace;
  switch (mention.kind) {
    case MENTION_KIND.FILE:
      return repositoryTarget(mention.kind, mention.path, place, mention.lines);
    case MENTION_KIND.FOLDER:
      return repositoryTarget(mention.kind, mention.path, place, undefined);
    case MENTION_KIND.TASK:
      return linkOf({ kind: LINK_PLACE.TASK, planId: mention.taskId }, workspace);
    case MENTION_KIND.SECTION:
      return linkOf(
        { kind: LINK_PLACE.SECTION, planId: mention.taskId, anchor: mention.anchor },
        workspace,
      );
    // An MCP server has no page of its own, so it keeps the app's own form, wherever it is written.
    case MENTION_KIND.SERVER:
      return legacyLinkOf(LEGACY_LINK_HOST.MCP, mention.connection ?? mention.provider);
    case MENTION_KIND.TOOL:
      return legacyLinkOf(
        LEGACY_LINK_HOST.MCP,
        `${mention.connection ?? mention.provider}/${encodedStep(mention.tool)}`,
      );
    case MENTION_KIND.LINK:
      return linkTarget(mention.url);
    case MENTION_KIND.PAGE:
      // A page of an agent on no task stands under that agent's own address.
      return "agentId" in mention
        ? linkOf(
            { kind: LINK_PLACE.PAGE, agentId: mention.agentId, pageId: mention.pageId },
            workspace,
          )
        : linkOf(
            { kind: LINK_PLACE.PAGE, planId: mention.taskId, pageId: mention.pageId },
            workspace,
          );
    case MENTION_KIND.AGENT: {
      // An agent on no task stands under its workspace, as its own Luke link does.
      const task = mention.taskId === undefined ? {} : { planId: mention.taskId };
      return linkOf({ kind: LINK_PLACE.AGENT, ...task, agentId: mention.agentId }, workspace);
    }
    case MENTION_KIND.PERSON:
      return linkOf({ kind: LINK_PLACE.PERSON, userId: mention.userId }, workspace);
    case MENTION_KIND.LUKE:
      return `${linkOf({ kind: LINK_PLACE.TASK, planId: mention.taskId }, workspace)}/${LUKE_STEP}`;
    // A date has no page of its own, so it keeps the app's own form; its ends spell nothing a target must encode.
    case MENTION_KIND.DATE:
      return legacyLinkOf(
        LEGACY_LINK_HOST.DATE,
        mention.end === undefined ? mention.start : `${mention.start}/${mention.end}`,
      );
  }
}

/**
 * The mention a link's target names, a GitHub page read as a file or a
 * folder only of `repository`, the task's; nothing where it names none, or
 * is no target of a mention.
 */
export function decodeMention(target: string, repository: string | null): Mention | undefined {
  if (target.length > MENTION_BOUNDS.MAX_TARGET_CHARS) return undefined;
  return Option.getOrUndefined(readMention(fieldsOf(target, repository)));
}

/**
 * The repository a GitHub page of a file or a folder is of, `owner/name` as
 * its own address spells it, for words of no repository to read the page
 * as that file or folder by (`decodeMention`), rather than as a page of
 * GitHub's; nothing for any other target, a branch's page among them.
 */
export function pageRepositoryOf(target: string): string | undefined {
  const page = readGitHubPage(target);
  if (page?.kind !== GITHUB_PAGE.FILE && page?.kind !== GITHUB_PAGE.FOLDER) return undefined;
  return page.repository;
}

/** Words with each control character, a line break among them, made a space, so a name stays one line of a link's label. */
function withoutControls(words: string): string {
  return [...words]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < SPACE_CODE || code === DELETE_CODE ? " " : character;
    })
    .join("");
}

/**
 * A page's web address as a mention's name reads it: the last steps of its
 * path, the step before a kind's word kept with it (`relay/pull/123`,
 * `LUKE-142/fix-the-thing`), cut from the front to its bound; the host
 * where the path has no step. Note that the name is read off the address
 * alone, since the page's own title is the provider's to answer and no
 * search here asks it.
 */
function readableLink(href: string): string {
  const url = new URL(href);
  const steps = url.pathname
    .split("/")
    .filter((step) => step !== "")
    .map((step) => withoutControls(decodedStep(step) ?? step));
  const kind = steps.length >= 3 && KIND_STEP.test(steps.at(-2) ?? "");
  const kept = steps.slice(kind ? -3 : -2);
  const name = kept.length === 0 ? url.hostname : kept.join("/");
  const bound = MENTION_BOUNDS.MAX_LINK_NAME_CHARS;
  return name.length <= bound ? name : `…${name.slice(-(bound - 1))}`;
}

/** Whether a link's label is a mention's: it starts with `@`. */
export function isMentionLabel(label: string): boolean {
  return label.startsWith(MENTION_SIGIL) && label.length > MENTION_SIGIL.length;
}

/** A mention's label without its `@`, as its chip says it. */
export function mentionName(label: string): string {
  return isMentionLabel(label) ? label.slice(MENTION_SIGIL.length) : label;
}

/** The kinds an address of Luke's own names, which a bare address of one is read as the mention of, pasted or handed: a plan, one of its sections, a page on it, a coding agent, and a person. */
const LUKE_KINDS: ReadonlySet<Mention["kind"]> = new Set([
  MENTION_KIND.TASK,
  MENTION_KIND.SECTION,
  MENTION_KIND.PAGE,
  MENTION_KIND.AGENT,
  MENTION_KIND.PERSON,
]);

/** What a bare link's chip names a plan, a page, an agent, and a person by, since its address holds no name of theirs. */
const BARE_NAME = {
  TASK: "Plan",
  PAGE: "Page",
  AGENT: "Agent",
  PERSON: "Person",
  LUKE: "Luke",
} as const;

/** A file's lines as a chip names them, `app.ts:12–20`, as a mention of them picked from a File tab is named. */
function linesName(path: string, lines: MentionLines | undefined): string {
  const name = path.split("/").at(-1) ?? path;
  if (lines === undefined) return name;
  const span =
    lines.startLine === lines.endLine
      ? String(lines.startLine)
      : `${lines.startLine}–${lines.endLine}`;
  return `${name}:${span}`;
}

/** What a mention written as its bare address is named: what the address itself says of the thing. */
function bareName(mention: Mention): string {
  switch (mention.kind) {
    case MENTION_KIND.TASK:
      return BARE_NAME.TASK;
    case MENTION_KIND.SECTION:
      return mention.anchor;
    case MENTION_KIND.FILE:
      return linesName(mention.path, mention.lines);
    case MENTION_KIND.FOLDER:
      return mention.path.split("/").at(-1) ?? mention.path;
    case MENTION_KIND.SERVER:
      return INTEGRATION_NAME[mention.provider];
    case MENTION_KIND.TOOL:
      return mention.tool;
    case MENTION_KIND.LINK:
      return "site" in mention
        ? linkSiteName(mention.site, mention.url)
        : readableLink(mention.url);
    case MENTION_KIND.PAGE:
      return BARE_NAME.PAGE;
    case MENTION_KIND.AGENT:
      return BARE_NAME.AGENT;
    case MENTION_KIND.PERSON:
      return BARE_NAME.PERSON;
    case MENTION_KIND.LUKE:
      return BARE_NAME.LUKE;
    case MENTION_KIND.DATE:
      return dateLabel(mention);
  }
}

/**
 * Words pasted whole that are one address of Luke's own, a plan's, a
 * section's, a page's, an agent's, or a person's, or one page of an integration's or a well-known site's, as
 * the mention they become and the name its bare address says of it
 * (`bareName`), which a place holding the thing's own name may better;
 * nothing for any other words, a file of the plan's repository among them,
 * which `repository` names.
 */
export function pastedLinkMention(
  words: string,
  repository: string | null,
): { readonly mention: Mention; readonly name: string } | undefined {
  const address = words.trim();
  if (address === "" || /\s/u.test(address)) return undefined;
  const mention = decodeMention(address, repository);
  if (mention === undefined) return undefined;
  if (mention.kind !== MENTION_KIND.LINK && !LUKE_KINDS.has(mention.kind)) return undefined;
  return { mention, name: bareName(mention) };
}

/** Whether a link's label is its target spelled out, as a bare address's is: the same address, however its characters are encoded. */
function isBareLabel(label: string, target: string): boolean {
  if (label === "" || label === target) return true;
  const spelled = parsedUrl(label);
  return spelled !== undefined && spelled.href === parsedUrl(target)?.href;
}

/** Whether a link in written words is bare: its label, trimmed, is its target spelled out, so what it is called is the drawer's to say. */
export function isBareLink(label: string, target: string): boolean {
  return isBareLabel(label.trim(), target);
}

/**
 * Whether a link's target may name a mention for some task, so a reader
 * who does not yet know the task's repository knows to read it again when
 * it does: one that names a mention with no repository, or any page of
 * GitHub's, which may be a file or a folder of the task's.
 */
export function mayNameMention(target: string): boolean {
  if (decodeMention(target, null) !== undefined) return true;
  return parsedUrl(target)?.origin === GITHUB_ORIGIN;
}

/**
 * A link in written words as the mention its chip draws, whoever wrote it:
 * any link whose target names a mention, a GitHub page as a file or a
 * folder only of `repository`, the task's, is one, whatever its label says,
 * so an agent's `[the store](<GitHub page>)` reads as the developer's
 * `[@store.ts](<GitHub page>)` does. Its name is its label, without its `@`;
 * a bare address, its label the address spelled out, is named by what the
 * address says of the thing. Nothing for a link whose target names none,
 * which stays a link.
 */
export function linkMention(
  label: string,
  target: string,
  repository: string | null,
): { readonly mention: Mention; readonly name: string } | undefined {
  const mention = decodeMention(target, repository);
  if (mention === undefined) return undefined;
  const words = label.trim();
  if (isBareLabel(words, target)) return { mention, name: bareName(mention) };
  return { mention, name: mentionName(words) };
}

/** The mention written into markdown as a link: `[@label](target)`, its label's brackets and backslashes escaped. */
export function mentionMarkdown(mention: Mention, name: string, place: MentionPlace): string {
  return mentionMarkdownLink(name, encodeMention(mention, place));
}

/**
 * Whether the bracket at `at` opens a picture, `![…](…)`, rather than a
 * link: its `!` stands before it, unescaped, which is behind an even run of
 * backslashes, since each pair is one backslash written as itself.
 */
/** Whether the character at `at` is escaped by an odd run of backslashes before it. */
function escapedAt(text: string, at: number): boolean {
  let backslashes = 0;
  while (text[at - 1 - backslashes] === "\\") backslashes += 1;
  return backslashes % 2 === 1;
}

function opensPicture(text: string, at: number): boolean {
  if (text[at - 1] !== "!") return false;
  let backslashes = 0;
  while (text[at - 2 - backslashes] === "\\") backslashes += 1;
  return backslashes % 2 === 0;
}

/**
 * Every link whose label starts with `@` written into the words, in order,
 * standing outside code, where markdown draws no link, whatever its target
 * names: what a developer placed, which a writer must keep as it stands. A
 * picture whose alt text starts with `@` is a picture, never a mention.
 */
export function mentionLinksIn(text: string): readonly MentionLink[] {
  const found: MentionLink[] = [];
  const opener = `[${MENTION_SIGIL}`;
  for (let at = text.indexOf(opener); at !== -1; at = text.indexOf(opener, at + 1)) {
    if (opensPicture(text, at)) continue;
    const close = labelEnd(text, at);
    if (close === undefined || text[close + 1] !== "(" || insideCode(text, at)) continue;
    const targetEnd = text.indexOf(")", close + 2);
    if (targetEnd === -1) continue;
    const written = text.slice(close + 2, targetEnd);
    if (/\s/u.test(written)) continue;
    // Note that a destination written between angle brackets is the address inside them, as markdown reads it.
    const angled = written.length > 2 && written.startsWith("<") && written.endsWith(">");
    const target = angled ? written.slice(1, -1) : written;
    const label = readLabel(text.slice(at + 1, close));
    found.push({ start: at, end: targetEnd + 1, label, target });
    at = targetEnd;
  }
  return found;
}

/**
 * Every mention written into the words, in order: a link whose label
 * starts with `@`, whose target names a mention, a GitHub page only as a
 * file or a folder of `repository`, standing outside code. A link of
 * another kind, or one whose target names nothing, is words. At most
 * `limit` are read, a message's `MAX_MENTIONS` unless the caller reads a
 * whole plan; any past them stay words.
 */
export function mentionsIn(
  text: string,
  repository: string | null,
  limit: number = MENTION_BOUNDS.MAX_MENTIONS,
): readonly MentionInWords[] {
  const found: MentionInWords[] = [];
  for (const link of mentionLinksIn(text)) {
    if (found.length === limit) break;
    const mention = decodeMention(link.target, repository);
    if (mention !== undefined) found.push({ ...link, mention });
  }
  return found;
}

/**
 * The coding agents a comment on the task's plan asks: those its words
 * mention, each once, in the order written. A mention is a link the writer
 * placed with `@`; a bare link to an agent asks no one, and neither does a
 * mention of a task's Luke, whom no task has any more.
 */
export function askedInWords(words: string): readonly string[] {
  const agentIds: string[] = [];
  // Note that every mention of the comment's bounded words is read, beyond the twenty a message hands an agent, so no one asked is missed.
  for (const { mention } of mentionsIn(words, null, Number.POSITIVE_INFINITY)) {
    if (
      mention.kind === MENTION_KIND.AGENT &&
      !agentIds.some((id) => id.toLowerCase() === mention.agentId.toLowerCase())
    ) {
      agentIds.push(mention.agentId);
    }
  }
  return agentIds;
}

/** The quotes a link's title may stand between, after its destination. */
const TITLE_QUOTES: ReadonlySet<string> = new Set(['"', "'"]);

/** Where a destination read so far stands: its target and the place after it, or where the read stopped, past which no link's destination can reach. */
type DestinationRead = { readonly target: string; readonly at: number } | { readonly stop: number };

/** The characters that end a line, which no destination between angle brackets spans. */
const LINE_ENDS: ReadonlySet<string> = new Set(["\n", "\r"]);

/**
 * A destination between angle brackets, which may hold spaces, read from
 * its `<` to just past its `>` on the same line. Note that one left open
 * stops the read just after its `<`, so a link later on the line is still
 * read as one, and the read stays one pass, since a later read reaches no
 * further than the next `<`.
 */
function angledDestination(words: string, open: number): DestinationRead {
  for (let at = open + 1; at < words.length; at += 1) {
    const character = words[at] ?? "";
    if (character === ">") return { target: words.slice(open + 1, at), at: at + 1 };
    if (character === "<" || LINE_ENDS.has(character)) break;
    if (character === "\\") {
      if (LINE_ENDS.has(words[at + 1] ?? "")) break;
      at += 1;
    }
  }
  return { stop: open + 1 };
}

/** A destination with no angle brackets: up to a space or the `)` that closes it, its parentheses balanced. */
function bareDestination(words: string, open: number): DestinationRead {
  let depth = 0;
  let at = open;
  for (; at < words.length; at += 1) {
    const character = words[at] ?? "";
    if (character === "\\") at += 1;
    else if (character === "(") depth += 1;
    else if (character === ")" && depth > 0) depth -= 1;
    else if (character === ")" || /\s/u.test(character)) break;
  }
  return depth > 0 ? { stop: at } : { target: words.slice(open, at), at };
}

/**
 * An inline link's destination read from just after its `(`: the
 * destination, between angle brackets or with its parentheses balanced,
 * perhaps a title in quotes after a space, and the `)` that closes it; or,
 * where the words hold no such link, where the read stopped, which no
 * link's destination can reach past.
 */
function destinationEnd(
  words: string,
  open: number,
): { readonly target: string; readonly end: number } | { readonly stop: number } {
  const read = words[open] === "<" ? angledDestination(words, open) : bareDestination(words, open);
  if ("stop" in read) return read;
  const { target, at } = read;
  if (words[at] === ")") return { target, end: at };
  // A title in quotes may follow the destination, after a space, and before its `)`.
  let titleAt = at;
  while (words[titleAt] === " " || words[titleAt] === "\t") titleAt += 1;
  const quote = words[titleAt] ?? "";
  // A quote no later one closes opens no title, said without reading on to the end.
  if (titleAt === at || !TITLE_QUOTES.has(quote) || words.lastIndexOf(quote) <= titleAt) {
    return { stop: at };
  }
  const closing = words.indexOf(quote, titleAt + 1);
  if (words[closing + 1] !== ")") return { stop: at };
  return { target, end: closing + 1 };
}

/** A bare address's end as GFM reads it: the sentence's punctuation after it left off, and a `)` that closes no `(` of its own. */
function bareAddressOf(spelled: string): string {
  let opens = 0;
  let closes = 0;
  for (const character of spelled) {
    if (character === "(") opens += 1;
    else if (character === ")") closes += 1;
  }
  // Note that the end is read back one character at a time, so a long run of punctuation costs one pass.
  let end = spelled.length;
  while (end > 0) {
    const last = spelled[end - 1] ?? "";
    if (last === ")" && closes > opens) closes -= 1;
    else if (!TRAILING_PUNCTUATION.has(last)) break;
    end -= 1;
  }
  return spelled.slice(0, end);
}

/**
 * Every link written bare into the words, outside code: an inline
 * link whose label is its target spelled out (`isBareLabel`), an autolink
 * (`<address>`), and an address standing alone as GFM links one, each with
 * its address as its label. An address inside any other link or picture is
 * that link's, and is no bare one.
 */
function bareLinksIn(text: string): readonly MentionLink[] {
  return writtenLinksIn(text, false);
}

/**
 * Every link written into the words, in order, outside code, as markdown
 * draws one: an inline link whatever its label, an `@` mention's among
 * them, an autolink, and an address standing alone. A picture is no link.
 */
export function linksIn(text: string): readonly MentionLink[] {
  return [...writtenLinksIn(text, true)].sort((first, second) => first.start - second.start);
}

/** The links of the words: every inline link where `labelled`, or only those whose label spells their target, then the autolinks and bare addresses. */
function writtenLinksIn(text: string, labelled: boolean): readonly MentionLink[] {
  const found: MentionLink[] = [];
  const taken: TextStretch[] = [];
  for (let at = text.indexOf("["); at !== -1; at = text.indexOf("[", at + 1)) {
    // Note that a bracket an odd run of backslashes escapes opens no link.
    if (escapedAt(text, at)) continue;
    const close = labelEnd(text, at);
    if (close === undefined || text[close + 1] !== "(") continue;
    const link = destinationEnd(text, close + 2);
    if (!("end" in link)) continue;
    const picture = opensPicture(text, at);
    taken.push({ start: picture ? at - 1 : at, end: link.end + 1 });
    const label = readLabel(text.slice(at + 1, close));
    if (picture) continue;
    if (labelled) {
      found.push({ start: at, end: link.end + 1, label, target: link.target });
      continue;
    }
    if (isMentionLabel(label) || !isBareLink(label, link.target)) continue;
    found.push({ start: at, end: link.end + 1, label: link.target, target: link.target });
  }
  const isTaken = (start: number) =>
    taken.some((stretch) => start >= stretch.start && start < stretch.end);
  for (const autolink of text.matchAll(AUTOLINK)) {
    // A link's destination between angle brackets is that link's, and no autolink.
    if (isTaken(autolink.index)) continue;
    const target = autolink[1] ?? "";
    const end = autolink.index + autolink[0].length;
    taken.push({ start: autolink.index, end });
    found.push({ start: autolink.index, end, label: target, target });
  }
  for (const spelled of text.matchAll(BARE_ADDRESS)) {
    const start = spelled.index;
    if (isTaken(start)) continue;
    const target = bareAddressOf(spelled[0]);
    found.push({ start, end: start + target.length, label: target, target });
  }
  return found.filter((link) => !insideCode(text, link.start));
}

/**
 * Every mention an agent is handed of the words, in order, standing outside
 * code: each `@` link whose target names a mention (`mentionsIn`), and each
 * address of Luke's own written bare (`bareLinksIn`), a plan's, a section's,
 * a page's, an agent's, or a person's, as the window draws either as its chip. A bare
 * address of any other kind, a file's GitHub page or a Linear issue's, is
 * the words' own, and is handed nothing. At most `limit` are read, across
 * both forms; any past them stay words.
 */
export function handedMentionsIn(
  text: string,
  repository: string | null,
  limit: number = MENTION_BOUNDS.MAX_MENTIONS,
): readonly MentionInWords[] {
  const written = [...mentionLinksIn(text), ...bareLinksIn(text)].sort(
    (first, second) => first.start - second.start,
  );
  const found: MentionInWords[] = [];
  for (const link of written) {
    if (found.length === limit) break;
    const mention = decodeMention(link.target, repository);
    if (mention === undefined) continue;
    if (isMentionLabel(link.label) || LUKE_KINDS.has(mention.kind))
      found.push({ ...link, mention });
  }
  return found;
}

/** A mention that names a member of a workspace: a person or an agent. */
export type MemberMention = Extract<
  Mention,
  { readonly kind: typeof MENTION_KIND.PERSON | typeof MENTION_KIND.AGENT }
>;

/** Whether a mention names a member, which a file's, a task's, or a Luke's does not. */
function namesMember(mention: Mention): mention is MemberMention {
  return mention.kind === MENTION_KIND.PERSON || mention.kind === MENTION_KIND.AGENT;
}

/**
 * The member words are, where they are a person's or an agent's mention
 * link written whole, `[@Name](address)`, or its address alone; nothing for
 * a link of any other kind, or words that are more than the one link.
 */
export function memberMentionOf(words: string): MemberMention | undefined {
  const [link] = mentionLinksIn(words);
  const whole = link !== undefined && link.start === 0 && link.end === words.length;
  const mention = decodeMention(whole ? link.target : words, null);
  return mention !== undefined && namesMember(mention) ? mention : undefined;
}

/**
 * The words with each person or agent they name written as `@` and its name
 * alone, whether by a mention link or by its address written bare, every
 * other link left as written: what a line another agent sent mentions
 * beside who sent it, whose link names the sender rather than pointing at it.
 */
export function withoutMemberLinks(text: string): string {
  let out = "";
  let at = 0;
  // Note that every link is read, past the cap a message's mentions are handed under, so none is left to be handed.
  for (const found of handedMentionsIn(text, null, text.length)) {
    if (!namesMember(found.mention)) continue;
    const name = linkMention(found.label, found.target, null)?.name ?? found.label;
    out += `${text.slice(at, found.start)}@${name}`;
    at = found.end;
  }
  return out + text.slice(at);
}

/**
 * Words with each Markdown link written as its name, as a place that draws
 * plain words says it, a notification or a list's title: a link naming a
 * mention by the name its chip says (`linkMention`, read with no
 * repository, as a place off a task's page draws it), and any other link
 * by its label, never its address. A bare address is words, and stays as
 * written. The words are read once, front to back: a label is the words
 * since the last `[` on its line, so of nested brackets the inner link is
 * the link, as markdown reads them. Note that code is not told apart,
 * since such a place says one line of words.
 */
export function linkLabels(words: string): string {
  let said = "";
  let from = 0;
  let open: number | undefined;
  for (let at = 0; at < words.length; at += 1) {
    const character = words[at];
    if (character === "\\") at += 1;
    else if (character === "\n") open = undefined;
    else if (character === "[") open = at;
    else if (character === "]" && open !== undefined) {
      const link = words[at + 1] === "(" ? destinationEnd(words, at + 2) : undefined;
      if (link !== undefined && "end" in link) {
        const label = readLabel(words.slice(open + 1, at));
        said += words.slice(from, open) + (linkMention(label, link.target, null)?.name ?? label);
        from = link.end + 1;
        at = link.end;
      } else if (link !== undefined) {
        // Note that the read goes on from where the destination's stopped, so no stretch of the words is read twice.
        at = link.stop - 1;
      }
      open = undefined;
    }
  }
  return said + words.slice(from);
}
