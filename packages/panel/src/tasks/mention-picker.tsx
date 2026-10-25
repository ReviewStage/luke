import { useAtom } from "@effect/atom-react";
import type { CodingAgentPullRequest, CodingAgentSummary } from "@luke/features/coding-agent-wire";
import {
  type DateSpan,
  dateChipText,
  dateLabel,
  dateOfWords,
  readerZone,
  suggestedDates,
} from "@luke/features/date-mention";
import { INTEGRATION_PROVIDER, type IntegrationProvider } from "@luke/features/integration-wire";
import {
  encodeMention,
  isMentionableTool,
  MENTION_KIND,
  type Mention,
  type MentionPlace,
  sectionAnchors,
} from "@luke/features/mention-link";
import type { PageLine } from "@luke/features/page-wire";
import { planSections } from "@luke/features/plan-document";
import { TASK_TREE_ENTRY, type TaskSummary } from "@luke/features/task-wire";
import type { TaskCodeShowing } from "@luke/features/tasks-view";
import {
  countWords,
  INTEGRATION_LABEL,
  noMatchWords,
  readFailedWords,
  TERM,
} from "@luke/features/words";
import { namesTaskKey, taskKey } from "@luke/features/workspace-key";
import type { Workspace, WorkspaceMember } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { SHORTCUT_KEY } from "@luke/settings/shortcuts";
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
} from "@luke/ui";
import { type Actor, LUKE_ACTOR } from "@luke/ui/actor-model";
import type { NamedServer } from "@luke/ui/agent-servers-model";
import { hitRangesIn, LOOSE_FROM, type SearchSubject, searchHit } from "@luke/ui/search-score";
import { searchTokens } from "@luke/ui/search-tokens";
import type { SkillOption } from "@luke/ui/skill-mention";
import { pullRequestLabelOf } from "@luke/ui/tab-strip-model";
import { fileFolder, fileName } from "@luke/voice/code-pane-model";
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
import { useAct } from "../act.js";
import { ACTOR_SIZE, ActorMark, actorCard } from "../actor-ref.js";
import { type IntegrationToolsReads, useIntegrationTools } from "../integration-tools.js";
import { useMemberDirectory } from "../member-directory.js";
import { memberRows, YOU_WORD } from "../member-rows.js";
import {
  type ComposerTrigger,
  type EditorAria,
  listAria,
  type MentionNode,
} from "../plan-editor/contract.js";
import { rendererRuntime } from "../renderer-runtime.js";
import { Highlighted } from "../search-field.js";
import { appStateDerivedAtom, useAppSlice } from "../use-app-state.js";
import { type AgentRowPlace, agentMenuRow, useAgentRowPlace } from "./agent-menu-row.js";
import { SERVER_PAGE_HEAD_CLASS } from "./agent-servers.js";
import {
  DATE_PICKER_CLOSE,
  type DatePicked,
  type DatePickerOpening,
  dateMentionNode,
  useDatePicker,
} from "./date-picker.js";
import { FileCard, newestFileNote } from "./file-ref.js";
import { FileTypeIcon } from "./file-type-icon.js";
import { PageCard } from "./page-card.js";
import { PullRequestMark } from "./pull-request-mark.js";
import { AgentMark, PlanGlyph } from "./tab-look.js";
import { NO_TASK } from "./task-mentions.js";
import { useTaskStatus } from "./use-known-names.js";

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
 * as ⌘K scores them (`@luke/ui/search-score`), each row marking what found
 * it, letters typed in order finding only a path, files and folders first, each
 * group in a fixed place so a later read never moves the rows above it.
 * Once the words run past a space and nothing matches them, the list
 * stands aside, since they are the developer's own words rather than a
 * mention, and the keys go to the editor as they would anywhere.
 * The repository's paths are read once per task, the first time an `@` is
 * typed, through the same listing ⌘K finds files with
 * (`ACT_KIND.TASKS_TREE`, the whole tree at the default branch). Each
 * file's row wears its type's icon and hangs the file's card, with Luke's
 * newest note on it read where a tab of it is open (`MentionSource.openFiles`).
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
 * glyph, its version or how long ago it was written beside it, hanging its
 * card, and the pull requests its agents published, each by its number
 * and title and its mark, a pick written as the pull request's GitHub
 * address, the link mention a pasted one becomes. And wherever the words go, it offers the coding agents of the
 * whole workspace, each drawn as every agent menu draws it
 * (`agent-menu-row.tsx`): its tab's glyph and name, its task, a teammate's
 * face and the failed mark at its end, and its card on rest; the plan's own agents first, then the workspace's others,
 * on another task or on none, as the place reads them the first time the
 * list opens (`MentionSource.readAgents`), the agent whose box it is left
 * out. Once a word is typed and the typing rests (`SEARCH_PAUSE`), the service finds the agents it names by
 * their title or their task's name, however many the workspace holds. An
 * archived agent takes no message, so it is offered only once a word is
 * typed, and marked archived. A mention of a page or an
 * agent names it by its id (`@luke/features/mention-link`), which the
 * agent it is sent to is handed what it needs to read by
 * (`packages/service/src/agents/mentioned-context.ts`).
 *
 * Wherever the words stand in a workspace, the list offers its other
 * tasks too, as the window lists them, once a word is typed: each by its
 * name, its key beside it (`ACME-42`, `@luke/features/workspace-key`),
 * found by either, a pick written as the task's mention; the plan's own is
 * found by its key in the plan's group. Words that are a task's key whole
 * lead the list with that task, as words that read as a date lead it with
 * the date.
 *
 * Wherever the words stand in a workspace whose members the window has
 * read (`../member-directory.tsx`), the list offers its people too, each by
 * their name and picture, the reader among them as You, found by their name
 * or their email: a mention of a person names them by their account's id,
 * so it names them still once they rename themselves, and an agent the
 * words go to is handed who they are in the workspace. Nobody is notified
 * of a mention.
 *
 * Where the words typed read as a date (`@luke/features/date-mention`),
 * `tomorrow 3pm`, `next fri`, `oct 20 to 24`, the list offers that date
 * first, said from today as its chip says it and in full beside it, a pick
 * written with the date in full; narrowed to dates with nothing typed, it
 * offers today, tomorrow, and next Monday.
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
  DATES: "Dates",
  FILES: "Files and folders",
  PLAN: "Plan",
  TASKS: "Tasks",
  PAGES: "Pages",
  AGENTS: "Agents",
  PEOPLE: "People",
  PULL_REQUESTS: "Pull requests",
  SKILLS: "Skills",
  SERVERS: INTEGRATION_LABEL.many,
  FROM: "Mention from",
} as const;

