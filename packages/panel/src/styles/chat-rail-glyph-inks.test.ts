// @vitest-environment jsdom

import assert from "node:assert/strict";
import { TASK_STATUS } from "@luke/features/task-wire";
import { PROFILE, surfaceAttributes, TaskStatusMark, THEME } from "@luke/ui";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * chat-rail-glyph-inks.test.ts -- the Chat rail inks its place glyphs (#, @,
 * a document) in the muted ink, and leaves a task's status mark the colour
 * its status gives it, as the Inbox and the sidebar draw it. The rail's rule
 * stands outside every `@layer`, so a rule written over every svg in a row's
 * mark would beat the layered status colours and grey the mark.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let root: Root | undefined;
let laid: HTMLStyleElement | undefined;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  if (root !== undefined) act(() => root?.unmount());
  root = undefined;
  laid?.remove();
  laid = undefined;
  document.body.replaceChildren();
  for (const name of ["data-luke-profile", "data-luke-theme", "data-luke-density"]) {
    document.documentElement.removeAttribute(name);
  }
});

/** The ink the rail draws a row's mark in, which holds `mark`. */
function railMarkInk(mark: React.ReactNode): string {
  for (const [name, value] of Object.entries(surfaceAttributes(PROFILE.DESKTOP, THEME.LIGHT))) {
    if (value !== undefined) document.documentElement.setAttribute(name, value);
  }
  laid = layContainersAt({});
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      createElement(
        "nav",
        { className: "chat-rail" },
        createElement("span", { className: "inbox-row-mark" }, mark),
      ),
    ),
  );
  const glyph = container.querySelector(".chat-rail .inbox-row-mark > svg");
  assert.ok(glyph, "the mark draws an svg");
  const style = getComputedStyle(glyph);
  // Note that a status mark draws in its tone's ink, which is read through to the palette's role it names.
  return style.color === "var(--luke-tone-ink)"
    ? style.getPropertyValue("--luke-tone-ink").trim()
    : style.color;
}

test("a place's glyph is inked muted in the rail", () => {
  const glyph = createElement("svg", { viewBox: "0 0 14 14" });
  assert.equal(railMarkInk(glyph), "var(--luke-color-text-muted)");
});

test("a task's status mark keeps its status colour in the rail", () => {
  assert.equal(
    railMarkInk(createElement(TaskStatusMark, { status: TASK_STATUS.IN_PROGRESS })),
    "var(--luke-color-working)",
  );
});

test("a done task's mark keeps the complete colour in the rail", () => {
  assert.equal(
    railMarkInk(createElement(TaskStatusMark, { status: TASK_STATUS.DONE })),
    "var(--luke-color-complete)",
  );
});
