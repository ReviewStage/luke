// @vitest-environment jsdom

import {
  TASK_PRIORITY,
  TASK_STATUS,
  type TaskStatus,
  type TaskSummary,
} from "@repo/features/task-wire";
import { IDLE_TASKS_VIEW, TASKS_READ } from "@repo/features/tasks-view";
import type { Workspace, WorkspaceMember } from "@repo/features/workspace-wire";
import { RUN_PROFILE } from "@repo/host/app-state";
import { selectableListBehavior } from "@repo/ui/testing/selectable-list";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";
import { SHELL_ROOM } from "../shell-room.js";
import { useLeaveGuard, useTasksTab } from "../tasks/use-tasks-tab.js";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { handMembers } from "../testing/app-state.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import {
  ADMIN_AWAY,
  AGENT_AWAY,
  AUTOMATIONS_AWAY,
  BOARD_AWAY,
  INBOX_AWAY,
  PERSON_AWAY,
  UNKNOWN_WORKSPACE_AWAY,
  VERSION_HISTORY_AWAY,
} from "../testing/tasks-control.js";
import { TasksPage } from "./tasks-page.js";

/**
 * tasks-list-selectable.test.ts -- the Tasks page's List chooses its tasks as
 * every selectable list does (`@repo/ui/testing/selectable-list`), across the
 * groups its tasks stand in. The page over the tasks tab itself, five tasks
 * in three statuses; the key of each is its task's id.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const DEAN = "user-dean";

const ACME = {
  id: "workspace-acme",
  name: "Acme",
  role: "owner",
  github: null,
  memberCount: 1,
} as const satisfies Workspace;

const MEMBERS: readonly WorkspaceMember[] = [
  { userId: DEAN, name: "Dean Stratakos", email: "dean@acme.dev", role: "owner" },
];

/** A task of Acme's, numbered `number`, standing in `status`. */
function task(number: number, status: TaskStatus): TaskSummary {
  return {
    id: `t-${number}`,
    workspaceId: ACME.id,
    name: `Task ${number}`,
    repository: "acme/web",
    createdAt: 1,
    updatedAt: 100 - number,
    ownerId: DEAN,
    createdBy: { userId: DEAN, name: "Dean Stratakos" },
    status,
    priority: TASK_PRIORITY.NONE,
    number,
  };
}

const TASKS = [
  task(1, TASK_STATUS.TODO),
  task(2, TASK_STATUS.TODO),
  task(3, TASK_STATUS.IN_PROGRESS),
  task(4, TASK_STATUS.IN_PROGRESS),
  task(5, TASK_STATUS.BACKLOG),
];

/** The page over the tasks tab reading `TASKS`, and the ids of the tasks it was asked to open. */
async function mount() {
  window.localStorage.clear();
  fakeAppPlatform(QUIET_PANEL);
  fakeAppBridge({});
  fakeActPort({});
  handMembers(() => ({ rows: { members: MEMBERS } }));
  const opened: string[] = [];
  function Page() {
    const control = useTasksTab({
      tasks: {
        ...IDLE_TASKS_VIEW,
        listStatus: TASKS_READ.READY,
        workspaces: [ACME],
        tasks: TASKS,
      },
      run: { fixtureMode: false, profile: RUN_PROFILE.IDLE },
      signedIn: true,
      account: "dean@acme.dev",
      shown: true,
      unseenAgents: [],
      inboxWaiting: [],
      inboxTasks: [],
      inboxTaskless: [],
      inboxAgents: [],
      failedRuns: [],
      onOpenIntegrations: () => undefined,
      onOpenApiKeys: () => undefined,
      onOpenSettings: () => undefined,
      leaveGuard: useLeaveGuard(),
      room: SHELL_ROOM.WIDE,
      adminView: ADMIN_AWAY,
      boardView: BOARD_AWAY,
      personView: PERSON_AWAY,
      agentView: AGENT_AWAY,
      automationsView: AUTOMATIONS_AWAY,
      versionHistoryView: VERSION_HISTORY_AWAY,
      inboxView: INBOX_AWAY,
      unknownWorkspaceView: UNKNOWN_WORKSPACE_AWAY,
    });
    return createElement(TasksPage, {
      tasks: { ...control, onSelect: (taskId: string) => opened.push(taskId) },
      room: SHELL_ROOM.WIDE,
    });
  }
  const container = document.body.appendChild(document.createElement("div"));
  const root: Root = createRoot(container);
  act(() => root.render(withQueryClient(createElement(Page))));
  // Note that the members and the list land after the first paint.
  await act(async () => undefined);
  await act(async () => undefined);
  return {
    root: container,
    opened: () => opened,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
      vi.restoreAllMocks();
    },
  };
}

selectableListBehavior("TASKS", { mount });
