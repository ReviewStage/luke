import { CHOICE_BAR_LOOK, ChoiceBar, type ChoiceItem } from "@luke/ui";
import { SIDE_PANEL_TAB, type SidePanelTab } from "../tasks/use-side-panel.js";

/**
 * task-pane-switcher.tsx -- a phone's three views of a task: its Plan, its
 * Agents, and its Activity, chosen from one segmented bar heading the task in
 * place of the side panel's strip and its toggle.
 *
 * Nothing here is held apart from the side panel: the views read what the
 * panel already holds. Plan is the panel open on the plan; Agents is the
 * panel shut, the agents' column and its tabs standing; Activity is the
 * panel open on the list of every other tab it holds, or on one of them
 * chosen from that list. So the tabs a phone opens are the same tabs, kept
 * the same way (`use-side-panel.ts`), and Back walks them as it did.
 */

/** The three views of a task on a phone. */
export const TASK_PANE = {
  PLAN: "plan",
  AGENTS: "agents",
  ACTIVITY: "activity",
} as const;

export type TaskPane = (typeof TASK_PANE)[keyof typeof TASK_PANE];

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

/** The bar heading a task on a phone; see the module's head. */
export function TaskPaneSwitcher({
  pane,
  agents,
  waiting,
  onChoose,
}: {
  pane: TaskPane;
  /** How many agents the task has, counted after Agents; none at none. */
  agents: number;
  /** How many of the task's inbox items wait on the developer, counted after Activity; none at none. */
  waiting: number;
  onChoose: (pane: TaskPane) => void;
}): React.JSX.Element {
  const items: readonly ChoiceItem<TaskPane>[] = [
    { value: TASK_PANE.PLAN, label: "Plan" },
    { value: TASK_PANE.AGENTS, label: "Agents", count: agents > 0 ? String(agents) : undefined },
    {
      value: TASK_PANE.ACTIVITY,
      label: "Activity",
      count: waiting > 0 ? String(waiting) : undefined,
    },
  ];
  return (
    <div className="task-pane-switcher">
      <ChoiceBar
        label="Task view"
        items={items}
        value={pane}
        look={CHOICE_BAR_LOOK.SEGMENTED}
        stretch
        onChange={onChoose}
      />
    </div>
  );
}
