// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  FAILURE_CONDITION,
  FAILURE_SURFACE,
  type ShownFailureSentry,
  sendShownFailure,
} from "@repo/features/shown-failure";
import { ErrorState } from "@repo/ui";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { failureShown, installShownFailureReporter, type ShownFailure } from "./failure-report.js";
import { copyingInto, fakeAppPlatform } from "./testing/app-platform.js";
import { onRegistry } from "./testing/copy-feedback.js";

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
        "Vespin error details. Include these when you report this problem:",
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
