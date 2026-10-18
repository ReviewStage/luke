import type { CodingAgentPullRequest } from "@luke/features/coding-agent-wire";
import { INTEGRATION_PROVIDER, type IntegrationProvider } from "@luke/features/integration-wire";
import {
  encodeMention,
  isMentionableTool,
  MENTION_KIND,
  type Mention,
  type MentionPlace,
  sectionAnchors,
} from "@luke/features/mention-link";
import { planSections } from "@luke/features/plan-document";
import { TASK_TREE_ENTRY } from "@luke/features/task-wire";
import type { WorkspaceMember } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { useAct } from "@luke/panel/act";
import {
  ArrowLeftIcon,
  type ComboboxGroup,
  ComboboxList,
  DocumentIcon,
  IconButton,
  ProviderMark,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  UserIcon,
  useComboboxField,
} from "@luke/ui";
import { type Actor, memberActor } from "@luke/ui/actor-model";
import type { NamedServer } from "@luke/ui/agent-servers-model";
import type { SkillOption } from "@luke/ui/skill-mention";
import { fileFolder, fileName } from "@luke/voice/code-pane-model";
import { defaultFilter } from "cmdk";
import {
  AppWindowIcon,
  BookOpenIcon,
  FolderIcon,
  GitPullRequestIcon,
  HashIcon,
  UsersIcon,
} from "lucide-react";
import { type RefObject, useEffect, useState } from "react";
import { ACTOR_SIZE, ActorMark } from "../actor-ref";
import { type IntegrationToolsReads, useIntegrationTools } from "../integration-tools";
import { useMemberDirectory } from "../member-directory";
import type { ComposerTrigger, MentionNode } from "../plan-editor/contract";
import { FileTypeIcon } from "./file-type-icon";
import { PullRequestMark } from "./pull-request-mark";
import { AgentMark } from "./tab-look";
import { NO_TASK } from "./task-mentions";

/**
 * mention-picker.tsx -- the list an `@` opens: the task's repository's files and folders, the plan's sections, and the task, grouped by kind, narrowed as the word is typed, the pick written as its mention.
 *
 * The list opens the way the `/` list does (`skill-picker.tsx`), at the
 * word an editor reports (`ComposerTrigger`), the caret staying in the
 * editor throughout, its keys steered as any combobox's are
 * (`@luke/ui`'s `useComboboxField`): ↑ and ↓ move the highlight, a bare Home
 * and End take it to the first row and the last, Enter or Tab write the
 * highlighted row as its mention, and Escape closes the list until the caret
 * leaves the word. Keys an input method is composing with stay its own. Nothing typed after the `@`, it offers the task and its
 * sections; typed, it finds each kind's best few by the words typed, scored
 * as ⌘K scores them (cmdk's own filter), files and folders first, each
 * group in a fixed place so a later read never moves the rows above it.
 * Once the words run past a space and nothing matches them, the list
 * stands aside, since they are the developer's own words rather than a
 * mention, and the keys go to the editor as they would anywhere.
 * The repository's paths are read once per task, the first time an `@` is
 * typed, through the same listing ⌘K finds files with
 * (`ACT_KIND.TASKS_TREE`, the whole tree at the default branch).
 *
 * Where the editor's words go to an agent, the list offers the repository's
 * skills too, a pick written as the `/name` chip the `/` list writes
 * (`skill-picker.tsx`), and the account's connected MCP servers, and once a word is typed each one's tools, read
 * while the list stands open through the same read the agent's servers
 * popover draws its tools from (`../integration-tools.ts`); a mention of one
 * hands the agent's next turn that server whatever its switch says
 * (`packages/service/src/agents/agent-runtime/servers.ts`).
 *
 * On a plan's page the list offers what the plan holds beside its words
 * too: the pages agents showed on it, each by its title and its tab's
 * glyph, and the pull requests its agents published, each by its number
 * and title and its mark, a pick written as the pull request's GitHub
 * address, the link mention a pasted one becomes. And wherever the words go, it offers the coding agents of the
 * whole workspace, each by its tab's name and its harness's mark, labelled
 * by its task: the plan's own agents first, then the workspace's others,
 * on another task or on none, as the place reads them the first time the
 * list opens (`MentionSource.readAgents`), the agent whose box it is left
 * out. Once a word is typed, the service finds the agents it names by
 * their title or their task's name, however many the workspace holds. An
 * archived agent takes no message, so it is offered only once a word is
 * typed, and marked archived. A mention of a page or an
 * agent names it by its id (`@luke/features/mention-link`), which the
 * agent it is sent to is handed what it needs to read by
 * (`packages/service/src/agents/mentioned-context.ts`).
 *
 * Wherever the words stand in a workspace whose members the window has
 * read (`../member-directory.tsx`), the list offers its people too, each by
 * their name and picture, the reader among them as You, found by their name
 * or their email: a mention of a person names them by their account's id,
 * so it names them still once they rename themselves, and an agent the
 * words go to is handed who they are in the workspace. Nobody is notified
 * of a mention.
 *
 * Nothing typed after the `@`, the list ends in a row for each kind the
 * place offers ("Mention from"): → or Enter on one narrows the list to that
 * kind, as typing its word and a colon does (`@files:`, `@agents:`, a
 * server's provider such as `@linear:`). A narrowed list stands under a
 * crumb naming the kind, lists up to fifty rows, and searches that kind
 * alone; ⌫ on its empty words widens it again. Narrowed to files and
 * folders, → on a folder walks into it: its first row mentions the folder,
 * the rest are what it holds, from the tree already read, and ⌫ on empty
 * words climbs back out. Narrowing changes only what the list offers; a
 * pick writes the same mention it would have written from the wide list.
 *
 * A pick hands the editor the mention's name and its target
 * (`@luke/features/mention-link`), which the editor writes in place of
 * the word; the name is the file's or folder's own name, the heading, the
 * plan's name, the page's title, the agent's tab's name, the server's
 * name, or the server's name and the tool's.
 */

/** What the list's groups are called, in the order they stand. */
const MENTION_GROUP = {
  FILES: "Files and folders",
  PLAN: "Plan",
  PAGES: "Pages",
  AGENTS: "Agents",
  PEOPLE: "People",
  PULL_REQUESTS: "Pull requests",
  SKILLS: "Skills",
  SERVERS: "MCP servers",
  FROM: "Mention from",
} as const;

