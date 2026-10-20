// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { PLAN_ACTOR } from "@luke/features/task-wire";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { SHELL_ROOM } from "../shell-room.js";
import { HISTORY_READ } from "../tasks/use-plan-history.js";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { DOCUMENT_TASK } from "../testing/document-task.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { tasksControl } from "../testing/tasks-control.js";
import { DesktopVersionHistory, taskVersionSubject } from "./desktop-version-history.js";
import { SIDEBAR_OVERLAY } from "./sidebar-collapse.js";

/**
 * Who wrote a plan's version, as its history names them: a member who left
 * is drawn by their own face, grayed, which a screen reader cannot see, so
 * their name says they left. Synthetic plan and people.
 */

const ignore = (): void => undefined;

const ACME = {
  id: "workspace-acme",
  name: "Acme",
  slug: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
};

const LEE = { userId: "user-lee", name: "Lee Park" };

/** A revision of the plan by Lee, who has since left. */
function line(seq: number) {
  return {
    seq,
    lastEdit: { actor: PLAN_ACTOR.DEVELOPER, by: LEE, at: 10 * seq, duringCall: false },
    startedAt: 10 * seq,
    changes: 2,
  };
}

const roots: Root[] = [];

beforeEach(() => {
  installScrollIntoView();
  fakeAppBridge({});
  fakeActPort({
    [ACT_KIND.WORKSPACE_FORMER_MEMBERS_READ]: () => Promise.resolve([LEE]),
    [ACT_KIND.WORKSPACE_MEMBERS_READ]: () => Promise.resolve([]),
  });
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

/** The plan's version history over the window, its versions by Lee read, and the sections of version 3 open. */
function drawn(): HTMLElement {
  const base = tasksControl();
  const tasks = tasksControl({
    page: TASKS_PAGE.DOCUMENT,
    activeTaskId: DOCUMENT_TASK.id,
    region: { kind: DOCUMENT_REGION.READY, task: { ...DOCUMENT_TASK, workspaceId: ACME.id } },
    workspaces: [ACME],
    workspace: ACME,
    history: {
      ...base.history,
      open: true,
      list: { kind: HISTORY_READ.READY, revisions: [line(3), line(2)], earlier: undefined },
      selected: 3,
      spot: { revision: 3, opened: { seq: 3, heading: undefined } },
    },
  });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
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
        history: { canGoBack: false, canGoForward: false, onBack: ignore, onForward: ignore },
        subject: taskVersionSubject(tasks),
        account: { status: ACCOUNT_STATUS.SIGNED_IN, email: "dev@example.com", provider: "github" },
        call: undefined,
        onExit: ignore,
        onRestored: ignore,
      }),
    ),
  );
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

test("a version by a member who left names them as one, in its row and over its sections, where their grayed face cannot", async () => {
  const view = drawn();
  await settle();

  const said = (selector: string) =>
    [...view.querySelectorAll(selector)].map((each) => each.textContent);
  assert.deepEqual(said('[aria-label="Version list"] .version-row-author'), [
    "Lee Park (former member)",
    "Lee Park (former member)",
  ]);
  assert.deepEqual(said(".version-sections-head .version-row-author"), [
    "Lee Park (former member)",
  ]);
  assert.ok(view.querySelector('.actor-mark[data-left="true"]'));
});
