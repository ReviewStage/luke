// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { PLAN_ACTOR } from "@luke/features/task-wire";
import { ACT_OUTCOME_STATUS, type ActOutcome } from "@luke/host/acts";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { layContainersAt } from "#testing/container-width";
import { DOCUMENT_PLAN } from "#testing/document-plan";
import { plansControl } from "#testing/plans-control";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { HISTORY_READ } from "../planning/use-plan-history";
import { DesktopVersionHistory, planVersionSubject } from "./desktop-version-history";
import { SIDEBAR_OVERLAY } from "./sidebar-collapse";

/**
 * A restore's row in the version history, whose one fact is the version it
 * brought back, says it on up to two lines in a log the folded sidebar's
 * width, rather than cutting the time short on one. jsdom lays nothing out,
 * so the row is read through the window's stylesheets. Synthetic plan.
 */

const ignore = (): void => undefined;

const ADA = { userId: "user-ada", name: "Ada Lovelace" };

/** A revision of the plan by Ada that restored the version from Oct 14, 9:00 AM. */
const RESTORE = {
  seq: 3,
  lastEdit: { actor: PLAN_ACTOR.DEVELOPER, by: ADA, at: 30, duringCall: false },
  startedAt: 30,
  changes: 1,
  restoredFrom: { seq: 1, at: new Date(2026, 9, 14, 9, 0).getTime() },
};

const roots: Root[] = [];

beforeEach(() => {
  installScrollIntoView();
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      act: (): Promise<ActOutcome> =>
        Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: [] }),
      recordSurfaceEvent: () => undefined,
    },
  });
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

/** The plan's version history over the window, its restore read. */
function drawn(): HTMLElement {
  const base = plansControl();
  const plans = plansControl({
    page: TASKS_PAGE.DOCUMENT,
    activePlanId: DOCUMENT_PLAN.id,
    region: { kind: DOCUMENT_REGION.READY, task: DOCUMENT_PLAN },
    history: {
      ...base.history,
      open: true,
      list: { kind: HISTORY_READ.READY, revisions: [RESTORE], earlier: undefined },
      selected: RESTORE.seq,
    },
  });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(DesktopVersionHistory, {
        sidebar: {
          collapsed: true,
          compact: true,
          overlay: SIDEBAR_OVERLAY.CLOSED,
          width: 264,
          onToggle: ignore,
          onOverlay: ignore,
          onResize: ignore,
          staged: false,
        },
        history: { canGoBack: false, canGoForward: false, onBack: ignore, onForward: ignore },
        subject: planVersionSubject(plans),
        account: { status: ACCOUNT_STATUS.SIGNED_IN, email: "dev@example.com", provider: "github" },
        call: undefined,
        onExit: ignore,
        onRestored: ignore,
      }),
    ),
  );
  return container;
}

test("a restore's row says which version it brought back on up to two lines rather than cutting it short on one", () => {
  layContainersAt({});
  const view = drawn();
  const summary =
    view.querySelector<HTMLElement>(".version-item .version-row-summary") ??
    assert.fail("the restore's row says what it did");
  const style = getComputedStyle(summary);

  assert.match(summary.textContent ?? "", /^Restored the version from Oct 14/u);
  assert.notEqual(style.whiteSpace, "nowrap");
  assert.equal(style.getPropertyValue("-webkit-line-clamp"), "2");
});
