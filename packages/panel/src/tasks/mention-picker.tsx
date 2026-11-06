import { useAtom } from "@effect/atom-react";
import { INBOX_SCOPE_KIND } from "@repo/features/agent-view";
import type { AgentPullRequest, AgentSummary, TasklessAgent } from "@repo/features/agent-wire";
import { automationTriggerText } from "@repo/features/automation-list-model";
import type { AutomationSummary } from "@repo/features/automation-wire";
import {
  type DateSpan,
  dateChipText,
  dateLabel,
  dateOfWords,
  readerZone,
  suggestedDates,
} from "@repo/features/date-mention";
import type { InboxItem } from "@repo/features/inbox-wire";
import { INTEGRATION_PROVIDER, type IntegrationProvider } from "@repo/features/integration-wire";
import { LINK_PLACE, type LinkPlace, linkOf } from "@repo/features/link-grammar";
import {
  encodeMention,
  isMentionableTool,
  MENTION_KIND,
  type Mention,
  type MentionPlace,
  sectionAnchors,
} from "@repo/features/mention-link";
import { agentName } from "@repo/features/model-label";
import type { PageLine } from "@repo/features/page-wire";
import { descriptionSections } from "@repo/features/description-document";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { TASK_TREE_ENTRY, type TaskSummary } from "@repo/features/task-wire";
import { thingOfMention } from "@repo/features/thing-kind";
import {
  countWords,
  INTEGRATION_LABEL,
  noMatchWords,
  readFailedWords,
  TERM,
} from "@repo/features/words";
import { namesTaskKey, taskKey } from "@repo/features/workspace-key";
import {
  type Workspace,
  type WorkspaceMember,
  workspaceOfSlug,
} from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppInboxItems, AppStateSnapshot } from "@repo/host/app-state";
import { EXPERIMENT } from "@repo/settings";
import { SHORTCUT_KEY } from "@repo/settings/shortcuts";
import {
  BackButton,
  type ComboboxGroup,
  ComboboxList,
  comboboxOptionId,
  DocumentIcon,
  ErrorState,
  KeepFocus,
  MENU_SURFACE_INSET,
  MenuGlyph,
  type MenuKey,
  MenuKeys,
  type MenuRow,
  MenuSurface,
  menuKey,
  NO_BACK_KEY,
  POPOVER_WIDTH,
  ProviderMark,
  RectFloat,
  Spinner,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
  Time,
  UserIcon,
  useComboboxField,
  useMinute,
} from "@repo/ui";
import { type Actor, APP_ACTOR } from "@repo/ui/actor-model";
import type { NamedServer } from "@repo/ui/agent-servers-model";
import { GLYPH } from "@repo/ui/icons";
import { hitRangesIn, LOOSE_FROM, type SearchSubject, searchHit } from "@repo/ui/search-score";
import { searchTokens } from "@repo/ui/search-tokens";
import { type SkillOption, skillWord } from "@repo/ui/skill-mention";
import { pullRequestLabelOf } from "@repo/ui/tab-strip-model";
import {
  queryOptions,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Duration, Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import {
  AppWindowIcon,
  BookOpenIcon,
  CalendarIcon,
  FolderIcon,
  GitPullRequestIcon,
  HashIcon,
  UsersIcon,
} from "lucide-react";
import { type RefObject, useEffect, useId, useMemo, useState } from "react";
import { askAct } from "../act.js";
import { ACTOR_SIZE, ActorMark, AutomationCard, actorCard, automationActor } from "../actor-ref.js";
import { useAutomations } from "../desktop/use-automations.js";
import { unreadShown } from "../failure-report.js";
import { type IntegrationToolsReads, useIntegrationTools } from "../integration-tools.js";
import { inboxItemsQuery, inboxItemsRetryMutation } from "../live-reads.js";
import { useMemberDirectory } from "../member-directory.js";
import { memberRows, YOU_WORD } from "../member-rows.js";
import {
  type ComposerTrigger,
  type EditorAria,
  listAria,
  type MentionNode,
} from "../description-editor/contract.js";
import { QUERY_ROOT } from "../query-keys.js";
import { rendererRuntime } from "../renderer-runtime.js";
import { Highlighted } from "../search-field.js";
import { appStateQuery, selectExperiment } from "../use-app-state.js";
import { type AgentRowPlace, agentMenuRow, useAgentRowPlace } from "./agent-menu-row.js";
import { SERVER_PAGE_HEAD_CLASS } from "./agent-servers.js";
import {
  DATE_PICKER_CLOSE,
  type DatePicked,
  type DatePickerOpening,
  dateMentionNode,
  useDatePicker,
} from "./date-picker.js";
import { fileFolder, fileName } from "./file-ref-model.js";
import { FileTypeIcon } from "./file-type-icon.js";
import { InboxItemChipCard } from "./inbox-item-chip.js";
import { inboxItemGlyph } from "./inbox-item-parts.js";
import { holderTaskId, type MentionHolder } from "./mention-holder.js";
import { PageCard } from "./page-card.js";
import { PullRequestMark } from "./pull-request-mark.js";
import { skillOption } from "./skill-ref.js";
import { AgentMark, PlanGlyph } from "./tab-look.js";
import { thingCard } from "./thing-card.js";
import { useTaskStatus } from "./use-known-names.js";

const MENTION_GROUP = {
  DATES: "Dates",
  AGENTS: "Agents",
  TASKS: "Tasks",
  PEOPLE: "People",
  DESCRIPTION: "Description",
  PAGES: "Pages",
  FILES: "Files and folders",
  THREADS: "Threads",
  AUTOMATIONS: "Automations",
  PULL_REQUESTS: "Pull requests",
  SKILLS: "Skills",
  SERVERS: INTEGRATION_LABEL.many,
  FROM: "Mention from",
} as const;

const MENTION_FROM = {
  FILES: "files",
  DESCRIPTION: "description",
  TASKS: "tasks",
  PAGES: "pages",
  AGENTS: "agents",
  PEOPLE: "people",
  THREADS: "threads",
  AUTOMATIONS: "automations",
  PULL_REQUESTS: "prs",
  SKILLS: "skills",
  DATES: "dates",
  SERVER: "server",
} as const;

type MentionFrom = (typeof MENTION_FROM)[keyof typeof MENTION_FROM];

const MENTION_FROM_ALIAS: ReadonlyMap<string, MentionFrom> = new Map([
  ["plan", MENTION_FROM.DESCRIPTION],
]);

type Narrow =
  | { readonly from: Exclude<MentionFrom, typeof MENTION_FROM.SERVER> }
  | {
      readonly from: typeof MENTION_FROM.SERVER;
      readonly connection: string;
      readonly provider: IntegrationProvider;
    };

interface MentionKind {
  readonly narrow: Narrow;
  readonly name: string;
  readonly detail: string | undefined;
  readonly keyword: string | undefined;
}

interface Closed {
  readonly start: number;
}

function versionWords(version: number): string {
  return `Version ${version}`;
}

const PULL_REQUEST_DETAIL = "Pull request";

const PICK_DATE_ROW: MentionRow = {
  picksDate: true,
  name: "Pick a date",
  detail: undefined,
  terms: "Pick a date",
};

const PICK_DATE_KEY = "pick-date";

const SKILL_DETAIL = "Skill";

const SERVER_DETAIL = INTEGRATION_LABEL.one;

const TOOL_DETAIL = "Tool";

const TOOL_JOIN = " · ";

const THREAD_NOUN = { one: "thread", many: "threads" } as const;

const AUTOMATION_NOUN = { one: "automation", many: "automations" } as const;

export interface MentionSkills {
  readonly known: readonly SkillOption[] | undefined;
  readonly unread: boolean;
  readonly ask: () => void;
  readonly onChoose: (name: string) => void;
}

const NO_SERVERS: readonly NamedServer[] = [];

const PER_GROUP = 4;

const PER_KIND = 50;

const SEARCH_PAUSE = Duration.millis(250);

const NO_TASKLESS_AGENTS: readonly TasklessAgent[] = [];

interface ListedTasks {
  readonly tasks: readonly TaskSummary[];
  readonly workspaces: readonly Workspace[];
  readonly tasklessAgents: readonly TasklessAgent[];
}

const NO_LISTED_TASKS: ListedTasks = {
  tasks: [],
  workspaces: [],
  tasklessAgents: NO_TASKLESS_AGENTS,
};

const selectListedTasks = (state: AppStateSnapshot): ListedTasks => ({
  tasks: state.tasks.tasks,
  workspaces: state.tasks.workspaces,
  tasklessAgents: state.tasks.tasklessAgents ?? NO_TASKLESS_AGENTS,
});

const MENU_LABEL = "Mention";

const NO_MATCH = noMatchWords(TERM.RESULT);

const MENU_KEY = {
  MOVE: menuKey("Move", SHORTCUT_KEY.UP, SHORTCUT_KEY.DOWN),
  MENTION: menuKey("Mention", SHORTCUT_KEY.ENTER, SHORTCUT_KEY.TAB),
  OPEN: menuKey("Open", SHORTCUT_KEY.RIGHT),
  WIDEN: menuKey("All kinds", SHORTCUT_KEY.BACKSPACE),
  UP: menuKey("Up", SHORTCUT_KEY.BACKSPACE),
  CLOSE: menuKey("Close", SHORTCUT_KEY.ESCAPE),
} as const satisfies Record<string, MenuKey>;

const BACK_LABEL = {
  WIDEN: "All kinds",
  UP: "Up",
} as const;

const BACK_PLACE = {
  WIDEN: "all kinds",
  UP: "the folder above",
} as const;

type MentionRow = {
  readonly name: string;
  readonly detail: React.ReactNode;
  readonly written?: string | undefined;
  readonly terms: string;
  readonly key?: string | undefined;
  readonly actor?: Actor | undefined;
  readonly look?: Pick<MenuRow, "icon" | "end" | "card"> | undefined;
  readonly card?: React.ReactNode | undefined;
  readonly pullRequest?: MentionablePullRequest | undefined;
} & (
  | { readonly mention: Mention }
  | { readonly thread: ThreadPlace; readonly item: InboxItem }
  | { readonly automation: AutomationSummary }
  | { readonly skill: string }
  | { readonly from: MentionKind }
  | { readonly picksDate: true }
);

type ThreadPlace = Extract<LinkPlace, { readonly kind: typeof LINK_PLACE.INBOX_ITEM }>;

interface MentionGroup {
  readonly label: string;
  readonly rows: readonly MentionRow[];
}

interface RepositoryPath {
  readonly path: string;
  readonly folder: boolean;
}

interface Highlight {
  readonly start: number;
  readonly query: string;
  readonly at: number;
}

interface Walked {
  readonly path: string;
  readonly entry: string;
}

interface Held {
  readonly start: number;
  readonly narrow: Narrow;
  readonly entry: string;
  readonly typed: boolean;
  readonly walked: readonly Walked[];
}

interface Scope {
  readonly kind: MentionKind | undefined;
  readonly entry: string;
  readonly typed: boolean;
  readonly walked: readonly Walked[];
  readonly term: string;
}

function sameNarrow(first: Narrow, second: Narrow): boolean {
  if (first.from !== MENTION_FROM.SERVER || second.from !== MENTION_FROM.SERVER) {
    return first.from === second.from;
  }
  return first.connection === second.connection;
}

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
  const typedWord = typed?.[1]?.toLowerCase();
  const word =
    typedWord === undefined ? undefined : (MENTION_FROM_ALIAS.get(typedWord) ?? typedWord);
  const kind = word === undefined ? undefined : kinds.find((each) => each.keyword === word);
  if (typed === null || kind === undefined) {
    return { kind: undefined, entry: "", typed: false, walked: [], term: query };
  }
  return { kind, entry: typed[0], typed: true, walked: [], term: query.slice(typed[0].length) };
}

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

