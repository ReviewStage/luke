// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentChangesAnswerView,
} from "@luke/features/coding-agent-view";
import { PLAN_ACTOR, type PlanRevisionLine, type TaskSummary } from "@luke/features/task-wire";
import { ACT_KIND } from "@luke/host/acts";
import { UPDATE_STATUS } from "@luke/settings/update";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { DesktopInbox } from "./desktop/desktop-inbox.js";
import { DesktopSidebar } from "./desktop/desktop-sidebar.js";
import { DesktopVersionHistory, taskVersionSubject } from "./desktop/desktop-version-history.js";
import { SIDEBAR_OVERLAY } from "./desktop/sidebar-collapse.js";
import { PANEL_TAB } from "./panel-tabs.js";
import { AgentAuthSection } from "./settings/agent-auth-section.js";
import { WorkspacePage } from "./settings/workspace-page.js";
import { SHELL_ROOM } from "./shell-room.js";
import { HISTORY_READ } from "./tasks/use-plan-history.js";
import { fakeActPort, fakeAppBridge } from "./testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "./testing/app-platform.js";
import { ChangesTabReading } from "./testing/changes-tab.js";
import { onRegistry } from "./testing/copy-feedback.js";
import { DOCUMENT_TASK } from "./testing/document-task.js";
import { followedInboxes } from "./testing/followed-inboxes.js";
import { installScrollIntoView } from "./testing/scroll-into-view.js";
import { codingAgentsControl, tasksControl } from "./testing/tasks-control.js";

/**
 * A read that did not land says so alike on every surface that reads: the
 * sidebar's tasks, the Inbox's list, a side panel tab, and a Settings
 * page's card each draw one alert, a sentence of the shape "The inbox
 * could not be read.", and one Retry, whose press reads again. Synthetic
 * tasks and keys.
 */

const ignore = () => undefined;
const UNANSWERED = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } as const;

const TASK: TaskSummary = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  workspaceId: "workspace-personal",
  name: "Billing usage alerts",
  createdAt: 1,
  updatedAt: 2,
  repository: "acme/relay",
};

/** Whether the service answers a read, rather than failing it, as a Retry finds it once it is back. */
let answering = false;

/** The host's inbox streams: a followed inbox could not be read until the service answers again, then holds nothing. */
const host = followedInboxes(() => (answering ? { items: [] } : UNANSWERED));

beforeEach(() => {
  installScrollIntoView();
  fakeAppPlatform(QUIET_PANEL);
  answering = false;
  window.localStorage.clear();
  // The window's motion as a Mac with none reduced answers it.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false, addEventListener: ignore, removeEventListener: ignore }),
  });
  fakeAppBridge({});
  fakeActPort({
    // Every followed inbox could not be read until the service answers again, then holds nothing.
    ...host.procedures,
    [ACT_KIND.CODING_AGENTS_LIST]: () => Promise.resolve({ agents: [] }),
    [ACT_KIND.PROVIDER_KEYS_READ]: () => Promise.resolve(answering ? { keys: [] } : UNANSWERED),
  });
});

const unmounts: (() => void)[] = [];

afterEach(() => {
  for (const unmount of unmounts.splice(0)) act(unmount);
  document.body.innerHTML = "";
});

/** Draws a surface into the page and lets every read it asked for answer. */
async function mount(surface: React.ReactElement): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  unmounts.push(() => root.unmount());
  act(() => root.render(onRegistry(AtomRegistry.make(), surface)));
  await settle();
  return container;
}

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** The surface's one read failure as a reader meets it: its words and its presses. */
function readFailure(page: HTMLElement) {
  const alerts = [...page.querySelectorAll<HTMLElement>('[role="alert"]')];
  assert.equal(alerts.length, 1, "one alert says the read failed");
  const [alert] = alerts;
  assert.ok(alert);
  const presses = [...alert.querySelectorAll<HTMLButtonElement>("button")];
  // The alert's words are what it says with its presses taken out, however it nests them.
  const said = alert.cloneNode(true);
  assert.ok(said instanceof HTMLElement);
  for (const press of said.querySelectorAll("button")) press.remove();
  const words = said.textContent;
  return {
    words,
    presses: presses.map((each) => each.textContent),
    retry: () => act(() => presses[0]?.click()),
  };
}

/** Asserts the failure is said as every other is: one sentence of the shape, one Retry. */
function assertSaidAlike(failure: ReturnType<typeof readFailure>, words: string): void {
  assert.equal(failure.words, words);
  assert.match(failure.words, /^[A-Z][^.]* could not be read\.$/u);
  assert.deepEqual(failure.presses, ["Retry"]);
}

