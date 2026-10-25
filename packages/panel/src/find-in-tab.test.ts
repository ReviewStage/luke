// @vitest-environment jsdom

import assert from "node:assert/strict";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { holdExits } from "@luke/ui/testing/held-exits";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test, vi } from "vitest";
import { runAppCommand } from "./app-commands.js";
import { FindScope } from "./find-in-tab.js";
import { holdMotion, releaseMotion } from "./testing/motion-held.js";

/**
 * find-in-tab.test.ts -- the find bar over a tab leaves as it arrives: Escape
 * or its close puts it away, focus back where ⌘F found it, the bar drawn
 * through its fade out on the exit token, taking no press and saying what it
 * last said, and gone once the fade has run, or at once where motion is held.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

const roots: Root[] = [];

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
  releaseMotion();
  Reflect.deleteProperty(Element.prototype, "getAnimations");
  vi.useRealTimers();
});

const BAR = '.find-bar[role="search"]';

/** A tab with words in it, and a button holding focus before the bar opens, with the find bar opened by ⌘F. */
function opened(): HTMLButtonElement {
  const before = document.createElement("button");
  const host = document.createElement("div");
  document.body.append(before, host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      createElement(
        FindScope,
        { active: true, subject: { agent: "agent-1" } },
        createElement("p", null, "The invite funnel"),
      ),
    ),
  );
  before.focus();
  act(() => {
    runAppCommand(APP_COMMAND.FIND);
  });
  assert.ok(document.querySelector(BAR), "⌘F opens the bar");
  return before;
}

/** Escape pressed in the bar's field. */
function pressEscape(): void {
  const field = document.querySelector<HTMLInputElement>('.find-bar input[aria-label="Find"]');
  assert.ok(field);
  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
}

test("a closed find bar stays drawn, inert, through its exit, with focus already back, and is gone after it", async () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
  const exits = holdExits();
  const before = opened();

  pressEscape();
  const leaving = document.querySelector<HTMLElement>(BAR);
  const heldBack = document.activeElement === before;
  await act(async () => exits.finish());

  assert.ok(leaving, "the bar stands through its exit");
  assert.equal(leaving.hasAttribute("inert"), true);
  assert.equal(heldBack, true);
  assert.equal(document.querySelector(BAR), null);
});

test("a find bar opened again while it leaves is the same bar, standing open", async () => {
  holdExits();
  const before = opened();
  pressEscape();
  const leaving = document.querySelector<HTMLElement>(BAR);

  act(() => {
    runAppCommand(APP_COMMAND.FIND);
  });

  assert.equal(document.querySelector(BAR), leaving);
  assert.notEqual(document.activeElement, before);
});

test("the find bar goes at once while motion is held", () => {
  holdMotion();
  holdExits();
  const before = opened();

  pressEscape();

  assert.equal(document.querySelector(BAR), null);
  assert.equal(document.activeElement, before);
});
