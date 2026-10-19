// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentChangesAnswerView,
} from "@luke/features/coding-agent-view";
import { INBOX_CURSOR_START } from "@luke/features/inbox-wire";
import type { TaskSummary } from "@luke/features/task-wire";
import {
  ACT_KIND,
  ACT_OUTCOME_STATUS,
  type Act,
  type ActKind,
  type ActOutcome,
  type ActResultFor,
} from "@luke/host/acts";
import { SIDEBAR_OVERLAY } from "@luke/panel/desktop/sidebar-collapse";
import { PANEL_TAB } from "@luke/panel/panel-tabs";
import { ApiKeysSection } from "@luke/panel/settings/api-keys-section";
import { WorkspacePage } from "@luke/panel/settings/workspace-page";
import { fakeAppBridge } from "@luke/panel/testing/app-bridge";
import { onRegistry } from "@luke/panel/testing/copy-feedback";
import { UPDATE_STATUS } from "@luke/settings/update";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { codingAgentsControl, tasksControl } from "#testing/tasks-control";
import { DesktopInbox } from "./desktop/desktop-inbox";
import { DesktopSidebar } from "./desktop/desktop-sidebar";
import { AgentChangesTab } from "./tasks/agent-changes-tab";

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

/** The bridge: every read fails until the service answers again, then answers with nothing in it. */
function answer(request: Act): Promise<ActOutcome> {
  const done = (value: ActResultFor<ActKind>): Promise<ActOutcome> =>
    Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value });
  switch (request.kind) {
    case ACT_KIND.CODING_AGENTS_LIST:
      return done({ agents: [] });
    case ACT_KIND.CODING_AGENTS_INBOX:
      // A read past the cursor is held open while nothing changes, as the service holds it.
      if (request.payload.after !== INBOX_CURSOR_START) return new Promise(() => undefined);
      return done(answering ? { items: [], cursor: "1" } : UNANSWERED);
    case ACT_KIND.PROVIDER_KEYS_READ:
      return done(answering ? { keys: [] } : UNANSWERED);
    default:
      return Promise.resolve({ status: ACT_OUTCOME_STATUS.UNKNOWN_ACT });
  }
}

beforeEach(() => {
  answering = false;
  window.localStorage.clear();
  // The window's motion as a Mac with none reduced answers it.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false, addEventListener: ignore, removeEventListener: ignore }),
  });
  fakeAppBridge({ act: answer });
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
      history: { canGoBack: false, canGoForward: false, onBack: ignore, onForward: ignore },
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
      call: undefined,
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
          pages: undefined,
          onRereadPages: () => undefined,
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
    createElement(AgentChangesTab, {
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
  const keys = await mount(createElement(ApiKeysSection, { signedIn: true, onKeys: ignore }));
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
