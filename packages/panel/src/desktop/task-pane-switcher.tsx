import { TASK_BOUNDS } from "@luke/features/task-wire";
import {
  BackButton,
  CHOICE_BAR_FOLD,
  CHOICE_BAR_LOOK,
  CHOICE_BAR_SIZE,
  ChoiceBar,
  type ChoiceItem,
  dropBelow,
  InlineEdit,
  type InlineEditEnd,
  NO_BACK_KEY,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
  type ToolbarPickUp,
  useMenu,
} from "@luke/ui";
import { useRef } from "react";
import type { AwayStep } from "../navigation-history.js";
import { isOverviewTab, type MainTab } from "../tasks/use-main-tabs.js";
import { ActionMenu, type MenuAction } from "./action-menu.js";
import { PhoneHead } from "./phone-head.js";

/**
 * task-pane-switcher.tsx -- how a phone heads a task: one row of the way
 * back, the title of what is on screen, and one ⋯, and under it one
 * segmented row of the task's three views, its Overview, its agent, and its
 * Activity (`TaskPaneBar`), which stands in the desktop's tab strip's place.
 *
 * Nothing here is held apart from the column and the side panel: the views
 * read what they already hold. Overview is the panel shut over the column on
 * its Overview, the task's plan; Agents is the panel shut over the column on
 * an agent's tab; Activity is the panel open on the list of every tab it
 * holds, or on one of them chosen from that list. So the tabs a phone opens
 * are the same tabs, kept the same way (`use-main-tabs.ts`,
 * `use-side-panel.ts`), and Back walks them as it did.
 *
 * The row is a phone's standard header and holds nothing else: the way back,
 * its glyph alone, is named for where it goes, the list the task was opened
 * from on the task's own views, or Activity on a tab chosen there; the
 * title, centred between the two corners, names the task, or the tab shown;
 * and the ⋯ holds the menu of what is on screen: the task's own on Overview
 * (`task-actions.tsx`), the chosen agent's on Agents (`agent-actions.tsx`),
 * and the tab's on one chosen from Activity, as its own ⋯ offers it where a
 * bar stands. The views are the segmented row's alone, a finger's size: the
 * middle one is named for the task's one agent, or counts its agents where
 * it holds several, a press then dropping the list of them to choose from.
 */

/** The three views of a task on a phone. */
export const TASK_PANE = {
  OVERVIEW: "overview",
  AGENTS: "agents",
  ACTIVITY: "activity",
} as const;

export type TaskPane = (typeof TASK_PANE)[keyof typeof TASK_PANE];

/** What the way back to the Activity list is called, on a tab chosen from it. */
export const ACTIVITY_BACK = "Activity";

/** What the way out of a task is called where no page stands behind it, and it opens the Tasks page. */
export const TASKS_BACK = "Tasks";

/** What the way out of a task is called where the page behind it has no name yet. */
const BACK = "Back";

/**
 * Which view stands: Activity while the panel is open, its list or any tab
 * chosen from it; else Overview while the column shows it, and Agents on any
 * other of its tabs.
 */
export function taskPaneOf(input: {
  readonly open: boolean;
  readonly column: MainTab | undefined;
}): TaskPane {
  if (input.open) return TASK_PANE.ACTIVITY;
  return isOverviewTab(input.column) ? TASK_PANE.OVERVIEW : TASK_PANE.AGENTS;
}

/** One of the task's agents as the row names it. */
export interface PaneAgent {
  readonly id: string;
  readonly name: string;
}

/** What the middle view is called: the task's one agent by its name, else Agents, counting them where it holds several. */
function agentsItem(agents: readonly PaneAgent[]): ChoiceItem<TaskPane> {
  const [only, ...more] = agents;
  if (only !== undefined && more.length === 0) return { value: TASK_PANE.AGENTS, label: only.name };
  return {
    value: TASK_PANE.AGENTS,
    label: "Agents",
    count: more.length > 0 ? String(agents.length) : undefined,
  };
}

/**
 * The row of a task's three views under a phone's header; see the module's
 * head. A press on the middle view where the task holds several agents, or
 * on it again while it stands, drops the list of them, the one shown
 * checked, rather than choosing one of them blind.
 */
