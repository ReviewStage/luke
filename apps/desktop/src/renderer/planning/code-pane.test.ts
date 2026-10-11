// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { CodeRef } from "@sidecar/hosted/plan-wire";
import type { PlanCode, PlanCodeShowing } from "@sidecar/hosted/planning-view";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, test } from "vitest";
import { CodePane } from "./code-pane";
import { type CodeFeedCallSource, rangeLabel } from "./code-pane-model";

/** A window of an invented file, its lines numbered in their words, starting at line `firstLine`. */
function windowOf(path: string, startLine: number, endLine: number, firstLine = 1): PlanCode {
  return {
    ref: { path, startLine, endLine },
    repository: "acme/relay",
    firstLine,
    lineCount: 60,
    lines: Array.from({ length: 30 }, (_, at) => [{ text: `line ${firstLine + at}` }]),
  };
}

/** One code shown, by its call, at `shownAt`. */
function showing(callId: string, shownAt: number, code: PlanCode): PlanCodeShowing {
  return { callId, turnId: `turn-${callId}`, shownAt, code };
}

/** Two calls about the plan, the second standing. */
const CALLS: readonly CodeFeedCallSource[] = [
  { key: "call-1", startedAt: 1_000, live: false },
  { key: "call-2", startedAt: 3_600_000, live: true },
];

const roots: Root[] = [];
const copyNothing = () => Promise.resolve();
const openNothing = () => undefined;

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The feed drawn into the document, redrawn by each `draw`. */
function mounted(
  copyText: (words: string) => Promise<void> = copyNothing,
  onOpenFile: (ref: CodeRef) => void = openNothing,
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const draw = (shown: readonly PlanCodeShowing[], calls = CALLS) =>
    act(() => root.render(createElement(CodePane, { shown, calls, copyText, onOpenFile })));
  return { container, draw };
}

/** The feed's order as a reader meets it: each call's divider, marked where it stands live, and each card by its name. */
function feedOrder(container: HTMLElement): string[] {
  return [...container.querySelectorAll("[data-checkpoint], .code-card")].map((element) => {
    if (!element.hasAttribute("data-checkpoint")) return element.getAttribute("aria-label") ?? "";
    return element.textContent?.endsWith("Live") ? "live call" : "call";
  });
}

test("every code Luke showed is a card of its own in the order shown, two of one file two cards, each under the call it was shown on", () => {
  const { container, draw } = mounted();

  draw([
    showing("a", 2_000, windowOf("src/invite.ts", 11, 12)),
    showing("b", 3_000, windowOf("src/invite.ts", 20, 20)),
    showing("c", 3_660_000, windowOf("src/roles.ts", 4, 6)),
  ]);

  assert.deepEqual(feedOrder(container), [
    "call",
    "src/invite.ts, Lines 11–12",
    "src/invite.ts, Line 20",
    "live call",
    "src/roles.ts, Lines 4–6",
  ]);
  assert.ok(container.querySelector(".code-pane.ph-no-capture"), "left out of the recording");
});

test("code shown on the live call lands after every card before it, and the feed keeps to its newest card unless the developer scrolled up", () => {
  const { container, draw } = mounted();
  const first = showing("a", 3_660_000, windowOf("src/invite.ts", 11, 12));
  draw([first]);
  const log = container.querySelector<HTMLElement>('[role="log"]');
  assert.ok(log);
  Object.defineProperty(log, "clientHeight", { configurable: true, value: 400 });
  Object.defineProperty(log, "scrollHeight", { configurable: true, value: 1_000 });

  draw([first, showing("b", 3_670_000, windowOf("src/roles.ts", 2, 2))]);
  assert.deepEqual(feedOrder(container), [
    "live call",
    "src/invite.ts, Lines 11–12",
    "src/roles.ts, Line 2",
  ]);
  assert.equal(log.scrollTop, 1_000, "scrolled to the new card");

  log.scrollTop = 100;
  act(() => log.dispatchEvent(new Event("scroll")));
  Object.defineProperty(log, "scrollHeight", { configurable: true, value: 1_400 });
  draw([
    first,
    showing("b", 3_670_000, windowOf("src/roles.ts", 2, 2)),
    showing("c", 3_680_000, first.code),
  ]);
  assert.equal(log.scrollTop, 100, "left where the developer scrolled to");
});