function sectionCount(count: number): string | undefined {
  return count === 0 ? undefined : countWords(count, TERM.SECTION);
}

function opens(row: MentionRow): boolean {
  return "from" in row || ("mention" in row && row.mention.kind === MENTION_KIND.FOLDER);
}

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

function taskRows(
  taskId: string | undefined,
  taskName: string,
  key: string | undefined,
  text: string,
): MentionRow[] {
  if (taskId === undefined) return [];
  const headings = descriptionSections(text).map((section) => section.heading);
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
      detail: "The whole description",
      terms: key === undefined ? taskName : `${key} ${taskName}`,
      key,
    },
  ];
}

function pageRows(
  holder: MentionHolder | undefined,
  pages: readonly MentionablePage[],
  now: number,
): MentionRow[] {
  if (holder === undefined) return [];
  return pages.map((page) => ({
    mention:
      "taskId" in holder
        ? { kind: MENTION_KIND.PAGE, taskId: holder.taskId, pageId: page.id }
        : { kind: MENTION_KIND.PAGE, agentId: holder.agentId, pageId: page.id },
    name: page.title,
    detail:
      page.version > 1 ? versionWords(page.version) : <Time at={page.at} now={now} hint={false} />,
    terms: page.title,
    card: <PageCard place={holder} page={page} />,
  }));
}

function workspaceTaskRows(
  taskId: string | undefined,
  workspace: Workspace | undefined,
  tasks: readonly TaskSummary[],
): MentionRow[] {
  if (workspace === undefined) return [];
  return tasks.flatMap((task): MentionRow[] => {
    if (task.id === taskId || task.workspaceId !== workspace.id) return [];
    const key = task.number === undefined ? undefined : taskKey(workspace.name, task.number);
    return [
      {
        mention: { kind: MENTION_KIND.TASK, taskId: task.id },
        name: task.name,
        detail: key,
        terms: key === undefined ? task.name : `${key} ${task.name}`,
        key,
      },
    ];
  });
}

