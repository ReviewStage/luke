import { Schema as EffectSchema, Option } from "effect";
import {
  INTEGRATION_NAME,
  integrationConnectionNameSchema,
  integrationConnectionOf,
  integrationOfHost,
  integrationProviderSchema,
} from "./integration-wire.js";
import { isLinkHome, LINK_ORIGIN } from "./link-home.js";
import { PLAN_SECTION_BOUNDS } from "./task-wire.js";

/**
 * mention-link.ts -- a mention as what it names, and the link it is written into words as: the one module that knows the link's form.
 *
 * A mention is written into a message's or a plan's markdown as a link
 * whose label starts with `@` (`[@Rollout](<target>)`), so the words stay
 * one string that reads as plain markdown anywhere chips are not drawn,
 * and the `@` is what marks the link as a mention rather than a link.
 * What the target looks like is decided here and nowhere else: every
 * caller holds a `Mention`, which names its subject and nothing of the
 * form, and goes through `encodeMention` and `decodeMention` to write and
 * read one.
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
 * out of Luke, into Slack, a pull request or a mail, still leads somewhere
 * (`docs/proposals/web-and-links.md`):
 *
 * - A plan is `https://tryluke.dev/<workspace>/plan/<id>`, and one of its
 *   sections that with `#<anchor>` after it. Only the id finds the plan: the
 *   workspace's slug reads well and is never trusted, so a slug spelled
 *   another way later breaks no link. The desktop's own scheme is the same
 *   address with `tryluke:` for `https:`, which reads as the same mention.
 * - A page an agent showed on a plan is the plan's address with
 *   `/page/<pageId>` after it, and one of the plan's coding agents with
 *   `/agent/<agentId>`, the links the window already opens them by
 *   (`luke-link.ts`): ids alone, never the page's title or the agent's. A
 *   coding agent on no task, as an automation's run or a one-off starts
 *   one, is the workspace's address with `/agent/<agentId>` after it, its
 *   own link, so any agent of the workspace can be mentioned.
 * - A section's anchor is its heading as GitHub spells a Markdown heading's
 *   (`sectionAnchors`): lower case, its punctuation dropped, a space a
 *   hyphen, and `-1`, `-2` after a heading the plan already held, so the
 *   anchor names one section, and one of a heading since renamed or
 *   deleted names nothing, which its reader says.
 * - A file or a folder of the plan's repository is its GitHub page on the
 *   default branch, `https://github.com/<owner>/<name>/blob/HEAD/<path>`
 *   (`/tree/` for a folder), and a file's lines are pinned to the commit
 *   they were read at, `/blob/<commit>/<path>#L3-L5`, since lines drift and
 *   a branch's would point at whatever moved into them. Its path is from
 *   the repository's root and never climbs out of it: no leading `/`, no
 *   `..` step, no backslash. A GitHub page is a file of the plan only when
 *   it is of the plan's own repository, which a reader is handed, and only
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
 * A page of one of the integrations, a Linear issue or a pull request, is
 * named by its own web address, which a host of the integration's
 * (`INTEGRATION_HOSTS`) says it is the integration's. It is read last, after
 * every form above, so a GitHub page that is a file of the plan stays one;
 * a link to any other page is a link, never a mention, whatever its label
 * says.
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
} as const;

const MENTION_BOUNDS = {
  /** The most characters a mention's target may spell: an anchor or a path at its bound, every character encoded as UTF-8's widest, and the plan's id. */
  MAX_TARGET_CHARS: 24_000,
  /** The most characters an anchor may spell: a heading at its bound, each character lowered into as many as two, and a suffix telling it from an earlier one. */
  MAX_ANCHOR_CHARS: PLAN_SECTION_BOUNDS.MAX_HEADING_CHARS * 2 + 16,
  /** The most characters a plan's id may spell; the service mints them far shorter. */
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

/** What marks a link's label as a mention's. */
const MENTION_SIGIL = "@";

/** The settled form: a plan's address on Luke's home (`link-home.ts`), by the web's scheme or the desktop's. */
const LINK = {
  TASK_STEP: "plan",
  /** The steps a task's link is read under: `plan`, which every release writes, and `task`, the next spelling. */
  TASK_STEPS: new Set(["plan", "task"]),
  PAGE_STEP: "page",
  AGENT_STEP: "agent",
} as const;

/** A file's or a folder's page on GitHub: the default branch for the thing itself, a commit for its lines. */
const GITHUB = {
  ORIGIN: "https://github.com",
  FILE_STEP: "blob",
  FOLDER_STEP: "tree",
  DEFAULT_BRANCH: "HEAD",
} as const;

