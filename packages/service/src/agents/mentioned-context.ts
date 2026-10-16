import { MENTIONED_HEADING } from "@luke/database/models/attached-file-parts";
import { AGENT_TOOL, CONNECTION_TOOL } from "@luke/features/agent-tools";
import { INTEGRATION_NAME } from "@luke/features/integration-wire";
import {
  handedMentionsIn,
  linkMention,
  MENTION_KIND,
  type Mention,
  mentionName,
  type PlanMention,
  type ServerMention,
  sectionAnchors,
  type TaskMention,
} from "@luke/features/mention-link";
import type { PageLine } from "@luke/features/page-wire";
import { planSections } from "@luke/features/plan-document";
import { planMarkdown } from "@luke/features/plan-markdown";
import type { Task } from "@luke/features/task-wire";

/**
 * mentioned-context.ts -- what a coding agent's message mentions that the agent cannot read for itself, as it stood when the message was sent.
 *
 * A message names things as links whose label starts with `@`
 * (`@luke/features/mention-link`), or as the bare address of a plan, one of
 * its sections, a page, or an agent, which the window draws as the same chip
 * and which is handed as the same mention (`handedMentionsIn`); a bare
 * address of anything else is words. The words go to the model as written,
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
 *
 * A page an agent showed on the plan is named by its id, read at the send
 * off the agent's own plan (`mentioned-reads.ts`) and handed here as
 * `MentionedReads`; one of another plan is handed nothing, as a section of
 * one is. A coding agent is named by its id too, and read on any task of
 * the agent's workspace or on none, as the sender could open it; one the
 * send did not find there, of another workspace or gone, is named as not
 * found. An agent is handed as its task and where its work stands on
 * GitHub, its branch and its pull request, which the agent reads with `gh`
 * and `git`, and as the id `message_agent` reaches it by, and never its
 * conversation, which is its starter's. A page is handed as its title, its
 * id, and its version, which `read_page` reads it by and `show_page` writes
 * its next version under, and never its HTML, which the agent reads when it
 * needs it rather than carrying it in every message that names the page.
 */

export const MENTIONED_BOUNDS = {
  /** The most characters of one section the part carries. */
  SECTION_CHARS: 4_000,
  /** The most characters of the whole plan the part carries, before its remaining headings. */
  PLAN_CHARS: 12_000,
  /** The most characters the whole part carries, about six thousand tokens. */
  PART_CHARS: 24_000,
} as const;

/** One of the workspace's coding agents a message mentions, as the send read it: what names it, its task, and where its work stands on GitHub. */
export interface MentionedAgent {
  readonly id: string;
  /** Its title, or its model's id where it has none yet. */
  readonly name: string;
  /** The task it works on, and whether that task is archived, which takes its agents no message; null for an agent on none. */
  readonly task: { readonly id: string; readonly name: string; readonly archived: boolean } | null;
  readonly repository: string;
  /** The branch its last turn ended on; null before one ended, or where it stood detached. */
  readonly branch: string | null;
  /** The pull request from its branch as GitHub last answered; null where it has none. */
  readonly pullRequest: { readonly number: number; readonly url: string } | null;
  readonly archived: boolean;
}

/** What the send read of the pages a message mentions on the agent's own plan and the agents it mentions in its workspace, each by its id; one it did not find is absent. */
export interface MentionedReads {
  readonly pages: ReadonlyMap<string, PageLine>;
  readonly agents: ReadonlyMap<string, MentionedAgent>;
}

/** The reads of a message that mentions no page and no agent. */
export const NO_MENTIONED_READS: MentionedReads = { pages: new Map(), agents: new Map() };

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

/** A mention the part hands its agent something of, and the name it was written with: the agent's own plan, one of its sections, pages, or agents, or an MCP server or one of its tools. */
interface HandedMention {
  readonly mention: Handed;
  readonly name: string;
}

