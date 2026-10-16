// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { CallStatus } from "@luke/ui/tasks-model";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { layContainersAt, shown } from "#testing/container-width";
import { CaptionStrip } from "../caption-strip";
import { CAPTION_TONE } from "../use-caption-presentation";
import { CallBar } from "./planning-parts";

/**
 * The call bar at every width it is drawn at: the plan's own under its
 * document, the sidebar's card, the floating card, and the floating
 * window. However narrow, the voice's word is never cut: a bar too narrow
 * for the status beside the controls stacks it over them; one too narrow
 * for both of the backend's parts drops the notetaker's, so what Luke is
 * doing keeps the line; and the captions over a narrow plan span its
 * column, their volume hint wrapping. jsdom lays nothing out, so each
 * width is the stylesheets' container queries resolved for a bar that wide
 * (`#testing/container-width`). Synthetic throughout.
 */

/** The bar's width where it is drawn. */
const BAR = {
  /** The plan's own, in a 720px column beside the summary's rail. */
  WIDE: 588,
  /** The plan's own, in a 423px column. */
  MAIN_423: 291,
  /** The floating window's and the floating card's. */
  WINDOW: 222,
  /** The plan's own in a 280px column, the rail's room given back. */
  MAIN_280: 200,
  /** The sidebar's card, the sidebar at its narrowest. */
  SIDEBAR_200: 148,
} as const;

const COMMAND = "grep -rn pending src/members";

const WORKING: CallStatus = {
  voiceWord: "Listening",
  backend: { brain: { action: COMMAND }, notes: true },
};

const ignore = () => undefined;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

/** Draws `element` under the stylesheets laid for the containers given. */
function drawnAt(widths: Readonly<Record<string, number>>, element: ReactElement): HTMLElement {
  layContainersAt(widths);
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

/** A call in progress, as the bar draws it in a bar `width` pixels wide. */
function barAt(width: number, status: CallStatus = WORKING, titled = false) {
  const drawn = drawnAt(
    { "call-bar": width },
    createElement(CallBar, {
      status,
      microphone: { label: "Mute microphone", enabled: true, muted: false, onPress: ignore },
      speaker: { muted: false, onPress: ignore },
      stop: { shown: true, onPress: ignore },
      titled,
    }),
  );
  const lines = drawn.querySelector(".call-status") ?? assert.fail("the status stands");
  return {
    /** The words of each part of the status that is drawn, in order. */
    words: () =>
      [...lines.querySelectorAll(".call-status-word, .call-backend-part")]
        .filter(shown)
        .map((part) => part.textContent),
    dots: () => shown(lines.querySelector(".thinking-dots") ?? assert.fail("the dots stand")),
    /** Whether the status takes a row of its own, over the controls. */
    stacked: () => getComputedStyle(lines).flexBasis === "100%",
    planner: () =>
      lines.querySelector<HTMLElement>("[data-part='planner']") ?? assert.fail("Luke's part"),
  };
}

test("a wide bar says the voice's word, Luke's command, and the notetaker's, beside the controls", () => {
  const bar = barAt(BAR.WIDE);
  assert.deepEqual(bar.words(), ["Listening", `Luke · ${COMMAND}`, "Notetaker · Writing notes"]);
  assert.equal(bar.dots(), true);
  assert.equal(bar.stacked(), false);
});

test("a bar in a 423px column gives the notetaker's part up, so Luke's command keeps the line", () => {
  const bar = barAt(BAR.MAIN_423);
  assert.deepEqual(bar.words(), ["Listening", `Luke · ${COMMAND}`]);
  assert.equal(bar.stacked(), false);
});

test("with no command pending, a narrow bar still says the notetaker writes", () => {
  const bar = barAt(BAR.MAIN_423, {
    voiceWord: "Listening",
    backend: { brain: undefined, notes: true },
  });
  assert.deepEqual(bar.words(), ["Listening", "Notetaker · Writing notes"]);
});

test("the floating window's bar stays one row, as its fixed height asks, giving the dots' room to Luke's command, whose whole words it hints", () => {
  const bar = barAt(BAR.WINDOW, WORKING, true);
  assert.deepEqual(bar.words(), ["Listening", `Luke · ${COMMAND}`]);
  assert.equal(bar.dots(), false);
  assert.equal(bar.stacked(), false);
  assert.equal(bar.planner().title, COMMAND);
});

test("a bar with a tooltip of the window's own to hang carries no system hint", () => {
  assert.equal(barAt(BAR.WIDE).planner().title, "");
});

test("a bar in a 280px column, or the sidebar's card at its narrowest, stacks the status over the controls rather than cutting the voice's word", () => {
  for (const width of [BAR.MAIN_280, BAR.SIDEBAR_200]) {
    const bar = barAt(width);
    assert.equal(bar.stacked(), true, `at ${width}px`);
    assert.deepEqual(bar.words(), ["Listening", `Luke · ${COMMAND}`], `at ${width}px`);
  }
});

/** The volume hint under Luke's captions, over a plan's column `width` pixels wide. */
function volumeHintOver(width: number): HTMLElement {
  const drawn = drawnAt(
    { "plan-call-bar": width },
    createElement(
      "div",
      { className: "desktop-call-bar" },
      createElement(CaptionStrip, {
        caption: { shown: true, content: { tone: CAPTION_TONE.LUKE, words: "Say the word." } },
        volumeHint: { wanted: true, text: "Unmute your Mac to hear Luke", onDismiss: ignore },
      }),
    ),
  );
  return drawn.querySelector<HTMLElement>(".volume-hint-text") ?? assert.fail("the hint stands");
}

test("over a 280px column the captions' volume hint wraps rather than being cut to its first word", () => {
  assert.equal(getComputedStyle(volumeHintOver(280)).whiteSpace, "normal");
});

test("over a wide column the captions' volume hint stays one line", () => {
  assert.equal(getComputedStyle(volumeHintOver(720)).whiteSpace, "nowrap");
});
