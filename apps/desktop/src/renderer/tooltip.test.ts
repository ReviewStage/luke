// @vitest-environment jsdom

import assert from "node:assert/strict";
import { MOTION_DELAY_MS } from "@sidecar/surface";
import { act, type ButtonHTMLAttributes, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { APP_COMMAND } from "#shared/shortcuts";
import { Tooltip } from "./tooltip";

/** The page's clock, which the pill reads to know whether it finished waiting. It only rises, as the page's does. */
let now = 0;

let root: Root | undefined;

function button(props: ButtonHTMLAttributes<HTMLButtonElement>, text?: string) {
  return createElement("button", { type: "button", ...props }, text);
}

/** Two neighbouring icon buttons and a labeled one, as a toolbar holds them. */
function mountToolbar(): void {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => {
    root?.render(
      createElement(
        "div",
        null,
        createElement(Tooltip, {
          label: "Hide sidebar",
          command: APP_COMMAND.TOGGLE_SIDEBAR,
          children: button({ "aria-label": "Hide sidebar" }),
        }),
        createElement(Tooltip, {
          label: "Plan actions",
          children: button({ "aria-label": "Plan actions" }),
        }),
        createElement(Tooltip, {
          label: "Settings",
          command: APP_COMMAND.SETTINGS,
          children: button({}, "Dean Stratakos"),
        }),
      ),
    );
  });
}

function control(name: string): HTMLButtonElement {
  const button = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) => (each.getAttribute("aria-label") ?? each.textContent) === name,
  );
  assert.ok(button, `no ${name} control`);
  return button;
}

function pill(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[role="tooltip"]');
}

/** The pointer arriving on a control, as React hears it. */
function hover(name: string): void {
  act(() => {
    control(name).dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
}

/** The pointer leaving a control for nowhere in particular. */
function leave(name: string): void {
  act(() => {
    control(name).dispatchEvent(
      new MouseEvent("pointerout", { bubbles: true, relatedTarget: document.body }),
    );
  });
}

function rest(milliseconds: number): void {
  now += milliseconds;
}

beforeEach(() => {
  // Each test starts long after the last, so no warm spell carries over.
  now += 60_000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  delete document.documentElement.dataset.keyboard;
  vi.restoreAllMocks();
});

test("resting on a control shows a pill naming it and its chord, and leaving takes it down", () => {
  mountToolbar();
  assert.equal(pill(), null);

  hover("Hide sidebar");
  assert.equal(pill()?.textContent, "Hide sidebar⌘B");
  assert.equal(control("Hide sidebar").getAttribute("aria-keyshortcuts"), "Meta+B");
  // The pill is the control's own name, so it is not said to a reader twice.
  assert.equal(control("Hide sidebar").getAttribute("aria-describedby"), null);

  leave("Hide sidebar");
  assert.equal(pill(), null);
});

test("a pill waits out the rest the first time, and the next one shows at once while the pointer keeps moving", () => {
  mountToolbar();

  hover("Hide sidebar");
  assert.equal(pill()?.dataset.instant, "false");
  rest(MOTION_DELAY_MS.HINT);
  leave("Hide sidebar");

  hover("Plan actions");
  assert.equal(pill()?.dataset.instant, "true", "a neighbour shows at once");
  leave("Plan actions");

  rest(MOTION_DELAY_MS.HINT * 2);
  hover("Hide sidebar");
  assert.equal(pill()?.dataset.instant, "false", "a pointer that paused waits again");
});

test("a pill that never finished waiting leaves the next to wait too", () => {
  mountToolbar();

  hover("Hide sidebar");
  rest(MOTION_DELAY_MS.HINT / 2);
  leave("Hide sidebar");
  hover("Plan actions");
  assert.equal(pill()?.dataset.instant, "false");
});

test("a press, a key, and a scroll each take the pill down, and Escape still reaches the window", () => {
  mountToolbar();
  const reached: string[] = [];
  const onKey = (event: KeyboardEvent) => reached.push(event.key);
  window.addEventListener("keydown", onKey);

  hover("Plan actions");
  act(() => {
    control("Plan actions").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
  });
  assert.equal(pill(), null);

  hover("Hide sidebar");
  rest(MOTION_DELAY_MS.HINT);
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
  assert.equal(pill(), null);
  assert.deepEqual(reached, ["Escape"]);

  leave("Hide sidebar");
  hover("Hide sidebar");
  act(() => {
    document.dispatchEvent(new Event("scroll"));
  });
  assert.equal(pill(), null);
  window.removeEventListener("keydown", onKey);
});

test("focus the keyboard moved shows the pill, and focus a press gave does not", () => {
  mountToolbar();

  act(() => control("Plan actions").focus());
  assert.equal(pill(), null);
  act(() => control("Plan actions").blur());

  document.documentElement.dataset.keyboard = "true";
  act(() => control("Plan actions").focus());
  assert.equal(pill()?.textContent, "Plan actions");
  act(() => control("Plan actions").blur());
  assert.equal(pill(), null);
});

test("a pill that says more than its control's name describes it", () => {
  mountToolbar();

  hover("Dean Stratakos");
  const shown = pill();
  assert.ok(shown);
  assert.equal(control("Dean Stratakos").getAttribute("aria-describedby"), shown.id);
  assert.equal(control("Dean Stratakos").getAttribute("aria-keyshortcuts"), "Meta+,");
});

test("a pill hangs below its control, and above it where the window ends", () => {
  mountToolbar();
  const anchor = control("Plan actions");
  const at = (top: number) =>
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(new DOMRect(100, top, 30, 30));

  at(10);
  hover("Plan actions");
  assert.equal(pill()?.dataset.side, "below");
  leave("Plan actions");

  at(window.innerHeight - 30);
  hover("Plan actions");
  assert.equal(pill()?.dataset.side, "above");
});
