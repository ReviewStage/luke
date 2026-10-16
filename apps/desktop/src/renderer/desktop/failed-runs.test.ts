// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { AccountFailedRun } from "@luke/features/account-inbox-wire";
import { AUTOMATION_RUN_REASON } from "@luke/features/automation-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { ToastHost } from "../toast";
import { type FailedRunPlace, useFailedRunsMark, useFailedRunToasts } from "./failed-runs";

/** A run failed to start as main hands it to the window's toast. */
interface RunFailed {
  readonly automationId: string;
  readonly runId: string;
  readonly workspaceId: string;
  readonly words: string;
  readonly detail: string;
}

const SWEEP = "5a0c4d2e-8f1b-4c3a-9e7d-2b6f1a8c9d04";
const DIGEST = "6b1d5e3f-9a2c-4d4b-8f8e-3c7a2b9d0e15";
const RUN_ID = "4b5c6d7e-8f90-4a1b-8c2d-3e4f5a6b7c8d";

let failedListener: ((run: RunFailed) => void) | undefined;
let viewed: FailedRunPlace[] = [];
let marked: boolean[] = [];
const roots: Root[] = [];
const registries: AtomRegistry.AtomRegistry[] = [];

beforeEach(() => {
  viewed = [];
  marked = [];
  localStorage.clear();
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      onRunFailed: (listener: (run: RunFailed) => void) => {
        failedListener = listener;
        return () => {
          failedListener = undefined;
        };
      },
    },
  });
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  for (const registry of registries.splice(0)) registry.dispose();
  document.body.innerHTML = "";
});

/** A run of the account's own automation that failed to start, as main hands the window its newest. */
function failedRun(
  automationId: string,
  failedAt: number,
  patch: Partial<AccountFailedRun> = {},
): AccountFailedRun {
  return {
    id: `${automationId.slice(0, 8)}-0000-4000-8000-${String(failedAt).padStart(12, "0")}`,
    automationId,
    automationName: automationId === SWEEP ? "Flaky test sweep" : "Morning digest",
    workspaceId: "workspace-acme",
    ...patch,
    reason: AUTOMATION_RUN_REASON.REPOSITORY_UNREACHABLE,
    failedAt,
  };
}

/** The window's toasts and its Automations mark, wired as the app and the sidebar wire them. */
function Harness({
  runs,
  opened,
}: {
  runs: readonly AccountFailedRun[];
  opened: string | undefined;
}): React.JSX.Element {
  useFailedRunToasts((place) => viewed.push(place));
  marked.push(useFailedRunsMark(runs, "workspace-acme", opened, false));
  return createElement(Fragment, null, createElement(ToastHost));
}

/** The harness mounted, and a way to draw it again with the runs and the automation open moved on. */
function mount(runs: readonly AccountFailedRun[], opened?: string) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const registry = AtomRegistry.make();
  registries.push(registry);
  const draw = (next: readonly AccountFailedRun[], open: string | undefined) =>
    act(() =>
      root.render(onRegistry(registry, createElement(Harness, { runs: next, opened: open }))),
    );
  draw(runs, opened);
  return draw;
}

test("a failed run's toast is in the failed tone under its automation's name, and its View opens the run in its own workspace", () => {
  mount([]);

  act(() =>
    failedListener?.({
      automationId: SWEEP,
      runId: RUN_ID,
      workspaceId: "workspace-other",
      words: "A run couldn't start. Luke can no longer reach its repository on GitHub.",
      detail: "Flaky test sweep",
    }),
  );
  const toast = document.querySelector<HTMLElement>(".toast");
  assert.ok(toast);
  assert.deepEqual(
    [toast.querySelector(".toast-detail")?.textContent, toast.dataset.tone],
    ["Flaky test sweep", "failed"],
  );
  act(() => toast.querySelector<HTMLButtonElement>(".toast-action")?.click());
  assert.deepEqual(viewed, [
    { automationId: SWEEP, runId: RUN_ID, workspaceId: "workspace-other" },
  ]);
});

test("the Automations mark stands until each failing automation is opened, stays off across a relaunch, and comes back when it fails again", () => {
  const first = [failedRun(SWEEP, 1_000), failedRun(DIGEST, 2_000)];
  const draw = mount(first);
  assert.equal(marked.at(-1), true);

  draw(first, SWEEP);
  draw(first, undefined);
  assert.equal(marked.at(-1), true, "the digest has not been opened");
  draw(first, DIGEST);
  draw(first, undefined);
  assert.equal(marked.at(-1), false);

  // A relaunch reads what this Mac kept.
  const again = mount(first);
  assert.equal(marked.at(-1), false);

  again([failedRun(SWEEP, 3_000), failedRun(DIGEST, 2_000)], undefined);
  assert.equal(marked.at(-1), true);
});

test("a failure seen in one workspace stays seen while another workspace's is opened, and a second failure in the same millisecond still marks", () => {
  const theirs = failedRun(DIGEST, 2_000, { workspaceId: "workspace-other" });
  const first = [failedRun(SWEEP, 1_000), theirs];
  const draw = mount(first);
  draw(first, SWEEP);
  draw(first, DIGEST);
  draw(first, undefined);
  assert.equal(marked.at(-1), false, "neither is news once both were opened");

  const again = failedRun(SWEEP, 1_000, { id: "5a0c4d2e-0000-4000-8000-000000000999" });
  draw([again, theirs], undefined);
  assert.equal(marked.at(-1), true, "another run failing in the same instant is news");
});

test("an automation of another workspace left open does not see its own failure there, which marks that workspace once it is listed", () => {
  const theirs = failedRun(DIGEST, 2_000, { workspaceId: "workspace-other" });
  const draw = mount([theirs], DIGEST);
  draw([theirs], undefined);
  assert.equal(marked.at(-1), false, "the listed workspace holds no failure");

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const registry = AtomRegistry.make();
  registries.push(registry);
  function Other(): React.JSX.Element {
    marked.push(useFailedRunsMark([theirs], "workspace-other", undefined, false));
    return createElement(Fragment);
  }
  act(() => root.render(onRegistry(registry, createElement(Other))));
  assert.equal(marked.at(-1), true, "its own workspace still marks it");
});
