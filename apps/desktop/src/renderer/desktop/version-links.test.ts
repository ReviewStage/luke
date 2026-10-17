// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { PLAN_ACTOR } from "@luke/features/task-wire";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { DOCUMENT_TASK } from "#testing/document-task";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { tasksControl } from "#testing/tasks-control";
import { newestToastSays } from "#testing/toast";
import { HISTORY_READ } from "../tasks/use-plan-history";
import { ToastHost } from "../toast";
import { DesktopVersionHistory, taskVersionSubject } from "./desktop-version-history";
import { SIDEBAR_OVERLAY } from "./sidebar-collapse";

/**
 * A plan's version has a link of its own: a version's row's menu copies its
 * plan's address under the version's number, which opens the plan's version
 * history on it, and says Link copied. Synthetic plan.
 */

const ignore = (): void => undefined;

const ACME = {
  id: "workspace-acme",
  name: "Acme",
  slug: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
};

/** A revision of the plan by the notetaker. */
function line(seq: number) {
  return {
    seq,
    lastEdit: { actor: PLAN_ACTOR.NOTETAKER, at: 10 * seq, duringCall: true },
    startedAt: 10 * seq,
    changes: 2,
  };
}

const roots: Root[] = [];
let copied: string[] = [];

beforeEach(() => {
  installScrollIntoView();
  copied = [];
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      act: (request: Act): Promise<ActOutcome> => {
        if (request.kind === ACT_KIND.WINDOW_COPY_TEXT) copied.push(request.payload.words);
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: undefined });
      },
      recordSurfaceEvent: () => undefined,
    },
  });
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

/** The plan's version history over the window, its versions read. */
function drawn(): HTMLElement {
  const base = tasksControl();
  const plans = tasksControl({
    page: TASKS_PAGE.DOCUMENT,
    activeTaskId: DOCUMENT_TASK.id,
    region: { kind: DOCUMENT_REGION.READY, task: { ...DOCUMENT_TASK, workspaceId: ACME.id } },
    workspaces: [ACME],
    history: {
      ...base.history,
      open: true,
      list: { kind: HISTORY_READ.READY, revisions: [line(3), line(2)], earlier: undefined },
      selected: 3,
    },
  });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(
        "div",
        null,
        createElement(ToastHost),
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
          history: { canGoBack: false, canGoForward: false, onBack: ignore, onForward: ignore },
          subject: taskVersionSubject(plans),
          account: {
            status: ACCOUNT_STATUS.SIGNED_IN,
            email: "dev@example.com",
            provider: "github",
          },
          call: undefined,
          onExit: ignore,
          onRestored: ignore,
        }),
      ),
    ),
  );
  return container;
}

test("a version's row offers Copy link, which copies its plan's address under the version's number and says Link copied", async () => {
  const container = drawn();
  const second = container.querySelectorAll<HTMLButtonElement>(".version-row")[1];
  assert.ok(second, "the second version is listed");

  act(() => {
    second.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, clientX: 20, clientY: 20 }),
    );
  });
  const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (each) => each.textContent === "Copy link",
  );
  assert.ok(item, "the row's menu offers Copy link");
  await act(async () => item.click());

  assert.deepEqual(copied, [`https://tryluke.dev/acme/plan/${DOCUMENT_TASK.id}/version/2`]);
  assert.equal(newestToastSays(), "Link copied");
});
