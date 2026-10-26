import type { Channel } from "@luke/features/channel-wire";
import type { WorkspaceMember } from "@luke/features/workspace-wire";
import {
  isAgentTab,
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
import { agentName } from "./tasks/coding-agent-model.js";
import type { MainTab } from "./tasks/use-main-tabs.js";
import { SIDE_PANEL_TAB_KIND, type SidePanelTab } from "./tasks/use-side-panel.js";
import type { TasksControl } from "./tasks/use-tasks-tab.js";

/**
 * history-titles.ts -- what each step of the window's history is called, as Back's and Forward's menus and ⌃Tab's cards list it.
 *
 * A step is named as the window stands on it, since a tab's name is known
 * only while its task is open: the page by what the window's title calls it
 * (`window-title.ts`), and a task's step by the task, with the tabs its
 * column and side panel showed under it, "Fix token refresh · Code". An
 * Inbox item's step names the task the item is of. With Channels on, the
 * Inbox's step is named by the channel its stream shows, "#app", and by the
 * task of the thread open in it, where one is. A Settings page is
 * named by its page alone.
 *
 * A step listed later is named again as what it names stands now
 * (`liveStepTitle`), by the ids it stood on: a task by the name the task
 * list gives it, an agent's tab by its agent's name as the open task's
 * agents or the task's row's agent line give it, and a person's page by
 * the name the workspace's members give them, and a channel's by the name
 * the workspace's channels give it. So a task, agent, person, or channel
 * renamed since is listed under the new name, and the name kept as the step
 * stood is only what a step falls back to where nothing the window reads
 * names it now.
 */

/** What a version history's step says under its task's name. */
const VERSION_HISTORY_WORDS = "Version history";

/** What the Inbox's step is called, and what it is called while Channels shows channels in its place and no channel names it. */
const INBOX_WORDS = "Inbox";
const CHANNELS_WORDS = "Channels";

/** What a Page tab is called where the window does not read its page's title. */
const PAGE_WORDS = "Page";

/** The parts of the Tasks tab a step's name is read again from: the task list, the open task's agents and pages. */
type StepNameTasks = Pick<TasksControl, "tasks" | "activeTaskId" | "agents" | "pages">;

/** The last part of a path, which a File tab is named by. */
function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** The name an agent of a task goes by now: as the open task's agents say, else as the task's row's agent line does; none where neither names it. */
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

/** What a column tab of a task is called now; none for an agent named nowhere the window reads. */
function columnTabLabel(tab: MainTab, taskId: string, tasks: StepNameTasks): string | undefined {
  return isAgentTab(tab) ? agentNameNow(tasks, taskId, tab.agent) : mainTabLabel(tab, tasks.agents);
}

/** What a side panel tab of a task is called under its task's name now; none for an agent named nowhere the window reads, or a page of a task not open, whose pages are not read. */
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
  if (isMacTerminalTab(tab)) return TAB_WORDS.MAC_TERMINAL;
  if (isCloudBrowserTab(tab)) return TAB_WORDS.BROWSER;
  if (isSubagentTab(tab)) return "Worker";
  if (isTranscriptTab(tab)) return agentNameNow(tasks, taskId, tab.transcript);
  return SIDE_PANEL_TAB_KIND[tab].label;
}

/** What a side panel tab is called as the window stands on it, its kind's word where nothing names it. */
function shownSideTabLabel(tab: SidePanelTab, taskId: string, tasks: StepNameTasks): string {
  const named = sideTabLabel(tab, taskId, tasks);
  if (named !== undefined) return named;
  return isPageTab(tab) ? PAGE_WORDS : TAB_WORDS.CODING_AGENT;
}

/** The parts of the Tasks tab a step's name reads. */
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

/** The name of a task the account lists, where it is listed. */
function taskName(tasks: StepNameTasks, taskId: string | undefined): string | undefined {
  if (taskId === undefined) return undefined;
  return tasks.tasks.find((task) => task.id === taskId)?.name;
}