/** The kinds a list may be narrowed to, each but a server by its own word typed before a colon after the `@`. */
const MENTION_FROM = {
  FILES: "files",
  PLAN: "plan",
  PAGES: "pages",
  AGENTS: "agents",
  PEOPLE: "people",
  PULL_REQUESTS: "prs",
  SKILLS: "skills",
  SERVER: "server",
} as const;

type MentionFrom = (typeof MENTION_FROM)[keyof typeof MENTION_FROM];

/** The kind a list is narrowed to: one of the place's own, or one connected server by its connection, wearing its provider's mark. */
type Narrow =
  | { readonly from: Exclude<MentionFrom, typeof MENTION_FROM.SERVER> }
  | {
      readonly from: typeof MENTION_FROM.SERVER;
      readonly connection: string;
      readonly provider: IntegrationProvider;
    };

/** One kind the place offers, as its row under "Mention from" and its narrowed list's crumb name it. */
interface MentionKind {
  readonly narrow: Narrow;
  readonly name: string;
  readonly detail: string | undefined;
  /** The word that, typed before a colon after the `@`, narrows the list to it; none for a server past its provider's first. */
  readonly keyword: string | undefined;
}

/** What a page's row says beside its title. */
const PAGE_DETAIL = "Page";

/** What an agent's row says beside its name: its task's, this one's, or none. */
const AGENT_DETAIL = {
  THIS_TASK: "This task",
  NO_TASK: "No task",
  OTHER_TASK: "Another task",
  ARCHIVED: "Archived",
} as const;

/** What the reader's own row says beside their name. */
const YOU_DETAIL = "You";

/** What stands between an agent's task and its being archived in its row's detail. */
const DETAIL_JOIN = " · ";

/** What a pull request's row says beside its name where no agent is named for it. */
const PULL_REQUEST_DETAIL = "Pull request";

/** What a skill's row says beside its name. */
const SKILL_DETAIL = "Skill";

/** What a server's row says beside its name. */
const SERVER_DETAIL = "MCP server";

/** What a tool's row says beside its name, which already names its server. */
const TOOL_DETAIL = "Tool";

/** What stands between a server's name and its tool's in a tool's mention. */
const TOOL_JOIN = " · ";

/** The repository's skills as an `@` list offers them: as read, the ask to read them, and the pick that writes one as its `/name` chip. */
export interface MentionSkills {
  readonly known: readonly SkillOption[] | undefined;
  readonly ask: () => void;
  readonly onChoose: (name: string) => void;
}

/** The servers of a list that offers none. */
const NO_SERVERS: readonly NamedServer[] = [];

/** The most rows one group lists. */
const PER_GROUP = 4;

/** The most rows a list narrowed to one kind lists. */
const PER_KIND = 50;

/** The least of cmdk's scores the list counts as a match, as ⌘K counts one. */
const LEAST_SCORE = 0.01;

/** The list's own name, which its listbox is read by. */
const MENU_LABEL = "Mention";

/** What the list says where it has no row. */
const NO_MATCH = "Nothing matches";

/** The keys the list hears, said at its foot as far as it hears them now. */
const MENU_KEY = {
  MOVE: "↑↓ Move",
  MENTION: "↵ Mention",
  OPEN: "→ Open",
  WIDEN: "⌫ All kinds",
  UP: "⌫ Up",
  CLOSE: "esc Close",
} as const;

/** What a narrowed list's back arrow is read by: back to every kind, or up out of a folder. */
const BACK_LABEL = {
  WIDEN: "All kinds",
  UP: "Up",
} as const;

/** The gap between the word's line and the list under it. */
const MENU_GAP = 4;

/** The list's width, as the stylesheet sets it (`.mention-menu`). */
const MENU_WIDTH = 360;

/** Where the list stands in its room: its left edge, and its top, or its foot over the word with its top left to it. */
type MenuPlace =
  | { readonly left: number; readonly top: number }
  | { readonly left: number; readonly top: "auto"; readonly bottom: number };

/** One row the list offers: what it mentions, or the skill it names, the name it is written with, and a muted detail. */
type MentionRow = {
  readonly name: string;
  readonly detail: string | undefined;
  /** The words it is found by. */
  readonly terms: string;
  /** An agent's tile, or a person's picture, which its row wears; none for any other row. */
  readonly actor?: Actor | undefined;
  /** A pull request, whose mark its row wears for where it stands; none for any other row. */
  readonly pullRequest?: MentionablePullRequest | undefined;
} & ({ readonly mention: Mention } | { readonly skill: string } | { readonly from: MentionKind });

interface MentionGroup {
  readonly label: string;
  readonly rows: readonly MentionRow[];
}

/** A path of the repository as the list finds it: a file or a folder. */
interface RepositoryPath {
  readonly path: string;
  readonly folder: boolean;
}

/** The highlight as it was moved, held against the word it was moved in. */
interface Highlight {
  readonly start: number;
  readonly query: string;
  readonly at: number;
}

/** A folder the list walked into: its path, and the words as they stood then, past which the words typed search it. */
interface Walked {
  readonly path: string;
  readonly entry: string;
}

/**
 * A narrowing a key made, held against the word it was made in: the kind,
 * the words as they stood then (or the `kind:` typed before it), whether
 * the kind was typed rather than opened, and the folders walked into since.
 */
interface Held {
  readonly start: number;
  readonly narrow: Narrow;
  readonly entry: string;
  readonly typed: boolean;
  readonly walked: readonly Walked[];
}

/** Where the list stands for the word: every kind, or one kind, its folders walked, and the words that search it. */
interface Scope {
  readonly kind: MentionKind | undefined;
  /** The words as they stood when the kind was narrowed to, or the `kind:` typed. */
  readonly entry: string;
  /** Whether the kind was typed (`@files:`), which ⌫ widens by deleting the colon rather than by a key the list takes. */
  readonly typed: boolean;
  readonly walked: readonly Walked[];
  readonly term: string;
}

/** Whether two narrowings name the same kind. */
function sameNarrow(first: Narrow, second: Narrow): boolean {
  if (first.from !== MENTION_FROM.SERVER || second.from !== MENTION_FROM.SERVER) {
    return first.from === second.from;
  }
  return first.connection === second.connection;
}

/**
 * Where the list stands for the word: the narrowing held for it, as long as
 * the words still begin as they did when it was made and the place still
 * offers its kind, its walk cut back to the folders whose words still
 * stand; else the kind whose word the words begin with, typed before a
 * colon; else every kind, searched by the words whole.
 */
