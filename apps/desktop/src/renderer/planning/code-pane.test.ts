// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { CodeRef } from "@sidecar/hosted/plan-wire";
import type { PlanCode, PlanCodeShowing } from "@sidecar/hosted/planning-view";
import { Duration, Effect } from "effect";
import { TestClock } from "effect/testing";
import type { AtomRegistry } from "effect/unstable/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, onTestFinished, test } from "vitest";
import { installClipboard, onRegistry, registryOnTestClock } from "#testing/copy-feedback";
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
const openNothing = () => undefined;

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The feed drawn into the document, redrawn by each `draw`, its atoms on `registry` where one is given. */
function mounted(onOpenFile: (ref: CodeRef) => void = openNothing, registry?: AtomRegistry) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const draw = (shown: readonly PlanCodeShowing[], calls = CALLS) => {
    const pane = createElement(CodePane, { shown, calls, onOpenFile });
    act(() => root.render(registry === undefined ? pane : onRegistry(registry, pane)));
  };
  return { container, draw };
}

/** Lets the clipboard's answer, and the redraw it causes, land with no time passing. */
const settle = Effect.promise(() =>
  act(async () => {
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
  }),
);

/** Advances the clock the copy's hold waits on, then lets what fell due land. */
const advance = (millis: number) =>
  Effect.andThen(TestClock.adjust(Duration.millis(millis)), settle);

/** What a copy button says it came to, as a reader hears it, and the glyph it draws. */
interface CopyAnswer {
  said: string;
  glyph: string | null;
}

function copyAnswer(button: HTMLElement): CopyAnswer {
  return {
    said: button.querySelector('[role="status"]')?.textContent ?? "",
    glyph: button.querySelector(".copy-glyph")?.getAttribute("data-state") ?? null,
  };
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

test("the card a File tab's note asks for is scrolled to as the tab is drawn, clear of its call's checkpoint, and said shown, and the feed stays there as more code lands", () => {
  // Note that jsdom lays nothing out, so the log and each card say where they stand.
  const at = { log: 100, b: -900 };
  const { prototype } = HTMLElement;
  const measures = {
    scrollHeight: Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight"),
    clientHeight: Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight"),
    rect: prototype.getBoundingClientRect,
  };
  Object.defineProperty(prototype, "scrollHeight", { configurable: true, get: () => 2_000 });
  Object.defineProperty(prototype, "clientHeight", { configurable: true, get: () => 400 });
  prototype.getBoundingClientRect = function (this: HTMLElement) {
    const top =
      this.getAttribute("role") === "log" ? at.log : this.dataset.callId === "b" ? at.b : 0;
    return new DOMRect(0, top, 300, 120);
  };
  onTestFinished(() => {
    Reflect.deleteProperty(prototype, "scrollHeight");
    Reflect.deleteProperty(prototype, "clientHeight");
    prototype.getBoundingClientRect = measures.rect;
  });
  const revealed: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const shown = [
    showing("a", 2_000, windowOf("src/invite.ts", 11, 12)),
    showing("b", 3_000, windowOf("src/invite.ts", 20, 20)),
    showing("c", 3_660_000, windowOf("src/roles.ts", 4, 6)),
  ];
  const draw = (code: readonly PlanCodeShowing[], reveal?: string) =>
    act(() =>
      root.render(
        createElement(CodePane, {
          shown: code,
          calls: CALLS,
          onOpenFile: openNothing,
          reveal,
          onRevealed: () => revealed.push(reveal ?? "none"),
        }),
      ),
    );

  draw(shown, "b");
  const log = container.querySelector<HTMLElement>('[role="log"]');
  assert.ok(log);
  // The log first kept to its newest card, 2,000 down, then stood the card 44 under its top.
  assert.equal(log.scrollTop, 2_000 - 900 - 100 - 44);
  assert.deepEqual(revealed, ["b"]);

  const kept = log.scrollTop;
  draw([...shown, showing("d", 3_670_000, windowOf("src/roles.ts", 9, 9))]);
  assert.equal(log.scrollTop, kept, "left on the card asked for");
  assert.deepEqual(revealed, ["b"], "asked for once");
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
      onOpenFile: openNothing,
    }),
  );

  const numbered = [
    ...markup.matchAll(/data-pointed="(true|false)"><span class="code-line-number"[^>]*>(\d+)</gu),
  ].map((match) => `${match[2]}${match[1] === "true" ? " lit" : ""}`);
  assert.deepEqual(numbered, ["8", "9", "10", "11 lit", "12 lit", "13", "14", "15"]);
});