/** What the step the window stands on is called, in a room that is `narrow` or not, with Channels on or not; none while nothing names it, as a task not yet listed. */
export function stepTitle(
  tab: PanelTab,
  tasks: StepTitleTasks,
  narrow = false,
  channelsOn = false,
): StepTitle | undefined {
  if (tab === PANEL_TAB.SETTINGS) return { label: "Settings" };
  if (tasks.inboxView.open) {
    // Note that an Inbox showing one column names no item while its list stands, as its step holds none.
    const single = narrow || tasks.inboxView.single === true;
    const chosen = single && tasks.inboxView.listed ? undefined : tasks.inboxView.chosen;
    const holder = chosen !== undefined && "taskId" in chosen ? chosen.taskId : undefined;
    return { label: channelsOn ? CHANNELS_WORDS : INBOX_WORDS, detail: taskName(tasks, holder) };
  }
  if (tasks.agentView.agentId !== undefined) return { label: "Agent" };
  if (tasks.personView.userId !== undefined) {
    return { label: tasks.personView.name ?? "Profile" };
  }
  if (tasks.automationsView.open) return { label: "Automations" };
  if (tasks.boardView.open) return { label: "Tasks" };
  if (tasks.boundFor === undefined) return { label: "Welcome" };
  const name = taskName(tasks, tasks.boundFor);
  if (name === undefined) return undefined;
  if (tasks.history.open) return { label: name, detail: VERSION_HISTORY_WORDS };
  // Note that the strips are named only once they are the task's, as the history reads them.
  if (tasks.activeTaskId !== tasks.boundFor) return { label: name };
  const { boundFor } = tasks;
  const column =
    tasks.mainTabs.tab === undefined
      ? undefined
      : columnTabLabel(tasks.mainTabs.tab, boundFor, tasks);
  const side =
    tasks.sidePanel.open && tasks.sidePanel.tab !== undefined
      ? shownSideTabLabel(tasks.sidePanel.tab, boundFor, tasks)
      : undefined;
  const shown = [column, side].filter((part) => part !== undefined);
  if (shown.length === 0) return { label: name, detail: undefined };
  return { label: name, detail: shown.join(" · "), panes: { column, side } };
}

/** What a channel's step is called: the channel, `#app`, and the task of the thread open in it, where one is. */
export function channelStepTitle(name: string, detail: string | undefined): StepTitle {
  return { label: `#${name}`, detail };
}

/** The kinds of step a name is read again for: those naming a task, a task's Inbox item, or a person. */
export const NAMED_STEP = {
  TASK: "task",
  VERSION_HISTORY: "version-history",
  INBOX: "inbox",
  PERSON: "person",
} as const;

/** A step by the ids its name is read from: a task with the tabs its panes showed, its version history, the Inbox on an item of a task, or a person's page. */
export type NamedStep =
  | {
      readonly kind: typeof NAMED_STEP.TASK;
      readonly taskId: string;
      readonly column: MainTab | undefined;
      readonly side: SidePanelTab | undefined;
    }
  | { readonly kind: typeof NAMED_STEP.VERSION_HISTORY; readonly taskId: string }
  | {
      readonly kind: typeof NAMED_STEP.INBOX;
      readonly taskId: string | undefined;
      /** The channel the stream showed, with Channels on. */
      readonly channelId?: string | undefined;
    }
  | { readonly kind: typeof NAMED_STEP.PERSON; readonly userId: string };

/** The name a person goes by now, by their id, as the workspace's members say; none for someone not among them, or while they are unread. */
export function memberName(
  members: readonly WorkspaceMember[] | undefined,
  userId: string,
): string | undefined {
  return members?.find((member) => member.userId === userId)?.name;
}

/** A task's step named again: its task's name now, and each of its tabs' now, or as the step called it where nothing names it now. */
function liveTaskTitle(
  step: Extract<NamedStep, { kind: typeof NAMED_STEP.TASK }>,
  kept: StepTitle | undefined,
  tasks: StepNameTasks,
): StepTitle | undefined {
  const label = taskName(tasks, step.taskId) ?? kept?.label;
  if (label === undefined) return undefined;
  const { taskId, column, side } = step;
  // Note that `null` is a pane that showed no tab, and `undefined` a tab named neither now nor as kept, which leaves the words kept whole.
  const columnName =
    column === undefined ? null : (columnTabLabel(column, taskId, tasks) ?? kept?.panes?.column);
  const sideName =
    side === undefined ? null : (sideTabLabel(side, taskId, tasks) ?? kept?.panes?.side);
  if (columnName === undefined || sideName === undefined) return { label, detail: kept?.detail };
  const shown = [columnName, sideName].filter((part) => part !== null);
  return { label, detail: shown.length === 0 ? undefined : shown.join(" · ") };
}

/**
 * What a step listed later is called: its name as it was kept, `kept`,
 * read again from what it names as that stands now, by the ids it stood on
 * (`step`), so a renamed task, agent, or person is listed by the new name.
 * Note that what nothing the window reads names now keeps its kept name,
 * and a step of no kind named again is called as it was kept.
 */
export function liveStepTitle(
  step: NamedStep | undefined,
  kept: StepTitle | undefined,
  tasks: StepNameTasks,
  members: readonly WorkspaceMember[] | undefined,
  channels?: readonly Channel[] | undefined,
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
      // Note that an Inbox step names an item only where it was kept naming one, as one column standing its list names none.
      const detail = kept?.detail === undefined ? undefined : taskName(tasks, step.taskId);
      const channel = channels?.find((each) => each.id === step.channelId);
      if (channel !== undefined) return channelStepTitle(channel.name, detail ?? kept?.detail);
      return { label: kept?.label ?? INBOX_WORDS, detail: detail ?? kept?.detail };
    }
    case NAMED_STEP.PERSON: {
      const label = memberName(members, step.userId) ?? kept?.label;
      return label === undefined ? undefined : { label, detail: kept?.detail };
    }
  }
}
