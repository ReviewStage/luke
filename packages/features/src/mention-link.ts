import { Schema as EffectSchema, Option } from "effect";
import { PLAN_SECTION_BOUNDS } from "./plan-wire.js";

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
 * The target is the address the thing has on the web, so a mention copied
 * out of Luke, into Slack, a pull request or a mail, still leads somewhere
 * (`docs/proposals/web-and-links.md`):
 *
 * - A plan is `https://tryluke.dev/<workspace>/plan/<id>`, and one of its
 *   sections that with `#<anchor>` after it. Only the id finds the plan: the
 *   workspace's slug reads well and is never trusted, so a slug spelled
 *   another way later breaks no link. The desktop's own scheme is the same
 *   address with `tryluke:` for `https:`, which reads as the same mention.
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
 * nothing outside the app opens.
 */

export const MENTION_KIND = {
  PLAN: "plan",
  SECTION: "section",
  FILE: "file",
  FOLDER: "folder",
} as const;

const MENTION_BOUNDS = {
  /** The most characters a mention's target may spell: an anchor or a path at its bound, every character encoded as UTF-8's widest, and the plan's id. */
  MAX_TARGET_CHARS: 24_000,
  /** The most characters an anchor may spell: a heading at its bound, each character lowered into as many as two, and a suffix telling it from an earlier one. */
  MAX_ANCHOR_CHARS: PLAN_SECTION_BOUNDS.MAX_HEADING_CHARS * 2 + 16,
  /** The most characters a plan's id may spell; the service mints them far shorter. */
  MAX_PLAN_ID_CHARS: 200,
  /** The most characters a repository path may spell. */
  MAX_PATH_CHARS: 1_000,
  /** The most mentions one message is read for; any past them stay words. */
  MAX_MENTIONS: 20,
} as const;

/** What marks a link's label as a mention's. */
const MENTION_SIGIL = "@";

/** The desktop's own scheme, which spells a plan's address with its scheme swapped. */
const LUKE_APP_PROTOCOL = "tryluke:";

/** The settled form: a plan's address on tryluke.dev, by the web's scheme or the desktop's. */
const LINK = {
  ORIGIN: "https://tryluke.dev",
  HOST: "tryluke.dev",
  PROTOCOLS: new Set(["https:", LUKE_APP_PROTOCOL]),
  PLAN_STEP: "plan",
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
    [MENTION_KIND.PLAN]: "plan",
    [MENTION_KIND.FILE]: "file",
    [MENTION_KIND.FOLDER]: "folder",
  },
} as const;

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

const planIdSchema = EffectSchema.String.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(MENTION_BOUNDS.MAX_PLAN_ID_CHARS),
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
    kind: EffectSchema.Literal(MENTION_KIND.PLAN),
    planId: planIdSchema,
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(MENTION_KIND.SECTION),
    planId: planIdSchema,
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
]);

export type Mention = typeof mentionSchema.Type;

/** A mention of the plan or one of its sections. */
export type PlanMention = Extract<Mention, { readonly planId: string }>;

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

/** A heading's anchor before it is told apart from an earlier heading's: GitHub's spelling of it. */
function headingAnchor(heading: string): string {
  return heading.toLowerCase().replace(ANCHOR_DROPPED, "").replace(/ /gu, "-");
}

