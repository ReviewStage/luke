// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CALL_KIND } from "@luke/features/turn-rows";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { TOOL_BLOCK, TOOL_STATE, type ToolBlock } from "../ai-elements/tool.js";
import { findRanges, reveal } from "../find-matches.js";
import { copyingInto, fakeAppPlatform } from "../testing/app-platform.js";
import { TranscriptTool, type TranscriptToolProps } from "./transcript-blocks.js";

/**
 * transcript-call-card.test.ts -- a tool call's input and output are code
 * cards: a long output is cut at 40 lines behind Show all, which shows the
 * rest, a find reaches a line past the cut and opens the card on it, and
 * its Copy copies the whole output however it stands. JSON reads as words,
 * an output that only acknowledges is left out and an empty one says so,
 * and a command is one Terminal card. Synthetic calls.
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

const PATH = "src/members/accept-invite.ts";

/** A finished call drawn with its row opened, as a reader would open it: a read of `PATH` answering `output` where nothing else is said. */
function openedCall(
  output: ToolBlock | undefined,
  call: Partial<TranscriptToolProps> = {},
): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(TranscriptTool, {
        kind: CALL_KIND.READ_FILE,
        state: TOOL_STATE.OUTPUT_AVAILABLE,
        subject: PATH,
        description: undefined,
        input: { kind: TOOL_BLOCK.TEXT, text: PATH },
        output,
        errorText: undefined,
        ...call,
      }),
    ),
  );
  act(() => container.querySelector<HTMLElement>("summary")?.click());
  return container;
}

/** A read answering `text` as its words. */
function openedRead(text: string): HTMLElement {
  return openedCall({ kind: TOOL_BLOCK.TEXT, text });
}

function buttonNamed(drawing: HTMLElement, name: string): HTMLButtonElement | undefined {
  return [...drawing.querySelectorAll("button")].find(
    (button) => (button.getAttribute("aria-label") ?? button.textContent) === name,
  );
}

/** The lines the card found by `selector` shows now, less what it holds `hidden` and the newline that closes the last. */
function cardLines(drawing: HTMLElement, selector = "[data-tool-output]"): string[] {
  const body = drawing.querySelector(`${selector} pre`)?.cloneNode(true);
  if (!(body instanceof Element)) return assert.fail(`No card at ${selector}`);
  for (const hidden of body.querySelectorAll("[hidden]")) hidden.remove();
  return (body.textContent ?? "").replace(/\n$/u, "").split("\n");
}

/** A card's title, by the card a selector finds. */
function cardTitle(drawing: HTMLElement, selector: string): string | undefined {
  return drawing.querySelector(`${selector} [data-title]`)?.textContent ?? undefined;
}

test("a long output is cut at 40 lines behind Show all, which shows the rest", () => {
  const output = numbered(60);
  const drawing = openedRead(output);

  assert.deepEqual(cardLines(drawing), output.split("\n").slice(0, 40));
  act(() => (buttonNamed(drawing, "Show all") ?? assert.fail("No Show all")).click());
  assert.deepEqual(cardLines(drawing), output.split("\n"));
  assert.ok(buttonNamed(drawing, "Show less"), "the rest can be cut again");
});

test("a find over the transcript reaches a long output's line past its cut, and brings it into view with the card whole", () => {
  // jsdom lays nothing out; a match is brought into view where it stands.
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  const output = numbered(60).replace("line 55", "lantern 55");
  const drawing = openedRead(output);

  const found = findRanges(drawing, "lantern");
  assert.equal(found.length, 1, "the one match past the cut is found");
  const match = found[0] ?? assert.fail("the match");
  act(() => reveal(match, drawing));
  assert.equal(match.toString(), "lantern");
  assert.equal(cardLines(drawing)[54], "lantern 55", "the line is shown");
  assert.ok(buttonNamed(drawing, "Show less"), "the output's card stands whole");
});

test("Copy copies the whole output, even while it is cut", async () => {
  const copied: string[] = [];
  fakeAppPlatform(copyingInto(copied));
  const output = numbered(60);
  const drawing = openedRead(output);

  const copy = drawing.querySelector<HTMLButtonElement>(
    '[data-tool-output] button[aria-label="Copy code"]',
  );
  await act(async () => copy?.click());
  assert.deepEqual(copied, [output]);
});

test("a command is one Terminal card, its prompt line over what it printed and its failure under it, and its Copy takes the command alone", async () => {
  const copied: string[] = [];
  fakeAppPlatform(copyingInto(copied));
  const drawing = openedCall(
    { kind: TOOL_BLOCK.TEXT, text: "lint passed\nexit 1" },
    {
      kind: CALL_KIND.COMMAND,
      state: TOOL_STATE.OUTPUT_ERROR,
      subject: "pnpm check",
      input: { kind: TOOL_BLOCK.COMMAND, text: "pnpm check" },
      errorText: "The command failed.",
    },
  );

  assert.deepEqual(cardLines(drawing, "[data-tool-terminal]"), [
    "$ pnpm check",
    "lint passed",
    "exit 1",
  ]);
  assert.equal(cardTitle(drawing, "[data-tool-terminal]"), "Terminal");
  assert.equal(
    drawing.querySelector("[data-tool-input]"),
    null,
    "no card of its own for the input",
  );
  assert.equal(drawing.querySelector("[data-tool-output]")?.textContent, "The command failed.");
  const copies = drawing.querySelectorAll<HTMLButtonElement>('button[aria-label="Copy code"]');
  assert.equal(copies.length, 1, "one Copy for the one card");
  await act(async () => copies[0]?.click());
  assert.deepEqual(copied, ["pnpm check"]);
});

test.each([
  {
    reads: "a record as indented key: value lines, an empty list as (none)",
    value: { query: "merge", filters: { team: "LUKE", labels: [] }, ids: [1, 2] },
    lines: [
      "query: merge",
      "filters:",
      "  team: LUKE",
      "  labels: (none)",
      "ids:",
      "  - 1",
      "  - 2",
    ],
  },
  {
    reads: "a record holding one string as that string",
    value: { text: "Merge on green" },
    lines: ["Merge on green"],
  },
])("a JSON input reads as words: $reads", ({ value, lines }) => {
  const drawing = openedCall(undefined, {
    kind: CALL_KIND.OTHER,
    subject: "search",
    input: { kind: TOOL_BLOCK.JSON, text: JSON.stringify(value, null, 2) },
  });
  assert.deepEqual(cardLines(drawing, "[data-tool-input]"), lines);
  assert.equal(cardTitle(drawing, "[data-tool-input]"), "Input");
});

test.each([
  {
    reads: "an output that only acknowledges the call is left out",
    output: { kind: TOOL_BLOCK.JSON, text: JSON.stringify({ status: "accepted", ok: true }) },
    shown: undefined,
  },
  {
    reads: "a true under a key of its own is an answer, not an acknowledgement",
    output: { kind: TOOL_BLOCK.JSON, text: JSON.stringify({ exists: true }) },
    shown: "exists: true",
  },
  {
    reads: "an empty output is a muted No output line, with no empty card",
    output: { kind: TOOL_BLOCK.TEXT, text: "" },
    shown: "No output",
  },
])("$reads", ({ output, shown }) => {
  const drawing = openedCall(output);
  const drawn = drawing.querySelector("[data-tool-output]");
  // Note that a card's words are its lines, without its header's.
  const words = drawn?.querySelector("pre") ? cardLines(drawing).join("\n") : drawn?.textContent;
  assert.equal(words, shown);
});
