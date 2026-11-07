// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { DESCRIPTION_ACTOR } from "@repo/features/task-wire";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { DOCUMENT_REGION, TASKS_PAGE } from "@repo/ui/tasks-model";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { SHELL_ROOM } from "../shell-room.js";
import { HISTORY_READ } from "../tasks/use-description-history.js";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { handMembers } from "../testing/app-state.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { DOCUMENT_TASK } from "../testing/document-task.js";
import { restOn } from "../testing/hint-rest.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { tasksControl } from "../testing/tasks-control.js";
import { DesktopVersionHistory, taskVersionSubject } from "./desktop-version-history.js";
import { SIDEBAR_OVERLAY } from "./sidebar-collapse.js";

/**
 * Who wrote a description's version, as its history names them: a member who left
 * is drawn by their own face, grayed, which a screen reader cannot see, so
 * their name says they left. Synthetic description and people.
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

/** A revision of the description by Lee, who has since left. */
function line(seq: number) {
  return {
    seq,
    lastEdit: { actor: DESCRIPTION_ACTOR.DEVELOPER, by: LEE, at: 10 * seq, duringCall: false },
    startedAt: 10 * seq,
    changes: 2,
  };
}

const roots: Root[] = [];

beforeEach(() => {
  installScrollIntoView();
  fakeAppBridge({});
  fakeActPort({});
  handMembers(() => ({ rows: { members: [], former: [LEE] } }));
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

/** The description's version history over the window, its versions by Lee read, and the sections of version 3 open. */
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
  // Note that each draw reads main's document as the window does, so the people the test lays are the ones it reads.
  act(() =>
    root.render(
      withQueryClient(
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
          account: {
            status: ACCOUNT_STATUS.SIGNED_IN,
            email: "dev@example.com",
            provider: "github",
          },
          onExit: ignore,
          onRestored: ignore,
        }),
      ),
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
  // Note that who left is named once the workspace's people reach their query.
  await vi.waitFor(() =>
    assert.deepEqual(said('[aria-label="Version list"] .version-row-author'), [
      "Lee Park (former member)",
      "Lee Park (former member)",
    ]),
  );
  assert.deepEqual(said(".version-sections-head .version-row-author"), [
    "Lee Park (former member)",
  ]);
});

test("a version by a member hangs their card beside its row while the pointer rests on it", async () => {
  handMembers(() => ({
    rows: { members: [{ ...LEE, email: "lee@example.com", role: WORKSPACE_ROLE.MEMBER }] },
  }));
  const view = drawn();
  await settle();

  const row = view.querySelector<HTMLElement>('[aria-label="Version list"] button');
  assert.ok(row, "a version is listed");
  // Note that the card names the member once the workspace's people reach their query, each rest drawing it afresh.
  await vi.waitFor(() => {
    restOn(row);
    const card = document.querySelector('.ui-tooltip-card [data-actor-card="person"]');
    assert.equal(card?.querySelector(".ui-hover-card-name")?.textContent, "Lee Park");
    assert.match(card?.textContent ?? "", /lee@example\.com/u);
  });
});
