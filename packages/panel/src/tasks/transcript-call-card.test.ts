// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CALL_KIND } from "@luke/features/turn-rows";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { TOOL_BLOCK, TOOL_STATE } from "../ai-elements/tool.js";
import { findRanges, reveal } from "../find-matches.js";
import { copyingInto, fakeAppPlatform } from "../testing/app-platform.js";
import { TranscriptTool } from "./transcript-blocks.js";

/**
 * transcript-call-card.test.ts -- a tool call's input and answer are code
 * cards: a long answer is cut at 40 lines behind Show all, which shows the
 * rest, a find reaches a line past the cut and opens the card on it, and
 * its Copy copies the whole answer however it stands. Synthetic
 * calls.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** A block of `count` numbered lines. */
function numbered(count: number): string {
  return Array.from({ length: count }, (_, at) => `line ${at + 1}`).join("\n");
}

/** A finished command call drawn with its row opened, as a reader would open it. */
function openedCall(answer: string): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(TranscriptTool, {
        kind: CALL_KIND.COMMAND,
        state: TOOL_STATE.OUTPUT_AVAILABLE,
        subject: "pnpm check",
        description: undefined,
        input: { kind: TOOL_BLOCK.COMMAND, text: "pnpm check" },
        output: { kind: TOOL_BLOCK.TEXT, text: answer },
        errorText: undefined,
      }),
    ),
  );
  act(() => container.querySelector<HTMLElement>("summary")?.click());
  return container;
}

function buttonNamed(drawing: HTMLElement, name: string): HTMLButtonElement | undefined {
  return [...drawing.querySelectorAll("button")].find(
    (button) => (button.getAttribute("aria-label") ?? button.textContent) === name,
  );
}

/** The lines the answer's card shows now, less what it holds `hidden` and the newline that closes the last. */
function answerLines(drawing: HTMLElement): string[] {
  const body = drawing.querySelector("[data-tool-output] pre")?.cloneNode(true);
  if (!(body instanceof Element)) return assert.fail("No answer card");
  for (const hidden of body.querySelectorAll("[hidden]")) hidden.remove();
  return (body.textContent ?? "").replace(/\n$/u, "").split("\n");
}

test("a long answer is cut at 40 lines behind Show all, which shows the rest", () => {
  const answer = numbered(60);
  const drawing = openedCall(answer);

  assert.deepEqual(answerLines(drawing), answer.split("\n").slice(0, 40));
  act(() => (buttonNamed(drawing, "Show all") ?? assert.fail("No Show all")).click());
  assert.deepEqual(answerLines(drawing), answer.split("\n"));
  assert.ok(buttonNamed(drawing, "Show less"), "the rest can be cut again");
});

test("a find over the transcript reaches a long answer's line past its cut, and brings it into view with the card whole", () => {
  // jsdom lays nothing out; a match is brought into view where it stands.
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  const answer = numbered(60).replace("line 55", "lantern 55");
  const drawing = openedCall(answer);

  const found = findRanges(drawing, "lantern");
  assert.equal(found.length, 1, "the one match past the cut is found");
  const match = found[0] ?? assert.fail("the match");
  act(() => reveal(match, drawing));
  assert.equal(match.toString(), "lantern");
  assert.equal(answerLines(drawing)[54], "lantern 55", "the line is shown");
  assert.ok(buttonNamed(drawing, "Show less"), "the answer's card stands whole");
});

test("Copy copies the whole answer, even while it is cut, and the input's Copy takes the command without its prompt", async () => {
  const copied: string[] = [];
  fakeAppPlatform(copyingInto(copied));
  const answer = numbered(60);
  const drawing = openedCall(answer);

  const copies = drawing.querySelectorAll<HTMLButtonElement>('button[aria-label="Copy code"]');
  assert.equal(copies.length, 2, "one Copy a block");
  await act(async () => copies[1]?.click());
  await act(async () => copies[0]?.click());
  assert.deepEqual(copied, [answer, "pnpm check"]);
});
