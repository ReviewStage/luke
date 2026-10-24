// @vitest-environment jsdom

import assert from "node:assert/strict";
import { Effect } from "effect";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { copyingInto, fakeAppPlatform } from "../testing/app-platform.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { TranscriptWords } from "./transcript-blocks.js";

/**
 * transcript-code-card.test.ts -- a fenced block in a transcript, an Inbox
 * item or a chat message is a code card: its language in the header with
 * one Copy, a block of more than 40 lines cut there behind Show all, and
 * Copy copies the whole block however it stands. Synthetic code.
 */

beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

const roots: Root[] = [];

beforeEach(() => {
  // A fenced block with a language asks main for its colours; refused, it is drawn plain.
  fakeAppBridge({});
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** What the element draws, once whatever it loads has landed. */
async function drawn(element: ReactElement): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(element));
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
  return container;
}

/** A block of `count` numbered lines. */
function block(count: number): string {
  return Array.from({ length: count }, (_, at) => `const line${at + 1} = ${at + 1};`).join("\n");
}

function fenced(code: string): string {
  return `Here it is:\n\n\`\`\`typescript\n${code}\n\`\`\`\n`;
}

function buttonNamed(drawing: HTMLElement, name: string): HTMLButtonElement | undefined {
  return [...drawing.querySelectorAll("button")].find(
    (button) => (button.getAttribute("aria-label") ?? button.textContent) === name,
  );
}

/** The lines the card shows now, less what it holds `hidden` and the newline that closes the last. */
function shownLines(drawing: HTMLElement): string[] {
  const body = drawing.querySelector(".luke-code-card pre")?.cloneNode(true);
  if (!(body instanceof Element)) return assert.fail("No code card");
  for (const hidden of body.querySelectorAll("[hidden]")) hidden.remove();
  return (body.textContent ?? "").replace(/\n$/u, "").split("\n");
}

test("a long fence in a transcript is cut at 40 lines behind Show all, which shows the rest", async () => {
  const code = block(60);
  const drawing = await drawn(createElement(TranscriptWords, { text: fenced(code) }));

  assert.equal(
    drawing.querySelector(".luke-code-card figcaption")?.textContent?.startsWith("typescript"),
    true,
  );
  assert.deepEqual(shownLines(drawing), code.split("\n").slice(0, 40));
  act(() => (buttonNamed(drawing, "Show all") ?? assert.fail("No Show all")).click());
  assert.deepEqual(shownLines(drawing), code.split("\n"));
  assert.ok(buttonNamed(drawing, "Show less"), "the rest can be cut again");
});

test("Copy copies the whole fence, even while it is cut", async () => {
  const copied: string[] = [];
  fakeAppPlatform(copyingInto(copied));
  const code = block(60);
  const drawing = await drawn(createElement(TranscriptWords, { text: fenced(code) }));

  await act(async () => (buttonNamed(drawing, "Copy code") ?? assert.fail("No Copy")).click());
  assert.deepEqual(copied, [code]);
  assert.equal(
    drawing.querySelectorAll('button[aria-label^="Copy"]').length,
    1,
    "one Copy a block",
  );
});

test("an Inbox item's or a chat message's fence, drawn as a document, is the same card", async () => {
  const code = block(45);
  const drawing = await drawn(
    createElement(TranscriptWords, { text: fenced(code), asDocument: true }),
  );

  assert.equal(drawing.querySelectorAll(".luke-code-card").length, 1);
  assert.deepEqual(shownLines(drawing), code.split("\n").slice(0, 40));
  assert.ok(buttonNamed(drawing, "Show all"));
  assert.ok(buttonNamed(drawing, "Copy code"));
});

test("a fence naming no language is headed text", async () => {
  const drawing = await drawn(createElement(TranscriptWords, { text: "```\nplain words\n```\n" }));
  assert.equal(
    drawing.querySelector(".luke-code-card figcaption")?.textContent?.startsWith("text"),
    true,
  );
});