function scopeOf(
  trigger: ComposerTrigger,
  held: Held | undefined,
  kinds: readonly MentionKind[],
): Scope {
  const { query } = trigger;
  const kept =
    held?.start === trigger.start && query.startsWith(held.entry)
      ? kinds.find((kind) => sameNarrow(kind.narrow, held.narrow))
      : undefined;
  if (held !== undefined && kept !== undefined) {
    const standing = held.walked.findIndex((level) => !query.startsWith(level.entry));
    const walked = standing === -1 ? held.walked : held.walked.slice(0, standing);
    const from = walked.at(-1)?.entry ?? held.entry;
    return {
      kind: kept,
      entry: held.entry,
      typed: held.typed,
      walked,
      term: query.slice(from.length),
    };
  }
  const typed = /^([^\s:]+):/u.exec(query);
  const word = typed?.[1]?.toLowerCase();
  const kind = word === undefined ? undefined : kinds.find((each) => each.keyword === word);
  if (typed === null || kind === undefined) {
    return { kind: undefined, entry: "", typed: false, walked: [], term: query };
  }
  return { kind, entry: typed[0], typed: true, walked: [], term: query.slice(typed[0].length) };
}

/**
 * Where back takes a narrowed list: out of the folder walked into, else to
 * every kind where a key narrowed it; nowhere for a wide list, or one whose
 * kind was typed, whose colon ⌫ deletes in the editor instead.
 */
function backFrom(
  scope: Scope | undefined,
  start: number,
): { readonly to: Held | undefined } | undefined {
  if (scope?.kind === undefined) return undefined;
  const { kind, entry, typed, walked } = scope;
  if (walked.length > 0) {
    return { to: { start, narrow: kind.narrow, entry, typed, walked: walked.slice(0, -1) } };
  }
  return typed ? undefined : { to: undefined };
}