/** What a mention of the plan or one of its sections is handed as. */
function excerptOf({ mention, name }: NamedMention, task: Task): string {
  if (mention.kind === MENTION_KIND.TASK) {
    const whole = planMarkdown(task);
    if (whole.length <= MENTIONED_BOUNDS.PLAN_CHARS) return `The whole plan:\n\n${whole.trimEnd()}`;
    // Note that a section is left out by where it starts, past the cut, never by its heading's words, which earlier text may quote.
    const bodyKept =
      keptLength(whole, MENTIONED_BOUNDS.PLAN_CHARS) -
      (whole.length - task.document.body.trimEnd().length - 1);
    const headings = planSections(task.document.body)
      .filter((section) => section.heading !== "" && section.from >= bodyKept)
      .map((section) => section.heading);
    const rest = headings.length === 0 ? "" : `\n\nIts other sections: ${headingList(headings)}.`;
    return `The whole plan, cut short:\n\n${cutOnLine(whole, MENTIONED_BOUNDS.PLAN_CHARS)}${rest}`;
  }
  const sections = planSections(task.document.body);
  const anchors = sectionAnchors(sections.map((section) => section.heading));
  const section = sections[anchors.indexOf(mention.anchor)];
  if (section === undefined) {
    return `The section "${name}": no longer in the plan.`;
  }
  return `The plan's section "${section.heading}":\n\n${cutOnLine(section.text, MENTIONED_BOUNDS.SECTION_CHARS)}`;
}

/** A mention of a file, which the part hands a note for where it pins the file's lines. */
type LinesMention = Extract<Mention, { readonly kind: typeof MENTION_KIND.FILE }>;

/** A mention the part hands something for. */
type Handed = PlanMention | ServerMention | LinesMention | TaskMention;

/**
 * What a mention of a page is handed as: its title, id, and version, the
 * read that answers its HTML as it stands, and how to write its next
 * version; never its HTML, which `read_page` answers when the agent wants it.
 */
function pageNoteOf(pageId: string, name: string, reads: MentionedReads): string {
  const page = reads.pages.get(pageId);
  if (page === undefined) return `The page "${name}": no longer on this task.`;
  return `The developer pointed you at the page "${page.title}" (id \`${page.id}\`, version ${page.version}) shown on this task. Read it as the developer saw it with \`${AGENT_TOOL.READ_PAGE}\`, \`pageId: "${page.id}"\`, and \`version: ${page.version}\`, or leave the version out for its newest. To change it, show it again with \`${AGENT_TOOL.SHOW_PAGE}\` and \`page: "${page.id}"\`, which writes its next version in its place.`;
}

/** How the agent reads another agent's work: its pull request's diff, else its branch's, by the repository the agent shares with it or names. */
function readingOf(agent: MentionedAgent, repository: string | null): string {
  const elsewhere = agent.repository.toLowerCase() !== repository?.toLowerCase();
  const repo = elsewhere ? ` --repo ${agent.repository}` : "";
  if (agent.pullRequest !== null) {
    return ` Read its work with \`gh pr diff ${agent.pullRequest.number}${repo}\` and \`gh pr view ${agent.pullRequest.number}${repo}\`.`;
  }
  if (agent.branch === null) return " It has pushed no work yet, so there is none of its to read.";
  return elsewhere
    ? ` Its work, once pushed, is on that branch of \`${agent.repository}\`, which \`gh\` reads.`
    : ` Read its work, once pushed, with \`git fetch origin ${agent.branch}\` and \`git diff HEAD...FETCH_HEAD\`.`;
}

/** Where a mentioned agent works, beside the plan of the agent it is handed to. */
function taskWords(agent: MentionedAgent, plan: Task | undefined): string {
  if (agent.task === null) return "on no task";
  if (agent.task.id === plan?.id) return "on this task";
  return `on the task "${agent.task.name}"`;
}