/** The form written before the link was settled, read forever: `luke://plan/<planId>` (`#<heading>` after it), `luke://file/<path>`, and `luke://folder/<path>/`. */
const LEGACY = {
  PROTOCOL: "luke:",
  HOST: {
    [MENTION_KIND.TASK]: "plan",
    [MENTION_KIND.FILE]: "file",
    [MENTION_KIND.FOLDER]: "folder",
    [MENTION_KIND.SERVER]: "mcp",
  },
} as const;

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

/** A GitHub page's lines: `#L3`, or `#L3-L5`. */
const LINES_FRAGMENT = /^#L(\d{1,9})(?:-L(\d{1,9}))?$/u;
/** The characters a markdown link's label must escape to stay one label. */
const LABEL_SPECIAL = /[[\]\\]/gu;

/** A label's escaped character, read back. */
const LABEL_ESCAPE = /\\([[\]\\])/gu;

/** The characters `encodeURIComponent` leaves that would end or break a markdown link's target. */
const TARGET_SPECIAL = /[()!'*]/gu;

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
    url: EffectSchema.String.check(
      EffectSchema.isNonEmpty(),
      EffectSchema.isMaxLength(MENTION_BOUNDS.MAX_URL_CHARS),
    ),
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(MENTION_KIND.PAGE),
    taskId: taskIdSchema,
    pageId: thingIdSchema,
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(MENTION_KIND.AGENT),
    /** The task the agent works on; absent for an agent on none. */
    taskId: EffectSchema.optionalKey(taskIdSchema),
    agentId: thingIdSchema,
  }),
]);

export type Mention = typeof mentionSchema.Type;

/** A mention of the plan or one of its sections. */
export type PlanMention = Extract<
  Mention,
  { readonly kind: typeof MENTION_KIND.TASK | typeof MENTION_KIND.SECTION }
>;

/** A mention of something the workspace holds beside a plan's words: a page an agent showed on a plan, or a coding agent, on a task or on none. */
export type TaskMention = Extract<
  Mention,
  { readonly kind: typeof MENTION_KIND.PAGE | typeof MENTION_KIND.AGENT }
>;

/** A mention of an MCP server or one of its tools. */
export type ServerMention = Extract<Mention, { readonly provider: string }>;

/** Whether a tool's name, as an MCP server lists it, is one a mention of the tool can carry. */
export function isMentionableTool(name: string): boolean {
  return TOOL_NAME.test(name) && !DOT_STEPS.has(name);
}

/** A file's lines a mention names, at the commit they were read at. */
export type MentionLines = typeof linesSchema.Type;

/** Where a mention is written: the plan's workspace, by its slug, and the repository the plan is about, `owner/name`, or null before one is chosen. */
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

