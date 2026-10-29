// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  FAILURE_CONDITION,
  FAILURE_SURFACE,
  type ShownFailureSentry,
  sendShownFailure,
} from "@luke/features/shown-failure";
import { ErrorState } from "@luke/ui";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { failureShown, installShownFailureReporter, type ShownFailure } from "./failure-report.js";
import { copyingInto, fakeAppPlatform } from "./testing/app-platform.js";
import { onRegistry } from "./testing/copy-feedback.js";

/**
 * failure-report.test.ts -- a failure drawn in place, through `ErrorState`
 * as the panel hands it one, is reported once as it first stands: not again
 * as it is drawn anew or remounted, as a tab switched away and back, but
 * again for another failure, and again once it comes back after standing
 * unshown past the lapse. Its Copy details copies what its report sent. A
 * recording SDK stands in for Sentry. Synthetic throughout.
 */

/** How long a failure no one shows stays the same one, as the panel keeps it. */
const LAPSE_MS = 5 * 60 * 1000;

const LINE = "Your tasks could not be read.";

let root: Root | undefined;
let registry: AtomRegistry.AtomRegistry | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  registry?.dispose();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

/** Draws `failure` in place, as a site of the panel draws one, or nothing. */
function draw(failure: ShownFailure | undefined): void {
  if (root === undefined) {
    root = createRoot(document.body.appendChild(document.createElement("div")));
    registry = AtomRegistry.make();
  }
  const held = registry;
  if (held === undefined) throw new Error("no registry");
  const element =
    failure === undefined
      ? null
      : createElement(ErrorState, { failure: failureShown(failure), children: LINE });
  act(() => root?.render(onRegistry(held, createElement("div", null, element))));
}

/** A read of a workspace's tasks that did not land, built afresh as a site builds it on each render. */
function unreadTasks(): ShownFailure {
  return {
    surface: FAILURE_SURFACE.TASKS_READ,
    cause: FAILURE_CONDITION.UNREAD,
    about: { workspaceId: "workspace-fixture" },
  };
}

test("a failure drawn in place is reported once as it stands, again for another, and again once it comes back after the lapse, and copies what was sent", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-29T18:20:03.198Z"));
  const copied: string[] = [];
  fakeAppPlatform(copyingInto(copied));
  const lines: string[] = [];
  const recording: ShownFailureSentry = {
    captureException: () => "event-fixture",
    logger: { warn: (line) => lines.push(line), error: (line) => lines.push(line) },
    getActiveSpan: () => undefined,
    getCurrentScope: () => ({ getPropagationContext: () => ({ traceId: "trace-fixture" }) }),
  };
  const uninstall = installShownFailureReporter((report) => sendShownFailure(recording, report));
  try {
    draw(unreadTasks());
    draw(unreadTasks());
    assert.equal(lines.length, 1, "drawn anew, it is the same failure");

    draw(undefined);
    vi.setSystemTime(Date.now() + LAPSE_MS - 1);
    draw(unreadTasks());
    assert.equal(lines.length, 1, "remounted within the lapse, it is the same failure");

    draw({ ...unreadTasks(), cause: new TypeError("fetch failed") });
    assert.equal(lines.length, 2, "another cause is another failure");

    vi.setSystemTime(Date.now() + LAPSE_MS);
    draw(unreadTasks());
    assert.equal(lines.length, 3, "come back after the lapse, it is reported again");

    const copy = document.querySelector<HTMLButtonElement>('button[aria-label="Copy details"]');
    if (copy === null) throw new Error("no Copy details");
    await act(async () => copy.click());
    assert.deepEqual(copied, [
      [
        "Luke showed an error. Find it in Sentry and the logs by these details:",
        "time: 2026-10-29T18:30:03.197Z",
        "failure.surface: tasks.read",
        "failure.kind: unexpected",
        "failure.code: unread",
        "error.code: unread",
        "workspace.id: workspace-fixture",
        "app.online: true",
        "app.account: unread",
        "sentry.event_id: event-fixture",
        "sentry.trace_id: trace-fixture",
      ].join("\n"),
    ]);
  } finally {
    uninstall();
  }
});
