// @vitest-environment jsdom

import assert from "node:assert/strict";
import { sideBundles } from "@luke/panel/bundle-loader";
import { AgentComposer } from "@luke/panel/tasks/agent-composer";
import { useAgentComposer } from "@luke/panel/tasks/use-agent-composer";
import { QUIET_COMPOSER } from "@luke/panel/testing/composer";
import { onSideBundles } from "@luke/panel/testing/side-bundles";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";

/**
 * A box whose editor bundle could not be loaded says so under the card and
 * stays inert, its importer failing as a chunk that could not be loaded does.
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

test("a box whose editor bundle could not be loaded says so under the card, and its field stays inert", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const bundles = sideBundles({
    planEditor: () => Promise.reject(new Error("The chunk could not be loaded.")),
  });
  await act(async () => root.render(onSideBundles(bundles, createElement(Box))));

  assert.equal(
    container.querySelector(".agent-composer-note")?.textContent,
    "The message box could not be loaded.",
  );
  assert.equal(container.querySelector(".agent-composer-input")?.getAttribute("aria-busy"), "true");
});
