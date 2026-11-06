import type { WorkspaceMember } from "@repo/features/workspace-wire";
import {
  isAgentTab,
  isChangesTab,
  isCloudBrowserTab,
  isFileTab,
  isLocalTab,
  isPageTab,
  isSubagentTab,
  isTerminalTab,
  isTranscriptTab,
  pullRequestLabelOf,
  TAB_WORDS,
} from "@repo/ui/tab-strip-model";
import { mainTabLabel } from "./desktop/main-tabs.js";
import type { StepTitle } from "./navigation-history.js";
import { ROUTED_PLACE, type RoutedPlace } from "./route-gates.js";
import { agentName } from "./tasks/agent-model.js";
import { isOverviewTab, type MainTab } from "./tasks/use-main-tabs.js";
import { SIDE_PANEL_TAB_KIND, type SidePanelTab } from "./tasks/use-side-panel.js";
import type { TasksControl } from "./tasks/use-tasks-tab.js";

const VERSION_HISTORY_WORDS = "Version history";

const INBOX_WORDS = "Inbox";

const PAGE_WORDS = "Page";

type StepNameTasks = Pick<TasksControl, "tasks" | "activeTaskId" | "agents" | "pages">;

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function agentNameNow(tasks: StepNameTasks, taskId: string, agentId: string): string | undefined {
  const open =
    taskId === tasks.activeTaskId
      ? tasks.agents.agents?.find((agent) => agent.id === agentId)
      : undefined;
  const line =
    open ??
    tasks.tasks
      .find((task) => task.id === taskId)
      ?.agents?.agents?.find((agent) => agent.id === agentId);
  return line === undefined ? undefined : agentName(line, tasks.agents.models);
}

function columnTabLabel(tab: MainTab, taskId: string, tasks: StepNameTasks): string | undefined {
  return isAgentTab(tab) ? agentNameNow(tasks, taskId, tab.agent) : mainTabLabel(tab, tasks.agents);
}

function sideTabLabel(tab: SidePanelTab, taskId: string, tasks: StepNameTasks): string | undefined {
  if (isFileTab(tab)) return fileName(tab.file);
  if (isChangesTab(tab)) {
    return tab.number === undefined
      ? TAB_WORDS.PULL_REQUEST
      : pullRequestLabelOf({ number: tab.number, title: TAB_WORDS.PULL_REQUEST });
  }
  if (isPageTab(tab)) {
    return taskId === tasks.activeTaskId
      ? tasks.pages?.find((page) => page.id === tab.page)?.title
      : undefined;
  }
  if (isTerminalTab(tab)) return TAB_WORDS.TERMINAL;
  if (isLocalTab(tab)) return TAB_WORDS.LOCAL;
  if (isCloudBrowserTab(tab)) return TAB_WORDS.BROWSER;
  if (isSubagentTab(tab)) return "Worker";
  if (isTranscriptTab(tab)) return agentNameNow(tasks, taskId, tab.transcript);
  return SIDE_PANEL_TAB_KIND[tab].label;
}

function shownSideTabLabel(tab: SidePanelTab, taskId: string, tasks: StepNameTasks): string {
  const named = sideTabLabel(tab, taskId, tasks);
  if (named !== undefined) return named;
  return isPageTab(tab) ? PAGE_WORDS : TAB_WORDS.AGENT;
}

export type StepTitleTasks = Pick<
  TasksControl,
  | "tasks"
  | "boundFor"
  | "activeTaskId"
  | "agents"
  | "pages"
  | "mainTabs"
  | "sidePanel"
  | "inboxView"
  | "agentView"
  | "personView"
  | "automationsView"
  | "boardView"
  | "history"
>;

function taskName(tasks: StepNameTasks, taskId: string | undefined): string | undefined {
  if (taskId === undefined) return undefined;
  return tasks.tasks.find((task) => task.id === taskId)?.name;
}