/** A part of a target percent-encoded, parentheses included, so the target stays one in a markdown link. */
function encodedPart(part: string): string {
  return encodeURIComponent(part).replace(
    TARGET_SPECIAL,
    (special) => `%${special.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** A path percent-encoded step by step, its slashes kept. */
function encodedPath(path: string): string {
  return path.split("/").map(encodedPart).join("/");
}

/** A percent-encoded part read back, or nothing where its encoding is broken. */
function decodedPart(part: string): string | undefined {
  try {
    return decodeURIComponent(part);
  } catch {
    return undefined;
  }
}

/** Steps of a path read back and joined, or nothing where one's encoding is broken. */
function decodedSteps(steps: readonly string[]): string | undefined {
  const read = steps.map(decodedPart);
  return read.every((step) => step !== undefined) ? read.join("/") : undefined;
}

/** A target's path read back from its steps, its leading slash and, for a folder, its trailing one taken off. */
function decodedPath(pathname: string): string | undefined {
  return decodedSteps(pathname.replace(/^\//u, "").replace(/\/$/u, "").split("/"));
}

/**
 * A target read as an address, or nothing where it is none. Note that it is
 * `new URL` caught rather than `URL.parse`, because the "Open in Luke" page
 * reads a link in whatever browser opened it, and Safari before 18 has no
 * `URL.parse`.
 */
function parsedUrl(target: string): URL | undefined {
  try {
    return new URL(target);
  } catch {
    return undefined;
  }
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
function legacyFields(url: URL) {
  switch (url.host) {
    case LEGACY.HOST[MENTION_KIND.FILE]:
      return { kind: MENTION_KIND.FILE, path: decodedPath(url.pathname) };
    case LEGACY.HOST[MENTION_KIND.FOLDER]:
      return { kind: MENTION_KIND.FOLDER, path: decodedPath(url.pathname) };
    case LEGACY.HOST[MENTION_KIND.SERVER]: {
      const [segment, tool, ...rest] = url.pathname.replace(/^\//u, "").split("/");
      if (rest.length > 0 || url.hash !== "" || url.search !== "") return undefined;
      const server = serverOfSegment(segment ?? "");
      if (tool === undefined) return { kind: MENTION_KIND.SERVER, ...server };
      return { kind: MENTION_KIND.TOOL, ...server, tool: decodedPart(tool) };
    }
    case LEGACY.HOST[MENTION_KIND.TASK]: {
      const taskId = decodedPart(url.pathname.replace(/^\//u, ""));
      if (url.hash === "") return { kind: MENTION_KIND.TASK, taskId };
      // Note that a heading's words name the first section under them, as its anchor without a suffix does.
      const heading = decodedPart(url.hash.slice(1));
      if (heading === undefined || heading === "") return undefined;
      return { kind: MENTION_KIND.SECTION, taskId, anchor: headingAnchor(heading) };
    }
    default:
      return undefined;
  }
}

/** The fields a page's or an agent's address spells after its task's id, or after the workspace for an agent on no task: `/page/<id>` or `/agent/<id>`, with no fragment. */
function taskFields(taskId: string | undefined, rest: readonly string[], hash: string) {
  const [step, id, ...more] = rest;
  if (id === undefined || more.length > 0 || hash !== "") return undefined;
  // A page always stands on a task, so one with none reads as nothing to the schema.
  if (step === LINK.PAGE_STEP) return { kind: MENTION_KIND.PAGE, taskId, pageId: decodedPart(id) };
  if (step !== LINK.AGENT_STEP) return undefined;
  const agentId = decodedPart(id);
  return taskId === undefined
    ? { kind: MENTION_KIND.AGENT, agentId }
    : { kind: MENTION_KIND.AGENT, taskId, agentId };
}

/** The fields a plan's address on tryluke.dev spells, by either scheme: `/<workspace>/plan/<id>`, perhaps `#<anchor>`, or a page's or an agent's under it; or an agent's on no task, `/<workspace>/agent/<id>`. */
function planFields(url: URL) {
  const [first, workspace, step, id, ...rest] = url.pathname.split("/");
  if (first !== "" || workspace === "" || id === undefined) return undefined;
  if (step === LINK.AGENT_STEP) return taskFields(undefined, [step, id, ...rest], url.hash);
  if (step === undefined || !LINK.TASK_STEPS.has(step)) return undefined;
  if (rest.length > 0) return taskFields(decodedPart(id), rest, url.hash);
  const taskId = decodedPart(id);
  if (url.hash === "" || url.hash === "#") return { kind: MENTION_KIND.TASK, taskId };
  const anchor = decodedPart(url.hash.slice(1))?.toLowerCase();
  return { kind: MENTION_KIND.SECTION, taskId, anchor };
}

/** The lines a GitHub page's fragment names at a commit; nothing where it names none, or the page is a branch's. */
function linesOf(ref: string, hash: string): MentionLines | undefined {
  const lines = LINES_FRAGMENT.exec(hash);
  if (lines === null || !COMMIT.test(ref)) return undefined;
  const startLine = Number(lines[1]);
  const endLine = lines[2] === undefined ? startLine : Number(lines[2]);
  return { commit: ref, startLine, endLine };
}

/** The fields a page of the plan's repository on GitHub spells, a file's or a folder's on `HEAD` or a commit; nothing for any other page. */
function repositoryFields(url: URL, repository: string | null) {
  const [first, owner, name, step, ref, ...path] = url.pathname.split("/");
  if (first !== "" || repository === null || ref === undefined) return undefined;
  // Note that a branch's page is no file of the plan, since `feature/rollout` spells two steps and the path's first is not to be told from its last.
  if (ref !== GITHUB.DEFAULT_BRANCH && !COMMIT.test(ref)) return undefined;
  // GitHub reads an owner and a name in any case, so a link spelled in another names the same repository.
  if (`${owner}/${name}`.toLowerCase() !== repository.toLowerCase()) return undefined;
  if (step === GITHUB.FOLDER_STEP) {
    const folder = path.at(-1) === "" ? path.slice(0, -1) : path;
    return { kind: MENTION_KIND.FOLDER, path: decodedSteps(folder) };
  }
  if (step !== GITHUB.FILE_STEP) return undefined;
  const lines = linesOf(ref, url.hash);
  const file = { kind: MENTION_KIND.FILE, path: decodedSteps(path) };
  return lines === undefined ? file : { ...file, lines };
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

/** A page's address as a mention holds it: a parenthesis it keeps encoded, so it stays one markdown link's target, and reads back the same. */
function linkAddress(href: string): string {
  return href.replace(/[()]/gu, (special) => (special === "(" ? "%28" : "%29"));
}

/** The fields a page of an integration's spells, its address kept without credentials; nothing for a page of no integration's. */
function linkFields(url: URL) {
  if (!WEB_PROTOCOLS.has(url.protocol)) return undefined;
  const provider = integrationOfHost(url.hostname);
  if (provider === undefined) return undefined;
  return { kind: MENTION_KIND.LINK, provider, url: linkAddress(withoutCredentials(url)) };
}

/**
 * The fields a target spells, for the schema to read; nothing where it is
 * no target of a mention. A GitHub page is read as a file or a folder of
 * the plan's repository first, so a page of it is never read as anything
 * else a GitHub address names.
 */
function fieldsOf(target: string, repository: string | null) {
  const url = parsedUrl(target);
  if (url === undefined) return undefined;
  if (url.protocol === LEGACY.PROTOCOL) return legacyFields(url);
  if (isLinkHome(url)) return planFields(url);
  // Note that a page of an integration's is read last, so a GitHub page that is a file of the plan stays one.
  const fields = url.origin === GITHUB.ORIGIN ? repositoryFields(url, repository) : undefined;
  return fields ?? linkFields(url);
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

/** A plan's address, a section's with its anchor; the plan's own where the anchor is empty. */
function taskTarget(taskId: string, place: MentionPlace, anchor: string): string {
  const plan = `${LINK_ORIGIN}/${encodedPart(place.workspace)}/${LINK.TASK_STEP}/${encodedPart(taskId)}`;
  return anchor === "" ? plan : `${plan}#${encodedPart(anchor)}`;
}

/** A file's or a folder's page on GitHub, or the legacy form where the plan has no repository to name it under. */
function repositoryTarget(
  kind: typeof MENTION_KIND.FILE | typeof MENTION_KIND.FOLDER,
  path: string,
  place: MentionPlace,
  lines: MentionLines | undefined,
): string {
  if (place.repository === null) {
    const folder = kind === MENTION_KIND.FOLDER ? "/" : "";
    return `${LEGACY.PROTOCOL}//${LEGACY.HOST[kind]}/${encodedPath(path)}${folder}`;
  }
  const repository = place.repository.split("/").map(encodedPart).join("/");
  const step = kind === MENTION_KIND.FOLDER ? GITHUB.FOLDER_STEP : GITHUB.FILE_STEP;
  const ref = lines === undefined ? GITHUB.DEFAULT_BRANCH : lines.commit;
  const page = `${GITHUB.ORIGIN}/${repository}/${step}/${ref}/${encodedPath(path)}`;
  if (lines === undefined) return page;
  return lines.startLine === lines.endLine
    ? `${page}#L${lines.startLine}`
    : `${page}#L${lines.startLine}-L${lines.endLine}`;
}

/** The target a mention is written with, in the plan's workspace and of its repository. */
export function encodeMention(mention: Mention, place: MentionPlace): string {
  switch (mention.kind) {
    case MENTION_KIND.FILE:
      return repositoryTarget(mention.kind, mention.path, place, mention.lines);
    case MENTION_KIND.FOLDER:
      return repositoryTarget(mention.kind, mention.path, place, undefined);
    case MENTION_KIND.TASK:
      return taskTarget(mention.taskId, place, "");
    case MENTION_KIND.SECTION:
      return taskTarget(mention.taskId, place, mention.anchor);
    // An MCP server has no page of its own, so it keeps the app's own form, wherever it is written.
    case MENTION_KIND.SERVER:
      return `${LEGACY.PROTOCOL}//${LEGACY.HOST[MENTION_KIND.SERVER]}/${mention.connection ?? mention.provider}`;
    case MENTION_KIND.TOOL:
      return `${LEGACY.PROTOCOL}//${LEGACY.HOST[MENTION_KIND.SERVER]}/${mention.connection ?? mention.provider}/${encodedPart(mention.tool)}`;
    case MENTION_KIND.LINK:
      return linkAddress(mention.url);
    case MENTION_KIND.PAGE:
      return `${taskTarget(mention.taskId, place, "")}/${LINK.PAGE_STEP}/${encodedPart(mention.pageId)}`;
    case MENTION_KIND.AGENT: {
      // An agent on no task stands under its workspace, as its own Luke link does.
      const owner =
        mention.taskId === undefined
          ? `${LINK_ORIGIN}/${encodedPart(place.workspace)}`
          : taskTarget(mention.taskId, place, "");
      return `${owner}/${LINK.AGENT_STEP}/${encodedPart(mention.agentId)}`;
    }
  }
}

/**
 * The mention a link's target names, a GitHub page read as a file or a
 * folder only of `repository`, the plan's; nothing where it names none, or
 * is no target of a mention.
 */
export function decodeMention(target: string, repository: string | null): Mention | undefined {
  if (target.length > MENTION_BOUNDS.MAX_TARGET_CHARS) return undefined;
  return Option.getOrUndefined(readMention(fieldsOf(target, repository)));
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
    .map((step) => withoutControls(decodedPart(step) ?? step));
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

/** The kinds an address of Luke's own names, which a bare address of one is read as the mention of, pasted or handed: a plan, one of its sections, a page on it, and a coding agent. */
const LUKE_KINDS: ReadonlySet<Mention["kind"]> = new Set([
  MENTION_KIND.TASK,
  MENTION_KIND.SECTION,
  MENTION_KIND.PAGE,
  MENTION_KIND.AGENT,
]);

/** What a bare link's chip names a plan, a page, and an agent by, since its address holds no name of theirs. */
const BARE_NAME = {
  TASK: "Plan",
  PAGE: "Page",
  AGENT: "Agent",
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
      return readableLink(mention.url);
    case MENTION_KIND.PAGE:
      return BARE_NAME.PAGE;
    case MENTION_KIND.AGENT:
      return BARE_NAME.AGENT;
  }
}

/**
 * Words pasted whole that are one address of Luke's own, a plan's, a
 * section's, a page's, or an agent's, or one page of an integration's, as
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
 * Whether a link's target may name a mention for some plan, so a reader
 * who does not yet know the plan's repository knows to read it again when
 * it does: one that names a mention with no repository, or any page of
 * GitHub's, which may be a file or a folder of the plan's.
 */
export function mayNameMention(target: string): boolean {
  if (decodeMention(target, null) !== undefined) return true;
  return parsedUrl(target)?.origin === GITHUB.ORIGIN;
}

/**
 * A link in written words as the mention its chip draws, whoever wrote it:
 * any link whose target names a mention, a GitHub page as a file or a
 * folder only of `repository`, the plan's, is one, whatever its label says,
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
  const label = `${MENTION_SIGIL}${name}`.replace(LABEL_SPECIAL, (special) => `\\${special}`);
  return `[${label}](${encodeMention(mention, place)})`;
}

/**
 * Whether the bracket at `at` opens a picture, `![…](…)`, rather than a
 * link: its `!` stands before it, unescaped, which is behind an even run of
 * backslashes, since each pair is one backslash written as itself.
 */
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
    const target = text.slice(close + 2, targetEnd);
    if (/\s/u.test(target)) continue;
    const label = text.slice(at + 1, close).replace(LABEL_ESCAPE, "$1");
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
  const found: MentionLink[] = [];
  const taken: TextStretch[] = [];
  for (let at = text.indexOf("["); at !== -1; at = text.indexOf("[", at + 1)) {
    const close = labelEnd(text, at);
    if (close === undefined || text[close + 1] !== "(") continue;
    const link = destinationEnd(text, close + 2);
    if (!("end" in link)) continue;
    const picture = opensPicture(text, at);
    taken.push({ start: picture ? at - 1 : at, end: link.end + 1 });
    const label = text.slice(at + 1, close).replace(LABEL_ESCAPE, "$1");
    if (picture || isMentionLabel(label) || !isBareLink(label, link.target)) continue;
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
 * a page's, or an agent's, as the window draws either as its chip. A bare
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

/**
 * Words with each Markdown link written as its name, as a place that draws
 * plain words says it, a notification or a list's title: a link naming a
 * mention by the name its chip says (`linkMention`, read with no
 * repository, as a place off a plan's page draws it), and any other link
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
        const label = words.slice(open + 1, at).replace(LABEL_ESCAPE, "$1");
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