test("a card says Luke's note on its lines in words between its heading and the lines, and code shown before notes reads without one", () => {
  const { container, draw } = mounted();
  const note = "The invite is looked up by its token alone, so an expired token still finds it.";

  draw([
    showing("a", 2_000, { ...windowOf("src/invite.ts", 3, 4), note }),
    showing("b", 3_000, windowOf("src/roles.ts", 7, 7)),
  ]);

  const [noted, bare] = [...container.querySelectorAll(".code-card")];
  assert.ok(noted && bare);
  assert.deepEqual(
    [...noted.children].map((part) => part.className),
    ["code-card-header", "code-card-note", "code-lines"],
  );
  assert.equal(noted.querySelector(".code-card-note")?.textContent, note);
  assert.deepEqual(
    [...bare.children].map((part) => part.className),
    ["code-card-header", "code-lines"],
  );
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
      onOpenFile: openNothing,
    }),
  );

  assert.match(markup, /<span style="--run-dark:#ff7b72;--run-light:#cf222e">export<\/span>/u);
  assert.match(markup, /<span> function accept\(\) \{<\/span>/u);
});

it.effect(
  "a card's copy hands the clipboard the lines pointed at and turns its glyph to a check for a moment, its name unchanged, a second press starting the moment again",
  () =>
    Effect.gen(function* () {
      const clipboard = installClipboard();
      const { container, draw } = mounted(openNothing, yield* registryOnTestClock);
      draw([showing("a", 2_000, windowOf("src/invite.ts", 11, 12))]);
      const copy = container.querySelector<HTMLButtonElement>('button[aria-label="Copy lines"]');
      assert.ok(copy);
      assert.deepEqual(copyAnswer(copy), { said: "", glyph: "idle" });

      act(() => copy.click());
      yield* settle;
      assert.deepEqual(clipboard.copied, ["line 11\nline 12"]);
      assert.deepEqual(copyAnswer(copy), { said: "Copied", glyph: "copied" });
      assert.equal(copy.getAttribute("aria-label"), "Copy lines", "the button keeps its name");

      // Pressed again a second in, the check stands a whole moment from the second press.
      yield* advance(1_000);
      act(() => copy.click());
      yield* settle;
      yield* advance(1_000);
      assert.deepEqual(copyAnswer(copy), { said: "Copied", glyph: "copied" });
      yield* advance(200);
      assert.deepEqual(copyAnswer(copy), { said: "", glyph: "idle" });
    }),
);

it.effect(
  "a card's copy the clipboard refused turns its glyph to an alert for the same moment, and back",
  () =>
    Effect.gen(function* () {
      const clipboard = installClipboard();
      clipboard.refuse(true);
      const { container, draw } = mounted(openNothing, yield* registryOnTestClock);
      draw([showing("a", 2_000, windowOf("src/invite.ts", 11, 12))]);
      const copy = container.querySelector<HTMLButtonElement>('button[aria-label="Copy lines"]');
      assert.ok(copy);

      act(() => copy.click());
      yield* settle;
      assert.deepEqual(clipboard.copied, []);
      assert.deepEqual(copyAnswer(copy), { said: "Could not copy", glyph: "failed" });
      yield* advance(1_200);
      assert.deepEqual(copyAnswer(copy), { said: "", glyph: "idle" });
    }),
);

it.effect(
  "a card's copy shows its last press's answer, however late an earlier press's answer lands",
  () =>
    Effect.gen(function* () {
      const clipboard = installClipboard();
      const { container, draw } = mounted(openNothing, yield* registryOnTestClock);
      draw([showing("a", 2_000, windowOf("src/invite.ts", 11, 12))]);
      const copy = container.querySelector<HTMLButtonElement>('button[aria-label="Copy lines"]');
      assert.ok(copy);

      // The first press's refusal lands after the second press's copy.
      clipboard.refuseNextLate();
      act(() => copy.click());
      act(() => copy.click());
      yield* settle;
      yield* settle;
      assert.deepEqual(copyAnswer(copy), { said: "Copied", glyph: "copied" });
    }),
);

test("a card's Open file and its path each open the whole file, its lines lit", () => {
  const opened: CodeRef[] = [];
  const { container, draw } = mounted((ref) => opened.push(ref));
  draw([showing("a", 2_000, windowOf("src/invite.ts", 11, 12))]);

  act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Open file"]')?.click());
  act(() =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Open src/invite.ts"]')?.click(),
  );

  const ref = { path: "src/invite.ts", startLine: 11, endLine: 12 };
  assert.deepEqual(opened, [ref, ref]);
});

test("the heading names one line, a range, or nothing for a whole file", () => {
  assert.equal(rangeLabel({ startLine: 4, endLine: 4 }), "Line 4");
  assert.equal(rangeLabel({ startLine: 4, endLine: 9 }), "Lines 4–9");
  assert.equal(rangeLabel({}), undefined);
});
