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
import { ACT_KIND } from "@luke/host/acts";
import { DocumentIcon, ProviderMark } from "@luke/ui";
import type { Actor } from "@luke/ui/actor-model";
import type { NamedServer } from "@luke/ui/agent-servers-model";
import type { SkillOption } from "@luke/ui/skill-mention";
import { fileFolder, fileName } from "@luke/voice/code-pane-model";
import { defaultFilter } from "cmdk";
import { AppWindowIcon, BookOpenIcon, FolderIcon, HashIcon } from "lucide-react";
import { type RefObject, useEffect, useId, useState } from "react";
import { useAct } from "../act";
import { ACTOR_SIZE, ActorMark } from "../actor-ref";
import { type IntegrationToolsReads, useIntegrationTools } from "../integration-tools";
import type { ComposerTrigger, MentionNode } from "../plan-editor/contract";
import { FileTypeIcon } from "./file-type-icon";
import { NO_PLAN } from "./plan-mentions";
import { AgentMark } from "./tab-look";

/**
 * mention-picker.tsx -- the list an `@` opens: the plan's repository's files and folders, the plan's sections, and the plan, grouped by kind, narrowed as the word is typed, the pick written as its mention.
 *
 * The list opens the way the `/` list does (`skill-picker.tsx`), at the
 * word an editor reports (`ComposerTrigger`), the caret staying in the
 * editor throughout: ↑ and ↓ move the highlight, Enter or Tab write the
 * highlighted row as its mention, and Escape closes the list until the caret
 * leaves the word. Nothing typed after the `@`, it offers the plan and its
 * sections; typed, it finds each kind's best few by the words typed, scored
 * as ⌘K scores them (cmdk's own filter), files and folders first, each
 * group in a fixed place so a later read never moves the rows above it.
 * The repository's paths are read once per plan, the first time an `@` is
 * typed, through the same listing ⌘K finds files with
 * (`ACT_KIND.PLANNING_TREE`, the whole tree at the default branch).
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
 * glyph. And wherever the words go, it offers the coding agents of the
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
  SKILLS: "Skills",
  SERVERS: "MCP servers",
} as const;

/** What a page's row says beside its title. */
const PAGE_DETAIL = "Page";

/** What an agent's row says beside its name: its task's, this one's, or none. */
const AGENT_DETAIL = {
  THIS_TASK: "This task",
  NO_TASK: "No task",
  OTHER_TASK: "Another task",
  ARCHIVED: "Archived",
} as const;

/** What stands between an agent's task and its being archived in its row's detail. */
const DETAIL_JOIN = " · ";

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

/** The least of cmdk's scores the list counts as a match, as ⌘K counts one. */
const LEAST_SCORE = 0.01;

/** The list's own name, which its listbox is read by. */
const MENU_LABEL = "Mention";

/** What the list says where it has no row. */
const NO_MATCH = "Nothing matches";

/** The keys the list hears, said at its foot. */
const MENU_KEYS = ["↑↓ Move", "↵ Mention", "esc Close"] as const;

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
  /** An agent's tile, which its row wears as its tab does; none for any other row. */
  readonly actor?: Actor | undefined;
} & ({ readonly mention: Mention } | { readonly skill: string });

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
function planRows(planId: string, planName: string, text: string): MentionRow[] {
  if (planId === NO_PLAN) return [];
  const headings = planSections(text).map((section) => section.heading);
  const anchors = sectionAnchors(headings);
  return [
    ...headings.flatMap((heading, at): MentionRow[] => {
      const anchor = anchors[at] ?? "";
      if (anchor === "") return [];
      return [
        {
          mention: { kind: MENTION_KIND.SECTION, taskId: planId, anchor },
          name: heading,
          detail: "Section",
          terms: heading,
        },
      ];
    }),
    {
      mention: { kind: MENTION_KIND.TASK, taskId: planId },
      name: planName,
      detail: "The whole plan",
      terms: planName,
    },
  ];
}

/** Each of the plan's pages' rows, by its title; none where no plan stands. */
function pageRows(planId: string, pages: readonly MentionablePage[]): MentionRow[] {
  if (planId === NO_PLAN) return [];
  return pages.map((page) => ({
    mention: { kind: MENTION_KIND.PAGE, taskId: planId, pageId: page.id },
    name: page.title,
    detail: PAGE_DETAIL,
    terms: page.title,
  }));
}

