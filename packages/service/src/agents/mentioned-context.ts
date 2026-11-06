import { MENTIONED_HEADING } from "@repo/database/models/attached-file-parts";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import {
  INTEGRATION_NAME,
  INTEGRATION_PROVIDER,
  type IntegrationProvider,
} from "@repo/features/integration-wire";
import {
  LINK_PLACE,
  linkOf,
  mentionMarkdownLink,
  readLink,
  taskNumberOf,
} from "@repo/features/link-grammar";
import { LINK_SITE, type LinkSite } from "@repo/features/link-site";
import {
  handedMentionsIn,
  linkMention,
  MENTION_KIND,
  type Mention,
  mentionName,
  type NumberedTaskIdOf,
  type PersonMention,
  type DescriptionMention,
  type ServerMention,
  sectionAnchors,
  type TaskMention,
} from "@repo/features/mention-link";
import { PAGE_OWNER, type PageLine, type PageOwner } from "@repo/features/page-wire";
import { descriptionSections } from "@repo/features/description-document";
import { descriptionMarkdown } from "@repo/features/description-markdown";
import type { Task } from "@repo/features/task-wire";
import { WORKSPACE_ROLE, type WorkspaceRole } from "@repo/features/workspace-wire";

export const MENTIONED_BOUNDS = {
  SECTION_CHARS: 4_000,
  DESCRIPTION_CHARS: 12_000,
  PART_CHARS: 24_000,
} as const;

export interface MentionedAgent {
  readonly id: string;
  readonly name: string;
  readonly task: { readonly id: string; readonly name: string } | null;
  readonly repository: string | null;
  readonly branch: string | null;
  readonly pullRequest: { readonly number: number; readonly url: string } | null;
  readonly archived: boolean;
}

export interface MentionedPerson {
  readonly userId: string;
  readonly name: string;
  readonly role: WorkspaceRole;
}

type MentionedTasks = ReadonlyMap<string, ReadonlyMap<number, string>>;

export interface MentionedReads {
  readonly pages: ReadonlyMap<string, PageLine>;
  readonly agents: ReadonlyMap<string, MentionedAgent>;
  readonly people: ReadonlyMap<string, MentionedPerson>;
  readonly tasks: MentionedTasks;
}

export const NO_MENTIONED_READS: MentionedReads = {
  pages: new Map(),
  agents: new Map(),
  people: new Map(),
  tasks: new Map(),
};

function foundTask(tasks: MentionedTasks): NumberedTaskIdOf {
  return ({ workspace, number }) => tasks.get(workspace)?.get(number);
}

const LEFT_OUT_ROOM = 120;

const SITE_READ_BY: Readonly<Partial<Record<LinkSite, IntegrationProvider>>> = {
  [LINK_SITE.GOOGLE_DOCS]: INTEGRATION_PROVIDER.GOOGLE_DRIVE,
  [LINK_SITE.GOOGLE_SHEETS]: INTEGRATION_PROVIDER.GOOGLE_DRIVE,
  [LINK_SITE.GOOGLE_SLIDES]: INTEGRATION_PROVIDER.GOOGLE_DRIVE,
};

function keptLength(text: string, bound: number): number {
  if (text.length <= bound) return text.length;
  const lineEnd = text.lastIndexOf("\n", bound);
  return text.slice(0, lineEnd > 0 ? lineEnd : bound).trimEnd().length;
}

function cutOnLine(text: string, bound: number): string {
  const kept = keptLength(text, bound);
  if (kept === text.length) return text;
  return `${text.slice(0, kept)}\n… (${text.length - kept} more characters)`;
}

const HEADINGS_CHARS = 2_000;

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

interface NamedMention {
  readonly mention: DescriptionMention;
  readonly name: string;
}

interface HandedMention {
  readonly mention: Handed;
  readonly name: string;
}

