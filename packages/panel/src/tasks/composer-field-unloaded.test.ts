// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { sideBundles } from "../bundle-loader.js";
import { QUIET_COMPOSER } from "../testing/composer.js";
import { onSideBundles } from "../testing/side-bundles.js";
import { AgentComposer } from "./agent-composer.js";
import { useAgentComposer } from "./use-agent-composer.js";

/**
 * A box whose editor bundle could not be loaded says so under the card and
 * stays inert, its importer failing as a chunk that could not be loaded does,
 * and offers Retry, which reads the bundle again.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

function Box(): ReactNode {
  const composer = useAgentComposer({
    agentId: "agent-1",
    taskId: "plan-1",
    messages: [],
    send: () => new Promise(() => undefined),
    onStatus: () => undefined,
  });
  return createElement(AgentComposer, { ...QUIET_COMPOSER, composer });
}

test("a box whose editor bundle could not be loaded says so under the card beside Retry, which reads the bundle again, and its field stays inert", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  let reads = 0;
  const bundles = sideBundles({
    planEditor: () => {
      reads += 1;
      return Promise.reject(new Error("The chunk could not be loaded."));
    },
  });
  await act(async () => root.render(onSideBundles(bundles, createElement(Box))));

  const note = container.querySelector(".luke-composer-foot-note");
  assert.equal(note?.textContent, "The message box could not be loaded.Retry");
  assert.equal(container.querySelector(".agent-composer-input")?.getAttribute("aria-busy"), "true");
  const before = reads;

  await act(async () => note?.querySelector("button")?.click());

  assert.equal(reads, before + 1, "Retry reads the bundle again");
});
