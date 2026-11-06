// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { QueuedMessage } from "@repo/features/agent-queue-wire";
import { QUEUE_PAUSE } from "@repo/features/agent-queue-wire";
import { AGENT_ATTACHMENT_TYPE } from "@repo/features/agent-wire";
import { ACTION_RESULT_STATUS } from "@repo/wire";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test, vi } from "vitest";
import { onRegistry } from "../testing/copy-feedback.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { AgentPicturesProvider } from "./agent-pictures.js";
import { AgentQueueDock } from "./agent-queue-dock.js";

const ignore = () => undefined;

const TWO: readonly QueuedMessage[] = [
  { id: "m1", text: "Run the tests", queuedBy: "user-1" },
  { id: "k2", text: "Open the pull request", queuedBy: "" },
];

const SHOT = {
  name: "flow.png",
  base64: "iVBORw0KGgo=",
  id: "7b2e4c1a-9d3f-4e5a-8b6c-0d1e2f3a4b5c",
};

const PICTURES = {
  owner: "agent-queue-dock-test",
  read: (_owner: string, id: string) =>
    Promise.resolve(
      id === SHOT.id
        ? { contentType: AGENT_ATTACHMENT_TYPE.PNG, base64: SHOT.base64 }
        : { failure: "not-found" },
    ),
};

beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

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
    words: (index: number) => rows[index]?.querySelector(".ui-one-line")?.textContent ?? "",
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
        chip.querySelector(".ui-inline-ref-label")?.textContent,
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
      text: "Wait 102 seconds [@Goal](https://vespin.dev/acme/plan/3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b#goal)",
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

  await vi.waitFor(() =>
    assert.deepEqual(dock.images(0), [`data:${AGENT_ATTACHMENT_TYPE.PNG};base64,${SHOT.base64}`]),
  );
  assert.ok(dock.filesReached(0), "a reader reaches the files, which open as a sent message's do");
});
