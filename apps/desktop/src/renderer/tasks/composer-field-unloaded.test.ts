// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { QUIET_COMPOSER } from "#testing/composer";
import { PLAN_EDITOR_ASSET } from "../plan-editor/contract";
import { AgentComposer } from "./agent-composer";
import { useAgentComposer } from "./use-agent-composer";

/**
 * A box whose editor bundle could not be loaded says so under the card and
 * stays inert. The bundle is read once per window, so this is a file of its
 * own.
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
  await act(async () => root.render(createElement(Box)));

  const script = document.head.querySelector(`script[src="${PLAN_EDITOR_ASSET.SCRIPT}"]`);
  assert.ok(script, "the editor bundle was asked for");
  await act(async () => {
    script.dispatchEvent(new Event("error"));
  });

  assert.equal(
    container.querySelector(".agent-composer-note")?.textContent,
    "The message box could not be loaded.",
  );
  assert.equal(container.querySelector(".agent-composer-input")?.getAttribute("aria-busy"), "true");
});