function excerptOf({ mention, name }: NamedMention, task: Task): string {
  if (mention.kind === MENTION_KIND.TASK) {
    const whole = descriptionMarkdown(task);
    if (whole.length <= MENTIONED_BOUNDS.DESCRIPTION_CHARS)
      return `The whole description:\n\n${whole.trimEnd()}`;
    const bodyKept =
      keptLength(whole, MENTIONED_BOUNDS.DESCRIPTION_CHARS) -
      (whole.length - task.document.body.trimEnd().length - 1);
    const headings = descriptionSections(task.document.body)
      .filter((section) => section.heading !== "" && section.from >= bodyKept)
      .map((section) => section.heading);
    const rest = headings.length === 0 ? "" : `\n\nIts other sections: ${headingList(headings)}.`;
    return `The whole description, cut short:\n\n${cutOnLine(whole, MENTIONED_BOUNDS.DESCRIPTION_CHARS)}${rest}`;
  }
  const sections = descriptionSections(task.document.body);
  const anchors = sectionAnchors(sections.map((section) => section.heading));
  const section = sections[anchors.indexOf(mention.anchor)];
  if (section === undefined) {
    return `The section "${name}": no longer in the description.`;
  }
  return `The description's section "${section.heading}":\n\n${cutOnLine(section.text, MENTIONED_BOUNDS.SECTION_CHARS)}`;
}

type LinesMention = Extract<Mention, { readonly kind: typeof MENTION_KIND.FILE }>;

const HANDED_KIND = {
  NUMBERED_TASK: "numbered-task",
} as const;

interface NumberedTask {
  readonly kind: typeof HANDED_KIND.NUMBERED_TASK;
  readonly taskId: string;
  readonly link: string;
}

type Handed =
  | DescriptionMention
  | ServerMention
  | LinesMention
  | TaskMention
  | PersonMention
  | NumberedTask;

function pageNoteOf(
  pageId: string,
  name: string,
  reads: MentionedReads,
  owner: PageOwner | undefined,
): string {
  const page = reads.pages.get(pageId);
  const on = owner?.kind === PAGE_OWNER.AGENT ? "among your own pages" : "on this task";
  if (page === undefined) return `The page "${name}": no longer ${on}.`;
  const shown = owner?.kind === PAGE_OWNER.AGENT ? "that you showed" : "shown on this task";
  return `The developer pointed you at the page "${page.title}" (id \`${page.id}\`, version ${page.version}) ${shown}. Read it as the developer saw it with \`${AGENT_TOOL.READ_PAGE}\`, \`pageId: "${page.id}"\`, and \`version: ${page.version}\`, or leave the version out for its newest. To change it, show it again with \`${AGENT_TOOL.SHOW_PAGE}\` and \`page: "${page.id}"\`, which writes its next version in its place.`;
}

