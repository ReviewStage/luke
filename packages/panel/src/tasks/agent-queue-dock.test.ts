// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { QueuedMessage } from "@luke/features/agent-queue-wire";
import { QUEUE_PAUSE } from "@luke/features/agent-queue-wire";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { onRegistry } from "../testing/copy-feedback.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { AgentQueueDock } from "./agent-queue-dock.js";

/**
 * The queue's presses as a reader finds them: a message still landing, queued
 * from this tab and not yet the service's, offers none, and a reader who did
 * not start the agent finds none at all, Resume among them, since the
 * service lets its starter alone change the queue. A row's words are drawn
 * as a sent message's are, a mention as its chip.
 */

const ignore = () => undefined;

const TWO: readonly QueuedMessage[] = [
  { id: "m1", text: "Run the tests", queuedBy: "user-1" },
  { id: "k2", text: "Open the pull request", queuedBy: "" },
];

// A row's words are drawn once the parser has landed, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The dock drawn over `messages`, `landing` still on its way, for a reader who `controls` the queue or not; answers its presses by name, and its words, row by row. */
function drawn(
  controls: boolean,
  landing: ReadonlySet<string>,
  messages: readonly QueuedMessage[] = TWO,
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(AgentQueueDock, {
          messages,
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
    words: (index: number) => rows[index]?.querySelector(".luke-one-line")?.textContent ?? "",
    chips: (index: number) =>
      [...(rows[index]?.querySelectorAll<HTMLElement>("[data-mention-ref]") ?? [])].map((chip) => [
        chip.dataset.kind,
        chip.querySelector(".luke-inline-ref-label")?.textContent,
      ]),
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

test("a queued message naming a mention draws the mention's chip, not its link's markdown", () => {
  const dock = drawn(true, new Set(), [
    {
      id: "m1",
      text: "Wait 102 seconds [@Goal](https://tryluke.dev/acme/plan/3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b#goal)",
      queuedBy: "user-1",
    },
  ]);

  assert.deepEqual(dock.chips(0), [["section", "Goal"]]);
  assert.ok(dock.words(0).startsWith("Wait 102 seconds"));
  assert.ok(!dock.words(0).includes("]("), "no link's markdown is drawn");
});
