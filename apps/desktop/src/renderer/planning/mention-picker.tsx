import { INTEGRATION_NAME, type IntegrationProvider } from "@luke/features/integration-wire";
import {
  encodeMention,
  isMentionableTool,
  MENTION_KIND,
  type Mention,
  type MentionPlace,
  sectionAnchors,
} from "@luke/features/mention-link";
import { planSections } from "@luke/features/plan-document";
import { PLAN_TREE_ENTRY } from "@luke/features/plan-wire";
import { ACT_KIND } from "@luke/host/acts";
import { DocumentIcon, ProviderMark } from "@luke/ui";
import type { SkillOption } from "@luke/ui/skill-mention";
import { fileFolder, fileName } from "@luke/voice/code-pane-model";
import { defaultFilter } from "cmdk";
import { BookOpenIcon, FolderIcon, HashIcon } from "lucide-react";
import { type RefObject, useEffect, useId, useState } from "react";
import { useAct } from "../act";
import { type IntegrationToolsReads, useIntegrationTools } from "../integration-tools";
import type { ComposerTrigger, MentionNode } from "../plan-editor/contract";
import { FileTypeIcon } from "./file-type-icon";

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
 * A pick hands the editor the mention's name and its target
 * (`@luke/features/mention-link`), which the editor writes in place of
 * the word; the name is the file's or folder's own name, the heading, the
 * plan's name, the server's name, or the server's name and the tool's.
 */

/** What the list's groups are called, in the order they stand. */
const MENTION_GROUP = {
  FILES: "Files and folders",
  PLAN: "Plan",
  SKILLS: "Skills",
  SERVERS: "MCP servers",
} as const;

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
const NO_SERVERS: readonly IntegrationProvider[] = [];

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

/** The plan's rows: each section by its heading, a heading borne twice once for each section, then the plan itself. */
function planRows(planId: string, planName: string, text: string): MentionRow[] {
  const headings = planSections(text).map((section) => section.heading);
  const anchors = sectionAnchors(headings);
  return [
    ...headings.flatMap((heading, at): MentionRow[] => {
      const anchor = anchors[at] ?? "";
      if (anchor === "") return [];
      return [
        {
          mention: { kind: MENTION_KIND.SECTION, planId, anchor },
          name: heading,
          detail: "Section",
          terms: heading,
        },
      ];
    }),
    {
      mention: { kind: MENTION_KIND.PLAN, planId },
      name: planName,
      detail: "The whole plan",
      terms: planName,
    },
  ];
}

/** Each connected server's row, and once a word is typed each of its tools' rows as far as its read answered, found by the server's name and the tool's. */
function serverRows(
  servers: readonly IntegrationProvider[],
  reads: IntegrationToolsReads,
  query: string,
): MentionRow[] {
  return servers.flatMap((provider) => {
    const name = INTEGRATION_NAME[provider];
    const server: MentionRow = {
      mention: { kind: MENTION_KIND.SERVER, provider },
      name,
      detail: SERVER_DETAIL,
      terms: name,
    };
    const read = reads[provider];
    if (query.trim() === "" || read === undefined || !("tools" in read)) return [server];
    // Note that a tool whose name no mention can carry is left out, since its pick would name nothing.
    const tools = read.tools.flatMap((tool): MentionRow[] => {
      const mention: Mention = { kind: MENTION_KIND.TOOL, provider, tool: tool.name };
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

/** The groups the list offers for the word: the plan's and the servers' for no query, else each kind's best, files and folders first. */
function groupsFor(
  query: string,
  paths: readonly RepositoryPath[] | undefined,
  plan: readonly MentionRow[],
  skills: readonly MentionRow[],
  servers: readonly MentionRow[],
): readonly MentionGroup[] {
  const files = query.trim() === "" || paths === undefined ? [] : best(paths.map(pathRow), query);
  return [
    { label: MENTION_GROUP.FILES, rows: files },
    { label: MENTION_GROUP.PLAN, rows: best(plan, query) },
    { label: MENTION_GROUP.SKILLS, rows: best(skills, query) },
    { label: MENTION_GROUP.SERVERS, rows: best(servers, query) },
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
    case MENTION_KIND.PLAN:
      return <DocumentIcon />;
    case MENTION_KIND.SERVER:
    case MENTION_KIND.TOOL:
    case MENTION_KIND.LINK:
      return <ProviderMark provider={mention.provider} />;
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

/** The plan whose sections and repository the list offers, the workspace it stands in, and its text as it stands now. */
export interface MentionSource {
  readonly planId: string;
  readonly planName: string;
  /** The slug of the plan's workspace, which a mention of it is written under. */
  readonly workspace: string;
  /** The plan's repository, `owner/name`; null before one is chosen. */
  readonly repository: string | null;
  readonly text: () => string;
}

/**
 * The `@` list for an editor on a plan's page: its rows read from the
 * plan's words as they stand and the repository's paths, placed by the word
 * in `room`, and a pick handed to `onChoose` as the mention's node; a list
 * that never opens where there is no plan to offer.
 */
export function useMentionPicker({
  source,
  skills,
  servers = NO_SERVERS,
  room,
  side,
  onChoose,
}: {
  source: MentionSource | undefined;
  /** The repository's skills, where the words go to an agent; none for the plan's own words. */
  skills?: MentionSkills | undefined;
  /** The account's connected MCP servers, where the words go to an agent; none for the plan's own words. */
  servers?: readonly IntegrationProvider[];
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
    repository: string | null;
    paths: readonly RepositoryPath[];
  }>();

  const planId = source?.planId ?? "";
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
    paths?.planId === planId && paths.repository === repository ? paths.paths : undefined;
  useEffect(() => {
    if (!open || read !== undefined) return;
    let live = true;
    act(ACT_KIND.PLANNING_TREE, { planId, path: "", recursive: true }).then(
      (answer) => {
        if (!live) return;
        const entries = "folder" in answer ? answer.folder.entries : [];
        setPaths({
          planId,
          repository,
          paths: entries.map((entry) => ({
            path: entry.name,
            folder: entry.kind === PLAN_TREE_ENTRY.FOLDER,
          })),
        });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [open, read, act, planId, repository]);

  // The skills are asked for as each `@` word opens the list, as the `/` list asks for them; a read
  // that answered is kept, and one that failed is asked again by the next word.
  const askSkills = skills?.ask;
  const askedAt = open ? trigger.start : undefined;
  useEffect(() => {
    if (askedAt !== undefined) askSkills?.();
  }, [askedAt, askSkills]);

  // Each server's tools are read while the list stands open, and forgotten once it closes.
  const tools = useIntegrationTools(open ? servers : NO_SERVERS);
  const groups = open
    ? groupsFor(
        trigger.query,
        read,
        planRows(planId, source.planName, source.text()),
        skillRows(skills?.known ?? []),
        serverRows(servers, tools, trigger.query),
      )
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
