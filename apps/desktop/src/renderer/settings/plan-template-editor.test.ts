// @vitest-environment jsdom

import assert from "node:assert/strict";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { test } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { PLAN_EDITOR_ASSET } from "../plan-editor/contract";
import { PlanTemplateEditor } from "./plan-template-editor";

/**
 * The editor's bundle failing to load, which the page's own tests cannot
 * reach, since they stand the editor in before the page reads it.
 */

test("a template whose editor could not be loaded is still edited, in a plain Markdown box", async () => {
  const typed: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const editor = createElement(PlanTemplateEditor, {
    text: "## Why\n",
    label: "Plan template",
    onText: (text) => typed.push(text),
    onLeave: () => undefined,
  });
  act(() => root.render(onRegistry(AtomRegistry.make(), editor)));
  assert.equal(container.querySelector("textarea"), null, "nothing while the bundle loads");

  const script = document.head.querySelector(`script[src="${PLAN_EDITOR_ASSET.SCRIPT}"]`);
  assert.ok(script, "the bundle asked for");
  await act(async () => {
    script.dispatchEvent(new Event("error"));
    await Promise.resolve();
  });

  const area = container.querySelector("textarea");
  assert.ok(area, "the plain box");
  assert.equal(area.value, "## Why\n");
  assert.equal(area.getAttribute("aria-label"), "Plan template");
  act(() => root.unmount());
});
