// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { QueuedMessage } from "@luke/features/agent-queue-wire";
import { QUEUE_PAUSE } from "@luke/features/agent-queue-wire";
import { AGENT_ATTACHMENT_TYPE } from "@luke/features/agent-wire";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { onRegistry } from "../testing/copy-feedback.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { AgentPicturesProvider } from "./agent-pictures.js";
import { AgentQueueDock } from "./agent-queue-dock.js";

/**
 * The queue's presses as a reader finds them: a message offers Steer, Edit,
 * and Delete, one being edited Cancel alone, in any of the starter's
 * windows, and a reader who did not start the agent finds none at all,
 * Resume among them, since the service lets its starter alone change the
 * queue. A row's words are drawn
 * as a sent message's are, a mention as its chip, and its files as a sent
 * message's, an image as its thumbnail, read through the agent's pictures.
 */

const ignore = () => undefined;

const TWO: readonly QueuedMessage[] = [
  { id: "m1", text: "Run the tests", queuedBy: "user-1" },
  { id: "k2", text: "Open the pull request", queuedBy: "" },
];

/** An image a queued message carries, as the agent's pictures answer it under the id the queue names it by. */
const SHOT = {
  name: "flow.png",
  base64: "iVBORw0KGgo=",
  id: "7b2e4c1a-9d3f-4e5a-8b6c-0d1e2f3a4b5c",
};

/** The agent's pictures, which answer the one image. */
const PICTURES = {
  owner: "agent-queue-dock-test",
  read: (_owner: string, id: string) =>
    Promise.resolve(
      id === SHOT.id
        ? { contentType: AGENT_ATTACHMENT_TYPE.PNG, base64: SHOT.base64 }
        : { failure: "not-found" },
    ),
};

// A row's words are drawn once the parser has landed, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The dock drawn over `messages` for a reader who `controls` the queue or not; answers its presses by name, and its words, row by row. */
function drawn(controls: boolean, messages: readonly QueuedMessage[] = TWO) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(
          AgentPicturesProvider,
          { value: PICTURES },
          createElement(AgentQueueDock, {
            messages,
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
    /** Whether a reader reaches the row's files, which no hidden region holds back. */
    filesReached: (index: number) => {
      const files = rows[index]?.querySelector('[aria-label="Attached files"]');
      return (
        files !== null && files !== undefined && files.closest('[aria-hidden="true"]') === null
      );
    },
    images: (index: number) =>
      [...(rows[index]?.querySelectorAll("img") ?? [])].map((image) => image.getAttribute("src")),
    chips: (index: number) =>
      [...(rows[index]?.querySelectorAll<HTMLElement>("[data-mention-ref]") ?? [])].map((chip) => [
        chip.dataset.kind,
        chip.querySelector(".luke-inline-ref-label")?.textContent,
      ]),
    all: () => presses(container),
  };
}

test("a message offers Steer, Edit, and Delete, and one an edit left standing in another window offers Cancel alone", () => {
  const [first, second] = TWO;
  assert.ok(first !== undefined && second !== undefined);
  const dock = drawn(true, [first, { ...second, editing: true }]);

  assert.deepEqual(dock.row(0), ["Steer", "Edit", "Delete"]);
  assert.deepEqual(dock.row(1), ["Cancel"]);
});

test("a reader who did not start the agent finds no press on the queue, Resume among them", () => {
  const dock = drawn(false);

  assert.deepEqual(dock.all(), []);
});

test("a queued message naming a mention draws the mention's chip, not its link's markdown", () => {
  const dock = drawn(true, [
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

test("a queued image is drawn on its row as a sent message's is, its thumbnail read through the agent's pictures", async () => {
  const dock = drawn(true, [
    {
      id: "m1",
      text: "Match this.",
      queuedBy: "user-1",
      files: [{ name: SHOT.name, mediaType: AGENT_ATTACHMENT_TYPE.PNG, id: SHOT.id }],
    },
  ]);
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });

  assert.deepEqual(dock.images(0), [`data:${AGENT_ATTACHMENT_TYPE.PNG};base64,${SHOT.base64}`]);
  assert.ok(dock.filesReached(0), "a reader reaches the files, which open as a sent message's do");
});