/** A count and its noun, as a kind's row says it. */
function counted(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Whether → opens the row: a kind's, which narrows the list, or a folder's, which walks into it. */
function opens(row: MentionRow): boolean {
  return "from" in row || ("mention" in row && row.mention.kind === MENTION_KIND.FOLDER);
}

/** A path's row: its own name, its folder after it, found by the whole path. */
function pathRow(entry: RepositoryPath): MentionRow {
  const name = fileName(entry.path);
  return {
    mention: entry.folder
      ? { kind: MENTION_KIND.FOLDER, path: entry.path }
      : { kind: MENTION_KIND.FILE, path: entry.path },
    name: entry.folder ? `${name}/` : name,
    detail: fileFolder(entry.path),
    terms: entry.path,
  };
}

/** The plan's rows: each section by its heading, a heading borne twice once for each section, then the plan itself; none where no plan stands. */
function taskRows(taskId: string, taskName: string, text: string): MentionRow[] {
  if (taskId === NO_TASK) return [];
  const headings = planSections(text).map((section) => section.heading);
  const anchors = sectionAnchors(headings);
  return [
    ...headings.flatMap((heading, at): MentionRow[] => {
      const anchor = anchors[at] ?? "";
      if (anchor === "") return [];
      return [
        {
          mention: { kind: MENTION_KIND.SECTION, taskId: taskId, anchor },
          name: heading,
          detail: "Section",
          terms: heading,
        },
      ];
    }),
    {
      mention: { kind: MENTION_KIND.TASK, taskId: taskId },
      name: taskName,
      detail: "The whole plan",
      terms: taskName,
    },
  ];
}

/** Each of the plan's pages' rows, by its title; none where no plan stands. */
function pageRows(taskId: string, pages: readonly MentionablePage[]): MentionRow[] {
  if (taskId === NO_TASK) return [];
  return pages.map((page) => ({
    mention: { kind: MENTION_KIND.PAGE, taskId: taskId, pageId: page.id },
    name: page.title,
    detail: PAGE_DETAIL,
    terms: page.title,
  }));
}

/** What an agent's row says of its task: this one, another by its name, or none, and whether it is archived. */
function agentDetail(agent: MentionableAgent, taskId: string): string {
  const task =
    agent.task === undefined
      ? AGENT_DETAIL.NO_TASK
      : agent.task.id === taskId
        ? AGENT_DETAIL.THIS_TASK
        : (agent.task.name ?? AGENT_DETAIL.OTHER_TASK);
  return agent.archived === true ? `${task}${DETAIL_JOIN}${AGENT_DETAIL.ARCHIVED}` : task;
}

/**
 * Each agent's row, by its tab's name, wearing its tile, labelled and found
 * by its task: the plan's own agents first, then the workspace's others in
 * the order read, each once, an archived one only once a word is typed, and
 * the agent whose box it is left out.
 */
function agentRows(
  taskId: string,
  own: readonly MentionableAgent[],
  workspace: readonly MentionableAgent[],
  self: string | undefined,
  query: string,
): MentionRow[] {
  const seen = new Set<string>(self === undefined ? [] : [self]);
  const typed = query.trim() !== "";
  const mine = taskId === NO_TASK ? [] : own.map((agent) => ({ ...agent, task: { id: taskId } }));
  const rows: MentionRow[] = [];
  for (const agent of [...mine, ...workspace]) {
    if (seen.has(agent.id) || (agent.archived === true && !typed)) continue;
    seen.add(agent.id);
    const task = agent.task;
    const detail = agentDetail(agent, taskId);
    rows.push({
      mention:
        task === undefined
          ? { kind: MENTION_KIND.AGENT, agentId: agent.id }
          : { kind: MENTION_KIND.AGENT, taskId: task.id, agentId: agent.id },
      name: agent.name,
      detail,
      terms: `${agent.name} ${detail}`,
      actor: agent.actor,
    });
  }
  return rows;
}

/** Each member's row, by their name, wearing their picture, said by their email or as You, found by either. */
function personRows(
  members: readonly WorkspaceMember[],
  readerId: string | undefined,
): MentionRow[] {
  return members.map((member) => {
    const detail = member.userId === readerId ? YOU_DETAIL : member.email;
    return {
      mention: { kind: MENTION_KIND.PERSON, userId: member.userId },
      name: member.name,
      detail,
      terms: `${member.name} ${member.email}`,
      actor: memberActor(member, readerId),
    };
  });
}

/**
 * Each of the task's pull requests' rows, by its number and title, wearing
 * its mark, labelled by the agent that published it: a pick writes its
 * GitHub address, as a pull request's link pasted is written; none where
 * no plan stands.
 */
function pullRequestRows(
  taskId: string,
  pullRequests: readonly MentionablePullRequest[],
): MentionRow[] {
  if (taskId === NO_TASK) return [];
  return pullRequests.map((pullRequest) => {
    const name = `#${pullRequest.number} ${pullRequest.title}`;
    const detail = pullRequest.agent ?? PULL_REQUEST_DETAIL;
    return {
      mention: {
        kind: MENTION_KIND.LINK,
        provider: INTEGRATION_PROVIDER.GITHUB,
        url: pullRequest.url,
      },
      name,
      detail,
      terms: `${name} ${detail} ${PULL_REQUEST_DETAIL}`,
      pullRequest,
    };
  });
}

/** Each connected server's row, and where asked each of its tools' rows as far as its read answered, found by the server's name and the tool's. */
function serverRows(
  servers: readonly NamedServer[],
  reads: IntegrationToolsReads,
  withTools: boolean,
): MentionRow[] {
  return servers.flatMap(({ provider, connection, name }) => {
    // An account past its provider's first is named by its connection; the first by the provider alone, as it always was.
    const account = connection === provider ? undefined : { connection };
    const server: MentionRow = {
      mention: { kind: MENTION_KIND.SERVER, provider, ...account },
      name,
      detail: SERVER_DETAIL,
      terms: name,
    };
    const read = reads[connection];
    if (!withTools || read === undefined || !("tools" in read)) return [server];
    // Note that a tool whose name no mention can carry is left out, since its pick would name nothing.
    const tools = read.tools.flatMap((tool): MentionRow[] => {
      const mention: Mention = { kind: MENTION_KIND.TOOL, provider, ...account, tool: tool.name };
      if (!isMentionableTool(tool.name)) return [];
      return [
        {
          mention,
          name: `${name}${TOOL_JOIN}${tool.name}`,
          detail: TOOL_DETAIL,
          terms: `${tool.name} ${name}`,
        },
      ];
    });
    return [server, ...tools];
  });
}

/** Each of the repository's skills' rows, found by its name and what it says it is for. */
function skillRows(skills: readonly SkillOption[]): MentionRow[] {
  return skills.map((skill) => ({
    skill: skill.name,
    name: skill.name,
    detail: SKILL_DETAIL,
    terms: `${skill.name} ${skill.description}`,
  }));
}

/** The rows matching the query, best first, as many as `most`; the first rows in order for no query. */
function best(rows: readonly MentionRow[], query: string, most: number): readonly MentionRow[] {
  if (query.trim() === "") return rows.slice(0, most);
  return rows
    .map((row) => ({ row, score: defaultFilter(row.terms, query) }))
    .filter((each) => each.score >= LEAST_SCORE)
    .sort((first, second) => second.score - first.score)
    .slice(0, most)
    .map((each) => each.row);
}

/**
 * The repository's paths a list narrowed to them offers: for no words, the
 * folder walked into, then what it holds, its folders first, or what the
 * repository's root holds where none was; else the best of every path
 * under the folder by the words.
 */
function fileRows(
  paths: readonly RepositoryPath[],
  folder: string | undefined,
  term: string,
): readonly MentionRow[] {
  const under =
    folder === undefined ? paths : paths.filter((entry) => entry.path.startsWith(`${folder}/`));
  if (term.trim() !== "") return best(under.map(pathRow), term, PER_KIND);
  // Note that a folder's own entries are said without the folder, which the crumb already names.
  const entries = under
    .filter((entry) => (fileFolder(entry.path) ?? "") === (folder ?? ""))
    .sort((first, second) => Number(second.folder) - Number(first.folder))
    .map((entry) => ({ ...pathRow(entry), detail: undefined }));
  const itself = folder === undefined ? [] : [pathRow({ path: folder, folder: true })];
  return [...itself, ...entries].slice(0, PER_KIND);
}

/** Every row of each kind but the repository's paths, found by the list's words. */
interface KindRows {
  readonly plan: readonly MentionRow[];
  readonly pages: readonly MentionRow[];
  readonly agents: readonly MentionRow[];
  readonly people: readonly MentionRow[];
  readonly pullRequests: readonly MentionRow[];
  readonly skills: readonly MentionRow[];
  /** The connected servers' rows, or the one server's the list is narrowed to. */
  readonly servers: readonly MentionRow[];
}

/** Up to fifty of one kind's rows, found by the words; a folder's where one was walked into. */
function narrowedRows(
  kind: MentionKind,
  folder: string | undefined,
  term: string,
  paths: readonly RepositoryPath[] | undefined,
  rows: KindRows,
): readonly MentionRow[] {
  switch (kind.narrow.from) {
    case MENTION_FROM.FILES:
      return paths === undefined ? [] : fileRows(paths, folder, term);
    case MENTION_FROM.PLAN:
      return best(rows.plan, term, PER_KIND);
    case MENTION_FROM.PAGES:
      return best(rows.pages, term, PER_KIND);
    case MENTION_FROM.AGENTS:
      return best(rows.agents, term, PER_KIND);
    case MENTION_FROM.PEOPLE:
      return best(rows.people, term, PER_KIND);
    case MENTION_FROM.PULL_REQUESTS:
      return best(rows.pullRequests, term, PER_KIND);
    case MENTION_FROM.SKILLS:
      return best(rows.skills, term, PER_KIND);
    case MENTION_FROM.SERVER:
      return best(rows.servers, term, PER_KIND);
  }
}

/** A kind's row under "Mention from", which opens its narrowed list. */
function kindRow(kind: MentionKind): MentionRow {
  return { from: kind, name: kind.name, detail: kind.detail, terms: kind.name };
}

/**
 * The groups the list offers for the word. Every kind at once: their first
 * few but the files, and a row for each kind, for no words; else each kind's
 * best, files and folders first. One kind: up to fifty of its rows, a
 * folder's where one was walked into.
 */
function groupsFor(
  scope: Scope,
  paths: readonly RepositoryPath[] | undefined,
  rows: KindRows,
  kinds: readonly MentionKind[],
): readonly MentionGroup[] {
  const { kind, term } = scope;
  if (kind !== undefined) {
    const folder = scope.walked.at(-1)?.path;
    const narrowed = narrowedRows(kind, folder, term, paths, rows);
    return narrowed.length === 0 ? [] : [{ label: folder ?? kind.name, rows: narrowed }];
  }
  const bare = term.trim() === "";
  const files = bare || paths === undefined ? [] : best(paths.map(pathRow), term, PER_GROUP);
  return [
    { label: MENTION_GROUP.FILES, rows: files },
    { label: MENTION_GROUP.PLAN, rows: best(rows.plan, term, PER_GROUP) },
    { label: MENTION_GROUP.PAGES, rows: best(rows.pages, term, PER_GROUP) },
    { label: MENTION_GROUP.AGENTS, rows: best(rows.agents, term, PER_GROUP) },
    { label: MENTION_GROUP.PEOPLE, rows: best(rows.people, term, PER_GROUP) },
    { label: MENTION_GROUP.PULL_REQUESTS, rows: best(rows.pullRequests, term, PER_GROUP) },
    { label: MENTION_GROUP.SKILLS, rows: best(rows.skills, term, PER_GROUP) },
    { label: MENTION_GROUP.SERVERS, rows: best(rows.servers, term, PER_GROUP) },
    { label: MENTION_GROUP.FROM, rows: bare ? kinds.map(kindRow) : [] },
  ].filter((group) => group.rows.length > 0);
}

/** A kind's glyph, as its rows wear theirs. */
function KindGlyph({ kind }: { kind: MentionKind }): React.JSX.Element {
  switch (kind.narrow.from) {
    case MENTION_FROM.FILES:
      return <FolderIcon aria-hidden="true" />;
    case MENTION_FROM.PLAN:
      return <DocumentIcon />;
    case MENTION_FROM.PAGES:
      return <AppWindowIcon aria-hidden="true" />;
    case MENTION_FROM.AGENTS:
      return <AgentMark provider={undefined} />;
    case MENTION_FROM.PEOPLE:
      return <UsersIcon aria-hidden="true" />;
    case MENTION_FROM.PULL_REQUESTS:
      return <GitPullRequestIcon aria-hidden="true" />;
    case MENTION_FROM.SKILLS:
      return <BookOpenIcon aria-hidden="true" />;
    case MENTION_FROM.SERVER:
      return <ProviderMark provider={kind.narrow.provider} />;
  }
}

/** A row's glyph, as its chip wears it. */
function RowGlyph({ row }: { row: MentionRow }): React.JSX.Element {
  if ("skill" in row) return <BookOpenIcon aria-hidden="true" />;
  if ("from" in row) return <KindGlyph kind={row.from} />;
  if (row.pullRequest !== undefined) return <PullRequestMark pullRequest={row.pullRequest} />;
  const { mention } = row;
  switch (mention.kind) {
    case MENTION_KIND.FILE:
      return <FileTypeIcon name={fileName(mention.path)} />;
    case MENTION_KIND.FOLDER:
      return <FolderIcon aria-hidden="true" />;
    case MENTION_KIND.SECTION:
      return <HashIcon aria-hidden="true" />;
    case MENTION_KIND.TASK:
      return <DocumentIcon />;
    case MENTION_KIND.SERVER:
    case MENTION_KIND.TOOL:
    case MENTION_KIND.LINK:
      return <ProviderMark provider={mention.provider} />;
    case MENTION_KIND.PAGE:
      return <AppWindowIcon aria-hidden="true" />;
    case MENTION_KIND.AGENT:
      return row.actor === undefined ? (
        <AgentMark provider={undefined} />
      ) : (
        <ActorMark actor={row.actor} size={ACTOR_SIZE.INLINE} />
      );
    case MENTION_KIND.PERSON:
      return row.actor === undefined ? (
        <UserIcon />
      ) : (
        <ActorMark actor={row.actor} size={ACTOR_SIZE.INLINE} />
      );
  }
}

/** A row's key, stable while it stands: its skill's name, its kind's narrowing, or its mention. */
function rowKey(row: MentionRow): string {
  if ("skill" in row) return row.skill;
  return JSON.stringify("from" in row ? row.from.narrow : row.mention);
}

/** The groups as the list draws them: each row its glyph, its name, its detail, and a chevron where it opens. */
function comboboxGroups(groups: readonly MentionGroup[]): ComboboxGroup[] {
  return groups.map((group) => ({
    label: group.label,
    options: group.rows.map((row) => ({
      id: rowKey(row),
      label: row.name,
      icon: <RowGlyph row={row} />,
      detail: row.detail,
      opens: "from" in row,
    })),
  }));
}

/** What a narrowed list stands under: its kind, the folder walked into, and the way back, where a key made it. */
interface Crumb {
  readonly kind: MentionKind;
  readonly folder: string | undefined;
  readonly back: (() => void) | undefined;
}

/** A narrowed list's crumb: back, the kind's glyph or a folder's, and the kind's name or the folder's path, as an MCP server's page stands under its own. */
function MentionCrumb({ crumb }: { crumb: Crumb }): React.JSX.Element {
  const { kind, folder, back } = crumb;
  return (
    // Note that a press on the crumb keeps the caret in the editor, where the keys are read.
    // biome-ignore lint/a11y/noStaticElementInteractions: the press is the back button's; the crumb only keeps the focus where it was.
    <div
      className="agent-servers-page-head mention-menu-crumb"
      onMouseDown={(event) => event.preventDefault()}
    >
      {back === undefined ? null : (
        <IconButton
          icon={<ArrowLeftIcon />}
          label={folder === undefined ? BACK_LABEL.WIDEN : BACK_LABEL.UP}
          tabbable={false}
          onClick={back}
        />
      )}
      <span className="menu-item-glyph">
        {folder === undefined ? <KindGlyph kind={kind} /> : <FolderIcon aria-hidden="true" />}
      </span>
      <span className="mention-menu-crumb-title">
        <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.SECTION}>
          {folder ?? kind.name}
        </Text>
      </span>
    </div>
  );
}

