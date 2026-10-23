import { TASK_BOUNDS } from "@luke/features/task-wire";
import {
  BackIcon,
  DocumentIcon,
  IconButton,
  InlineEdit,
  type InlineEditEnd,
  Tooltip,
} from "@luke/ui";
import { BotIcon, ListIcon } from "lucide-react";
import type { AwayStep } from "../navigation-history.js";
import { SIDE_PANEL_TAB, type SidePanelTab } from "../tasks/use-side-panel.js";
import type { MenuAction } from "./action-menu.js";

/**
 * task-pane-switcher.tsx -- how a phone heads a task: one row of the way
 * back, the title of what is on screen, and one ⋯, whose menu leads with the
 * task's three views, its Plan, its Agents, and its Activity.
 *
 * Nothing here is held apart from the side panel: the views read what the
 * panel already holds. Plan is the panel open on the plan; Agents is the
 * panel shut, the agents' column and its tabs standing; Activity is the
 * panel open on the list of every other tab it holds, or on one of them
 * chosen from that list. So the tabs a phone opens are the same tabs, kept
 * the same way (`use-side-panel.ts`), and Back walks them as it did.
 *
 * The row is a phone's standard header and holds nothing else: the way back,
 * its glyph alone, is named for where it goes, the list the task was opened
 * from on the task's own views, or Activity on a tab chosen there; the
 * title, centred between the two corners, names the task, or the tab shown;
 * and the ⋯ holds the views as a checked group, then what the tab
 * shown offers, then the task's own actions (`task-actions.tsx`).
 */

/** The three views of a task on a phone. */
export const TASK_PANE = {
  PLAN: "plan",
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
 * Which view stands: Agents while the panel is shut, Plan while it shows the
 * plan and its list is not asked for, and Activity otherwise, the list or any
 * other tab chosen from it.
 */
export function taskPaneOf(panel: {
  readonly open: boolean;
  readonly tab: SidePanelTab | undefined;
  readonly listed: boolean;
}): TaskPane {
  if (!panel.open) return TASK_PANE.AGENTS;
  if (panel.tab === SIDE_PANEL_TAB.PLAN && !panel.listed) return TASK_PANE.PLAN;
  return TASK_PANE.ACTIVITY;
}

/** The ⋯'s first group: the three views, the one standing checked, each choosing itself. */
export function taskPaneItems(pane: TaskPane, onChoose: (pane: TaskPane) => void): MenuAction[] {
  const item = (value: TaskPane, label: string, icon: React.JSX.Element): MenuAction => ({
    label,
    icon,
    checked: pane === value,
    onSelect: () => onChoose(value),
  });
  return [
    item(TASK_PANE.PLAN, "Plan", <DocumentIcon />),
    item(TASK_PANE.AGENTS, "Agents", <BotIcon />),
    item(TASK_PANE.ACTIVITY, "Activity", <ListIcon />),
  ];
}

/** Where the way back goes, and what it is called there. */
export interface TaskHeadBack {
  readonly label: string;
  readonly onPress: () => void;
}

/**
 * The way out of a task, named for the page it goes back to, as the
 * window's history names that step (`WindowHistory`'s `away`): the Tasks
 * page, the Inbox, Chat, or another task; the Tasks page where none stands
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

/** What the way back is called: where it goes, since its glyph alone says only that it goes back. */
function backLabel(back: TaskHeadBack): string {
  return `Back to ${back.label}`;
}

/**
 * The row heading a task on a phone; see the module's head. Its corners are
 * one control wide each, the way back at its start and the ⋯ at its end, so
 * the title stands centred between them and truncates there.
 */
export function TaskHead({
  back,
  title,
  rename,
  actions,
}: {
  back: TaskHeadBack;
  /** What is on screen: the task's name, or the tab shown. */
  title: string;
  /** The task's name as a field in the title's place while it is renamed, `title` then being the task's name. */
  rename?: TaskHeadRename | undefined;
  /** The row's one ⋯ (`TaskActions`). */
  actions: React.ReactNode;
}): React.JSX.Element {
  return (
    <header className="desktop-toolbar task-head">
      <div className="task-head-back">
        <Tooltip label={backLabel(back)}>
          <IconButton icon={<BackIcon />} label={backLabel(back)} onClick={back.onPress} />
        </Tooltip>
      </div>
      <div className="desktop-toolbar-heading">
        <h1 className="desktop-toolbar-title">
          <InlineEdit
            value={title}
            label="Task name"
            maxLength={TASK_BOUNDS.MAX_NAME_CHARS}
            editing={rename?.editing === true}
            onEnd={(end) => rename?.onEnd(end)}
          />
        </h1>
      </div>
      <div className="desktop-toolbar-actions">{actions}</div>
    </header>
  );
}