test("code shown by a turn that began just before the live call was first heard stands under the live call", () => {
  const { container, draw } = mounted();

  draw(
    [showing("a", 3_600_000, windowOf("src/invite.ts", 3, 3))],
    [
      { key: "call-1", startedAt: 1_000, live: false },
      { key: "call-2", startedAt: 3_610_000, live: true },
    ],
  );

  assert.deepEqual(feedOrder(container), ["live call", "src/invite.ts, Line 3"]);
});

test("code shown before any call the transcript holds stands under its own turn's divider", () => {
  const { container, draw } = mounted();

  draw([showing("a", 2_000, windowOf("src/invite.ts", 3, 3))], []);

  assert.deepEqual(feedOrder(container), ["call", "src/invite.ts, Line 3"]);
});

test("a card numbers its lines from where they sit in the file and lights the lines pointed at", () => {
  const code = {
    ...windowOf("src/invite.ts", 11, 12, 8),
    lines: windowOf("src/invite.ts", 11, 12, 8).lines.slice(0, 8),
  };
  const markup = renderToStaticMarkup(
    createElement(CodePane, {
      shown: [showing("a", 2_000, code)],
      calls: CALLS,
      copyText: copyNothing,
      onOpenFile: openNothing,
    }),
  );

  const numbered = [
    ...markup.matchAll(/data-pointed="(true|false)"><span class="code-line-number">(\d+)</gu),
  ].map((match) => `${match[2]}${match[1] === "true" ? " lit" : ""}`);
  assert.deepEqual(numbered, ["8", "9", "10", "11 lit", "12 lit", "13", "14", "15"]);
});

test("a run carries its colour in both appearances, so the stylesheet picks one as the appearance changes", () => {
  const code: PlanCode = {
    ...windowOf("src/invite.ts", 1, 1),
    lines: [
      [
        { text: "export", color: "#ff7b72", lightColor: "#cf222e" },
        { text: " function accept() {" },
      ],
    ],
  };
  const markup = renderToStaticMarkup(
    createElement(CodePane, {
      shown: [showing("a", 2_000, code)],
      calls: CALLS,
      copyText: copyNothing,
      onOpenFile: openNothing,
    }),
  );

  assert.match(markup, /<span style="--run-dark:#ff7b72;--run-light:#cf222e">export<\/span>/u);
  assert.match(markup, /<span> function accept\(\) \{<\/span>/u);
});

test("a card's copy hands the clipboard the lines pointed at, and shows the check once the clipboard took them", async () => {
  const copied: string[] = [];
  const { container, draw } = mounted((words) => {
    copied.push(words);
    return Promise.resolve();
  });
  draw([showing("a", 2_000, windowOf("src/invite.ts", 11, 12))]);

  const copy = container.querySelector<HTMLButtonElement>('button[aria-label="Copy lines"]');
  assert.ok(copy);
  await act(async () => {
    copy.click();
    await Promise.resolve();
  });

  assert.deepEqual(copied, ["line 11\nline 12"]);
  assert.ok(container.querySelector('button[aria-label="Copied"]'));
});

test("a card's Open file and its path each open the whole file, its lines lit", () => {
  const opened: CodeRef[] = [];
  const { container, draw } = mounted(copyNothing, (ref) => opened.push(ref));
  draw([showing("a", 2_000, windowOf("src/invite.ts", 11, 12))]);

  act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Open file"]')?.click());
  act(() =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Open src/invite.ts"]')?.click(),
  );

  const ref = { path: "src/invite.ts", startLine: 11, endLine: 12 };
  assert.deepEqual(opened, [ref, ref]);
});

test("the heading names one line, a range, or nothing for a whole file", () => {
  assert.equal(rangeLabel({ path: "a.ts", startLine: 4, endLine: 4 }), "Line 4");
  assert.equal(rangeLabel({ path: "a.ts", startLine: 4, endLine: 9 }), "Lines 4–9");
  assert.equal(rangeLabel({ path: "a.ts" }), undefined);
});