/** The list itself: a narrowed list's crumb, each group's heading and rows, the highlighted one washed, and the keys it hears at its foot. */
function MentionMenu({
  crumb,
  groups,
  at,
  keys,
  place,
  onHover,
  onChoose,
}: {
  crumb: Crumb | undefined;
  groups: readonly MentionGroup[];
  at: number;
  keys: readonly string[];
  place: MenuPlace;
  onHover: (index: number) => void;
  onChoose: (row: MentionRow) => void;
}): React.JSX.Element {
  const rows = groups.flatMap((group) => group.rows);
  return (
    <div className="menu-surface searchable-menu mention-menu" style={place}>
      {crumb === undefined ? null : <MentionCrumb crumb={crumb} />}
      <ComboboxList
        label={MENU_LABEL}
        groups={comboboxGroups(groups)}
        active={at}
        onActiveChange={onHover}
        onChoose={(index) => {
          const row = rows[index];
          if (row !== undefined) onChoose(row);
        }}
        // A narrowed list's one group is named by its crumb.
        headed={crumb === undefined}
        empty={NO_MATCH}
      />
      <div className="task-compose-menu-foot mention-menu-foot" aria-hidden="true">
        {keys.map((key) => (
          <Text
            key={key}
            as={TEXT_ELEMENT.SPAN}
            variant={TEXT_VARIANT.CAPTION}
            tone={TEXT_TONE.SUBTLE}
          >
            {key}
          </Text>
        ))}
      </div>
    </div>
  );
}

