// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CALL_KIND } from "@luke/features/turn-rows";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { TOOL_BLOCK, TOOL_STATE } from "../ai-elements/tool.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { restOn } from "../testing/hint-rest.js";
import { TARGET_HINT, TOOL_TARGET } from "./tool-call-model.js";
import { TranscriptOpeningCall, TranscriptSubagent, TranscriptTool } from "./transcript-blocks.js";

/**
 * transcript-call-hints.test.ts -- every call's row says on hover what a
 * press on it does: a row that opens a tab names what it opens, and a row
 * that folds says it shows the call, and hides it once open, so the two
 * are told apart under the pointer. Synthetic calls.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** `element` drawn into the page, under the window's atoms. */
function drawn(element: ReactElement): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(onRegistry(AtomRegistry.make(), element)));
  return container;
}

/** What the window's pill says once the pointer rests on `row`, none where it raises none. */
function hintOver(row: Element): string | undefined {
  restOn(row);
  return document.querySelector('[role="tooltip"]')?.textContent ?? undefined;
}

/** The one row a drawing holds, a fold's line or a press. */
function rowOf(container: HTMLElement): HTMLElement {
  return (
    container.querySelector<HTMLElement>("summary, button[data-call-id]") ??
    assert.fail("the call's row")
  );
}

const FOLDING_CALL = createElement(TranscriptTool, {
  kind: CALL_KIND.COMMAND,
  state: TOOL_STATE.OUTPUT_AVAILABLE,
  subject: "pnpm check",
  description: undefined,
  input: { kind: TOOL_BLOCK.COMMAND, text: "pnpm check" },
  output: { kind: TOOL_BLOCK.TEXT, text: "ok" },
  errorText: undefined,
});

const OPENING_CALL = createElement(TranscriptOpeningCall, {
  callId: "call-show_page",
  kind: CALL_KIND.SHOW_PAGE,
  subject: "Pricing explorer",
  state: TOOL_STATE.OUTPUT_AVAILABLE,
  hint: TARGET_HINT[TOOL_TARGET.PAGE],
  onOpen: () => undefined,
});

const FOLDING_SUBAGENT = createElement(TranscriptSubagent, {
  callId: "call-task",
  job: "Audit retries",
  pair: undefined,
  state: TOOL_STATE.OUTPUT_AVAILABLE,
  errorText: undefined,
  onOpen: undefined,
  body: {
    input: { kind: TOOL_BLOCK.TEXT, text: "Audit the retries." },
    output: { kind: TOOL_BLOCK.TEXT, text: "Three retry loops." },
  },
});

test("a row that opens a tab and a row that folds each say on hover what a press does, and say different things", () => {
  const opens = hintOver(rowOf(drawn(OPENING_CALL)));
  const folds = hintOver(rowOf(drawn(FOLDING_CALL)));

  assert.equal(opens, "Open the page");
  assert.equal(folds, "Show the call");
});

test("a folding row says it hides the call once it stands open", () => {
  const row = rowOf(drawn(FOLDING_CALL));
  act(() => row.click());

  assert.equal(row.getAttribute("aria-expanded"), "true");
  assert.equal(hintOver(row), "Hide the call");
});

test("a worker's row that folds rather than opening its tab says it shows the call", () => {
  assert.equal(hintOver(rowOf(drawn(FOLDING_SUBAGENT))), "Show the call");
});