/** The kinds a list may be narrowed to, each but a server by its own word typed before a colon after the `@`. */
const MENTION_FROM = {
  FILES: "files",
  PLAN: "plan",
  TASKS: "tasks",
  PAGES: "pages",
  AGENTS: "agents",
  PEOPLE: "people",
  PULL_REQUESTS: "prs",
  SKILLS: "skills",
  DATES: "dates",
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

/** A word closed with Escape: where it stands. */
interface Closed {
  readonly start: number;
}

/** What a page's row says of a version past its first, as its card says it. */
function versionWords(version: number): string {
  return `Version ${version}`;
}

/** What a pull request's row says beside its name where no agent is named for it. */
const PULL_REQUEST_DETAIL = "Pull request";

/** What the Dates kind's row says beside its name. */
const DATES_DETAIL = "A day, a time, or a range";

/** The row of a list narrowed to dates that opens the date picker, to write the day picked there. */
const PICK_DATE_ROW: MentionRow = {
  picksDate: true,
  name: "Pick a date…",
  detail: undefined,
  terms: "Pick a date",
};

/** The key the picker's row stands under, which no mention's or kind's key spells. */
const PICK_DATE_KEY = "pick-date";

/** What a skill's row says beside its name. */
const SKILL_DETAIL = "Skill";

/** What a server's row says beside its name. */
const SERVER_DETAIL = INTEGRATION_LABEL.one;

/** What a tool's row says beside its name, which already names its server. */
const TOOL_DETAIL = "Tool";

/** What stands between a server's name and its tool's in a tool's mention. */
const TOOL_JOIN = " · ";

/** The repository's skills as an `@` list offers them: as read, the ask to read them, and the pick that writes one as its `/name` chip. */
export interface MentionSkills {
  readonly known: readonly SkillOption[] | undefined;
  /** Whether the read came back unread, which the list says could not be read, with Retry, rather than that it is reading. */
  readonly unread: boolean;
  readonly ask: () => void;
  readonly onChoose: (name: string) => void;
}

/** The servers of a list that offers none. */
const NO_SERVERS: readonly NamedServer[] = [];

/** The most rows one group lists. */
const PER_GROUP = 4;

/** The most rows a list narrowed to one kind lists. */
const PER_KIND = 50;

/** How long the typing rests before the service is searched for the agents the words name. */
const SEARCH_PAUSE = Duration.millis(250);

/** The window's tasks and workspaces, which tell their readers only when either is a new list, so a patch to the open plan draws no list again. */
const listedTasksAtom: Atom.Atom<{
  readonly tasks: readonly TaskSummary[];
  readonly workspaces: readonly Workspace[];
}> = Atom.withEquality(
  appStateDerivedAtom((state) => ({
    tasks: state?.tasks.tasks ?? [],
    workspaces: state?.tasks.workspaces ?? [],
  })),
  (held, next) => held.tasks === next.tasks && held.workspaces === next.workspaces,
);

/** The list's own name, which its listbox is read by. */
const MENU_LABEL = "Mention";

/** What the list says where it has no row. */
const NO_MATCH = noMatchWords(TERM.RESULT);

/** The keys the list hears, said at its foot as far as it hears them now. */
const MENU_KEY = {
  MOVE: menuKey("Move", SHORTCUT_KEY.UP, SHORTCUT_KEY.DOWN),
  MENTION: menuKey("Mention", SHORTCUT_KEY.ENTER, SHORTCUT_KEY.TAB),
  OPEN: menuKey("Open", SHORTCUT_KEY.RIGHT),
  WIDEN: menuKey("All kinds", SHORTCUT_KEY.BACKSPACE),
  UP: menuKey("Up", SHORTCUT_KEY.BACKSPACE),
  CLOSE: menuKey("Close", SHORTCUT_KEY.ESCAPE),
} as const satisfies Record<string, MenuKey>;

/** What a narrowed list's back arrow is read by: back to every kind, or up out of a folder. */
const BACK_LABEL = {
  WIDEN: "All kinds",
  UP: "Up",
} as const;

/** Where the crumb's way back leads, as its hint says it. */
const BACK_PLACE = {
  WIDEN: "all kinds",
  UP: "the folder above",
} as const;

/** One row the list offers: what it mentions, or the skill it names, the name it is written with, and a muted detail. */
type MentionRow = {
  readonly name: string;
  readonly detail: React.ReactNode;
  /** The name a pick writes, where it is not the row's own: a date's in full, where its row says it from today. */
  readonly written?: string | undefined;
  /** The words it is found by. */
  readonly terms: string;
  /** A task's key, as `ACME-42`, which typed whole finds the task first. */
  readonly key?: string | undefined;
  /** A person's picture, which their row wears; none for any other row. */
  readonly actor?: Actor | undefined;
  /** An agent's row as every agent menu draws it (`agent-menu-row.tsx`): its tab's glyph, its end, and its card; none for any other row. */
  readonly look?: Pick<MenuRow, "icon" | "end" | "card"> | undefined;
  /** The card a page's or a person's row hangs beside it, a page's tab's and a person's own; none for any other row, a file's being drawn as its row is (`comboboxGroups`). */
  readonly card?: React.ReactNode | undefined;
  /** A pull request, whose mark its row wears for where it stands; none for any other row. */
  readonly pullRequest?: MentionablePullRequest | undefined;
} & (
  | { readonly mention: Mention }
  | { readonly skill: string }
  | { readonly from: MentionKind }
  | { readonly picksDate: true }
);

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

/** What the plan's row says of its sections: how many, where it holds any. */
function sectionCount(count: number): string | undefined {
  return count === 0 ? undefined : countWords(count, TERM.SECTION);
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

/** The plan's rows: each section by its heading, a heading borne twice once for each section, then the plan itself, found by its name and its key; none where no plan stands. */
function taskRows(
  taskId: string,
  taskName: string,
  key: string | undefined,
  text: string,
): MentionRow[] {
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
      terms: key === undefined ? taskName : `${key} ${taskName}`,
      key,
    },
  ];
}