/** What an editor drawing an `@` list wires: the list while it stands, and the report and keys the editor hands it. */
export interface MentionPicker {
  readonly menu: React.ReactNode;
  readonly onTrigger: (trigger: ComposerTrigger | undefined) => void;
  readonly onKey: (event: KeyboardEvent) => boolean;
}

/** Which side of the word the list stands: under it, as in the plan, or over it, as at the foot of an agent's tab. */
export const MENTION_MENU_SIDE = {
  BELOW: "below",
  ABOVE: "above",
} as const;

type MentionMenuSide = (typeof MENTION_MENU_SIDE)[keyof typeof MENTION_MENU_SIDE];

/** A page an agent showed on the plan, as the list offers it: its id and its newest version's title. */
export interface MentionablePage {
  readonly id: string;
  readonly title: string;
}

/** One of the workspace's coding agents, as the list offers it: its id, its tab's name, its tile, which its row wears, its task, and whether it is archived. */
export interface MentionableAgent {
  readonly id: string;
  readonly name: string;
  readonly actor: Actor;
  /** The task it works on, by its id and, where the place knows it, its name; absent for an agent on none. */
  readonly task?: { readonly id: string; readonly name?: string | undefined } | undefined;
  readonly archived?: boolean | undefined;
}

/** One of the task's pull requests, as the list offers it: where it stands, which its mark wears, its GitHub address, and the name of the agent that published it, where the place knows it. */
export interface MentionablePullRequest
  extends Pick<CodingAgentPullRequest, "number" | "title" | "url" | "state" | "checks"> {
  readonly agent: string | undefined;
}

/**
 * Reads the workspace's coding agents: the newest where no words are given,
 * or, found by the service, those whose title or task's name holds the
 * words, the archived ones among them; settles with none where the read
 * failed.
 */
export type MentionAgentsReader = (
  words: string | undefined,
) => Promise<readonly MentionableAgent[]>;

/** The pages and agents of a place that offers none. */
const NO_PAGES: readonly MentionablePage[] = [];
const NO_AGENTS: readonly MentionableAgent[] = [];
const NO_PULL_REQUESTS: readonly MentionablePullRequest[] = [];
const NO_MEMBERS: readonly WorkspaceMember[] = [];

/** The plan whose sections and repository the list offers, the workspace it stands in, and its text as it stands now; `NO_TASK` for a page no task holds, which offers its repository alone. */
export interface MentionSource {
  readonly taskId: string;
  readonly taskName: string;
  /** The slug of the task's workspace, which a mention of it is written under. */
  readonly workspace: string;
  /** The task's repository, `owner/name`; null before one is chosen. */
  readonly repository: string | null;
  /** The id of the workspace whose installation the repository is read through, where no plan names it. */
  readonly workspaceId?: string | undefined;
  readonly text: () => string;
  /** The pages agents showed on the plan; none where the place offers none. */
  readonly pages?: readonly MentionablePage[] | undefined;
  /** The plan's coding agents, as its page holds them now; none where the place offers none. */
  readonly agents?: readonly MentionableAgent[] | undefined;
  /** Reads the workspace's coding agents, which the list offers after the plan's own; none where the place offers none. */
  readonly readAgents?: MentionAgentsReader | undefined;
  /** The pull requests the plan's agents published, as its page holds them now; none where the place offers none. */
  readonly pullRequests?: readonly MentionablePullRequest[] | undefined;
}

/** What a repository's paths are read by: the plan whose repository it is, or, with no plan, the workspace and the repository; none where neither names one. */
function treeKey(
  taskId: string,
  workspaceId: string | undefined,
  repository: string | null,
): { planId: string } | { workspaceId: string; repository: string } | undefined {
  if (taskId !== NO_TASK) return { planId: taskId };
  if (workspaceId === undefined || repository === null) return undefined;
  return { workspaceId, repository };
}

/**
 * The kinds the place offers, in the list's order: its repository's files
 * and folders where it names one, the plan and its pages where a plan
 * stands, the workspace's agents where it reads them, its people where
 * the window has read them, the pull requests
 * the plan's agents published, the repository's skills where the words go
 * to an agent, and each connected server, the
 * first of each provider narrowed to by the provider's own word.
 */
function kindsOf(
  source: MentionSource,
  self: string | undefined,
  skills: MentionSkills | undefined,
  servers: readonly NamedServer[],
  people: number,
): readonly MentionKind[] {
  const { taskId, repository } = source;
  const pages = taskId === NO_TASK ? 0 : (source.pages ?? NO_PAGES).length;
  const pullRequests = taskId === NO_TASK ? 0 : (source.pullRequests ?? NO_PULL_REQUESTS).length;
  const agents =
    source.readAgents !== undefined ||
    (taskId !== NO_TASK && (source.agents ?? NO_AGENTS).some((agent) => agent.id !== self));
  const known = skills?.known ?? [];
  const own: MentionKind[] = [
    ...(repository === null || treeKey(taskId, source.workspaceId, repository) === undefined
      ? []
      : [{ from: MENTION_FROM.FILES, name: MENTION_GROUP.FILES, detail: repository }]),
    ...(taskId === NO_TASK
      ? []
      : [
          {
            from: MENTION_FROM.PLAN,
            name: MENTION_GROUP.PLAN,
            detail: counted(planSections(source.text()).length, "section", "sections"),
          },
        ]),
    ...(pages === 0
      ? []
      : [
          {
            from: MENTION_FROM.PAGES,
            name: MENTION_GROUP.PAGES,
            detail: counted(pages, "page", "pages"),
          },
        ]),
    ...(agents
      ? [
          {
            from: MENTION_FROM.AGENTS,
            name: MENTION_GROUP.AGENTS,
            detail: source.workspace || undefined,
          },
        ]
      : []),
    ...(people === 0
      ? []
      : [
          {
            from: MENTION_FROM.PEOPLE,
            name: MENTION_GROUP.PEOPLE,
            detail: counted(people, "member", "members"),
          },
        ]),
    ...(pullRequests === 0
      ? []
      : [
          {
            from: MENTION_FROM.PULL_REQUESTS,
            name: MENTION_GROUP.PULL_REQUESTS,
            detail: counted(pullRequests, "pull request", "pull requests"),
          },
        ]),
    ...(known.length === 0
      ? []
      : [
          {
            from: MENTION_FROM.SKILLS,
            name: MENTION_GROUP.SKILLS,
            detail: counted(known.length, "skill", "skills"),
          },
        ]),
  ].map(({ from, name, detail }) => ({ narrow: { from }, name, detail, keyword: from }));
  const named = new Set<IntegrationProvider>();
  const connected = servers.map(({ provider, connection, name }): MentionKind => {
    const first = !named.has(provider);
    named.add(provider);
    return {
      narrow: { from: MENTION_FROM.SERVER, connection, provider },
      name,
      detail: SERVER_DETAIL,
      keyword: first ? provider : undefined,
    };
  });
  return [...own, ...connected];
}