test("the sidebar's plans that could not be read say so, and Retry reads the list again", async () => {
  let retried = 0;
  const page = await mount(
    createElement(DesktopSidebar, {
      sidebar: {
        collapsed: false,
        compact: false,
        overlay: SIDEBAR_OVERLAY.CLOSED,
        width: 264,
        onToggle: ignore,
        onOverlay: ignore,
        onResize: ignore,
        staged: false,
      },
      history: {
        canGoBack: false,
        canGoForward: false,
        onBack: ignore,
        onForward: ignore,
        steps: { back: [], forward: [] },
        onGoTo: ignore,
      },
      tasks: tasksControl({
        listFailed: true,
        onRetryList: () => {
          retried += 1;
        },
      }),
      tab: PANEL_TAB.TASKS,
      onTabChange: ignore,
      onPressWithin: ignore,
      account: {
        status: ACCOUNT_STATUS.SIGNED_IN,
        email: "dev@example.com",
        name: "Dev",
        provider: "github",
      },
      updates: {
        update: {
          status: UPDATE_STATUS.IDLE,
          currentVersion: "1.0.0",
          installSupported: true,
          upToDate: false,
        },
        build: { packaged: false },
        onCheck: () => Promise.resolve(),
        onInstall: ignore,
        onOpenLatest: ignore,
      },
      onSignOut: () => Promise.resolve(),
    }),
  );
  const failure = readFailure(page);
  assertSaidAlike(failure, "Your tasks could not be read.");
  failure.retry();
  assert.equal(retried, 1);
});

test("the Inbox's list says a plan it could not read as the sidebar does, and Retry lists what the plan holds", async () => {
  const page = await mount(
    createElement(DesktopInbox, {
      tasks: tasksControl({
        tasks: [TASK],
        inboxTasks: [{ taskId: TASK.id, items: 1, updatedAt: 2 }],
        inboxView: {
          open: true,
          chosen: undefined,
          onOpen: ignore,
          onClose: ignore,
          onChoose: ignore,
          onOpenItem: () => undefined,
          onOpenChannel: () => undefined,
          listed: false,
          onListed: ignore,
          pages: undefined,
          onTaskAgents: () => undefined,
        },
      }),
    }),
  );
  const failure = readFailure(page);
  assertSaidAlike(failure, "Some items could not be read.");
  answering = true;
  failure.retry();
  await settle();
  assert.equal(page.querySelector('[role="alert"]'), null, "the read landed, so nothing fails");
});

test("a side panel tab whose read failed says so alike, and Retry reads them again", async () => {
  let reads = 0;
  const readChanges = (): Promise<CodingAgentChangesAnswerView> => {
    reads += 1;
    return Promise.resolve(reads === 1 ? UNANSWERED : { pullRequest: null });
  };
  const page = await mount(
    createElement(ChangesTabReading, {
      agentId: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
      control: codingAgentsControl({ readChanges }),
      shown: true,
      repository: null,
      tree: { open: false, onToggle: ignore },
    }),
  );
  const failure = readFailure(page);
  assertSaidAlike(failure, "The changes could not be read.");
  failure.retry();
  await settle();
  assert.equal(page.querySelector('[role="alert"]'), null, "the read landed, so nothing fails");
});

test("Settings says a page's failed read alike in its card's place, the keys and the workspaces both, and Retry reads again", async () => {
  const keys = await mount(createElement(AgentAuthSection, { signedIn: true, onKeys: ignore }));
  const keysFailure = readFailure(keys);
  assertSaidAlike(keysFailure, "Your keys could not be read.");
  answering = true;
  keysFailure.retry();
  await settle();
  assert.equal(keys.querySelector('[role="alert"]'), null, "the keys were read, so nothing fails");

  let retried = 0;
  const workspaces = await mount(
    createElement(WorkspacePage, {
      readerId: undefined,
      control: {
        workspaces: [],
        workspaceId: undefined,
        onLeft: ignore,
        listFailed: true,
        onRetryList: () => {
          retried += 1;
        },
      },
    }),
  );
  const workspacesFailure = readFailure(workspaces);
  assertSaidAlike(workspacesFailure, "Your workspaces could not be read.");
  workspacesFailure.retry();
  assert.equal(retried, 1);
});