export function TaskPaneBar({
  pane,
  agents,
  shownAgent,
  shown,
  onChoose,
  onChooseAgent,
}: {
  pane: TaskPane;
  /** The task's agents, archived ones left out, in the order the column lists them. */
  agents: readonly PaneAgent[];
  /** The agent whose tab the column shows, which the list checks; none on Overview, a draft, or Activity. */
  shownAgent: string | undefined;
  /** Whether the task is on screen, for the list not to outlive it. */
  shown: boolean;
  onChoose: (pane: TaskPane) => void;
  onChooseAgent: (agentId: string) => void;
}): React.JSX.Element {
  const row = useRef<HTMLDivElement>(null);
  const menu = useMenu(shown);
  const several = agents.length > 1;
  const listAgents = () => {
    const opener = row.current;
    if (opener !== null) menu.show(dropBelow(opener), opener);
  };
  const choose = (pressed: TaskPane | undefined) => {
    // Note that the view standing pressed again is undefined, as a clearable bar answers it, and chosen again, as Activity's list asks.
    const chosen = pressed ?? pane;
    const [only] = agents;
    if (chosen === TASK_PANE.AGENTS && several) listAgents();
    else if (chosen === TASK_PANE.AGENTS && only !== undefined) onChooseAgent(only.id);
    else onChoose(chosen);
  };
  const agentRows: MenuAction[] = agents.map((agent) => ({
    label: agent.name,
    checked: agent.id === shownAgent,
    onSelect: () => onChooseAgent(agent.id),
  }));
  return (
    <div ref={row} className="task-pane-bar flex flex-none px-luke-12 pb-luke-8">
      <ChoiceBar<TaskPane>
        label="Task views"
        items={[
          { value: TASK_PANE.OVERVIEW, label: "Overview" },
          agentsItem(agents),
          { value: TASK_PANE.ACTIVITY, label: "Activity" },
        ]}
        value={pane}
        clearable
        onChange={choose}
        look={CHOICE_BAR_LOOK.SEGMENTED}
        size={CHOICE_BAR_SIZE.TOUCH}
        fold={CHOICE_BAR_FOLD.WORDS}
        stretch
      />
      {menu.drawn === undefined ? null : (
        <ActionMenu label="Agents" menu={menu.drawn} groups={[agentRows]} onClose={menu.close} />
      )}
    </div>
  );
}

/** Where the way back goes, and what it is called there. */
export interface TaskHeadBack {
  readonly label: string;
  readonly onPress: () => void;
}

/**
 * The way out of a task, named for the page it goes back to, as the
 * window's history names that step (`WindowHistory`'s `away`): the Tasks
 * page, the Inbox, or another task; the Tasks page where none stands
 * behind it, which `onLeave` then opens.
 */
export function awayBack(away: AwayStep | undefined, onLeave: () => void): TaskHeadBack {
  const label = away === undefined ? TASKS_BACK : (away.title?.label ?? BACK);
  return { label, onPress: onLeave };
}

/** The task's name being edited in the title's place, as the ⋯'s Rename asks. */
interface TaskHeadRename {
  readonly editing: boolean;
  readonly onEnd: (end: InlineEditEnd) => void;
}

/**
 * The row heading a task on a phone; see the module's head. It is a phone's
 * header (`phone-head.tsx`): the way back at its start, the ⋯ at its end,
 * and the title centred between them.
 */
export function TaskHead({
  back,
  title,
  pickUp,
  rename,
  actions,
}: {
  back: TaskHeadBack;
  /** What is on screen: the task's name, or the tab shown; none on Overview, whose plan names the task in its own heading, which the row then picks up once it scrolls away (`pickUp`). */
  title: string | undefined;
  /** The plan's heading as the row picks it up where it draws no title. */
  pickUp?: ToolbarPickUp | undefined;
  /** The task's name as a field in the title's place while it is renamed, `title` then being the task's name. */
  rename?: TaskHeadRename | undefined;
  /** The row's one ⋯ (`PlaceMore`). */
  actions: React.ReactNode;
}): React.JSX.Element {
  return (
    <PhoneHead
      place="task"
      start={
        // Note that it names no key, because the window's Back takes one history step and this leaves the task or its tab.
        <BackButton
          label={back.label}
          place={back.label}
          command={NO_BACK_KEY}
          onBack={back.onPress}
        />
      }
      pickUp={pickUp}
      title={
        title === undefined ? undefined : (
          <Text
            as={TEXT_ELEMENT.H1}
            variant={TEXT_VARIANT.TOOLBAR_TITLE}
            className="luke-toolbar-title"
          >
            <InlineEdit
              value={title}
              label="Task name"
              maxLength={TASK_BOUNDS.MAX_NAME_CHARS}
              editing={rename?.editing === true}
              onEnd={(end) => rename?.onEnd(end)}
            />
          </Text>
        )
      }
      end={actions}
    />
  );
}
