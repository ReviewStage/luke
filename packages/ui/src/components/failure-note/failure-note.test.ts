/**
 * failure-note.test.ts -- a failure's line is one alert saying its words and,
 * where it is given a press, Retry, whose press tries again, then a second
 * act of the caller's where one is given; with none it says its words alone;
 * its mark says nothing to a reader.
 */

// @vitest-environment jsdom

import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { FailureNote } from "../../index.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

/** jsdom's stand-in observer: jsdom lays nothing out, so nothing ever reports a resize. */
class SilentResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const WORDS = "The message could not be sent.";

const roots: Root[] = [];

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("ResizeObserver", SilentResizeObserver);
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

/** Draws `element` into the page and answers the one alert it says. */
function mountAlert(element: ReactElement): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  const alerts = container.querySelectorAll<HTMLElement>('[role="alert"]');
  expect(alerts).toHaveLength(1);
  const [alert] = alerts;
  if (alert === undefined) throw new Error("no alert");
  return alert;
}

test("a failure is one alert saying its words and Retry, whose press tries again", () => {
  let tries = 0;
  const alert = mountAlert(
    createElement(FailureNote, {
      onRetry: () => {
        tries += 1;
      },
      children: WORDS,
    }),
  );
  const buttons = alert.querySelectorAll("button");
  expect(buttons).toHaveLength(1);
  expect(alert.textContent).toBe(`${WORDS}Retry`);

  act(() => buttons[0]?.click());

  expect(tries).toBe(1);
});

test("a failure with no Retry says its words alone, and offers no button", () => {
  const alert = mountAlert(createElement(FailureNote, { children: WORDS }));

  expect(alert.textContent).toBe(WORDS);
  expect(alert.querySelector("button")).toBeNull();
});

test("a failure's mark says nothing to a reader", () => {
  const alert = mountAlert(createElement(FailureNote, { children: WORDS }));
  const marks = [...alert.querySelectorAll("svg")];

  expect(marks).toHaveLength(1);
  expect(marks.every((mark) => mark.closest("[aria-hidden='true']") !== null)).toBe(true);
});

test("a failure's second act stands after Retry in the same alert, and works alone without one", () => {
  let tries = 0;
  let discards = 0;
  const discard = createElement(
    "button",
    {
      type: "button",
      onClick: () => {
        discards += 1;
      },
    },
    "Discard",
  );
  const both = mountAlert(
    createElement(FailureNote, {
      onRetry: () => {
        tries += 1;
      },
      also: discard,
      children: WORDS,
    }),
  );
  expect(both.textContent).toBe(`${WORDS}RetryDiscard`);

  const buttons = both.querySelectorAll("button");
  act(() => buttons[1]?.click());
  act(() => buttons[0]?.click());

  expect([tries, discards]).toEqual([1, 1]);

  const alone = mountAlert(createElement(FailureNote, { also: discard, children: WORDS }));
  expect(alone.textContent).toBe(`${WORDS}Discard`);
});
