import { MENTIONED_HEADING } from "@luke/database/models/attached-file-parts";
import { CONNECTION_TOOL } from "@luke/features/agent-tools";
import { INTEGRATION_NAME, type IntegrationProvider } from "@luke/features/integration-wire";
import {
  MENTION_KIND,
  type Mention,
  mentionName,
  mentionsIn,
  type PlanMention,
  type ServerMention,
  sectionAnchors,
} from "@luke/features/mention-link";
import { planSections } from "@luke/features/plan-document";
import { planMarkdown } from "@luke/features/plan-markdown";
import type { Plan } from "@luke/features/plan-wire";

/**
 * mentioned-context.ts -- what a coding agent's message mentions that the agent cannot read for itself, as it stood when the message was sent.
 *
 * A message names things as links whose label starts with `@`
 * (`@luke/features/mention-link`). The words go to the model as written,
 * links and all. A file or a folder is the agent's to read from its own
 * checkout, on its own branch, so nothing of it is added here, but for a
 * file's lines the developer picked (`file.ts:12–20`): those are pinned to
 * the commit they were read at, which the agent's branch may have moved
 * past, so a note names the lines and the commit, and says to read just
 * those. The plan, or
 * one of its sections, is not: a coding agent has no tool to read the plan
 * again, and one started on a prompt never saw it. So the message carries one
 * more part after its words, the plan or each section it named as it stood
 * at the send, under a heading eve's receipt is read back by
 * (`attached-file-parts.ts`). Only the agent's own plan is read, the plan the
 * send already read as its sender; a mention of another plan adds nothing.
 *
 * Each excerpt is cut on a line to its own bound, and the part to one bound
 * over all of them, in the order the mentions stand; an excerpt cut short
 * says how much was left out, and a mention the part has no room left for
 * is named with a line saying so, so the model knows to ask rather than
 * guess. A section is found by its anchor (`sectionAnchors`), and one whose
 * anchor no heading of the plan spells any longer is named as gone, by the
 * name the mention was written with. *
 * An MCP server, one of its tools, or a page of its integration's (a Linear
 * issue's address), is the agent's to reach through its
 * connections, whose tools it finds by search; a mention says which the
 * developer pointed it at, so it uses that one without hunting for it. The
 * turn the message opens is handed the server whatever the agent's switches
 * (`agent-runtime/servers.ts`), but a message steering a turn already running
 * reaches one handed only what it started with, so the note says a server
 * not among its connections joins at its next turn. An agent with no plan
 * is handed the notes alone.
 */

export const MENTIONED_BOUNDS = {
  /** The most characters of one section the part carries. */
  SECTION_CHARS: 4_000,
  /** The most characters of the whole plan the part carries, before its remaining headings. */
  PLAN_CHARS: 12_000,
  /** The most characters the whole part carries, about six thousand tokens. */
  PART_CHARS: 24_000,
} as const;

/** The room an excerpt leaves in the part for the closing line saying what was left out, which never names a heading. */
const LEFT_OUT_ROOM = 120;

/** How much of the text is kept when it is cut on a line to the bound: all of it where it fits. */
function keptLength(text: string, bound: number): number {
  if (text.length <= bound) return text.length;
  const lineEnd = text.lastIndexOf("\n", bound);
  return text.slice(0, lineEnd > 0 ? lineEnd : bound).trimEnd().length;
}

/** The text cut on a line to the bound, saying how much was left out; whole where it fits. */
function cutOnLine(text: string, bound: number): string {
  const kept = keptLength(text, bound);
  if (kept === text.length) return text;
  return `${text.slice(0, kept)}\n… (${text.length - kept} more characters)`;
}

/** The most characters the list of a cut plan's other sections spells, before it counts the rest. */
const HEADINGS_CHARS = 2_000;

/** Headings joined as a list, as many as its bound holds, the rest counted. */
function headingList(headings: readonly string[]): string {
  let list = "";
  for (const [at, heading] of headings.entries()) {
    const next = list === "" ? heading : `${list}; ${heading}`;
    if (next.length > HEADINGS_CHARS)
      return `${list === "" ? "" : `${list}; `}and ${headings.length - at} more`;
    list = next;
  }
  return list;
}

