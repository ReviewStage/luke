// @vitest-environment jsdom

import assert from "node:assert/strict";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { MainTabContent } from "../desktop/main-tabs.js";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { codingAgentsControl } from "../testing/tasks-control.js";
import { NOTHING_HELD } from "./agent-ref.js";
import { StartingAgentTab, type TranscriptCards } from "./agent-tab.js";
import { openingLineOf } from "./coding-agent-model.js";

/**
 * starting-agent-tab.test.ts -- the tab of an agent New task is still
 * starting draws the developer's words as its first line and says it is
 * starting, before the service has made the agent, and the column draws a
 * Start on the plan still out as that tab under the press's key. Synthetic
 * throughout.
 */

const roots: Root[] = [];

/** No row of a transcript hangs a card. */
const NO_CARDS: TranscriptCards = {
  target: () => undefined,
  worker: () => undefined,
  agent: () => undefined,
};

beforeEach(() => installScrollIntoView());

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

test("an agent still starting draws the words it was started on as its first line, and says it is starting", async () => {
  fakeAppBridge({});
  const prompt = "Make the sidebar keep its folds.";
  const line = openingLineOf({ key: "key-start", prompt, attachments: [] });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(onRegistry(AtomRegistry.make(), createElement(StartingAgentTab, { line }))),
  );
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });

  const words = container.textContent ?? "";
  assert.ok(words.includes(prompt), words);
  assert.match(words, /Starting/u);
});

test("the column draws a Start still out on the plan as its agent's tab saying it is starting, under the press's key", async () => {
  fakeAppBridge({});
  const base = codingAgentsControl();
  const agents = codingAgentsControl({
    agentIds: ["press-1"],
    start: { ...base.start, busy: true, pending: { key: "press-1", model: undefined } },
  });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(MainTabContent, {
          tab: { agent: "press-1" },
          agents,
          shown: true,
          views: {
            held: NOTHING_HELD,
            standings: new Map(),
            onAgentHeld: () => undefined,
            onWorkerHeld: () => undefined,
            onWorkerStatus: () => undefined,
          },
          onOpenDelegation: () => undefined,
          onOpenTarget: () => undefined,
          cards: { call: NO_CARDS, agent: () => NO_CARDS },
        }),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });

  assert.match(container.textContent ?? "", /starting/iu);
});
