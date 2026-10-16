// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_TODO_STATUS } from "@luke/features/coding-agent-wire";
import { CALL_KIND, TURN_ROW, type TurnRow } from "@luke/features/turn-rows";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, test } from "vitest";
import { focusByKeyboard, layWindowStyles, ringClippedBy, ringOf } from "#testing/focus-ring";
import { Message, MessageContent } from "../ai-elements/message";
import { Plan, PlanHeader, PlanTitle } from "../ai-elements/task";
import { TOOL_BLOCK, TOOL_STATE } from "../ai-elements/tool";
import { TranscriptRows, TranscriptTodosDock, TranscriptTool } from "./transcript-blocks";

/**
 * transcript-focus-ring.test.ts -- the keyboard's ring on what a reply holds
 * is drawn whole: a run of calls' line, a call's own line, and a press in a
 * call's opened card, and the plan's card and the to-do dock ring their
 * header inside the edge they clip to, on its rounded corners. Laid out in the window's own
 * stylesheets (`#testing/focus-ring`); synthetic calls.
 */

let styles: HTMLStyleElement | undefined;

beforeAll(async () => {
  styles = await layWindowStyles();
});

afterAll(() => {
  styles?.remove();
});

/** The node drawn into the document as an agent's reply holds it. */
function reply(node: ReactNode): HTMLElement {
  const box = document.body.appendChild(document.createElement("div"));
  box.innerHTML = renderToStaticMarkup(
    createElement(Message, { from: "assistant" }, createElement(MessageContent, null, node)),
  );
  return box;
}

/** One finished command call, opened where `open` asks. */
function command(open = false): ReactNode {
  return createElement(TranscriptTool, {
    kind: CALL_KIND.COMMAND,
    state: TOOL_STATE.OUTPUT_AVAILABLE,
    subject: "pnpm exec vitest run",
    description: "Run the sidebar tests",
    input: { kind: TOOL_BLOCK.COMMAND, text: "pnpm exec vitest run" },
    output: { kind: TOOL_BLOCK.TEXT, text: "4 passed" },
    errorText: undefined,
    defaultOpen: open,
  });
}

function only<T extends Element>(surface: ParentNode, selector: string): T {
  const found = surface.querySelectorAll<T>(selector);
  assert.equal(found.length, 1, `one ${selector}`);
  const [element] = found;
  assert.ok(element !== undefined);
  return element;
}

test("a run of calls' line rings whole inside the reply holding it", () => {
  const rows: TurnRow<string>[] = [
    {
      kind: TURN_ROW.GROUP,
      key: "calls",
      blocks: ["one", "two"],
      summary: "2 tool calls",
      open: false,
      running: false,
      failed: false,
    },
  ];
  const surface = reply(createElement(TranscriptRows<string>, { rows, children: () => command() }));
  const line = only<HTMLElement>(surface, "[data-turn-fold] > summary");
  focusByKeyboard(line);
  assert.ok(ringOf(line), "the line rings");
  assert.equal(
    ringClippedBy(line)?.className,
    undefined,
    "no box around the line cuts its ring off",
  );
  surface.remove();
});

test("a call's line and a press in its opened card ring whole", () => {
  const surface = reply(command(true));
  const line = only<HTMLElement>(surface, "summary");
  focusByKeyboard(line);
  assert.equal(ringClippedBy(line)?.className, undefined, "the call's line rings whole");
  const card = only<HTMLElement>(surface, "details > div");
  const press = card.appendChild(document.createElement("button"));
  focusByKeyboard(press);
  const ring = ringOf(press);
  assert.ok(ring, "a press in the card rings");
  assert.ok(ring.offset + ring.width <= 0, "inside itself, on the card's side of its clipped edge");
  surface.remove();
});

test("the plan's card and the to-do dock ring their header inside the edge they clip to, round as the card", () => {
  const surface = reply([
    createElement(
      Plan,
      { key: "plan" },
      createElement(
        PlanHeader,
        null,
        createElement(PlanTitle, { label: "Plan", children: "Audit focus rings" }),
      ),
    ),
    createElement(TranscriptTodosDock, {
      key: "todos",
      todos: [
        { content: "Read the shared focus styles", status: CODING_AGENT_TODO_STATUS.IN_PROGRESS },
      ],
      summary: "0 of 1 done",
      focus: "Read the shared focus styles",
    }),
  ]);
  const headers = [...surface.querySelectorAll<HTMLElement>("summary")];
  assert.equal(headers.length, 2, "the plan's header and the dock's");
  for (const header of headers) {
    focusByKeyboard(header);
    const ring = ringOf(header);
    assert.ok(ring, "the header rings");
    assert.ok(ring.offset + ring.width <= 0, "inside the card's clipped edge");
    const card = header.parentElement;
    assert.ok(card);
    assert.notEqual(getComputedStyle(card).borderRadius, "0", "the card is rounded");
    assert.equal(
      getComputedStyle(header).borderRadius,
      getComputedStyle(card).borderRadius,
      "the closed header, and so its ring, rounds as the card does",
    );
  }
  surface.remove();
});