function readingOf(agent: MentionedAgent, repository: string | null): string {
  if (agent.repository === null)
    return " It works in no repository, so there is no work of its to read.";
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

function taskWords(agent: MentionedAgent, task: Task | undefined): string {
  if (agent.task === null) return "on no task";
  if (agent.task.id === task?.id) return "on this task";
  return `on the task "${agent.task.name}"`;
}

function agentNoteOf(
  agentId: string,
  name: string,
  reads: MentionedReads,
  task: Task | undefined,
): string {
  const agent = reads.agents.get(agentId.toLowerCase());
  if (agent === undefined) return `The agent "${name}": not found in your workspace.`;
  const archived = agent.archived ? ", archived," : "";
  const branch = agent.branch === null ? "" : ` on the branch \`${agent.branch}\``;
  const working = agent.repository === null ? "" : ` working in \`${agent.repository}\``;
  const pullRequest =
    agent.pullRequest === null
      ? ""
      : `, whose pull request is ${mentionMarkdownLink(`#${agent.pullRequest.number}`, agent.pullRequest.url)}`;
  const message = agent.archived
    ? ""
    : ` To message it, call \`${AGENT_TOOL.MESSAGE_AGENT}\` with its id.`;
  return `The developer pointed you at another agent of your workspace ${taskWords(agent, task)}, "${agent.name}" (id \`${agent.id}\`)${archived}${working}${branch}${pullRequest}.${readingOf(agent, task?.repository ?? null)}${message} Its conversation is not yours to read.`;
}

const ROLE_WORDS = {
  [WORKSPACE_ROLE.OWNER]: "an owner",
  [WORKSPACE_ROLE.ADMIN]: "an admin",
  [WORKSPACE_ROLE.MEMBER]: "a member",
} as const satisfies Record<WorkspaceRole, string>;

function personNoteOf(userId: string, name: string, reads: MentionedReads): string {
  const person = reads.people.get(userId);
  if (person === undefined) return `The person "${name}": not a member of your workspace.`;
  return `The developer pointed you at ${person.name}, ${ROLE_WORDS[person.role]} of your workspace. No tool of yours reaches them, so where the work needs them, name them in what you write, as the developer's mention of them is written.`;
}

function linesNoteOf({ path, lines }: LinesMention): string {
  if (lines === undefined) return "";
  const span =
    lines.startLine === lines.endLine
      ? `line ${lines.startLine}`
      : `lines ${lines.startLine}–${lines.endLine}`;
  return `The developer pointed you at ${span} of \`${path}\` as they stood at commit \`${lines.commit}\` for this message: read just those lines, as \`git show ${lines.commit}:${path}\` holds them, since your branch may have moved them.`;
}

function numberedTaskNoteOf({ taskId, link }: NumberedTask): string {
  return `The link ${link} names the task whose id is \`${taskId}\`, which \`${AGENT_TOOL.READ_TASK}\` and the other task tools take.`;
}

function noteOf(mention: ServerMention): string {
  const connection =
    mention.kind === MENTION_KIND.LINK
      ? mention.provider
      : (mention.connection ?? mention.provider);
  const server = `the ${INTEGRATION_NAME[mention.provider]} MCP server (connection \`${connection}\`)`;
  const joins = "If that connection is not among yours in this turn, it joins at your next.";
  if (mention.kind === MENTION_KIND.SERVER) {
    return `The developer pointed you at ${server} for this message: use that connection's tools before reaching for anything else. ${joins}`;
  }
  if (mention.kind === MENTION_KIND.LINK) {
    return `The developer pointed you at ${mention.url}, a page of ${server}, for this message: read it through that connection's tools rather than the web. ${joins}`;
  }
  return `The developer pointed you at the tool \`${mention.tool}\` of ${server} for this message: run it in preference to other tools. ${joins}`;
}

export function pagesOwnerOf(
  task: Task | undefined,
  agentId: string | undefined,
): PageOwner | undefined {
  if (task !== undefined) return { kind: PAGE_OWNER.TASK, taskId: task.id };
  return agentId === undefined ? undefined : { kind: PAGE_OWNER.AGENT, agentId };
}

function standsOn(
  mention: Extract<Mention, { kind: typeof MENTION_KIND.PAGE }>,
  owner: PageOwner | undefined,
): boolean {
  if (owner === undefined) return false;
  return owner.kind === PAGE_OWNER.TASK
    ? "taskId" in mention && mention.taskId === owner.taskId
    : "agentId" in mention && mention.agentId.toLowerCase() === owner.agentId.toLowerCase();
}

function numberedTaskOf(
  mention: Mention,
  target: string,
  task: Task | undefined,
): NumberedTask | undefined {
  if (!("taskId" in mention) || mention.taskId === task?.id) return undefined;
  const read = readLink(target);
  const number = read === undefined ? undefined : taskNumberOf(read.place);
  if (read === undefined || number === undefined) return undefined;
  const link = linkOf({ kind: LINK_PLACE.TASK, planId: String(number) }, read.workspace);
  return { kind: HANDED_KIND.NUMBERED_TASK, taskId: mention.taskId, link };
}

function handedMention(
  mention: Mention,
  target: string,
  task: Task | undefined,
  owner: PageOwner | undefined,
): Handed | undefined {
  const numbered = numberedTaskOf(mention, target, task);
  if (numbered !== undefined) return numbered;
  switch (mention.kind) {
    case MENTION_KIND.TASK:
    case MENTION_KIND.SECTION:
      return mention.taskId === task?.id ? mention : undefined;
    case MENTION_KIND.PAGE:
      return standsOn(mention, owner) ? mention : undefined;
    case MENTION_KIND.AGENT:
    case MENTION_KIND.PERSON:
    case MENTION_KIND.SERVER:
    case MENTION_KIND.TOOL:
      return mention;
    case MENTION_KIND.LINK: {
      if ("provider" in mention) return mention;
      const reader = SITE_READ_BY[mention.site];
      return reader === undefined
        ? undefined
        : { kind: mention.kind, provider: reader, url: mention.url };
    }
    case MENTION_KIND.FILE:
      return mention.lines === undefined ? undefined : mention;
    case MENTION_KIND.FOLDER:
    case MENTION_KIND.APP:
    case MENTION_KIND.DATE:
      return undefined;
  }
}

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
    case MENTION_KIND.PERSON:
      return second.kind === MENTION_KIND.PERSON && first.userId === second.userId;
    case HANDED_KIND.NUMBERED_TASK:
      return second.kind === HANDED_KIND.NUMBERED_TASK && first.taskId === second.taskId;
  }
}