/** The fields a legacy `luke:` target spells, for the schema to read; nothing where it is none. */
function legacyFields(url: URL) {
  switch (url.host) {
    case LEGACY.HOST[MENTION_KIND.FILE]:
      return { kind: MENTION_KIND.FILE, path: decodedPath(url.pathname) };
    case LEGACY.HOST[MENTION_KIND.FOLDER]:
      return { kind: MENTION_KIND.FOLDER, path: decodedPath(url.pathname) };
    case LEGACY.HOST[MENTION_KIND.PLAN]: {
      const planId = decodedPart(url.pathname.replace(/^\//u, ""));
      if (url.hash === "") return { kind: MENTION_KIND.PLAN, planId };
      // Note that a heading's words name the first section under them, as its anchor without a suffix does.
      const heading = decodedPart(url.hash.slice(1));
      if (heading === undefined || heading === "") return undefined;
      return { kind: MENTION_KIND.SECTION, planId, anchor: headingAnchor(heading) };
    }
    default:
      return undefined;
  }
}

/** The fields a plan's address on tryluke.dev spells, by either scheme: `/<workspace>/plan/<id>`, perhaps `#<anchor>`. */
function planFields(url: URL) {
  const [first, workspace, step, id, ...rest] = url.pathname.split("/");
  if (first !== "" || workspace === "" || step !== LINK.PLAN_STEP || id === undefined) {
    return undefined;
  }
  if (rest.length > 0) return undefined;
  const planId = decodedPart(id);
  if (url.hash === "" || url.hash === "#") return { kind: MENTION_KIND.PLAN, planId };
  const anchor = decodedPart(url.hash.slice(1))?.toLowerCase();
  return { kind: MENTION_KIND.SECTION, planId, anchor };
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
 * The fields a target spells, for the schema to read; nothing where it is
 * no target of a mention. A GitHub page is read as a file or a folder of
 * the plan's repository first, so a page of it is never read as anything
 * else a GitHub address names.
 */
function fieldsOf(target: string, repository: string | null) {
  const url = URL.parse(target);
  if (url === null) return undefined;
  if (url.protocol === LEGACY.PROTOCOL) return legacyFields(url);
  if (LINK.PROTOCOLS.has(url.protocol) && url.host === LINK.HOST) return planFields(url);
  if (url.origin === GITHUB.ORIGIN) return repositoryFields(url, repository);
  return undefined;
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
 * four spaces or a tab, after a blank line or another such line, since an
 * indented line cannot interrupt a paragraph, and not under a list's item,
 * whose indented lines are the item's own.
 */
function insideIndented(text: string, at: number): boolean {
  const lines = text.split("\n");
  let start = 0;
  let open = false;
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

/** Whether the index stands in code, where markdown draws no link: a fenced block, an indented block, or a code span. */
function insideCode(text: string, at: number): boolean {
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
function planTarget(planId: string, place: MentionPlace, anchor: string): string {
  const plan = `${LINK.ORIGIN}/${encodedPart(place.workspace)}/${LINK.PLAN_STEP}/${encodedPart(planId)}`;
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
    case MENTION_KIND.PLAN:
      return planTarget(mention.planId, place, "");
    case MENTION_KIND.SECTION:
      return planTarget(mention.planId, place, mention.anchor);
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

/**
 * A plan's address on tryluke.dev, or a section's, spelled in the desktop's
 * own scheme (`tryluke://tryluke.dev/<workspace>/plan/<id>#<anchor>`), which
 * the system hands the app: written again from what the address names, so
 * nothing else it carried reaches the app; nothing for any other address.
 */
export function appLinkOf(target: string): string | undefined {
  if (target.length > MENTION_BOUNDS.MAX_TARGET_CHARS) return undefined;
  const url = URL.parse(target);
  if (url === null || !LINK.PROTOCOLS.has(url.protocol) || url.host !== LINK.HOST) {
    return undefined;
  }
  const mention = Option.getOrUndefined(readMention(planFields(url)));
  const workspace = decodedPart(url.pathname.split("/")[1] ?? "");
  if (mention === undefined || workspace === undefined) return undefined;
  if (mention.kind !== MENTION_KIND.PLAN && mention.kind !== MENTION_KIND.SECTION) return undefined;
  const address = encodeMention(mention, { workspace, repository: null });
  return `${LUKE_APP_PROTOCOL}${address.slice(address.indexOf("//"))}`;
}

/** Whether a link's label is a mention's: it starts with `@`. */
export function isMentionLabel(label: string): boolean {
  return label.startsWith(MENTION_SIGIL) && label.length > MENTION_SIGIL.length;
}

/** A mention's label without its `@`, as its chip says it. */
export function mentionName(label: string): string {
  return isMentionLabel(label) ? label.slice(MENTION_SIGIL.length) : label;
}

/** The mention written into markdown as a link: `[@label](target)`, its label's brackets and backslashes escaped. */
export function mentionMarkdown(mention: Mention, name: string, place: MentionPlace): string {
  const label = `${MENTION_SIGIL}${name}`.replace(LABEL_SPECIAL, (special) => `\\${special}`);
  return `[${label}](${encodeMention(mention, place)})`;
}

/**
 * Every link whose label starts with `@` written into the words, in order,
 * standing outside code, where markdown draws no link, whatever its target
 * names: what a developer placed, which a writer must keep as it stands.
 */
export function mentionLinksIn(text: string): readonly MentionLink[] {
  const found: MentionLink[] = [];
  const opener = `[${MENTION_SIGIL}`;
  for (let at = text.indexOf(opener); at !== -1; at = text.indexOf(opener, at + 1)) {
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