/** What a mention of another of the workspace's agents is handed as: its name, its id to message it by, its task, and where its work stands on GitHub; never its conversation. */
function agentNoteOf(
  agentId: string,
  name: string,
  reads: MentionedReads,
  plan: Task | undefined,
): string {
  // The store holds an id in lower case, whatever case the link spelled it in.
  const agent = reads.agents.get(agentId.toLowerCase());
  if (agent === undefined) return `The coding agent "${name}": not found in your workspace.`;
  const archived = agent.archived ? ", archived," : "";
  const branch = agent.branch === null ? "" : ` on the branch \`${agent.branch}\``;
  const pullRequest =
    agent.pullRequest === null
      ? ""
      : `, whose pull request is #${agent.pullRequest.number} (${agent.pullRequest.url})`;
  const message = agent.archived
    ? ""
    : agent.task?.archived === true
      ? " Its task is archived, so it takes no message."
      : ` To message it, call \`${AGENT_TOOL.MESSAGE_AGENT}\` with its id.`;
  return `The developer pointed you at another coding agent of your workspace ${taskWords(agent, plan)}, "${agent.name}" (id \`${agent.id}\`)${archived} working in \`${agent.repository}\`${branch}${pullRequest}.${readingOf(agent, plan?.repository ?? null)}${message} Its conversation is not yours to read.`;
}

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
  const connection =
    mention.kind === MENTION_KIND.LINK
      ? mention.provider
      : (mention.connection ?? mention.provider);
  const server = `the ${INTEGRATION_NAME[mention.provider]} MCP server (connection \`${connection}\`)`;
  const joins = "If that connection is not among yours in this turn, it joins at your next.";
  if (mention.kind === MENTION_KIND.SERVER) {
    return `The developer pointed you at ${server} for this message: find its tools with \`${CONNECTION_TOOL.SEARCH}\` on that connection and run them with \`${CONNECTION_TOOL.EXECUTE}\` before reaching for anything else. ${joins}`;
  }
  if (mention.kind === MENTION_KIND.LINK) {
    return `The developer pointed you at ${mention.url}, a page of ${server}, for this message: read it through that connection's tools rather than the web. ${joins}`;
  }
  return `The developer pointed you at the tool \`${mention.tool}\` of ${server} for this message: run it with \`${CONNECTION_TOOL.EXECUTE}\` in preference to other tools. ${joins}`;
}

