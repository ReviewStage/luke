// @vitest-environment jsdom

import assert from "node:assert/strict";
import { QUEUE_PAUSE } from "@luke/features/agent-queue-wire";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { onRegistry } from "../testing/copy-feedback.js";
import { AgentQueueDock } from "./agent-queue-dock.js";

/**
 * The queue's presses as a reader finds them: a message still landing, queued
 * from this tab and not yet the service's, offers none, and a reader who did
 * not start the agent finds none at all, Resume among them, since the
 * service lets its starter alone change the queue.
 */

const ignore = () => undefined;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The dock drawn over two messages, `landing` still on its way, for a reader who `controls` the queue or not; answers its presses by name, row by row. */
function drawn(controls: boolean, landing: ReadonlySet<string>) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(AgentQueueDock, {
          messages: [
            { id: "m1", text: "Run the tests", queuedBy: "user-1" },
            { id: "k2", text: "Open the pull request", queuedBy: "" },
          ],
          landing,
          controls,
          paused: { because: QUEUE_PAUSE.STOPPED },
          editing: undefined,
          onMove: ignore,
          onSteer: ignore,
          onEdit: ignore,
          onCancelEdit: ignore,
          onDelete: () => Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED }),
          onResume: ignore,
        }),
      ),
    ),
  );
  const rows = [...container.querySelectorAll("li")];
  const presses = (row: Element | undefined) =>
    [...(row?.querySelectorAll("button") ?? [])].map(
      (button) => button.getAttribute("aria-label") ?? button.textContent?.trim() ?? "",
    );
  return {
    row: (index: number) => presses(rows[index]),
    all: () => presses(container),
  };
}

test("a message still landing offers no press, and one the service holds offers Steer, Edit, and Delete", () => {
  const dock = drawn(true, new Set(["k2"]));

  assert.deepEqual(dock.row(0), ["Steer", "Edit", "Delete"]);
  assert.deepEqual(dock.row(1), []);
});

test("a reader who did not start the agent finds no press on the queue, Resume among them", () => {
  const dock = drawn(false, new Set());

  assert.deepEqual(dock.all(), []);
});