/**
 * Each of the plan's pages' rows, by its title, its version where it has
 * more than one and else how long ago it was written, as its card says
 * them, hanging that card; none where no plan stands.
 */
function pageRows(taskId: string, pages: readonly MentionablePage[], now: number): MentionRow[] {
  if (taskId === NO_TASK) return [];
  return pages.map((page) => ({
    mention: { kind: MENTION_KIND.PAGE, taskId: taskId, pageId: page.id },
    name: page.title,
    detail:
      page.version > 1 ? versionWords(page.version) : <Time at={page.at} now={now} hint={false} />,
    terms: page.title,
    card: <PageCard place={{ taskId }} page={page} />,
  }));
}

/** Each of the workspace's tasks' rows but the plan's own, by its name, its key beside it, found by either. */
function workspaceTaskRows(
  taskId: string,
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

/**
 * Each agent's row as every agent menu draws it (`agentMenuRow`), labelled
 * and found by its task: the plan's own agents first, then the workspace's
 * others in the order read, each once, an archived one only once a word is
 * typed, and the agent whose box it is left out.
 */
function agentRows(
  taskId: string,
  own: readonly MentionableAgent[],
  workspace: readonly MentionableAgent[],
  self: string | undefined,
  query: string,
  place: AgentRowPlace,
): MentionRow[] {
  const seen = new Set<string>(self === undefined ? [] : [self]);
  const typed = query.trim() !== "";
  const mine = taskId === NO_TASK ? [] : own.map((agent) => ({ ...agent, task: { id: taskId } }));
  const rows: MentionRow[] = [];
  for (const agent of [...mine, ...workspace]) {
    if (seen.has(agent.id) || (agent.archived === true && !typed)) continue;
    seen.add(agent.id);
    const task = agent.task;
    const row = agentMenuRow(agent, place);
    rows.push({
      mention:
        task === undefined
          ? { kind: MENTION_KIND.AGENT, agentId: agent.id }
          : { kind: MENTION_KIND.AGENT, taskId: task.id, agentId: agent.id },
      name: row.label,
      detail: row.detail,
      terms: (row.terms ?? [row.label]).join(" "),
      look: { icon: row.icon, end: row.end, card: row.card },
    });
  }
  return rows;
}

/** The workspace's members as the list offers them, as every people menu lists them (`memberRows`): the reader first, then everyone else by name, each wearing their picture. */
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

/** Each person's row, by their name, wearing their picture and hanging their card, said by their email or as You, found by their name or their email. */
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

/** A date's row: said from today as its chip says it, in full beside it, and written in full. */
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

/**
 * The dates the list offers for the words: the one they name, or, narrowed
 * to dates with nothing typed, today, tomorrow, and next Monday; none for
 * a wide list with nothing typed. A list narrowed to dates ends on the row
 * that opens the date picker.
 */
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

/** Each of the repository's skills' rows, found by its name and what it says it is for. */
function skillRows(skills: readonly SkillOption[]): MentionRow[] {
  return skills.map((skill) => ({
    skill: skill.name,
    name: skill.name,
    detail: SKILL_DETAIL,
    terms: `${skill.name} ${skill.description}`,
  }));
}

/** Whether the words are a row's task's key whole. */
function keyed(row: MentionRow, query: string): boolean {
  return row.key !== undefined && namesTaskKey(query, row.key);
}

/** Whether a row is a path's, whose letters typed in order find it. */
function isPath(row: MentionRow): boolean {
  return (
    "mention" in row &&
    (row.mention.kind === MENTION_KIND.FILE || row.mention.kind === MENTION_KIND.FOLDER)
  );
}

/** What a row is searched by: its name, the words it is found by, its task's key, and, for a path, its letters in order. */
function rowSubject(row: MentionRow): SearchSubject {
  return {
    label: row.name,
    lines: row.terms === row.name ? [] : [row.terms],
    key: row.key,
    loose: isPath(row),
  };
}

/** How well a row answers the query, by the tier it meets; 0 where it meets none. */
function rowScore(row: MentionRow, query: string): number {
  return searchHit(rowSubject(row), query)?.score ?? 0;
}

/**
 * The rows matching the query, best first, as many as `most`; the first
 * rows in order for no query. A task whose key the words are whole ranks
 * first, in the scorer's first tier.
 */
function best(rows: readonly MentionRow[], query: string, most: number): readonly MentionRow[] {
  if (query.trim() === "") return rows.slice(0, most);
  return rows
    .map((row) => ({ row, score: rowScore(row, query) }))
    .filter((each) => each.score > 0)
    .sort((first, second) => second.score - first.score)
    .slice(0, most)
    .map((each) => each.row);
}

/** A path's row, and how well it answers the words it was found by. */
interface FoundPath {
  readonly entry: RepositoryPath;
  readonly row: MentionRow;
  readonly score: number;
}

/** The paths some words found: in the listing's order, and best first. */
interface PathsFound {
  readonly matched: readonly FoundPath[];
  readonly ranked: readonly FoundPath[];
}

/** The repository's paths as read, and what each word typed found among them. */
interface PathSearch {
  readonly paths: readonly RepositoryPath[];
  /** The paths the words found, best first, ties in the listing's order; the words are never blank. */
  readonly found: (term: string) => readonly FoundPath[];
}

/**
 * A search over the paths one read listed, which a repository may hold tens
 * of thousands of. Each word's finds are kept while the word is typed on or
 * back, so a word met again is answered from what it found; and a word typed
 * on from one kept searches only what that one found. Note that the
 * narrowing is sound only from a word of at least `LOOSE_FROM` letters:
 * a letter more never begins, starts, or holds a word the shorter one did
 * not, and its letters in order are the shorter one's in order, but a
 * shorter word finds nothing by letters in order, which a longer one may.
 */
function pathSearch(paths: readonly RepositoryPath[]): PathSearch {
  const all = paths.map((entry) => ({ entry, row: pathRow(entry) }));
  const kept = new Map<string, PathsFound>();
  const found = (term: string): readonly FoundPath[] => {
    const known = kept.get(term);
    if (known !== undefined) return known.ranked;
    // Only the words this one types on or back from stay kept.
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

/** The best of the paths the words found, as many as `most`, under the folder where one was walked into. */
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

/**
 * The repository's paths a list narrowed to them offers: for no words, the
 * folder walked into, then what it holds, its folders first, or what the
 * repository's root holds where none was; else the best of every path
 * under the folder by the words.
 */
function fileRows(
  search: PathSearch,
  folder: string | undefined,
  term: string,
): readonly MentionRow[] {
  if (term.trim() !== "") return foundRows(search, folder, term, PER_KIND);
  const { paths } = search;
  const under =
    folder === undefined ? paths : paths.filter((entry) => entry.path.startsWith(`${folder}/`));
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
  /** The workspace's other tasks. */
  readonly tasks: readonly MentionRow[];
  readonly pages: readonly MentionRow[];
  readonly agents: readonly MentionRow[];
  readonly people: readonly MentionRow[];
  readonly pullRequests: readonly MentionRow[];
  readonly skills: readonly MentionRow[];
  /** The date the words name, or the dates a list narrowed to dates offers. */
  readonly dates: readonly MentionRow[];
  /** The connected servers' rows, or the one server's the list is narrowed to. */
  readonly servers: readonly MentionRow[];
}

/** Up to fifty of one kind's rows, found by the words; a folder's where one was walked into. */
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
    case MENTION_FROM.PLAN:
      return best(rows.plan, term, PER_KIND);
    case MENTION_FROM.TASKS:
      return best(rows.tasks, term, PER_KIND);
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
    case MENTION_FROM.DATES:
      return rows.dates;
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
 * best, the date the words name first, since words that read as a date
 * mean one, and the task whose key they are whole next, then files and
 * folders. One kind: up to fifty of its rows, a
 * folder's where one was walked into.
 */
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
  const plan = { label: MENTION_GROUP.PLAN, rows: best(rows.plan, term, PER_GROUP) };
  // The workspace's tasks are offered only once a word is typed.
  const tasks = {
    label: MENTION_GROUP.TASKS,
    rows: bare ? [] : best(rows.tasks, term, PER_GROUP),
  };
  // The group holding the task the words are the key of, the plan's own or another, leads the list.
  const keyedGroup = [plan, tasks].find((group) => group.rows.some((row) => keyed(row, term)));
  const members = [
    { label: MENTION_GROUP.AGENTS, rows: best(rows.agents, term, PER_GROUP) },
    { label: MENTION_GROUP.PEOPLE, rows: best(rows.people, term, PER_GROUP) },
  ];
  const place = [
    { label: MENTION_GROUP.FILES, rows: files },
    plan,
    tasks,
    { label: MENTION_GROUP.PAGES, rows: best(rows.pages, term, PER_GROUP) },
  ].filter((group) => group !== keyedGroup);
  return [
    { label: MENTION_GROUP.DATES, rows: rows.dates },
    ...(keyedGroup === undefined ? [] : [keyedGroup]),
    ...place,
    ...members,
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
    case MENTION_FROM.TASKS:
      return <PlanGlyph status={undefined} />;
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
    case MENTION_FROM.DATES:
      return <CalendarIcon aria-hidden="true" />;
    case MENTION_FROM.SERVER:
      return <ProviderMark provider={kind.narrow.provider} />;
  }
}

/** A row's glyph, as its chip wears it. */
function RowGlyph({ row }: { row: MentionRow }): React.JSX.Element {
  const planned = "mention" in row && row.mention.kind === MENTION_KIND.TASK;
  const taskStatus = useTaskStatus(planned ? row.mention.taskId : undefined);
  if ("skill" in row) return <BookOpenIcon aria-hidden="true" />;
  if ("from" in row) return <KindGlyph kind={row.from} />;
  if ("picksDate" in row) return <CalendarIcon aria-hidden="true" />;
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
    case MENTION_KIND.LUKE:
      return <ActorMark actor={LUKE_ACTOR} size={ACTOR_SIZE.INLINE} />;
    case MENTION_KIND.DATE:
      return <CalendarIcon aria-hidden="true" />;
  }
}

/** A row's key, stable while it stands: its skill's name, its kind's narrowing, or its mention. */
function rowKey(row: MentionRow): string {
  if ("skill" in row) return row.skill;
  if ("picksDate" in row) return PICK_DATE_KEY;
  return JSON.stringify("from" in row ? row.from.narrow : row.mention);
}

/** The card a file's row hangs, drawn for the path as the list draws it; none for a row that is no file. */
type FileCardOf = (row: MentionRow) => React.ReactNode;

/** A row's name and detail, each marked where the words found it, as ⌘K marks its rows. */
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

/** The groups as the list draws them: each row its glyph, its name and detail marked where `query` found them, an agent's end, its card, and a chevron where it opens. */
function comboboxGroups(
  groups: readonly MentionGroup[],
  query: string,
  fileCard: FileCardOf,
): ComboboxGroup[] {
  return groups.map((group) => ({
    label: group.label,
    options: group.rows.map((row) => ({
      id: rowKey(row),
      ...markedWords(row, query),
      words: row.name,
      icon: row.look?.icon ?? <RowGlyph row={row} />,
      hint: row.look?.end,
      card: row.look?.card ?? row.card ?? fileCard(row),
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
    <KeepFocus className={`${SERVER_PAGE_HEAD_CLASS} mention-menu-crumb [--luke-fold:folded]`}>
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

/** The reads the list draws rows from that can fail, each named as its failure says it. */
const MENTION_READ = {
  MEMBERS: "members",
  AGENTS: "agents",
  FILES: "the repository's files",
  SKILLS: "skills",
} as const;

type MentionRead = (typeof MENTION_READ)[keyof typeof MENTION_READ];

/** A read of the list that failed, and the press that reads it again. */
interface MentionReadFailure {
  readonly read: MentionRead;
  readonly retry: () => void;
}

/** The list itself: a narrowed list's crumb, each group's heading and rows, the highlighted one washed, and the keys it hears at its foot. */
function MentionMenu({
  id,
  crumb,
  groups,
  query,
  at,
  keys,
  reading,
  failures,
  fileCard,
  onHover,
  onChoose,
}: {
  id: string;
  crumb: Crumb | undefined;
  groups: readonly MentionGroup[];
  /** The words the groups were found by, which mark each row. */
  query: string;
  at: number;
  keys: readonly MenuKey[];
  /** Whether a read the list offers rows from is still out, which the list says in place of "no match". */
  reading: boolean;
  /** The reads that failed, which the list says could not be read, with Retry, in place of "no match". */
  failures: readonly MentionReadFailure[];
  fileCard: FileCardOf;
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
        groups={comboboxGroups(groups, query, fileCard)}
        active={at}
        onActiveChange={onHover}
        onChoose={(index) => {
          const row = rows[index];
          if (row !== undefined) onChoose(row);
        }}
        // A narrowed list's one group is named by its crumb.
        headed={crumb === undefined}
        empty={noted ? undefined : NO_MATCH}
        note={
          noted ? (
            <>
              {reading ? <Spinner delay label="Reading" /> : null}
              {failures.map((failure) => (
                <ErrorState key={failure.read} onRetry={failure.retry}>
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

/** What an editor drawing an `@` list wires: the list and the date picker while they stand, the field's ties to the list for assistive technology, the reports and keys the editor hands it, and what opens the date picker over a chip. */
export interface MentionPicker {
  readonly menu: React.ReactNode;
  /** What ties the editor to the list (`listAria`), which names it a combobox while the list stands. */
  readonly aria: EditorAria;
  readonly onTrigger: (trigger: ComposerTrigger | undefined) => void;
  readonly onKey: (event: KeyboardEvent) => boolean;
  readonly pickDate: (opening: DatePickerOpening) => void;
}

/** Which side of the word the list stands: under it, as in the plan, or over it, as at the foot of an agent's tab. */
export const MENTION_MENU_SIDE = {
  BELOW: "below",
  ABOVE: "above",
} as const;

export type MentionMenuSide = (typeof MENTION_MENU_SIDE)[keyof typeof MENTION_MENU_SIDE];

/** The box a word's list hangs by, in window coordinates: the line its first letter stands on, as the editor reported it. */
export function wordBox(word: ComposerTrigger): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  const { left, top, bottom } = word.rect;
  return { left, top, right: left, bottom };
}

/** A page an agent showed on the plan, as the list offers it: as the plan lists it, its id, its newest version's title and number, and when that version was written, which its row and its card say. */
export type MentionablePage = PageLine;

/** One of the workspace's coding agents, as the list offers it: its id, its tab's name, its tile, which its row wears, its task, and whether it is archived. */
export interface MentionableAgent {
  readonly id: string;
  readonly name: string;
  readonly actor: Actor;
  /** The task it works on, by its id and, where the place knows it, its name; absent for an agent on none. */
  readonly task?: { readonly id: string; readonly name?: string | undefined } | undefined;
  readonly archived?: boolean | undefined;
  /** The agent as the workspace's list read it, where a place drew it from that list: what a picker draws its tab's look and title from. */
  readonly summary?: CodingAgentSummary | undefined;
}

/** A person as the list offers them: their account's id, their name, their email where the members read names it, and their picture, which their row wears. */
interface MentionablePerson {
  readonly userId: string;
  readonly name: string;
  readonly email: string | undefined;
  readonly actor: Actor;
}

/** One of the task's pull requests, as the list offers it: where it stands, which its mark wears, its GitHub address, and the name of the agent that published it, where the place knows it. */
export interface MentionablePullRequest
  extends Pick<CodingAgentPullRequest, "number" | "title" | "url" | "state" | "checks" | "queued"> {
  readonly agent: string | undefined;
}

/**
 * Reads the workspace's coding agents: the newest where no words are given,
 * or, found by the service, those whose title or task's name holds the
 * words, the archived ones among them; rejects where the read failed, so
 * the list says it could not read them rather than that none match.
 */
export type MentionAgentsReader = (
  words: string | undefined,
) => Promise<readonly MentionableAgent[]>;

/** The pages and agents of a place that offers none. */
const NO_PAGES: readonly MentionablePage[] = [];
const NO_AGENTS: readonly MentionableAgent[] = [];
const NO_PULL_REQUESTS: readonly MentionablePullRequest[] = [];
const NO_SHOWN_CODE: readonly TaskCodeShowing[] = [];
const NO_OPEN_FILES: readonly MentionOpenFile[] = [];

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
  /** Every code Luke showed on the plan, whose newest note on a file its row's card says; none where the place knows none. */
  readonly shownCode?: readonly TaskCodeShowing[] | undefined;
  /** The plan's open File tabs, whose pinned commit a file's card is read at; none where the place holds none. */
  readonly openFiles?: readonly MentionOpenFile[] | undefined;
}

/** A File tab the plan holds open: its path and the commit it is pinned to, none for the default branch's head. */
export interface MentionOpenFile {
  readonly path: string;
  readonly commit?: string | undefined;
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
 * and folders where it names one, the plan where one stands, the
 * workspace's other tasks where it holds any, the plan's pages, the
 * workspace's agents where it reads them, its people where
 * the window has read them, the pull requests
 * the plan's agents published, the repository's skills where the words go
 * to an agent, dates wherever the list stands, and each connected server, the
 * first of each provider narrowed to by the provider's own word.
 */
function kindsOf(
  source: MentionSource,
  self: string | undefined,
  skills: MentionSkills | undefined,
  servers: readonly NamedServer[],
  people: number,
  tasks: number,
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
            detail: sectionCount(planSections(source.text()).length),
          },
        ]),
    ...(tasks === 0
      ? []
      : [
          {
            from: MENTION_FROM.TASKS,
            name: MENTION_GROUP.TASKS,
            detail: countWords(tasks, TERM.TASK),
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
            detail: countWords(people, TERM.MEMBER),
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
    { from: MENTION_FROM.DATES, name: MENTION_GROUP.DATES, detail: DATES_DETAIL },
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

/** Words typed in the `@` word that starts at `wordAt`. */
interface WordsTyped {
  readonly wordAt: number;
  readonly words: string;
}

/**
 * Words once they have stood the pause, as an atom whose work is the wait:
 * setting it again starts the wait over, so only the newest words rest.
 */
const restAtom = () =>
  rendererRuntime.fn((typed: WordsTyped) => Effect.as(Effect.sleep(SEARCH_PAUSE), typed));

/**
 * Whether the typing has rested on the words of the `@` word at `wordAt`,
 * which no words always have. Note that the rest is forgotten once the
 * words go, so words typed again, in this word or another, wait afresh.
 */
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

/**
 * The `@` list for an editor on a task's page: its rows read from the
 * plan's words as they stand and the repository's paths, hung by the word
 * (`@luke/ui`'s `RectFloat`) and closed by a press outside it and `room`,
 * and a pick handed to `onChoose` as the mention's node; a list that never
 * opens where there is no task to offer.
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
  /** The box the editor stands in: a press in it is the editor's, and the date picker hangs in it. */
  room: RefObject<HTMLElement | null>;
  side: MentionMenuSide;
  onChoose: (mention: MentionNode) => void;
}): MentionPicker {
  const { act } = useAct();
  const directory = useMemberDirectory();
  const { readerId } = directory;
  const now = useMinute();
  const listId = useId();
  const [trigger, setTrigger] = useState<ComposerTrigger | undefined>(undefined);
  const [highlight, setHighlight] = useState<Highlight | undefined>(undefined);
  const [closed, setClosed] = useState<Closed | undefined>(undefined);
  const [narrowing, setNarrowing] = useState<Held | undefined>(undefined);
  const [paths, setPaths] = useState<{
    planId: string;
    workspaceId: string | undefined;
    repository: string | null;
    /** The paths read; none where the read failed, which Retry clears to read again. */
    paths: readonly RepositoryPath[] | undefined;
  }>();

  const taskId = source?.taskId ?? NO_TASK;
  const agentPlace = useAgentRowPlace(taskId);
  const workspaceId = source?.workspaceId;
  const repository = source?.repository ?? null;
  const place: MentionPlace = { workspace: source?.workspace ?? "", repository };
  const shut = trigger !== undefined && closed !== undefined && closed.start === trigger.start;
  const open = source !== undefined && trigger !== undefined && !shut;
  // A word closed with Escape stays closed only while the caret is in it.
  const inWord = trigger !== undefined;
  // So does a narrowing a key made.
  useEffect(() => {
    if (inWord) return;
    setClosed(undefined);
    setNarrowing(undefined);
  }, [inWord]);

  // The repository's paths are read the first time the list opens on the task, and again once its repository changes or Retry asks.
  const readOf =
    paths?.planId === taskId && paths.workspaceId === workspaceId && paths.repository === repository
      ? paths
      : undefined;
  const read = readOf?.paths;
  // Note that the paths are searched through one search per read, which keeps what each word found, rather than ranking every path on each render.
  const pathsSearched = useMemo(() => (read === undefined ? undefined : pathSearch(read)), [read]);
  const pathsFailed = readOf !== undefined && readOf.paths === undefined;
  useEffect(() => {
    if (!open || readOf !== undefined) return;
    const key = treeKey(taskId, workspaceId, repository);
    if (key === undefined) return;
    let live = true;
    // Note that a refusal and a rejection both leave the paths unread and the read failed, never an empty repository.
    const failed = () => {
      if (live) setPaths({ planId: taskId, workspaceId, repository, paths: undefined });
    };
    act(ACT_KIND.TASKS_TREE, { ...key, path: "", recursive: true }).then((answer) => {
      if (!live) return;
      if (!("folder" in answer)) return failed();
      setPaths({
        planId: taskId,
        workspaceId,
        repository,
        paths: answer.folder.entries.map((entry) => ({
          path: entry.name,
          folder: entry.kind === TASK_TREE_ENTRY.FOLDER,
        })),
      });
    }, failed);
    return () => {
      live = false;
    };
  }, [open, readOf, act, taskId, workspaceId, repository]);

  // A failed read of the paths is read again by the next word that opens the list.
  useEffect(() => {
    if (!open && pathsFailed) setPaths(undefined);
  }, [open, pathsFailed]);

  // The skills are asked for as each `@` word opens the list, as the `/` list asks for them; a read
  // that answered is kept, and one that failed is asked again by the next word.
  const askSkills = skills?.ask;
  const askedAt = open ? trigger.start : undefined;
  useEffect(() => {
    if (askedAt !== undefined) askSkills?.();
  }, [askedAt, askSkills]);

  // The people offered are the workspace's as read.
  const people =
    directory.members === undefined ? [] : directoryPeople(directory.members, readerId);
  // The tasks offered are the workspace's the words stand in: the one that names it, else the plan's, else the one its slug names.
  const listed = useAppSlice(listedTasksAtom);
  const tasksWorkspaceId =
    workspaceId ??
    listed.tasks.find((task) => task.id === taskId)?.workspaceId ??
    listed.workspaces.find((each) => each.slug !== undefined && each.slug === source?.workspace)
      ?.id;
  const tasksWorkspace = listed.workspaces.find((each) => each.id === tasksWorkspaceId);
  const taskRowsOffered = open ? workspaceTaskRows(taskId, tasksWorkspace, listed.tasks) : [];
  // The plan's own key, which finds the plan's row as another task's finds its.
  const planNumber = listed.tasks.find((task) => task.id === taskId)?.number;
  const planKey =
    tasksWorkspace === undefined || planNumber === undefined
      ? undefined
      : taskKey(tasksWorkspace.name, planNumber);
  // The list is narrowed to the kind a key opened or whose word was typed, and searched by the words after it.
  const kinds = open
    ? kindsOf(source, self, skills, servers, people.length, taskRowsOffered.length)
    : [];
  const scope = open ? scopeOf(trigger, narrowing, kinds) : undefined;
  const term = scope?.term ?? "";

  // The workspace's newest agents are read as each `@` word opens the list, and once a word is
  // typed and the typing rests the service finds those it names, archived ones among them, however many the workspace
  // holds; each read is kept while its word stands, and the last one shown until the next lands.
  const readAgents = source?.readAgents;
  const wordAt = open ? trigger.start : undefined;
  const words = open && term.trim() !== "" ? term.trim() : undefined;
  const [workspaceAgents, setWorkspaceAgents] = useState<{
    readonly reader: MentionAgentsReader;
    readonly wordAt: number;
    readonly words: string | undefined;
    /** The agents read; none where the read failed, which Retry clears to read again. */
    readonly agents: readonly MentionableAgent[] | undefined;
  }>();
  const agentsRead =
    workspaceAgents?.reader === readAgents && workspaceAgents?.wordAt === wordAt
      ? workspaceAgents
      : undefined;
  const wantsAgents = agentsRead === undefined || agentsRead.words !== words;
  const agentsFailed =
    agentsRead !== undefined && agentsRead.words === words && agentsRead.agents === undefined;
  // Note that words are asked of the service once the typing rests on them, as the issue pickers' are, rather than letter by letter.
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
          pathsSearched,
          {
            plan: taskRows(taskId, source.taskName, planKey, source.text()),
            tasks: taskRowsOffered,
            pages: pageRows(taskId, source.pages ?? NO_PAGES, now),
            agents: agentRows(
              taskId,
              source.agents ?? NO_AGENTS,
              agentsRead?.agents ?? NO_AGENTS,
              self,
              term,
              agentPlace,
            ),
            people: personRows(people, readerId),
            pullRequests: pullRequestRows(taskId, source.pullRequests ?? NO_PULL_REQUESTS),
            skills: skillRows(skills?.known ?? []),
            dates: dateRows(term, narrow?.from === MENTION_FROM.DATES, now, readerZone()),
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
  // The list says it is reading, never that nothing matches, while a read it draws rows from is out.
  const reading =
    open &&
    (directory.membersReading ||
      (readAgents !== undefined && wantsAgents) ||
      (read === undefined &&
        !pathsFailed &&
        treeKey(taskId, workspaceId, repository) !== undefined) ||
      (skills !== undefined && skills.known === undefined && !skills.unread));
  // The list says a read could not be read, never that nothing matches, and Retry reads it again.
  const failures: readonly MentionReadFailure[] = open
    ? [
        ...(directory.membersRefused
          ? [{ read: MENTION_READ.MEMBERS, retry: directory.retry }]
          : []),
        ...(readAgents !== undefined && agentsFailed
          ? [{ read: MENTION_READ.AGENTS, retry: () => setWorkspaceAgents(undefined) }]
          : []),
        ...(pathsFailed ? [{ read: MENTION_READ.FILES, retry: () => setPaths(undefined) }] : []),
        ...(skills?.unread === true ? [{ read: MENTION_READ.SKILLS, retry: skills.ask }] : []),
      ]
    : [];
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
  // The date picker opened from the list hangs from the word and writes the date picked in its place.
  const datePicker = useDatePicker(room);
  const pickNewDate = (word: ComposerTrigger) => {
    // Note that the editor is handed the caret back before a pick is written, because it finds the `@` word only while it has it.
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
  // A skill is written as the `/name` chip its own list writes; a kind's row opens; the picker's row opens the picker; anything else is written as its mention.
  const choose = (row: MentionRow) => {
    if ("from" in row) openRow(row);
    else if ("skill" in row) skills?.onChoose(row.skill);
    else if ("picksDate" in row) {
      if (trigger !== undefined) pickNewDate(trigger);
    } else onChoose({ name: row.written ?? row.name, target: encodeMention(row.mention, place) });
  };

  // The list closed by Escape or a press away stays closed until the caret leaves its word.
  const closeList = () => {
    if (trigger !== undefined) setClosed({ start: trigger.start });
  };

  // ↑, ↓, Home, End, Enter and Escape steer the list as any combobox's do;
  // ⌘Enter writes the highlighted row as a bare Enter does.
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

  // Note that a file's card is made as its row is drawn, because the repository's paths are thousands and only the few listed hang one.
  const shownCode = source?.shownCode ?? NO_SHOWN_CODE;
  const openFiles = source?.openFiles ?? NO_OPEN_FILES;
  const fileCard: FileCardOf = (row) => {
    if (!("mention" in row) || row.mention.kind !== MENTION_KIND.FILE) return undefined;
    const { path } = row.mention;
    // Note that the note read is of the revision a row opens: the open tab's, else the default branch's head.
    const commit = openFiles.find((file) => file.path === path)?.commit;
    return <FileCard path={path} note={newestFileNote(shownCode, path, { repository, commit })} />;
  };
  // The list hangs by the word's line, on the side asked; a press outside it and the room closes it as Escape does, and it fades as it closes.
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
      fileCard={fileCard}
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
    // The field names the list it opened and the row highlighted in it, as any combobox's does.
    aria: listAria(field.field),
    onTrigger: setTrigger,
    onKey,
    pickDate: datePicker.open,
  };
}