/**
 * The `@` list for an editor on a task's page: its rows read from the
 * plan's words as they stand and the repository's paths, placed by the word
 * in `room`, and a pick handed to `onChoose` as the mention's node; a list
 * that never opens where there is no task to offer.
 */
export function useMentionPicker({
  source,
  self,
  skills,
  servers = NO_SERVERS,
  room,
  side,
  onChoose,
}: {
  source: MentionSource | undefined;
  /** The agent whose box the list stands in, which it does not offer; none for the plan's own words. */
  self?: string | undefined;
  /** The repository's skills, where the words go to an agent; none for the plan's own words. */
  skills?: MentionSkills | undefined;
  /** The account's connected MCP servers, where the words go to an agent; none for the plan's own words. */
  servers?: readonly NamedServer[];
  /** The element the list is placed in, by the word. */
  room: RefObject<HTMLElement | null>;
  side: MentionMenuSide;
  onChoose: (mention: MentionNode) => void;
}): MentionPicker {
  const { act } = useAct();
  const { members, readerId } = useMemberDirectory();
  const [trigger, setTrigger] = useState<ComposerTrigger | undefined>(undefined);
  const [highlight, setHighlight] = useState<Highlight | undefined>(undefined);
  const [closedAt, setClosedAt] = useState<number | undefined>(undefined);
  const [narrowing, setNarrowing] = useState<Held | undefined>(undefined);
  const [paths, setPaths] = useState<{
    planId: string;
    workspaceId: string | undefined;
    repository: string | null;
    paths: readonly RepositoryPath[];
  }>();

  const taskId = source?.taskId ?? NO_TASK;
  const workspaceId = source?.workspaceId;
  const repository = source?.repository ?? null;
  const place: MentionPlace = { workspace: source?.workspace ?? "", repository };
  const open = source !== undefined && trigger !== undefined && closedAt !== trigger.start;
  // A word closed with Escape stays closed only while the caret is in it.
  const inWord = trigger !== undefined;
  // So does a narrowing a key made.
  useEffect(() => {
    if (inWord) return;
    setClosedAt(undefined);
    setNarrowing(undefined);
  }, [inWord]);

  // The repository's paths are read the first time the list opens on the task, and again once its repository changes.
  const read =
    paths?.planId === taskId && paths.workspaceId === workspaceId && paths.repository === repository
      ? paths.paths
      : undefined;
  useEffect(() => {
    if (!open || read !== undefined) return;
    const key = treeKey(taskId, workspaceId, repository);
    if (key === undefined) return;
    let live = true;
    act(ACT_KIND.TASKS_TREE, { ...key, path: "", recursive: true }).then(
      (answer) => {
        if (!live) return;
        const entries = "folder" in answer ? answer.folder.entries : [];
        setPaths({
          planId: taskId,
          workspaceId,
          repository,
          paths: entries.map((entry) => ({
            path: entry.name,
            folder: entry.kind === TASK_TREE_ENTRY.FOLDER,
          })),
        });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [open, read, act, taskId, workspaceId, repository]);

  // The skills are asked for as each `@` word opens the list, as the `/` list asks for them; a read
  // that answered is kept, and one that failed is asked again by the next word.
  const askSkills = skills?.ask;
  const askedAt = open ? trigger.start : undefined;
  useEffect(() => {
    if (askedAt !== undefined) askSkills?.();
  }, [askedAt, askSkills]);

  // The list is narrowed to the kind a key opened or whose word was typed, and searched by the words after it.
  const kinds = open ? kindsOf(source, self, skills, servers, members?.length ?? 0) : [];
  const scope = open ? scopeOf(trigger, narrowing, kinds) : undefined;
  const term = scope?.term ?? "";

  // The workspace's newest agents are read as each `@` word opens the list, and once a word is
  // typed the service finds those it names, archived ones among them, however many the workspace
  // holds; each read is kept while its word stands, and the last one shown until the next lands.
  const readAgents = source?.readAgents;
  const wordAt = open ? trigger.start : undefined;
  const words = open && term.trim() !== "" ? term.trim() : undefined;
  const [workspaceAgents, setWorkspaceAgents] = useState<{
    readonly reader: MentionAgentsReader;
    readonly wordAt: number;
    readonly words: string | undefined;
    readonly agents: readonly MentionableAgent[];
  }>();
  const agentsRead =
    workspaceAgents?.reader === readAgents && workspaceAgents?.wordAt === wordAt
      ? workspaceAgents
      : undefined;
  const wantsAgents = agentsRead === undefined || agentsRead.words !== words;
  useEffect(() => {
    if (!wantsAgents || readAgents === undefined || wordAt === undefined) return;
    let live = true;
    readAgents(words).then((agents) => {
      if (live) setWorkspaceAgents({ reader: readAgents, wordAt, words, agents });
    });
    return () => {
      live = false;
    };
  }, [wantsAgents, words, readAgents, wordAt]);

  // Each server's tools are read while the list stands open, and forgotten once it closes.
  const tools = useIntegrationTools(
    (open ? servers : NO_SERVERS).map((server) => server.connection),
  );
  const narrow = scope?.kind?.narrow;
  const groups =
    scope === undefined || source === undefined
      ? []
      : groupsFor(
          scope,
          read,
          {
            plan: taskRows(taskId, source.taskName, source.text()),
            pages: pageRows(taskId, source.pages ?? NO_PAGES),
            agents: agentRows(
              taskId,
              source.agents ?? NO_AGENTS,
              agentsRead?.agents ?? NO_AGENTS,
              self,
              term,
            ),
            people: personRows(members ?? NO_MEMBERS, readerId),
            pullRequests: pullRequestRows(taskId, source.pullRequests ?? NO_PULL_REQUESTS),
            skills: skillRows(skills?.known ?? []),
            // A list narrowed to one server offers its tools before a word is typed.
            servers:
              narrow?.from === MENTION_FROM.SERVER
                ? serverRows(
                    servers.filter((server) => server.connection === narrow.connection),
                    tools,
                    true,
                  )
                : serverRows(servers, tools, term.trim() !== ""),
          },
          kinds,
        );
  const rows = groups.flatMap((group) => group.rows);
  // Words typed past a space that match nothing are prose, not a mention: the list stands aside, and comes back only if they match again.
  const shown = open && (rows.length > 0 || !/\s/u.test(term.trim()));
  const held =
    highlight !== undefined &&
    trigger !== undefined &&
    highlight.start === trigger.start &&
    highlight.query === trigger.query
      ? highlight.at
      : 0;
  const at = Math.min(held, Math.max(rows.length - 1, 0));
  // The list narrowed or widened by a key starts again at its first row.
  const narrowTo = (next: Held | undefined) => {
    if (trigger === undefined) return;
    setNarrowing(next);
    setHighlight({ start: trigger.start, query: trigger.query, at: 0 });
  };
  // A kind's row narrows the list to it; a folder's walks into it, narrowing a wide list to files and folders.
  const openRow = (row: MentionRow) => {
    if (trigger === undefined || scope === undefined) return;
    const { start, query } = trigger;
    if ("from" in row) {
      narrowTo({ start, narrow: row.from.narrow, entry: query, typed: false, walked: [] });
      return;
    }
    if (!("mention" in row) || row.mention.kind !== MENTION_KIND.FOLDER) return;
    const within = scope.kind?.narrow.from === MENTION_FROM.FILES;
    const walked = { path: row.mention.path, entry: query };
    narrowTo({
      start,
      narrow: { from: MENTION_FROM.FILES },
      entry: within ? scope.entry : query,
      typed: within && scope.typed,
      walked: within ? [...scope.walked, walked] : [walked],
    });
  };
  const backTo = trigger === undefined ? undefined : backFrom(scope, trigger.start);
  const back = backTo === undefined ? undefined : () => narrowTo(backTo.to);
  // A skill is written as the `/name` chip its own list writes; a kind's row opens; anything else is written as its mention.
  const choose = (row: MentionRow) => {
    if ("from" in row) openRow(row);
    else if ("skill" in row) skills?.onChoose(row.skill);
    else onChoose({ name: row.name, target: encodeMention(row.mention, place) });
  };

  // ↑, ↓, Home, End, Enter and Escape steer the list as any combobox's do;
  // ⌘Enter writes the highlighted row as a bare Enter does.
  const field = useComboboxField({
    open: shown,
    active: at,
    count: rows.length,
    controls: undefined,
    activeId: undefined,
    onActiveChange: (index) => {
      if (trigger !== undefined)
        setHighlight({ start: trigger.start, query: trigger.query, at: index });
    },
    onChoose: (index) => {
      const row = rows[index];
      if (row !== undefined) choose(row);
    },
    onEnter: () => {
      const row = rows[at];
      if (row !== undefined) choose(row);
    },
    onEscape: () => {
      if (trigger !== undefined) setClosedAt(trigger.start);
    },
  });

  // The list's own keys come first: ⌫ widens, → opens, Tab writes, and a
  // Shift+Enter is the editor's line break, as a modified Home or End is
  // its own; with no row only Escape is the list's.
  const onKey = (event: KeyboardEvent): boolean => {
    if (!shown) return false;
    const bare = !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey;
    if (event.key === "Backspace" && bare && term === "" && back !== undefined) {
      back();
      return true;
    }
    if (event.key === "Escape") return field.onKeyDown(event);
    const row = rows[at];
    if (row === undefined) return false;
    if (event.key === "ArrowRight" && bare && opens(row)) {
      openRow(row);
      return true;
    }
    if (event.key === "Tab") {
      choose(row);
      return true;
    }
    if (event.key === "Enter" && event.shiftKey) return false;
    // A Home or End held with a modifier selects or travels in the editor's words.
    if ((event.key === "Home" || event.key === "End") && !bare) return false;
    return field.onKeyDown(event);
  };

  // The foot names the keys the list hears now: → where a row opens, ⌫ where the list is narrowed.
  const keys = [
    MENU_KEY.MOVE,
    MENU_KEY.MENTION,
    ...(rows.some(opens) ? [MENU_KEY.OPEN] : []),
    ...(scope?.kind === undefined ? [] : [scope.walked.length > 0 ? MENU_KEY.UP : MENU_KEY.WIDEN]),
    MENU_KEY.CLOSE,
  ];

  // The list stands by the word's line, on the side asked, inside the room's width.
  const box = room.current;
  const placed = box?.getBoundingClientRect();
  const placeOf = (word: ComposerTrigger, at: DOMRect, width: number): MenuPlace => {
    const left = Math.max(0, Math.min(word.rect.left - at.left, width - MENU_WIDTH));
    return side === MENTION_MENU_SIDE.BELOW
      ? { left, top: word.rect.bottom - at.top + MENU_GAP }
      : { left, top: "auto", bottom: at.bottom - word.rect.top + MENU_GAP };
  };
  const menu =
    !shown || box === null || placed === undefined ? null : (
      <MentionMenu
        crumb={
          scope?.kind === undefined
            ? undefined
            : { kind: scope.kind, folder: scope.walked.at(-1)?.path, back }
        }
        groups={groups}
        at={at}
        keys={keys}
        place={placeOf(trigger, placed, box.clientWidth)}
        onHover={(index) => setHighlight({ start: trigger.start, query: trigger.query, at: index })}
        onChoose={choose}
      />
    );

  return { menu, onTrigger: setTrigger, onKey };
}