/** The Inbox page as the tests draw it: open, nothing chosen. */
const INBOX_VIEW = {
  open: true,
  chosen: undefined,
  onOpen: ignore,
  onClose: ignore,
  onChoose: ignore,
  onOpenItem: () => undefined,
  onOpenChannel: () => undefined,
  listed: false,
  onListed: ignore,
  pages: undefined,
  onTaskAgents: () => undefined,
} as const;

test("an Inbox whose task list could not be read says so, never that nothing needs you, and Retry reads the list again", async () => {
  let retried = 0;
  const tasks = tasksControl({
    listFailed: true,
    onRetryList: () => {
      retried += 1;
    },
    inboxView: INBOX_VIEW,
  });
  const page = await mount(createElement(DesktopInbox, { tasks }));
  const failure = readFailure(page);
  assertSaidAlike(failure, "Some items could not be read.");
  assert.doesNotMatch(page.textContent ?? "", /Nothing needs you/u);
  assert.equal(page.querySelector('[role="status"]'), null, "no loading placeholder");
  failure.retry();
  assert.equal(retried, 1);
});

const REVISION: PlanRevisionLine = {
  seq: 2,
  lastEdit: { actor: PLAN_ACTOR.NOTETAKER, at: 20, duringCall: true },
  startedAt: 20,
  changes: 2,
};

/** The plan's version history whose chosen version could not be read, its sections open where `sections` says. */
async function versionNotRead(sections: boolean, onRetryVersion: () => void): Promise<HTMLElement> {
  const base = tasksControl();
  const history = {
    ...base.history,
    open: true,
    list: { kind: HISTORY_READ.READY, revisions: [REVISION], earlier: undefined } as const,
    selected: REVISION.seq,
    viewing: { line: REVISION, current: true, read: { kind: HISTORY_READ.FAILED } } as const,
    spot: sections
      ? { revision: REVISION.seq, opened: { seq: REVISION.seq, heading: undefined } }
      : undefined,
    onRetryVersion,
  };
  const tasks = tasksControl({
    page: TASKS_PAGE.DOCUMENT,
    activeTaskId: DOCUMENT_TASK.id,
    region: { kind: DOCUMENT_REGION.READY, task: DOCUMENT_TASK },
    history,
  });
  return mount(
    createElement(DesktopVersionHistory, {
      sidebar: {
        collapsed: false,
        compact: false,
        overlay: SIDEBAR_OVERLAY.CLOSED,
        width: 264,
        onToggle: ignore,
        onOverlay: ignore,
        onResize: ignore,
        staged: false,
      },
      room: SHELL_ROOM.WIDE,
      history: {
        canGoBack: false,
        canGoForward: false,
        onBack: ignore,
        onForward: ignore,
        steps: { back: [], forward: [] },
        onGoTo: ignore,
      },
      subject: taskVersionSubject(tasks),
      account: { status: ACCOUNT_STATUS.SIGNED_IN, email: "dev@example.com", provider: "github" },
      onExit: ignore,
      onRestored: ignore,
    }),
  );
}

/** The Retry in a region's alert, which reads the version again. */
function retryIn(region: Element | null): HTMLButtonElement | undefined {
  const alert = region?.querySelector('[role="alert"]');
  return [...(alert?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
    (each) => each.textContent === "Retry",
  );
}

test("a version history whose version could not be read says so on its page and over the sections it opened, each with Retry, and no placeholder", async () => {
  let retried = 0;
  const page = await versionNotRead(true, () => {
    retried += 1;
  });
  const sections = page.querySelector("section[aria-label='Sections changed']");
  const version = page.querySelector(".version-page");
  assert.match(sections?.textContent ?? "", /The sections it changed could not be read\./u);
  assert.match(version?.textContent ?? "", /The version could not be read\./u);
  assert.equal(page.querySelector('[role="status"]'), null, "no placeholder stands");
  assert.equal(page.querySelector(".luke-skeleton"), null, "no block stands");
  act(() => retryIn(sections)?.click());
  act(() => retryIn(version)?.click());
  assert.equal(retried, 2, "each Retry reads the version again");
});

test("a version history whose version could not be read says so on its page with Retry where no sections are open", async () => {
  let retried = 0;
  const page = await versionNotRead(false, () => {
    retried += 1;
  });
  const version = page.querySelector(".version-page");
  assert.match(version?.textContent ?? "", /The version could not be read\./u);
  assert.equal(page.querySelectorAll('[role="alert"]').length, 1);
  act(() => retryIn(version)?.click());
  assert.equal(retried, 1);
});