function agentRows(
  taskId: string | undefined,
  own: readonly MentionableAgent[],
  workspace: readonly MentionableAgent[],
  self: string | undefined,
  query: string,
  place: AgentRowPlace,
): MentionRow[] {
  const seen = new Set<string>(self === undefined ? [] : [self]);
  const typed = query.trim() !== "";
  const mine = taskId === undefined ? [] : own.map((agent) => ({ ...agent, task: { id: taskId } }));
  const rows: MentionRow[] = [];
  for (const agent of [...mine, ...workspace]) {
    if (seen.has(agent.id) || (agent.archived === true && !typed)) continue;
    seen.add(agent.id);
    const row = agentMenuRow(agent, place);
    rows.push({
      mention: { kind: MENTION_KIND.AGENT, agentId: agent.id },
      name: row.label,
      detail: row.detail,
      terms: (row.terms ?? [row.label]).join(" "),
      look: { icon: row.icon, end: row.end, card: row.card },
    });
  }
  return rows;
}

function directoryPeople(
  members: readonly WorkspaceMember[],
  readerId: string | undefined,
): readonly MentionablePerson[] {
  return memberRows(members, readerId).map((row) => ({
    userId: row.member.userId,
    name: row.label,
    email: row.member.email,
    actor: row.actor,
  }));
}

function personRows(
  people: readonly MentionablePerson[],
  readerId: string | undefined,
): MentionRow[] {
  return people.map((person) => ({
    mention: { kind: MENTION_KIND.PERSON, userId: person.userId },
    name: person.name,
    detail: person.userId === readerId ? YOU_WORD : person.email,
    terms: `${person.name} ${person.email ?? ""}`,
    actor: person.actor,
    card: actorCard(person.actor),
  }));
}

function threadRow(place: ThreadPlace, item: InboxItem, holder: string): MentionRow {
  return {
    thread: place,
    item,
    name: item.title,
    detail: holder,
    terms: `${item.title} ${holder}`,
    card: <InboxItemChipCard place={place} fallback={null} />,
  };
}

function threadRows(
  feed: AppInboxItems | undefined,
  taskId: string | undefined,
  workspace: Workspace | undefined,
  tasks: readonly TaskSummary[],
  agents: readonly TasklessAgent[],
): MentionRow[] {
  if (feed === undefined || workspace === undefined) return [];
  const held: { readonly row: MentionRow; readonly own: boolean; readonly at: number }[] = [];
  for (const [planId, items] of Object.entries(feed[INBOX_SCOPE_KIND.PLAN])) {
    const task = tasks.find((each) => each.id === planId && each.workspaceId === workspace.id);
    if (task === undefined) continue;
    for (const item of items) {
      const place: ThreadPlace = { kind: LINK_PLACE.INBOX_ITEM, planId, itemId: item.id };
      held.push({
        row: threadRow(place, item, task.name),
        own: planId === taskId,
        at: item.updatedAt,
      });
    }
  }
  for (const [agentId, items] of Object.entries(feed[INBOX_SCOPE_KIND.AGENT])) {
    const agent = agents.find((each) => each.id === agentId && each.workspaceId === workspace.id);
    if (agent === undefined) continue;
    for (const item of items) {
      const place: ThreadPlace = { kind: LINK_PLACE.INBOX_ITEM, agentId, itemId: item.id };
      held.push({ row: threadRow(place, item, agentName(agent)), own: false, at: item.updatedAt });
    }
  }
  return held
    .sort((first, second) => Number(second.own) - Number(first.own) || second.at - first.at)
    .map((each) => each.row);
}

function automationRows(
  automations: readonly AutomationSummary[],
  workspace: Workspace | undefined,
): MentionRow[] {
  return automations.map((automation) => {
    const fires = automationTriggerText(automation.trigger, automation.repositories ?? []);
    return {
      automation,
      name: automation.name,
      detail: fires,
      terms: `${automation.name} ${fires}`,
      card: <AutomationCard automation={automation} workspaceName={workspace?.name} />,
    };
  });
}

