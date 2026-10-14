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
 * read one. The form is provisional until the link format is settled
 * (`docs/proposals/at-mentions.md`, "Pending: the link format"); changing
 * it changes this file and its tests alone.
 *
 * A plan is named by its id, and one of its sections by the plan and the
 * heading's own words, as the plan's sections are known by their headings
 * everywhere else (`planSections`): a mention of a heading two sections
 * share names the first, and one of a heading since renamed or deleted
 * names nothing, which its reader says. A file or a folder of the plan's
 * repository is named by its path from the repository's root, which never
 * climbs out of it: no leading `/`, no `..` step, no backslash.
 */

export const MENTION_KIND = {
  PLAN: "plan",
  SECTION: "section",
  FILE: "file",
  FOLDER: "folder",
} as const;

const MENTION_BOUNDS = {
  /** The most characters a mention's target may spell: a heading or a path at its bound, every character encoded as UTF-8's widest, and the plan's id. */
  MAX_TARGET_CHARS: 12_000,
  /** The most characters a plan's id may spell; the service mints them far shorter. */
  MAX_PLAN_ID_CHARS: 200,
  /** The most characters a repository path may spell. */
  MAX_PATH_CHARS: 1_000,
  /** The most mentions one message is read for; any past them stay words. */
  MAX_MENTIONS: 20,
} as const;

/** What marks a link's label as a mention's. */
const MENTION_SIGIL = "@";

/** The provisional form: `luke://plan/<planId>` (`#<heading>` after it for a section), `luke://file/<path>`, and `luke://folder/<path>/`, each part percent-encoded. */
const LINK = {
  PROTOCOL: "luke:",
  HOST: {
    [MENTION_KIND.PLAN]: "plan",
    [MENTION_KIND.FILE]: "file",
    [MENTION_KIND.FOLDER]: "folder",
  },
} as const;

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
      !path.includes("\u0000") &&
      path.split("/").every((step) => step !== ".." && step !== "." && step !== ""),
  ),
);

const mentionSchema = EffectSchema.Union([
  EffectSchema.Struct({
    kind: EffectSchema.Literal(MENTION_KIND.PLAN),
    planId: planIdSchema,
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(MENTION_KIND.SECTION),
    planId: planIdSchema,
    heading: EffectSchema.String.check(
      EffectSchema.isNonEmpty(),
      EffectSchema.isMaxLength(PLAN_SECTION_BOUNDS.MAX_HEADING_CHARS),
    ),
  }),
  EffectSchema.Struct({ kind: EffectSchema.Literal(MENTION_KIND.FILE), path: pathSchema }),
  EffectSchema.Struct({ kind: EffectSchema.Literal(MENTION_KIND.FOLDER), path: pathSchema }),
]);

export type Mention = typeof mentionSchema.Type;

/** A mention of the plan or one of its sections. */
export type PlanMention = Extract<Mention, { readonly planId: string }>;

/** A mention written into words: where its link stands, the label it was written with, `@` and all, and what it names. */
export interface MentionInWords {
  readonly start: number;
  readonly end: number;
  readonly label: string;
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

/** A target's path read back from its steps, its leading slash and, for a folder, its trailing one taken off. */
function decodedPath(pathname: string): string | undefined {
  const steps = pathname.replace(/^\//u, "").replace(/\/$/u, "").split("/").map(decodedPart);
  return steps.every((step) => step !== undefined) ? steps.join("/") : undefined;
}

/** The fields a target spells, for the schema to read; nothing where it is no target of this form. */
function fieldsOf(target: string) {
  const url = URL.parse(target);
  if (url === null || url.protocol !== LINK.PROTOCOL) return undefined;
  switch (url.host) {
    case LINK.HOST[MENTION_KIND.FILE]:
      return { kind: MENTION_KIND.FILE, path: decodedPath(url.pathname) };
    case LINK.HOST[MENTION_KIND.FOLDER]:
      return { kind: MENTION_KIND.FOLDER, path: decodedPath(url.pathname) };
    case LINK.HOST[MENTION_KIND.PLAN]: {
      const planId = decodedPart(url.pathname.replace(/^\//u, ""));
      if (url.hash === "") return { kind: MENTION_KIND.PLAN, planId };
      return { kind: MENTION_KIND.SECTION, planId, heading: decodedPart(url.hash.slice(1)) };
    }
    default:
      return undefined;
  }
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

/** Whether the index stands inside a code span on its own line: between a run of backticks and the next run of the same length. */
function insideSpan(text: string, at: number): boolean {
  const lineStart = text.lastIndexOf("\n", at - 1) + 1;
  const lineEnd = text.indexOf("\n", at);
  const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
  const runs = [...line.matchAll(TICKS)].map((run) => ({
    start: run.index,
    end: run.index + run[0].length,
  }));
  const offset = at - lineStart;
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

/** Whether the index stands in code, where markdown draws no link: a fenced block, or a code span on its line. */
function insideCode(text: string, at: number): boolean {
  return insideFence(text, at) || insideSpan(text, at);
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

/** The target a mention is written with. */
export function encodeMention(mention: Mention): string {
  switch (mention.kind) {
    case MENTION_KIND.FILE:
      return `${LINK.PROTOCOL}//${LINK.HOST[MENTION_KIND.FILE]}/${encodedPath(mention.path)}`;
    case MENTION_KIND.FOLDER:
      return `${LINK.PROTOCOL}//${LINK.HOST[MENTION_KIND.FOLDER]}/${encodedPath(mention.path)}/`;
    case MENTION_KIND.PLAN:
    case MENTION_KIND.SECTION: {
      const plan = `${LINK.PROTOCOL}//${LINK.HOST[MENTION_KIND.PLAN]}/${encodedPart(mention.planId)}`;
      return mention.kind === MENTION_KIND.PLAN ? plan : `${plan}#${encodedPart(mention.heading)}`;
    }
  }
}

/** The mention a link's target names; nothing where it names none, or is no target of a mention. */
export function decodeMention(target: string): Mention | undefined {
  if (target.length > MENTION_BOUNDS.MAX_TARGET_CHARS) return undefined;
  return Option.getOrUndefined(readMention(fieldsOf(target)));
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
export function mentionMarkdown(mention: Mention, name: string): string {
  const label = `${MENTION_SIGIL}${name}`.replace(LABEL_SPECIAL, (special) => `\\${special}`);
  return `[${label}](${encodeMention(mention)})`;
}

/**
 * Every mention written into the words, in order: a link whose label
 * starts with `@`, whose target names a mention, standing outside code,
 * where markdown draws no link. A link of another kind, or one whose target
 * names nothing, is words. At most `MAX_MENTIONS` are read; any past them
 * stay words.
 */
export function mentionsIn(text: string): readonly MentionInWords[] {
  const found: MentionInWords[] = [];
  const opener = `[${MENTION_SIGIL}`;
  for (let at = text.indexOf(opener); at !== -1; at = text.indexOf(opener, at + 1)) {
    if (found.length === MENTION_BOUNDS.MAX_MENTIONS) break;
    const close = labelEnd(text, at);
    if (close === undefined || text[close + 1] !== "(" || insideCode(text, at)) continue;
    const targetEnd = text.indexOf(")", close + 2);
    if (targetEnd === -1) continue;
    const target = text.slice(close + 2, targetEnd);
    const mention = /\s/u.test(target) ? undefined : decodeMention(target);
    if (mention === undefined) continue;
    const label = text.slice(at + 1, close).replace(LABEL_ESCAPE, "$1");
    found.push({ start: at, end: targetEnd + 1, label, mention });
    at = targetEnd;
  }
  return found;
}
