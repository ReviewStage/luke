import {
  isBrowserTab,
  isChangesTab,
  isCloudBrowserTab,
  isFileTab,
  isMacTerminalTab,
  isPageTab,
  isSubagentTab,
  isTerminalTab,
  isTranscriptTab,
  pullRequestLabelOf,
  TAB_WORDS,
} from "@luke/ui/tab-strip-model";
import { mainTabLabel } from "./desktop/main-tabs.js";
import type { StepTitle } from "./navigation-history.js";
import { PANEL_TAB, type PanelTab } from "./panel-tabs.js";
import { SIDE_PANEL_TAB_KIND, type SidePanelTab } from "./tasks/use-side-panel.js";
import type { TasksControl } from "./tasks/use-tasks-tab.js";

/**
 * history-titles.ts -- what each step of the window's history is called, as Back's and Forward's menus list it.
 *
 * A step is named as the window stands on it, since a tab's name is known
 * only while its task is open: the page by what the window's title calls it
 * (`window-title.ts`), and a task's step by the task, with the tabs its
 * column and side panel showed under it, "Fix token refresh · Code". An
 * Inbox item's step names the task the item is of. A Settings page or a
 * Chat place is named by its page alone.
 */

/** The last part of a path, which a File tab is named by. */
function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** What a side panel tab is called under its task's name. */
function sideTabLabel(tab: SidePanelTab, tasks: StepTitleTasks): string {
  if (isFileTab(tab)) return fileName(tab.file);
  if (isChangesTab(tab)) {
    return tab.number === undefined
      ? TAB_WORDS.PULL_REQUEST
      : pullRequestLabelOf({ number: tab.number, title: TAB_WORDS.PULL_REQUEST });
  }
  if (isPageTab(tab)) {
    return tasks.pages?.find((page) => page.id === tab.page)?.title ?? "Page";
  }
  if (isTerminalTab(tab)) return TAB_WORDS.TERMINAL;
  if (isMacTerminalTab(tab)) return TAB_WORDS.MAC_TERMINAL;
  if (isBrowserTab(tab) || isCloudBrowserTab(tab)) return TAB_WORDS.BROWSER;
  if (isSubagentTab(tab)) return "Worker";
  if (isTranscriptTab(tab)) {
    const agent = tasks.agents.agents?.find((each) => each.id === tab.transcript);
    return agent === undefined
      ? TAB_WORDS.CODING_AGENT
      : (mainTabLabel({ agent: agent.id }, tasks.agents) ?? TAB_WORDS.CODING_AGENT);
  }
  return SIDE_PANEL_TAB_KIND[tab].label;
}

/** The parts of the Tasks tab a step's name reads. */
export type StepTitleTasks = Pick<
  TasksControl,
  | "tasks"
  | "archived"
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
  | "chatView"
  | "boardView"
  | "history"
>;

/** The name of a task the account lists, where it is listed. */
function taskName(tasks: StepTitleTasks, taskId: string | undefined): string | undefined {
  if (taskId === undefined) return undefined;
  return [...tasks.tasks, ...tasks.archived].find((task) => task.id === taskId)?.name;
}

/** What the step the window stands on is called, in a room that is `narrow` or not; none while nothing names it, as a task not yet listed. */
export function stepTitle(
  tab: PanelTab,
  tasks: StepTitleTasks,
  narrow = false,
): StepTitle | undefined {
  if (tab === PANEL_TAB.SETTINGS) return { label: "Settings" };
  if (tasks.inboxView.open) {
    // Note that an Inbox showing one column names no item while its list stands, as its step holds none.
    const single = narrow || tasks.inboxView.single === true;
    const chosen = single && tasks.inboxView.listed ? undefined : tasks.inboxView.chosen;
    const holder = chosen !== undefined && "taskId" in chosen ? chosen.taskId : undefined;
    return { label: "Inbox", detail: taskName(tasks, holder) };
  }
  if (tasks.agentView.agentId !== undefined) return { label: "Agent" };
  if (tasks.personView.userId !== undefined) {
    return { label: tasks.personView.name ?? "Profile" };
  }
  if (tasks.automationsView.open) return { label: "Automations" };
  if (tasks.chatView.open) return { label: "Chat" };
  if (tasks.boardView.open) return { label: "Tasks" };
  if (tasks.boundFor === undefined) return { label: "Welcome" };
  const name = taskName(tasks, tasks.boundFor);
  if (name === undefined) return undefined;
  if (tasks.history.open) return { label: name, detail: "Version history" };
  // Note that the strips are named only once they are the task's, as the history reads them.
  if (tasks.activeTaskId !== tasks.boundFor) return { label: name };
  const column =
    tasks.mainTabs.tab === undefined ? undefined : mainTabLabel(tasks.mainTabs.tab, tasks.agents);
  const side =
    tasks.sidePanel.open && tasks.sidePanel.tab !== undefined
      ? sideTabLabel(tasks.sidePanel.tab, tasks)
      : undefined;
  const shown = [column, side].filter((part) => part !== undefined);
  return { label: name, detail: shown.length === 0 ? undefined : shown.join(" · ") };
}