/** A mention of the plan or one of its sections, and the name it was written with. */
interface NamedMention {
  readonly mention: PlanMention;
  readonly name: string;
}

/** A mention the part hands its agent something of, and the name it was written with: the agent's own plan or one of its sections, or an MCP server or one of its tools. */
interface HandedMention {
  readonly mention: PlanMention | ServerMention | LinesMention;
  readonly name: string;
}

/** What a mention of the plan or one of its sections is handed as. */
function excerptOf({ mention, name }: NamedMention, plan: Plan): string {
  if (mention.kind === MENTION_KIND.PLAN) {
    const whole = planMarkdown(plan);
    if (whole.length <= MENTIONED_BOUNDS.PLAN_CHARS) return `The whole plan:\n\n${whole.trimEnd()}`;
    // Note that a section is left out by where it starts, past the cut, never by its heading's words, which earlier text may quote.
    const bodyKept =
      keptLength(whole, MENTIONED_BOUNDS.PLAN_CHARS) -
      (whole.length - plan.document.body.trimEnd().length - 1);
    const headings = planSections(plan.document.body)
      .filter((section) => section.heading !== "" && section.from >= bodyKept)
      .map((section) => section.heading);
    const rest = headings.length === 0 ? "" : `\n\nIts other sections: ${headingList(headings)}.`;
    return `The whole plan, cut short:\n\n${cutOnLine(whole, MENTIONED_BOUNDS.PLAN_CHARS)}${rest}`;
  }
  const sections = planSections(plan.document.body);
  const anchors = sectionAnchors(sections.map((section) => section.heading));
  const section = sections[anchors.indexOf(mention.anchor)];
  if (section === undefined) {
    return `The section "${name}": no longer in the plan.`;
  }
  return `The plan's section "${section.heading}":\n\n${cutOnLine(section.text, MENTIONED_BOUNDS.SECTION_CHARS)}`;
}

/** A mention of a file, which the part hands a note for where it pins the file's lines. */
type LinesMention = Extract<Mention, { readonly kind: typeof MENTION_KIND.FILE }>;

/** What a mention of a file's lines is handed as: the lines, the commit they were read at, and how to read just those; nothing for a whole file. */
function linesNoteOf({ path, lines }: LinesMention): string {
  if (lines === undefined) return "";
  const span =
    lines.startLine === lines.endLine
      ? `line ${lines.startLine}`
      : `lines ${lines.startLine}–${lines.endLine}`;
  return `The developer pointed you at ${span} of \`${path}\` as they stood at commit \`${lines.commit}\` for this message: read just those lines, as \`git show ${lines.commit}:${path}\` holds them, since your branch may have moved them.`;
}

/** What a mention of an MCP server or one of its tools is handed as: which the developer pointed the agent at, and how to reach it. */
function noteOf(mention: ServerMention): string {
  const server = `the ${INTEGRATION_NAME[mention.provider]} MCP server (connection \`${mention.provider}\`)`;
  const joins = "If that connection is not among yours in this turn, it joins at your next.";
  if (mention.kind === MENTION_KIND.SERVER) {
    return `The developer pointed you at ${server} for this message: find its tools with \`${CONNECTION_TOOL.SEARCH}\` on that connection and run them with \`${CONNECTION_TOOL.EXECUTE}\` before reaching for anything else. ${joins}`;
  }
  if (mention.kind === MENTION_KIND.LINK) {
    return `The developer pointed you at ${mention.url}, a page of ${server}, for this message: read it through that connection's tools rather than the web. ${joins}`;
  }
  return `The developer pointed you at the tool \`${mention.tool}\` of ${server} for this message: run it with \`${CONNECTION_TOOL.EXECUTE}\` in preference to other tools. ${joins}`;
}

