// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { sideBundles } from "../bundle-loader.js";
import { planEditor } from "../plan-editor/index.js";
import { installEditorLayout, QUIET_COMPOSER } from "../testing/composer.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { onSideBundles } from "../testing/side-bundles.js";
import { AgentComposer } from "./agent-composer.js";
import { useAgentComposer } from "./use-agent-composer.js";

/**
 * A box whose editor bundle could not be loaded says so under the card and
 * stays inert, its importer failing as a chunk that could not be loaded does,
 * and offers Retry, which reads the bundle again, so a chunk that lands then
 * mounts the editor.
 */

const roots: Root[] = [];

beforeEach(() => {
  installScrollIntoView();
  installEditorLayout();
});

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

test("a box whose editor bundle could not be loaded says so beside Retry and stays inert, and Retry mounts the editor once the bundle lands", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  // Note that the chunk fails the first time it is asked for and lands the next, as a connection that dropped for a moment does.
  let failed = false;
  const bundles = sideBundles({
    planEditor: () => {
      if (failed) return Promise.resolve(planEditor);
      failed = true;
      return Promise.reject(new Error("The chunk could not be loaded."));
    },
  });
  await act(async () => root.render(onSideBundles(bundles, createElement(Box))));

  const note = container.querySelector(".luke-composer-foot-note");
  assert.equal(note?.textContent, "The message box could not be loaded.Retry");
  assert.equal(container.querySelector(".agent-composer-input")?.getAttribute("aria-busy"), "true");

  await act(async () => note?.querySelector("button")?.click());

  assert.equal(container.querySelector(".luke-composer-foot-note"), null, "the note is gone");
  assert.notEqual(
    container.querySelector(".agent-composer-input")?.getAttribute("aria-busy"),
    "true",
    "the field takes words",
  );
});