function pullRequestRows(pullRequests: readonly MentionablePullRequest[]): MentionRow[] {
  return pullRequests.map((pullRequest) => {
    const name = pullRequestLabelOf(pullRequest);
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

function serverRows(
  servers: readonly NamedServer[],
  reads: IntegrationToolsReads,
  withTools: boolean,
): MentionRow[] {
  return servers.flatMap(({ provider, connection, name }) => {
    const account = connection === provider ? undefined : { connection };
    const server: MentionRow = {
      mention: { kind: MENTION_KIND.SERVER, provider, ...account },
      name,
      detail: SERVER_DETAIL,
      terms: name,
    };
    const read = reads[connection];
    if (!withTools || read === undefined || !("tools" in read)) return [server];
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

function dateRow(date: DateSpan, now: number, zone: string): MentionRow {
  const written = dateLabel(date, zone);
  return {
    mention: { kind: MENTION_KIND.DATE, ...date },
    name: dateChipText(date, now, zone),
    detail: written,
    written,
    terms: written,
  };
}

function dateRows(term: string, narrowed: boolean, now: number, zone: string): MentionRow[] {
  const pick = narrowed ? [PICK_DATE_ROW] : [];
  if (term.trim() === "") {
    return narrowed
      ? [...suggestedDates(now, zone).map((date) => dateRow(date, now, zone)), ...pick]
      : [];
  }
  const date = dateOfWords(term, now, zone);
  return [...(date === undefined ? [] : [dateRow(date, now, zone)]), ...pick];
}

function skillRows(skills: readonly SkillOption[]): MentionRow[] {
  return skills.map((skill) => {
    const option = skillOption(skill);
    return {
      skill: skill.name,
      name: skillWord(skill.name),
      detail: skill.description === "" ? SKILL_DETAIL : skill.description,
      terms: `${skill.name} ${skill.description}`,
      look: { icon: option.icon, end: option.hint, card: option.card },
    };
  });
}

function keyed(row: MentionRow, query: string): boolean {
  return row.key !== undefined && namesTaskKey(query, row.key);
}

function isPath(row: MentionRow): boolean {
  return (
    "mention" in row &&
    (row.mention.kind === MENTION_KIND.FILE || row.mention.kind === MENTION_KIND.FOLDER)
  );
}

function rowSubject(row: MentionRow): SearchSubject {
  return {
    label: row.name,
    lines: row.terms === row.name ? [] : [row.terms],
    key: row.key,
    loose: isPath(row),
  };
}

function rowScore(row: MentionRow, query: string): number {
  return searchHit(rowSubject(row), query)?.score ?? 0;
}

function best(rows: readonly MentionRow[], query: string, most: number): readonly MentionRow[] {
  if (query.trim() === "") return rows.slice(0, most);
  return rows
    .map((row) => ({ row, score: rowScore(row, query) }))
    .filter((each) => each.score > 0)
    .sort((first, second) => second.score - first.score)
    .slice(0, most)
    .map((each) => each.row);
}

interface FoundPath {
  readonly entry: RepositoryPath;
  readonly row: MentionRow;
  readonly score: number;
}

interface PathsFound {
  readonly matched: readonly FoundPath[];
  readonly ranked: readonly FoundPath[];
}

interface PathSearch {
  readonly paths: readonly RepositoryPath[];
  readonly found: (term: string) => readonly FoundPath[];
}

function pathSearch(paths: readonly RepositoryPath[]): PathSearch {
  const all = paths.map((entry) => ({ entry, row: pathRow(entry) }));
  const kept = new Map<string, PathsFound>();
  const found = (term: string): readonly FoundPath[] => {
    const known = kept.get(term);
    if (known !== undefined) return known.ranked;
    for (const word of kept.keys()) {
      if (!term.startsWith(word) && !word.startsWith(term)) kept.delete(word);
    }
    const shorter = [...kept.keys()]
      .filter((word) => term.startsWith(word) && searchTokens(word).join("").length >= LOOSE_FROM)
      .sort((first, second) => second.length - first.length)
      .at(0);
    const among = shorter === undefined ? all : (kept.get(shorter)?.matched ?? all);
    const matched = among
      .map((each) => ({ ...each, score: rowScore(each.row, term) }))
      .filter((each) => each.score > 0);
    const ranked = [...matched].sort((first, second) => second.score - first.score);
    kept.set(term, { matched, ranked });
    return ranked;
  };
  return { paths, found };
}

function foundRows(
  search: PathSearch,
  folder: string | undefined,
  term: string,
  most: number,
): readonly MentionRow[] {
  const found = search.found(term);
  const under =
    folder === undefined ? found : found.filter((each) => each.entry.path.startsWith(`${folder}/`));
  return under.slice(0, most).map((each) => each.row);
}

function fileRows(
  search: PathSearch,
  folder: string | undefined,
  term: string,
): readonly MentionRow[] {
  if (term.trim() !== "") return foundRows(search, folder, term, PER_KIND);
  const { paths } = search;
  const under =
    folder === undefined ? paths : paths.filter((entry) => entry.path.startsWith(`${folder}/`));
  const entries = under
    .filter((entry) => (fileFolder(entry.path) ?? "") === (folder ?? ""))
    .sort((first, second) => Number(second.folder) - Number(first.folder))
    .map((entry) => ({ ...pathRow(entry), detail: undefined }));
  const itself = folder === undefined ? [] : [pathRow({ path: folder, folder: true })];
  return [...itself, ...entries].slice(0, PER_KIND);
}

interface KindRows {
  readonly description: readonly MentionRow[];
  readonly tasks: readonly MentionRow[];
  readonly pages: readonly MentionRow[];
  readonly agents: readonly MentionRow[];
  readonly people: readonly MentionRow[];
  readonly threads: readonly MentionRow[];
  readonly automations: readonly MentionRow[];
  readonly pullRequests: readonly MentionRow[];
  readonly skills: readonly MentionRow[];
  readonly dates: readonly MentionRow[];
  readonly servers: readonly MentionRow[];
}

function narrowedRows(
  kind: MentionKind,
  folder: string | undefined,
  term: string,
  paths: PathSearch | undefined,
  rows: KindRows,
): readonly MentionRow[] {
  switch (kind.narrow.from) {
    case MENTION_FROM.FILES:
      return paths === undefined ? [] : fileRows(paths, folder, term);
    case MENTION_FROM.DESCRIPTION:
      return best(rows.description, term, PER_KIND);
    case MENTION_FROM.TASKS:
      return best(rows.tasks, term, PER_KIND);
    case MENTION_FROM.PAGES:
      return best(rows.pages, term, PER_KIND);
    case MENTION_FROM.AGENTS:
      return best(rows.agents, term, PER_KIND);
    case MENTION_FROM.PEOPLE:
      return best(rows.people, term, PER_KIND);
    case MENTION_FROM.THREADS:
      return best(rows.threads, term, PER_KIND);
    case MENTION_FROM.AUTOMATIONS:
      return best(rows.automations, term, PER_KIND);
    case MENTION_FROM.PULL_REQUESTS:
      return best(rows.pullRequests, term, PER_KIND);
    case MENTION_FROM.SKILLS:
      return best(rows.skills, term, PER_KIND);
    case MENTION_FROM.DATES:
      return rows.dates;
    case MENTION_FROM.SERVER:
      return best(rows.servers, term, PER_KIND);
  }
}

function kindRow(kind: MentionKind): MentionRow {
  return { from: kind, name: kind.name, detail: kind.detail, terms: kind.name };
}

function groupsFor(
  scope: Scope,
  paths: PathSearch | undefined,
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
  const files = bare || paths === undefined ? [] : foundRows(paths, undefined, term, PER_GROUP);
  const description = {
    label: MENTION_GROUP.DESCRIPTION,
    rows: best(rows.description, term, PER_GROUP),
  };
  const tasks = {
    label: MENTION_GROUP.TASKS,
    rows: bare ? [] : best(rows.tasks, term, PER_GROUP),
  };
  const keyedGroup = [description, tasks].find((group) =>
    group.rows.some((row) => keyed(row, term)),
  );
  const inbox = bare
    ? []
    : [
        { label: MENTION_GROUP.THREADS, rows: best(rows.threads, term, PER_GROUP) },
        { label: MENTION_GROUP.AUTOMATIONS, rows: best(rows.automations, term, PER_GROUP) },
      ];
  const ranked = [
    { label: MENTION_GROUP.AGENTS, rows: best(rows.agents, term, PER_GROUP) },
    tasks,
    { label: MENTION_GROUP.PEOPLE, rows: best(rows.people, term, PER_GROUP) },
    description,
    { label: MENTION_GROUP.PAGES, rows: best(rows.pages, term, PER_GROUP) },
    { label: MENTION_GROUP.FILES, rows: files },
  ].filter((group) => group !== keyedGroup);
  return [
    { label: MENTION_GROUP.DATES, rows: rows.dates },
    ...(keyedGroup === undefined ? [] : [keyedGroup]),
    ...ranked,
    ...inbox,
    { label: MENTION_GROUP.PULL_REQUESTS, rows: best(rows.pullRequests, term, PER_GROUP) },
    { label: MENTION_GROUP.SKILLS, rows: best(rows.skills, term, PER_GROUP) },
    { label: MENTION_GROUP.SERVERS, rows: best(rows.servers, term, PER_GROUP) },
    { label: MENTION_GROUP.FROM, rows: bare ? kinds.map(kindRow) : [] },
  ].filter((group) => group.rows.length > 0);
}

function KindGlyph({ kind }: { kind: MentionKind }): React.JSX.Element {
  switch (kind.narrow.from) {
    case MENTION_FROM.FILES:
      return <FolderIcon aria-hidden="true" />;
    case MENTION_FROM.DESCRIPTION:
      return <DocumentIcon />;
    case MENTION_FROM.TASKS:
      return <PlanGlyph status={undefined} />;
    case MENTION_FROM.PAGES:
      return <AppWindowIcon aria-hidden="true" />;
    case MENTION_FROM.AGENTS:
      return <AgentMark provider={undefined} />;
    case MENTION_FROM.PEOPLE:
      return <UsersIcon aria-hidden="true" />;
    case MENTION_FROM.THREADS:
      return <GLYPH.THREAD />;
    case MENTION_FROM.AUTOMATIONS:
      return <GLYPH.AUTOMATION />;
    case MENTION_FROM.PULL_REQUESTS:
      return <GitPullRequestIcon aria-hidden="true" />;
    case MENTION_FROM.SKILLS:
      return <BookOpenIcon aria-hidden="true" />;
    case MENTION_FROM.DATES:
      return <CalendarIcon aria-hidden="true" />;
    case MENTION_FROM.SERVER:
      return <ProviderMark provider={kind.narrow.provider} />;
  }
}

function RowGlyph({ row }: { row: MentionRow }): React.JSX.Element {
  const planned = "mention" in row && row.mention.kind === MENTION_KIND.TASK;
  const taskStatus = useTaskStatus(planned ? row.mention.taskId : undefined);
  if ("skill" in row) return <BookOpenIcon aria-hidden="true" />;
  if ("from" in row) return <KindGlyph kind={row.from} />;
  if ("picksDate" in row) return <CalendarIcon aria-hidden="true" />;
  if ("thread" in row) return inboxItemGlyph(row.item);
  if ("automation" in row) {
    return <ActorMark actor={automationActor(row.automation)} size={ACTOR_SIZE.INLINE} />;
  }
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
      return <PlanGlyph status={taskStatus} />;
    case MENTION_KIND.SERVER:
    case MENTION_KIND.TOOL:
      return <ProviderMark provider={mention.provider} />;
    case MENTION_KIND.LINK:
      return <ProviderMark provider={"site" in mention ? mention.site : mention.provider} />;
    case MENTION_KIND.PAGE:
      return <AppWindowIcon aria-hidden="true" />;
    case MENTION_KIND.AGENT:
      return <AgentMark provider={undefined} />;
    case MENTION_KIND.PERSON:
      return row.actor === undefined ? (
        <UserIcon />
      ) : (
        <ActorMark actor={row.actor} size={ACTOR_SIZE.INLINE} />
      );
    case MENTION_KIND.APP:
      return <ActorMark actor={APP_ACTOR} size={ACTOR_SIZE.INLINE} />;
    case MENTION_KIND.DATE:
      return <CalendarIcon aria-hidden="true" />;
  }
}

function rowKey(row: MentionRow): string {
  if ("skill" in row) return row.skill;
  if ("picksDate" in row) return PICK_DATE_KEY;
  if ("thread" in row) return JSON.stringify(row.thread);
  if ("automation" in row) return row.automation.id;
  return JSON.stringify("from" in row ? row.from.narrow : row.mention);
}

type RowCardOf = (row: MentionRow) => React.ReactNode;

function markedWords(
  row: MentionRow,
  query: string,
): { readonly label: React.ReactNode; readonly detail: React.ReactNode } {
  const subject = rowSubject(row);
  const hit = searchHit(subject, query);
  if (hit === undefined) return { label: row.name, detail: row.detail };
  return {
    label: <Highlighted text={row.name} ranges={hit.label} />,
    detail:
      typeof row.detail === "string" ? (
        <Highlighted text={row.detail} ranges={hitRangesIn(row.detail, subject, hit)} />
      ) : (
        row.detail
      ),
  };
}

function comboboxGroups(
  groups: readonly MentionGroup[],
  query: string,
  rowCard: RowCardOf,
): ComboboxGroup[] {
  return groups.map((group) => ({
    label: group.label,
    options: group.rows.map((row) => ({
      id: rowKey(row),
      ...markedWords(row, query),
      words: row.name,
      icon: row.look?.icon ?? <RowGlyph row={row} />,
      hint: row.look?.end,
      card: row.look?.card ?? row.card ?? rowCard(row),
      opens: "from" in row,
    })),
  }));
}

interface Crumb {
  readonly kind: MentionKind;
  readonly folder: string | undefined;
  readonly back: (() => void) | undefined;
}

function MentionCrumb({ crumb }: { crumb: Crumb }): React.JSX.Element {
  const { kind, folder, back } = crumb;
  return (
    <KeepFocus className={`${SERVER_PAGE_HEAD_CLASS} mention-menu-crumb [--ui-fold:folded]`}>
      {back === undefined ? null : (
        <BackButton
          label={folder === undefined ? BACK_LABEL.WIDEN : BACK_LABEL.UP}
          place={folder === undefined ? BACK_PLACE.WIDEN : BACK_PLACE.UP}
          command={NO_BACK_KEY}
          tabbable={false}
          onBack={back}
        />
      )}
      <MenuGlyph>
        {folder === undefined ? <KindGlyph kind={kind} /> : <FolderIcon aria-hidden="true" />}
      </MenuGlyph>
      <Text
        as={TEXT_ELEMENT.SPAN}
        variant={TEXT_VARIANT.SECTION}
        truncate
        className="mention-menu-crumb-title"
      >
        {folder ?? kind.name}
      </Text>
    </KeepFocus>
  );
}

const MENTION_READ = {
  MEMBERS: "members",
  AGENTS: "agents",
  FILES: "the repository's files",
  SKILLS: "skills",
  THREADS: "Inbox threads",
  AUTOMATIONS: "automations",
} as const;

type MentionRead = (typeof MENTION_READ)[keyof typeof MENTION_READ];

interface MentionReadFailure {
  readonly read: MentionRead;
  readonly retry: () => void;
}

function MentionMenu({
  id,
  crumb,
  groups,
  query,
  at,
  keys,
  reading,
  failures,
  rowCard,
  onHover,
  onChoose,
}: {
  id: string;
  crumb: Crumb | undefined;
  groups: readonly MentionGroup[];
  query: string;
  at: number;
  keys: readonly MenuKey[];
  reading: boolean;
  failures: readonly MentionReadFailure[];
  rowCard: RowCardOf;
  onHover: (index: number) => void;
  onChoose: (row: MentionRow) => void;
}): React.JSX.Element {
  const rows = groups.flatMap((group) => group.rows);
  const noted = reading || failures.length > 0;
  return (
    <MenuSurface className="mention-menu" inset={MENU_SURFACE_INSET.NONE}>
      {crumb === undefined ? null : <MentionCrumb crumb={crumb} />}
      <ComboboxList
        id={id}
        label={MENU_LABEL}
        groups={comboboxGroups(groups, query, rowCard)}
        active={at}
        onActiveChange={onHover}
        onChoose={(index) => {
          const row = rows[index];
          if (row !== undefined) onChoose(row);
        }}
        headed={crumb === undefined}
        empty={noted ? undefined : NO_MATCH}
        note={
          noted ? (
            <>
              {reading ? <Spinner delay label="Reading" /> : null}
              {failures.map((failure) => (
                <ErrorState
                  failure={unreadShown(FAILURE_SURFACE.MENTIONS_READ)}
                  key={failure.read}
                  onRetry={failure.retry}
                >
                  {readFailedWords(failure.read)}
                </ErrorState>
              ))}
            </>
          ) : undefined
        }
      />
      <MenuKeys keys={keys} />
    </MenuSurface>
  );
}

export interface MentionPicker {
  readonly menu: React.ReactNode;
  readonly aria: EditorAria;
  readonly onTrigger: (trigger: ComposerTrigger | undefined) => void;
  readonly onKey: (event: KeyboardEvent) => boolean;
  readonly pickDate: (opening: DatePickerOpening) => void;
}

export const MENTION_MENU_SIDE = {
  BELOW: "below",
  ABOVE: "above",
} as const;

export type MentionMenuSide = (typeof MENTION_MENU_SIDE)[keyof typeof MENTION_MENU_SIDE];

export function wordBox(word: ComposerTrigger): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  const { left, top, bottom } = word.rect;
  return { left, top, right: left, bottom };
}

export type MentionablePage = PageLine;

export interface MentionableAgent {
  readonly id: string;
  readonly name: string;
  readonly actor: Actor;
  readonly task?: { readonly id: string; readonly name?: string | undefined } | undefined;
  readonly archived?: boolean | undefined;
  readonly summary?: AgentSummary | undefined;
}

interface MentionablePerson {
  readonly userId: string;
  readonly name: string;
  readonly email: string | undefined;
  readonly actor: Actor;
}

export interface MentionablePullRequest
  extends Pick<AgentPullRequest, "number" | "title" | "url" | "state" | "checks" | "queued"> {
  readonly agent: string | undefined;
}

export type MentionAgentsReader = (
  words: string | undefined,
) => Promise<readonly MentionableAgent[]>;

const NO_PAGES: readonly MentionablePage[] = [];
const NO_AGENTS: readonly MentionableAgent[] = [];
const NO_PULL_REQUESTS: readonly MentionablePullRequest[] = [];

export interface MentionSource {
  readonly holder: MentionHolder | undefined;
  readonly taskName: string;
  readonly workspace: string;
  readonly repository: string | null;
  readonly workspaceId?: string | undefined;
  readonly text: () => string;
  readonly pages?: readonly MentionablePage[] | undefined;
  readonly agents?: readonly MentionableAgent[] | undefined;
  readonly readAgents?: MentionAgentsReader | undefined;
  readonly pullRequests?: readonly MentionablePullRequest[] | undefined;
}

function treeKey(
  taskId: string | undefined,
  workspaceId: string | undefined,
  repository: string | null,
): { planId: string } | { workspaceId: string; repository: string } | undefined {
  if (taskId !== undefined) return { planId: taskId };
  if (workspaceId === undefined || repository === null) return undefined;
  return { workspaceId, repository };
}

type TreeKey = NonNullable<ReturnType<typeof treeKey>>;

async function repositoryPaths(key: TreeKey): Promise<readonly RepositoryPath[]> {
  const answer = await askAct(ACT_KIND.TASKS_TREE, { ...key, path: "", recursive: true });
  if (!("folder" in answer)) throw new Error("The repository's paths were not read.");
  return answer.folder.entries.map((entry) => ({
    path: entry.name,
    folder: entry.kind === TASK_TREE_ENTRY.FOLDER,
  }));
}

function repositoryPathsQueryOptions(place: {
  readonly taskId: string | undefined;
  readonly workspaceId: string | undefined;
  readonly repository: string | null;
}) {
  const key = treeKey(place.taskId, place.workspaceId, place.repository);
  return queryOptions({
    queryKey: [QUERY_ROOT.REPOSITORY_PATHS, place.taskId, place.workspaceId, place.repository],
    queryFn: key === undefined ? skipToken : () => repositoryPaths(key),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

function kindsOf(
  source: MentionSource,
  self: string | undefined,
  skills: MentionSkills | undefined,
  servers: readonly NamedServer[],
  people: number,
  tasks: number,
  inbox: { readonly threads: number; readonly automations: number },
  descriptionsOn: boolean,
): readonly MentionKind[] {
  const { holder, repository } = source;
  const taskId = holderTaskId(holder);
  const pages = holder === undefined ? 0 : (source.pages ?? NO_PAGES).length;
  const pullRequests = (source.pullRequests ?? NO_PULL_REQUESTS).length;
  const agents =
    source.readAgents !== undefined ||
    (taskId !== undefined && (source.agents ?? NO_AGENTS).some((agent) => agent.id !== self));
  const known = skills?.known ?? [];
  const own: MentionKind[] = [
    ...(agents
      ? [
          {
            from: MENTION_FROM.AGENTS,
            name: MENTION_GROUP.AGENTS,
            detail: source.workspace || undefined,
          },
        ]
      : []),
    ...(tasks === 0
      ? []
      : [
          {
            from: MENTION_FROM.TASKS,
            name: MENTION_GROUP.TASKS,
            detail: countWords(tasks, TERM.TASK),
          },
        ]),
    ...(people === 0
      ? []
      : [
          {
            from: MENTION_FROM.PEOPLE,
            name: MENTION_GROUP.PEOPLE,
            detail: countWords(people, TERM.MEMBER),
          },
        ]),
    ...(taskId === undefined || !descriptionsOn
      ? []
      : [
          {
            from: MENTION_FROM.DESCRIPTION,
            name: MENTION_GROUP.DESCRIPTION,
            detail: sectionCount(descriptionSections(source.text()).length),
          },
        ]),
    ...(pages === 0
      ? []
      : [
          {
            from: MENTION_FROM.PAGES,
            name: MENTION_GROUP.PAGES,
            detail: countWords(pages, TERM.PAGE),
          },
        ]),
    ...(repository === null || treeKey(taskId, source.workspaceId, repository) === undefined
      ? []
      : [{ from: MENTION_FROM.FILES, name: MENTION_GROUP.FILES, detail: repository }]),
    ...(inbox.threads === 0
      ? []
      : [
          {
            from: MENTION_FROM.THREADS,
            name: MENTION_GROUP.THREADS,
            detail: countWords(inbox.threads, THREAD_NOUN),
          },
        ]),
    ...(inbox.automations === 0
      ? []
      : [
          {
            from: MENTION_FROM.AUTOMATIONS,
            name: MENTION_GROUP.AUTOMATIONS,
            detail: countWords(inbox.automations, AUTOMATION_NOUN),
          },
        ]),
    ...(pullRequests === 0
      ? []
      : [
          {
            from: MENTION_FROM.PULL_REQUESTS,
            name: MENTION_GROUP.PULL_REQUESTS,
            detail: countWords(pullRequests, TERM.PULL_REQUEST),
          },
        ]),
    ...(known.length === 0
      ? []
      : [
          {
            from: MENTION_FROM.SKILLS,
            name: MENTION_GROUP.SKILLS,
            detail: countWords(known.length, TERM.SKILL),
          },
        ]),
    { from: MENTION_FROM.DATES, name: MENTION_GROUP.DATES, detail: undefined },
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

interface WordsTyped {
  readonly wordAt: number;
  readonly words: string;
}

const restAtom = () =>
  rendererRuntime.fn((typed: WordsTyped) => Effect.as(Effect.sleep(SEARCH_PAUSE), typed));

function useRested(wordAt: number | undefined, words: string | undefined): boolean {
  const [atom] = useState(restAtom);
  const [rested, rest] = useAtom(atom);
  useEffect(() => {
    rest(wordAt === undefined || words === undefined ? Atom.Reset : { wordAt, words });
  }, [wordAt, words, rest]);
  return (
    words === undefined ||
    (AsyncResult.isSuccess(rested) &&
      !rested.waiting &&
      rested.value.wordAt === wordAt &&
      rested.value.words === words)
  );
}

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
  self?: string | undefined;
  skills?: MentionSkills | undefined;
  servers?: readonly NamedServer[];
  room: RefObject<HTMLElement | null>;
  side: MentionMenuSide;
  onChoose: (mention: MentionNode) => void;
}): MentionPicker {
  const directory = useMemberDirectory();
  const { readerId } = directory;
  const now = useMinute();
  const listId = useId();
  const [trigger, setTrigger] = useState<ComposerTrigger | undefined>(undefined);
  const [highlight, setHighlight] = useState<Highlight | undefined>(undefined);
  const [closed, setClosed] = useState<Closed | undefined>(undefined);
  const [narrowing, setNarrowing] = useState<Held | undefined>(undefined);

  const holder = source?.holder;
  const taskId = holderTaskId(holder);
  const agentPlace = useAgentRowPlace(taskId);
  const workspaceId = source?.workspaceId;
  const repository = source?.repository ?? null;
  const place: MentionPlace = { workspace: source?.workspace ?? "", repository };
  const shut = trigger !== undefined && closed !== undefined && closed.start === trigger.start;
  const open = source !== undefined && trigger !== undefined && !shut;
  const inWord = trigger !== undefined;
  useEffect(() => {
    if (inWord) return;
    setClosed(undefined);
    setNarrowing(undefined);
  }, [inWord]);

  const paths = useQuery({
    ...repositoryPathsQueryOptions({ taskId, workspaceId, repository }),
    enabled: open,
  });
  const queryClient = useQueryClient();
  useEffect(() => {
    const { queryKey } = repositoryPathsQueryOptions({ taskId, workspaceId, repository });
    void queryClient.invalidateQueries({ queryKey, exact: true, refetchType: "none" });
  }, [queryClient, taskId, workspaceId, repository]);
  const read = paths.data;
  const pathsSearched = useMemo(() => (read === undefined ? undefined : pathSearch(read)), [read]);
  const pathsFailed = paths.isError && !paths.isFetching;
  const readPathsAgain = paths.refetch;

  const askSkills = skills?.ask;
  const askedAt = open ? trigger.start : undefined;
  useEffect(() => {
    if (askedAt !== undefined) askSkills?.();
  }, [askedAt, askSkills]);

  const people =
    directory.members === undefined ? [] : directoryPeople(directory.members, readerId);
  const listed = useQuery({ ...appStateQuery, select: selectListedTasks }).data ?? NO_LISTED_TASKS;
  const tasksWorkspaceId =
    workspaceId ??
    listed.tasks.find((task) => task.id === taskId)?.workspaceId ??
    (source === undefined ? undefined : workspaceOfSlug(listed.workspaces, source.workspace))?.id;
  const tasksWorkspace = listed.workspaces.find((each) => each.id === tasksWorkspaceId);
  const descriptionsOn =
    useQuery({ ...appStateQuery, select: selectExperiment(EXPERIMENT.DESCRIPTIONS) }).data === true;
  const taskRowsOffered = open
    ? workspaceTaskRows(descriptionsOn ? taskId : undefined, tasksWorkspace, listed.tasks)
    : [];
  const feed = useQuery(inboxItemsQuery());
  const retryFeed = useMutation(inboxItemsRetryMutation());
  const threadsAsked = open && tasksWorkspace !== undefined;
  const threadRowsOffered = threadsAsked
    ? threadRows(feed.data, taskId, tasksWorkspace, listed.tasks, listed.tasklessAgents)
    : [];
  const automationsAsked = open && tasksWorkspace !== undefined;
  const automations = useAutomations(automationsAsked ? tasksWorkspace.id : undefined);
  const automationsRead = automationsAsked ? automations.read : undefined;
  const automationRowsOffered =
    automationsRead !== undefined && "automations" in automationsRead
      ? automationRows(automationsRead.automations, tasksWorkspace)
      : [];
  const planNumber = listed.tasks.find((task) => task.id === taskId)?.number;
  const planKey =
    tasksWorkspace === undefined || planNumber === undefined
      ? undefined
      : taskKey(tasksWorkspace.name, planNumber);
  const kinds = open
    ? kindsOf(
        source,
        self,
        skills,
        servers,
        people.length,
        taskRowsOffered.length,
        {
          threads: threadRowsOffered.length,
          automations: automationRowsOffered.length,
        },
        descriptionsOn,
      )
    : [];
  const scope = open ? scopeOf(trigger, narrowing, kinds) : undefined;
  const term = scope?.term ?? "";

  const readAgents = source?.readAgents;
  const wordAt = open ? trigger.start : undefined;
  const words = open && term.trim() !== "" ? term.trim() : undefined;
  const [workspaceAgents, setWorkspaceAgents] = useState<{
    readonly reader: MentionAgentsReader;
    readonly wordAt: number;
    readonly words: string | undefined;
    readonly agents: readonly MentionableAgent[] | undefined;
  }>();
  const agentsRead =
    workspaceAgents?.reader === readAgents && workspaceAgents?.wordAt === wordAt
      ? workspaceAgents
      : undefined;
  const wantsAgents = agentsRead === undefined || agentsRead.words !== words;
  const agentsFailed =
    agentsRead !== undefined && agentsRead.words === words && agentsRead.agents === undefined;
  const rested = useRested(wordAt, words);
  useEffect(() => {
    if (!wantsAgents || readAgents === undefined || wordAt === undefined || !rested) return;
    let live = true;
    readAgents(words).then(
      (agents) => {
        if (live) setWorkspaceAgents({ reader: readAgents, wordAt, words, agents });
      },
      () => {
        if (live) setWorkspaceAgents({ reader: readAgents, wordAt, words, agents: undefined });
      },
    );
    return () => {
      live = false;
    };
  }, [wantsAgents, words, readAgents, wordAt, rested]);

  const tools = useIntegrationTools(
    (open ? servers : NO_SERVERS).map((server) => server.connection),
  );
  const narrow = scope?.kind?.narrow;
  const groups =
    scope === undefined || source === undefined
      ? []
      : groupsFor(
          scope,
          pathsSearched,
          {
            description: descriptionsOn
              ? taskRows(taskId, source.taskName, planKey, source.text())
              : [],
            tasks: taskRowsOffered,
            pages: pageRows(holder, source.pages ?? NO_PAGES, now),
            agents: agentRows(
              taskId,
              source.agents ?? NO_AGENTS,
              agentsRead?.agents ?? NO_AGENTS,
              self,
              term,
              agentPlace,
            ),
            people: personRows(people, readerId),
            threads: threadRowsOffered,
            automations: automationRowsOffered,
            pullRequests: pullRequestRows(source.pullRequests ?? NO_PULL_REQUESTS),
            skills: skillRows(skills?.known ?? []),
            dates: dateRows(term, narrow?.from === MENTION_FROM.DATES, now, readerZone()),
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
  const reading =
    open &&
    (directory.reading ||
      (readAgents !== undefined && wantsAgents) ||
      (read === undefined &&
        !pathsFailed &&
        treeKey(taskId, workspaceId, repository) !== undefined) ||
      (skills !== undefined && skills.known === undefined && !skills.unread) ||
      (threadsAsked && feed.isPending) ||
      (automationsAsked && automationsRead === undefined));
  const failures: readonly MentionReadFailure[] = open
    ? [
        ...(directory.refused ? [{ read: MENTION_READ.MEMBERS, retry: directory.retry }] : []),
        ...(readAgents !== undefined && agentsFailed
          ? [{ read: MENTION_READ.AGENTS, retry: () => setWorkspaceAgents(undefined) }]
          : []),
        ...(pathsFailed ? [{ read: MENTION_READ.FILES, retry: () => void readPathsAgain() }] : []),
        ...(skills?.unread === true ? [{ read: MENTION_READ.SKILLS, retry: skills.ask }] : []),
        ...(threadsAsked && feed.isError
          ? [{ read: MENTION_READ.THREADS, retry: () => retryFeed.mutate() }]
          : []),
        ...(automationsRead !== undefined && "failure" in automationsRead
          ? [{ read: MENTION_READ.AUTOMATIONS, retry: automations.reload }]
          : []),
      ]
    : [];
  const shown = open && (rows.length > 0 || !/\s/u.test(term.trim()));
  const held =
    highlight !== undefined &&
    trigger !== undefined &&
    highlight.start === trigger.start &&
    highlight.query === trigger.query
      ? highlight.at
      : 0;
  const at = Math.min(held, Math.max(rows.length - 1, 0));
  const narrowTo = (next: Held | undefined) => {
    if (trigger === undefined) return;
    setNarrowing(next);
    setHighlight({ start: trigger.start, query: trigger.query, at: 0 });
  };
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
  const datePicker = useDatePicker(room);
  const pickNewDate = (word: ComposerTrigger) => {
    const editing = document.activeElement;
    setClosed({ start: word.start });
    datePicker.open({
      at: word.rect,
      date: undefined,
      onClose: ({ date, zone, changed, how }: DatePicked) => {
        const kept = how === DATE_PICKER_CLOSE.CLEAR || !changed ? undefined : date;
        if (
          (kept !== undefined || how !== DATE_PICKER_CLOSE.LEAVE) &&
          editing instanceof HTMLElement
        )
          editing.focus();
        if (kept !== undefined) onChoose(dateMentionNode(kept, place, zone));
      },
    });
  };
  const choose = (row: MentionRow) => {
    if ("from" in row) openRow(row);
    else if ("skill" in row) skills?.onChoose(row.skill);
    else if ("picksDate" in row) {
      if (trigger !== undefined) pickNewDate(trigger);
    } else if ("thread" in row) {
      const thread = { kind: LINK_PLACE.INBOX_ITEM, itemId: row.thread.itemId } as const;
      onChoose({ name: row.name, target: linkOf(thread, place.workspace) });
    } else if ("automation" in row) {
      const automation = { kind: LINK_PLACE.AUTOMATION, automationId: row.automation.id } as const;
      onChoose({ name: row.name, target: linkOf(automation, place.workspace) });
    } else onChoose({ name: row.written ?? row.name, target: encodeMention(row.mention, place) });
  };

  const closeList = () => {
    if (trigger !== undefined) setClosed({ start: trigger.start });
  };

  const activeId = rows.length === 0 ? undefined : comboboxOptionId(listId, at);
  const field = useComboboxField({
    open: shown,
    active: at,
    count: rows.length,
    controls: listId,
    activeId,
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
    onEscape: () => closeList(),
  });

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
    if ((event.key === "Home" || event.key === "End") && !bare) return false;
    return field.onKeyDown(event);
  };

  const keys = [
    MENU_KEY.MOVE,
    MENU_KEY.MENTION,
    ...(rows.some(opens) ? [MENU_KEY.OPEN] : []),
    ...(scope?.kind === undefined ? [] : [scope.walked.length > 0 ? MENU_KEY.UP : MENU_KEY.WIDEN]),
    MENU_KEY.CLOSE,
  ];

  const rowCard: RowCardOf = (row) => {
    if (!("mention" in row)) return undefined;
    return thingCard(thingOfMention(row.mention), {
      own: undefined,
      glyph: <RowGlyph row={row} />,
      name: row.written ?? row.name,
      workspace: place.workspace,
      wordsWorkspaceId: tasksWorkspaceId,
      repository: repository ?? undefined,
      gone: undefined,
    });
  };
  const rowsShown = !shown ? null : (
    <MentionMenu
      id={listId}
      crumb={
        scope?.kind === undefined
          ? undefined
          : { kind: scope.kind, folder: scope.walked.at(-1)?.path, back }
      }
      groups={groups}
      query={term}
      at={at}
      keys={keys}
      reading={reading}
      failures={failures}
      rowCard={rowCard}
      onHover={(index) => setHighlight({ start: trigger.start, query: trigger.query, at: index })}
      onChoose={choose}
    />
  );
  const list = (
    <RectFloat
      open={shown}
      anchor={() => (trigger === undefined ? undefined : wordBox(trigger))}
      side={side}
      width={POPOVER_WIDTH.REGULAR}
      onPressAway={closeList}
      holds={(target) => room.current?.contains(target) === true}
    >
      {rowsShown}
    </RectFloat>
  );

  const menu = (
    <>
      {list}
      {datePicker.popover}
    </>
  );

  return {
    menu,
    aria: listAria(field.field),
    onTrigger: setTrigger,
    onKey,
    pickDate: datePicker.open,
  };
}