/** The mention as the part hands it, where it hands it anything: what stands on another plan, or on a plan where the agent has none, is handed nothing, but for a coding agent, which is read across the workspace. */
function handedMention(mention: Mention, plan: Task | undefined): Handed | undefined {
  switch (mention.kind) {
    case MENTION_KIND.TASK:
    case MENTION_KIND.SECTION:
    case MENTION_KIND.PAGE:
      return mention.taskId === plan?.id ? mention : undefined;
    case MENTION_KIND.AGENT:
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
function sameMention(first: Handed, second: Handed): boolean {
  switch (first.kind) {
    case MENTION_KIND.FILE:
      return (
        second.kind === MENTION_KIND.FILE &&
        first.path === second.path &&
        first.lines?.commit === second.lines?.commit &&
        first.lines?.startLine === second.lines?.startLine &&
        first.lines?.endLine === second.lines?.endLine
      );
    case MENTION_KIND.TASK:
      return second.kind === MENTION_KIND.TASK;
    case MENTION_KIND.SECTION:
      return second.kind === MENTION_KIND.SECTION && first.anchor === second.anchor;
    case MENTION_KIND.SERVER:
      return (
        second.kind === MENTION_KIND.SERVER &&
        first.provider === second.provider &&
        first.connection === second.connection
      );
    case MENTION_KIND.TOOL:
      return (
        second.kind === MENTION_KIND.TOOL &&
        first.provider === second.provider &&
        first.connection === second.connection &&
        first.tool === second.tool
      );
    case MENTION_KIND.LINK:
      return second.kind === MENTION_KIND.LINK && first.url === second.url;
    case MENTION_KIND.PAGE:
      return second.kind === MENTION_KIND.PAGE && first.pageId === second.pageId;
    case MENTION_KIND.AGENT:
      return (
        second.kind === MENTION_KIND.AGENT &&
        first.agentId.toLowerCase() === second.agentId.toLowerCase()
      );
  }
}

/** What the part hands for one mention; a mention of the plan or of what it holds only where the agent has one (`handedMention`). */
function handedAs(
  { mention, name }: HandedMention,
  plan: Task | undefined,
  reads: MentionedReads,
): string {
  switch (mention.kind) {
    case MENTION_KIND.TASK:
    case MENTION_KIND.SECTION:
      return plan === undefined ? "" : excerptOf({ mention, name }, plan);
    case MENTION_KIND.PAGE:
      return pageNoteOf(mention.pageId, name, reads);
    case MENTION_KIND.AGENT:
      return agentNoteOf(mention.agentId, name, reads, plan);
    case MENTION_KIND.FILE:
      return linesNoteOf(mention);
    case MENTION_KIND.SERVER:
    case MENTION_KIND.TOOL:
    case MENTION_KIND.LINK:
      return noteOf(mention);
  }
}

/** The pages of a plan and the agents words mention, by id. */
export interface MentionedIds {
  readonly pages: readonly string[];
  readonly agents: readonly string[];
}

/** The pages of the plan, where there is one, and the agents on any task or none, that the words mention, by id, each once: what the send reads for `mentionedContext` to hand. */
export function mentionedIds(words: string, plan: Task | undefined): MentionedIds {
  const pages = new Set<string>();
  const agents = new Set<string>();
  for (const { mention } of handedMentionsIn(words, plan?.repository ?? null)) {
    if (mention.kind === MENTION_KIND.PAGE && mention.taskId === plan?.id)
      pages.add(mention.pageId);
    if (mention.kind === MENTION_KIND.AGENT) agents.add(mention.agentId.toLowerCase());
  }
  return { pages: [...pages], agents: [...agents] };
}

/** The MCP servers the words mention, by connection name, by themselves, by one of their tools, or by a page of theirs, each once: the ones the turn the words open is handed whatever the agent's switches say. */
export function mentionedServers(words: string, repository: string | null): readonly string[] {
  // Note that the plan's repository is handed, so a page that is a file of it brings in no server.
  const connections = handedMentionsIn(words, repository).flatMap(({ mention }) => {
    if (mention.kind === MENTION_KIND.SERVER || mention.kind === MENTION_KIND.TOOL) {
      return [mention.connection ?? mention.provider];
    }
    // A page names its provider and no account, so it brings in the provider's first.
    return mention.kind === MENTION_KIND.LINK ? [mention.provider] : [];
  });
  return [...new Set(connections)];
}

/**
 * The part a message hands its agent beside its words: the plan or each of
 * its sections the words mention, as it stands in `plan`, the agent's own
 * plan as the send read it, each of its pages and each of the workspace's
 * agents they mention, as the send read them into `reads`, and a note for
 * each MCP server or tool they mention; nothing where they mention none of
 * these. An agent with no plan is handed the notes and the agents alone.
 */
export function mentionedContext(
  words: string,
  task: Task | undefined,
  reads: MentionedReads = NO_MENTIONED_READS,
): string | undefined {
  const named: HandedMention[] = [];
  const repository = task?.repository ?? null;
  for (const { mention, label, target } of handedMentionsIn(words, repository)) {
    const handed = handedMention(mention, task);
    if (handed === undefined) continue;
    // A bare address is named by what it says of the thing, a section by its anchor, as its chip is.
    const name = linkMention(label, target, repository)?.name ?? mentionName(label);
    if (!named.some((each) => sameMention(each.mention, handed))) {
      named.push({ mention: handed, name });
    }
  }
  if (named.length === 0) return undefined;
  let part = MENTIONED_HEADING;
  let left = 0;
  // Note that an excerpt too long for the room left is passed over rather than
  // ending the part, so a shorter one after it still goes; what was passed
  // over is counted, and said once at the end.
  for (const mention of named) {
    const excerpt = `\n\n${handedAs(mention, task, reads)}`;
    if (part.length + excerpt.length + LEFT_OUT_ROOM <= MENTIONED_BOUNDS.PART_CHARS)
      part += excerpt;
    else left += 1;
  }
  if (left > 0) {
    part += `\n\n${left} more mention${left === 1 ? "" : "s"} of the plan left out, since this part is full; ask for what you need.`;
  }
  return part;
}