export function stepTitle(
  routed: RoutedPlace | undefined,
  tasks: StepTitleTasks,
): StepTitle | undefined {
  if (routed === ROUTED_PLACE.SETTINGS) return { label: "Settings" };
  if (tasks.personView.userId !== undefined) {
    return { label: tasks.personView.name ?? "Profile" };
  }
  if (tasks.boardView.open) return { label: "Tasks" };
  if (tasks.automationsView.open) return { label: "Automations" };
  if (tasks.inboxView.open) {
    const { chosen } = tasks.inboxView;
    const holder = chosen !== undefined && "taskId" in chosen ? chosen.taskId : undefined;
    return { label: INBOX_WORDS, detail: taskName(tasks, holder) };
  }
  if (tasks.agentView.agentId !== undefined) return { label: "Agent" };
  if (tasks.boundFor === undefined) return { label: "Home" };
  const name = taskName(tasks, tasks.boundFor);
  if (name === undefined) return undefined;
  if (tasks.history.open) return { label: name, detail: VERSION_HISTORY_WORDS };
  if (tasks.activeTaskId !== tasks.boundFor) return { label: name };
  const { boundFor } = tasks;
  const columnTab = tasks.mainTabs.tab;
  const column =
    columnTab === undefined || isOverviewTab(columnTab)
      ? undefined
      : columnTabLabel(columnTab, boundFor, tasks);
  const side =
    tasks.sidePanel.open && tasks.sidePanel.tab !== undefined
      ? shownSideTabLabel(tasks.sidePanel.tab, boundFor, tasks)
      : undefined;
  const shown = [column, side].filter((part) => part !== undefined);
  if (shown.length === 0) return { label: name, detail: undefined };
  return { label: name, detail: shown.join(" · "), panes: { column, side } };
}

export const NAMED_STEP = {
  TASK: "task",
  VERSION_HISTORY: "version-history",
  INBOX: "inbox",
  PERSON: "person",
} as const;

export type NamedStep =
  | {
      readonly kind: typeof NAMED_STEP.TASK;
      readonly taskId: string;
      readonly column: MainTab | undefined;
      readonly side: SidePanelTab | undefined;
    }
  | { readonly kind: typeof NAMED_STEP.VERSION_HISTORY; readonly taskId: string }
  | { readonly kind: typeof NAMED_STEP.INBOX; readonly taskId: string | undefined }
  | { readonly kind: typeof NAMED_STEP.PERSON; readonly userId: string };

export function memberName(
  members: readonly WorkspaceMember[] | undefined,
  userId: string,
): string | undefined {
  return members?.find((member) => member.userId === userId)?.name;
}

function liveTaskTitle(
  step: Extract<NamedStep, { kind: typeof NAMED_STEP.TASK }>,
  kept: StepTitle | undefined,
  tasks: StepNameTasks,
): StepTitle | undefined {
  const label = taskName(tasks, step.taskId) ?? kept?.label;
  if (label === undefined) return undefined;
  const { taskId, column, side } = step;
  const columnName =
    column === undefined || isOverviewTab(column)
      ? null
      : (columnTabLabel(column, taskId, tasks) ?? kept?.panes?.column);
  const sideName =
    side === undefined ? null : (sideTabLabel(side, taskId, tasks) ?? kept?.panes?.side);
  if (columnName === undefined || sideName === undefined) return { label, detail: kept?.detail };
  const shown = [columnName, sideName].filter((part) => part !== null);
  return { label, detail: shown.length === 0 ? undefined : shown.join(" · ") };
}

export function liveStepTitle(
  step: NamedStep | undefined,
  kept: StepTitle | undefined,
  tasks: StepNameTasks,
  members: readonly WorkspaceMember[] | undefined,
): StepTitle | undefined {
  switch (step?.kind) {
    case undefined:
      return kept;
    case NAMED_STEP.TASK:
      return liveTaskTitle(step, kept, tasks);
    case NAMED_STEP.VERSION_HISTORY: {
      const label = taskName(tasks, step.taskId) ?? kept?.label;
      return label === undefined ? undefined : { label, detail: VERSION_HISTORY_WORDS };
    }
    case NAMED_STEP.INBOX: {
      const detail = kept?.detail === undefined ? undefined : taskName(tasks, step.taskId);
      return { label: kept?.label ?? INBOX_WORDS, detail: detail ?? kept?.detail };
    }
    case NAMED_STEP.PERSON: {
      const label = memberName(members, step.userId) ?? kept?.label;
      return label === undefined ? undefined : { label, detail: kept?.detail };
    }
  }
}