/** What an agent's row says of its task: this one, another by its name, or none, and whether it is archived. */
function agentDetail(agent: MentionableAgent, planId: string): string {
  const task =
    agent.task === undefined
      ? AGENT_DETAIL.NO_TASK
      : agent.task.id === planId
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
  planId: string,
  own: readonly MentionableAgent[],
  workspace: readonly MentionableAgent[],
  self: string | undefined,
  query: string,
): MentionRow[] {
  const seen = new Set<string>(self === undefined ? [] : [self]);
  const typed = query.trim() !== "";
  const mine = planId === NO_PLAN ? [] : own.map((agent) => ({ ...agent, task: { id: planId } }));
  const rows: MentionRow[] = [];
  for (const agent of [...mine, ...workspace]) {
    if (seen.has(agent.id) || (agent.archived === true && !typed)) continue;
    seen.add(agent.id);
    const task = agent.task;
    const detail = agentDetail(agent, planId);
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

/** Each connected server's row, and once a word is typed each of its tools' rows as far as its read answered, found by the server's name and the tool's. */
function serverRows(
  servers: readonly NamedServer[],
  reads: IntegrationToolsReads,
  query: string,
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
    if (query.trim() === "" || read === undefined || !("tools" in read)) return [server];
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

/** The rows matching the query, best first, as many as a group lists; every row in order for no query. */
function best(rows: readonly MentionRow[], query: string): readonly MentionRow[] {
  if (query.trim() === "") return rows.slice(0, PER_GROUP);
  return rows
    .map((row) => ({ row, score: defaultFilter(row.terms, query) }))
    .filter((each) => each.score >= LEAST_SCORE)
    .sort((first, second) => second.score - first.score)
    .slice(0, PER_GROUP)
    .map((each) => each.row);
}

/** Every row of each kind but the repository's paths, which are offered only once a word is typed. */
interface KindRows {
  readonly plan: readonly MentionRow[];
  readonly pages: readonly MentionRow[];
  readonly agents: readonly MentionRow[];
  readonly skills: readonly MentionRow[];
  readonly servers: readonly MentionRow[];
}

/** The groups the list offers for the word: every kind's first few but the files for no query, else each kind's best, files and folders first. */
function groupsFor(
  query: string,
  paths: readonly RepositoryPath[] | undefined,
  rows: KindRows,
): readonly MentionGroup[] {
  const files = query.trim() === "" || paths === undefined ? [] : best(paths.map(pathRow), query);
  return [
    { label: MENTION_GROUP.FILES, rows: files },
    { label: MENTION_GROUP.PLAN, rows: best(rows.plan, query) },
    { label: MENTION_GROUP.PAGES, rows: best(rows.pages, query) },
    { label: MENTION_GROUP.AGENTS, rows: best(rows.agents, query) },
    { label: MENTION_GROUP.SKILLS, rows: best(rows.skills, query) },
    { label: MENTION_GROUP.SERVERS, rows: best(rows.servers, query) },
  ].filter((group) => group.rows.length > 0);
}

/** A row's glyph, as its chip wears it. */
function RowGlyph({ row }: { row: MentionRow }): React.JSX.Element {
  if ("skill" in row) return <BookOpenIcon aria-hidden="true" />;
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
  }
}

/** One row's id, under the list's own. */
function optionId(listId: string, index: number): string {
  return `${listId}-${index}`;
}

/** The list itself: each group's heading and rows, the highlighted one washed, and the keys at its foot. */
function MentionMenu({
  id,
  groups,
  at,
  place,
  onHover,
  onChoose,
}: {
  id: string;
  groups: readonly MentionGroup[];
  at: number;
  place: MenuPlace;
  onHover: (index: number) => void;
  onChoose: (row: MentionRow) => void;
}): React.JSX.Element {
  let index = -1;
  return (
    <div className="menu-surface searchable-menu mention-menu" style={place}>
      {/* Note that a press on a row keeps the caret in the editor, where the keys are read. */}
      <div
        id={id}
        className="plan-compose-menu-list"
        role="listbox"
        aria-label={MENU_LABEL}
        onMouseDown={(event) => event.preventDefault()}
      >
        {groups.map((group) => (
          // biome-ignore lint/a11y/useSemanticElements: a listbox's section is a group of options, which a <fieldset> of form controls is not.
          <div key={group.label} role="group" aria-label={group.label}>
            <div className="menu-heading" aria-hidden="true">
              {group.label}
            </div>
            {group.rows.map((row) => {
              index += 1;
              const mine = index;
              return (
                <button
                  key={"skill" in row ? row.skill : JSON.stringify(row.mention)}
                  id={optionId(id, mine)}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  className="menu-item"
                  aria-selected={mine === at}
                  onMouseMove={() => onHover(mine)}
                  onClick={() => onChoose(row)}
                >
                  <span className="menu-item-glyph">
                    <RowGlyph row={row} />
                  </span>
                  <span className="plan-compose-menu-name">{row.name}</span>
                  {row.detail === undefined ? null : (
                    <span className="menu-item-hint mention-row-detail">{row.detail}</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
        {groups.length === 0 ? <p className="plan-compose-menu-note">{NO_MATCH}</p> : null}
      </div>
      <div className="plan-compose-menu-foot mention-menu-foot" aria-hidden="true">
        {MENU_KEYS.map((key) => (
          <span key={key}>{key}</span>
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

/** The plan whose sections and repository the list offers, the workspace it stands in, and its text as it stands now; `NO_PLAN` for a page no plan holds, which offers its repository alone. */
export interface MentionSource {
  readonly planId: string;
  readonly planName: string;
  /** The slug of the plan's workspace, which a mention of it is written under. */
  readonly workspace: string;
  /** The plan's repository, `owner/name`; null before one is chosen. */
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
}

/** What a repository's paths are read by: the plan whose repository it is, or, with no plan, the workspace and the repository; none where neither names one. */
function treeKey(
  planId: string,
  workspaceId: string | undefined,
  repository: string | null,
): { planId: string } | { workspaceId: string; repository: string } | undefined {
  if (planId !== NO_PLAN) return { planId };
  if (workspaceId === undefined || repository === null) return undefined;
  return { workspaceId, repository };
}

/**
 * The `@` list for an editor on a plan's page: its rows read from the
 * plan's words as they stand and the repository's paths, placed by the word
 * in `room`, and a pick handed to `onChoose` as the mention's node; a list
 * that never opens where there is no plan to offer.
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
  const listId = useId();
  const { act } = useAct();
  const [trigger, setTrigger] = useState<ComposerTrigger | undefined>(undefined);
  const [highlight, setHighlight] = useState<Highlight | undefined>(undefined);
  const [closedAt, setClosedAt] = useState<number | undefined>(undefined);
  const [paths, setPaths] = useState<{
    planId: string;
    workspaceId: string | undefined;
    repository: string | null;
    paths: readonly RepositoryPath[];
  }>();

  const planId = source?.planId ?? NO_PLAN;
  const workspaceId = source?.workspaceId;
  const repository = source?.repository ?? null;
  const place: MentionPlace = { workspace: source?.workspace ?? "", repository };
  const open = source !== undefined && trigger !== undefined && closedAt !== trigger.start;
  // A word closed with Escape stays closed only while the caret is in it.
  const inWord = trigger !== undefined;
  useEffect(() => {
    if (!inWord) setClosedAt(undefined);
  }, [inWord]);

  // The repository's paths are read the first time the list opens on the plan, and again once its repository changes.
  const read =
    paths?.planId === planId && paths.workspaceId === workspaceId && paths.repository === repository
      ? paths.paths
      : undefined;
  useEffect(() => {
    if (!open || read !== undefined) return;
    const key = treeKey(planId, workspaceId, repository);
    if (key === undefined) return;
    let live = true;
    act(ACT_KIND.TASKS_TREE, { ...key, path: "", recursive: true }).then(
      (answer) => {
        if (!live) return;
        const entries = "folder" in answer ? answer.folder.entries : [];
        setPaths({
          planId,
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
  }, [open, read, act, planId, workspaceId, repository]);

  // The skills are asked for as each `@` word opens the list, as the `/` list asks for them; a read
  // that answered is kept, and one that failed is asked again by the next word.
  const askSkills = skills?.ask;
  const askedAt = open ? trigger.start : undefined;
  useEffect(() => {
    if (askedAt !== undefined) askSkills?.();
  }, [askedAt, askSkills]);

  // The workspace's newest agents are read as each `@` word opens the list, and once a word is
  // typed the service finds those it names, archived ones among them, however many the workspace
  // holds; each read is kept while its word stands, and the last one shown until the next lands.
  const readAgents = source?.readAgents;
  const wordAt = open ? trigger.start : undefined;
  const words = open && trigger.query.trim() !== "" ? trigger.query.trim() : undefined;
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
  const groups = open
    ? groupsFor(trigger.query, read, {
        plan: planRows(planId, source.planName, source.text()),
        pages: pageRows(planId, source.pages ?? NO_PAGES),
        agents: agentRows(
          planId,
          source.agents ?? NO_AGENTS,
          agentsRead?.agents ?? NO_AGENTS,
          self,
          trigger.query,
        ),
        skills: skillRows(skills?.known ?? []),
        servers: serverRows(servers, tools, trigger.query),
      })
    : [];
  const rows = groups.flatMap((group) => group.rows);
  const held =
    highlight !== undefined &&
    trigger !== undefined &&
    highlight.start === trigger.start &&
    highlight.query === trigger.query
      ? highlight.at
      : 0;
  const at = Math.min(held, Math.max(rows.length - 1, 0));
  // A skill is written as the `/name` chip its own list writes; anything else as its mention.
  const choose = (row: MentionRow) =>
    "skill" in row
      ? skills?.onChoose(row.skill)
      : onChoose({ name: row.name, target: encodeMention(row.mention, place) });

  const onKey = (event: KeyboardEvent): boolean => {
    if (!open) return false;
    if (event.key === "Escape") {
      event.stopPropagation();
      setClosedAt(trigger.start);
      return true;
    }
    const row = rows[at];
    if (row === undefined) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const step = event.key === "ArrowDown" ? 1 : rows.length - 1;
      setHighlight({ start: trigger.start, query: trigger.query, at: (at + step) % rows.length });
      return true;
    }
    if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
      choose(row);
      return true;
    }
    return false;
  };

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
    !open || box === null || placed === undefined ? null : (
      <MentionMenu
        id={listId}
        groups={groups}
        at={at}
        place={placeOf(trigger, placed, box.clientWidth)}
        onHover={(index) => setHighlight({ start: trigger.start, query: trigger.query, at: index })}
        onChoose={choose}
      />
    );

  return { menu, onTrigger: setTrigger, onKey };
}
