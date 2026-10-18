// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { PlanEditorModule } from "@luke/panel/plan-editor/contract";
import { installScrollIntoView } from "@luke/panel/testing/scroll-into-view";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import {
  composerEditor,
  installEditorLayout,
  QUIET_COMPOSER,
  typeInComposer,
} from "#testing/composer";
import { onSideBundles } from "#testing/side-bundles";
import { sideBundles } from "../bundle-loader";
import { planEditor } from "../plan-editor/index";
import { AgentComposer } from "./agent-composer";
import { useAgentComposer } from "./use-agent-composer";

/**
 * A box drawn before the editor bundle has landed: its field stands inert at
 * its own size with its placeholder, and the editor mounts and takes the
 * caret as the bundle lands. The box is drawn over an importer the test
 * answers once it has looked at the box, as the bundle's chunk would land.
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

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

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

test("a box drawn before the editor bundle lands is inert with its placeholder, and takes the caret as the bundle runs", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const landing = Promise.withResolvers<PlanEditorModule>();
  let asked = false;
  const bundles = sideBundles({
    planEditor: () => {
      asked = true;
      return landing.promise;
    },
  });
  await act(async () => root.render(onSideBundles(bundles, createElement(Box))));

  const field = container.querySelector<HTMLElement>(".agent-composer-input");
  assert.equal(field?.getAttribute("aria-busy"), "true", "the field stands inert");
  assert.equal(field?.tabIndex, -1, "out of the Tab order");
  assert.equal(container.querySelector(".composer-editor"), null);
  assert.equal(
    container.querySelector(".agent-composer-placeholder")?.textContent,
    "Send a follow up",
  );
  assert.equal(
    container.querySelector<HTMLButtonElement>('button[aria-label="Dictate"]')?.disabled,
    true,
    "nothing can be dictated into a box with no editor",
  );

  assert.ok(asked, "the editor bundle was asked for");
  landing.resolve(planEditor);
  await settle();

  assert.equal(document.activeElement, composerEditor(container));
  typeInComposer(container, "Hello");
  assert.equal(composerEditor(container).textContent, "Hello");
  assert.equal(container.querySelector(".agent-composer-placeholder"), null);
});