/** The mention as the part hands it, where it hands it anything: one of another plan, or of a plan where the agent has none, is handed nothing. */
function handedMention(
  mention: Mention,
  plan: Plan | undefined,
): PlanMention | ServerMention | LinesMention | undefined {
  switch (mention.kind) {
    case MENTION_KIND.PLAN:
    case MENTION_KIND.SECTION:
      return mention.planId === plan?.id ? mention : undefined;
    case MENTION_KIND.SERVER:
    case MENTION_KIND.TOOL:
    case MENTION_KIND.LINK:
      return mention;
    // A whole file is the agent's to read; only lines the developer picked are handed a note.
    case MENTION_KIND.FILE:
      return mention.lines === undefined ? undefined : mention;
    case MENTION_KIND.FOLDER:
      return undefined;
  }
}

/** The same mention, each named once whatever times the message names it. */
function sameMention(
  first: PlanMention | ServerMention | LinesMention,
  second: PlanMention | ServerMention | LinesMention,
): boolean {
  switch (first.kind) {
    case MENTION_KIND.FILE:
      return (
        second.kind === MENTION_KIND.FILE &&
        first.path === second.path &&
        first.lines?.commit === second.lines?.commit &&
        first.lines?.startLine === second.lines?.startLine &&
        first.lines?.endLine === second.lines?.endLine
      );
    case MENTION_KIND.PLAN:
      return second.kind === MENTION_KIND.PLAN;
    case MENTION_KIND.SECTION:
      return second.kind === MENTION_KIND.SECTION && first.anchor === second.anchor;
    case MENTION_KIND.SERVER:
      return second.kind === MENTION_KIND.SERVER && first.provider === second.provider;
    case MENTION_KIND.TOOL:
      return (
        second.kind === MENTION_KIND.TOOL &&
        first.provider === second.provider &&
        first.tool === second.tool
      );
    case MENTION_KIND.LINK:
      return second.kind === MENTION_KIND.LINK && first.url === second.url;
  }
}

/** What the part hands for one mention; a mention of the plan only where the agent has one (`handedMention`). */
function handedAs({ mention, name }: HandedMention, plan: Plan | undefined): string {
  if (mention.kind === MENTION_KIND.PLAN || mention.kind === MENTION_KIND.SECTION) {
    return plan === undefined ? "" : excerptOf({ mention, name }, plan);
  }
  return mention.kind === MENTION_KIND.FILE ? linesNoteOf(mention) : noteOf(mention);
}

/** The MCP servers the words mention, by themselves, by one of their tools, or by a page of theirs, each once: the ones the turn the words open is handed whatever the agent's switches say. */
export function mentionedServers(
  words: string,
  repository: string | null,
): readonly IntegrationProvider[] {
  // Note that the plan's repository is handed, so a page that is a file of it brings in no server.
  const providers = mentionsIn(words, repository).flatMap(({ mention }) =>
    mention.kind === MENTION_KIND.SERVER ||
    mention.kind === MENTION_KIND.TOOL ||
    mention.kind === MENTION_KIND.LINK
      ? [mention.provider]
      : [],
  );
  return [...new Set(providers)];
}

/**
 * The part a message hands its agent beside its words: the plan or each of
 * its sections the words mention, as it stands in `plan`, the agent's own
 * plan as the send read it, and a note for each MCP server or tool they
 * mention; nothing where they mention none of these. An agent with no plan
 * is handed the notes alone.
 */
export function mentionedContext(words: string, plan: Plan | undefined): string | undefined {
  const named: HandedMention[] = [];
  for (const { mention, label } of mentionsIn(words, plan?.repository ?? null)) {
    const handed = handedMention(mention, plan);
    if (handed === undefined) continue;
    if (!named.some((each) => sameMention(each.mention, handed))) {
      named.push({ mention: handed, name: mentionName(label) });
    }
  }
  if (named.length === 0) return undefined;
  let part = MENTIONED_HEADING;
  let left = 0;
  // Note that an excerpt too long for the room left is passed over rather than
  // ending the part, so a shorter one after it still goes; what was passed
  // over is counted, and said once at the end.
  for (const mention of named) {
    const excerpt = `\n\n${handedAs(mention, plan)}`;
    if (part.length + excerpt.length + LEFT_OUT_ROOM <= MENTIONED_BOUNDS.PART_CHARS)
      part += excerpt;
    else left += 1;
  }
  if (left > 0) {
    part += `\n\n${left} more mention${left === 1 ? "" : "s"} of the plan left out, since this part is full; ask for what you need.`;
  }
  return part;
}