function handedAs(
  { mention, name }: HandedMention,
  task: Task | undefined,
  reads: MentionedReads,
  owner: PageOwner | undefined,
): string {
  switch (mention.kind) {
    case MENTION_KIND.TASK:
    case MENTION_KIND.SECTION:
      return task === undefined ? "" : excerptOf({ mention, name }, task);
    case MENTION_KIND.PAGE:
      return pageNoteOf(mention.pageId, name, reads, owner);
    case MENTION_KIND.AGENT:
      return agentNoteOf(mention.agentId, name, reads, task);
    case MENTION_KIND.PERSON:
      return personNoteOf(mention.userId, name, reads);
    case MENTION_KIND.FILE:
      return linesNoteOf(mention);
    case MENTION_KIND.SERVER:
    case MENTION_KIND.TOOL:
    case MENTION_KIND.LINK:
      return noteOf(mention);
    case HANDED_KIND.NUMBERED_TASK:
      return numberedTaskNoteOf(mention);
  }
}

export interface MentionedIds {
  readonly pages: readonly string[];
  readonly agents: readonly string[];
  readonly people: readonly string[];
}

export function mentionedIds(
  words: string,
  task: Task | undefined,
  agentId?: string | undefined,
  tasks: MentionedTasks = NO_MENTIONED_READS.tasks,
): MentionedIds {
  const owner = pagesOwnerOf(task, agentId);
  const pages = new Set<string>();
  const agents = new Set<string>();
  const people = new Set<string>();
  const handed = handedMentionsIn(words, task?.repository ?? null, { taskIdOf: foundTask(tasks) });
  for (const { mention } of handed) {
    if (mention.kind === MENTION_KIND.PAGE && standsOn(mention, owner)) pages.add(mention.pageId);
    if (mention.kind === MENTION_KIND.AGENT) agents.add(mention.agentId.toLowerCase());
    if (mention.kind === MENTION_KIND.PERSON) people.add(mention.userId);
  }
  return { pages: [...pages], agents: [...agents], people: [...people] };
}

export function mentionedServers(words: string, repository: string | null): readonly string[] {
  const connections = handedMentionsIn(words, repository).flatMap(({ mention }) => {
    if (mention.kind === MENTION_KIND.SERVER || mention.kind === MENTION_KIND.TOOL) {
      return [mention.connection ?? mention.provider];
    }
    if (mention.kind !== MENTION_KIND.LINK) return [];
    if ("provider" in mention) return [mention.provider];
    const reader = SITE_READ_BY[mention.site];
    return reader === undefined ? [] : [reader];
  });
  return [...new Set(connections)];
}

export function mentionedContext(
  words: string,
  task: Task | undefined,
  reads: MentionedReads = NO_MENTIONED_READS,
  agentId?: string | undefined,
  descriptionsOn = true,
): string | undefined {
  const owner = pagesOwnerOf(task, agentId);
  const named: HandedMention[] = [];
  const repository = task?.repository ?? null;
  const taskIdOf = foundTask(reads.tasks);
  for (const { mention, label, target } of handedMentionsIn(words, repository, { taskIdOf })) {
    const handed = handedMention(mention, target, task, owner);
    if (handed === undefined) continue;
    if (
      !descriptionsOn &&
      (handed.kind === MENTION_KIND.TASK || handed.kind === MENTION_KIND.SECTION)
    ) {
      continue;
    }
    const name = linkMention(label, target, repository)?.name ?? mentionName(label);
    if (!named.some((each) => sameMention(each.mention, handed))) {
      named.push({ mention: handed, name });
    }
  }
  if (named.length === 0) return undefined;
  let part = MENTIONED_HEADING;
  let left = 0;
  for (const mention of named) {
    const excerpt = `\n\n${handedAs(mention, task, reads, owner)}`;
    if (part.length + excerpt.length + LEFT_OUT_ROOM <= MENTIONED_BOUNDS.PART_CHARS)
      part += excerpt;
    else left += 1;
  }
  if (left > 0) {
    part += `\n\n${left} more mention${left === 1 ? "" : "s"} of the plan left out, since this part is full; ask for what you need.`;
  }
  return part;
}
