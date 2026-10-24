// @vitest-environment jsdom

import { Duration } from "effect";
import { act, createElement, Fragment, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { CheckIcon } from "../../face/glyphs.js";
import { GLYPH } from "../../icons/glyph-registry.js";
import { Announcer } from "../announcer/announcer.js";
import { TOAST_HOLD } from "../toast/toast.js";
import { CopyButton } from "./copy-button.js";

/**
 * copy-button.test.ts -- a copy button is named "Copy {what}", hands its
 * words to the copy act it is given, shows the check and says "Copied"
 * once the act lands, and is back to the copy glyph once the toast's short
 * hold has run out; a refused copy shows the alert and says it could not
 * copy; a second press starts the hold over. Synthetic words.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const HOLD_MS = Duration.toMillis(TOAST_HOLD.DONE);

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  vi.useRealTimers();
});

function draw(element: ReactElement): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Fragment, null, createElement(Announcer), element)));
  return container;
}

/** The markup `Glyph` draws, to tell which glyph the button shows. */
function drawing(Glyph: () => React.JSX.Element): string {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(createElement(Glyph)));
  const markup = container.innerHTML;
  act(() => root.unmount());
  return markup;
}

function button(): HTMLButtonElement {
  return document.querySelector("button") ?? expect.fail("No copy button");
}

/** The glyph the button shows now. */
function shownGlyph(): string {
  return button().querySelector('[aria-hidden="true"]')?.innerHTML ?? "";
}

/** What the window's announcer says now in `role`'s region. */
function said(role: "status" | "alert"): string {
  return document.querySelector(`[role="${role}"]`)?.textContent ?? "";
}

async function press(): Promise<void> {
  await act(async () => button().click());
}

test("a copy button is named for what it copies, and draws the copy glyph at rest", () => {
  draw(createElement(CopyButton, { text: "pnpm test", what: "code", copy: async () => {} }));
  expect(button().getAttribute("aria-label")).toBe("Copy code");
  expect(shownGlyph()).toBe(drawing(GLYPH.COPY));
});

test("a press copies its words, shows the check, and turns back to the copy glyph after the hold", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const copied: string[] = [];
  draw(
    createElement(CopyButton, {
      text: "pnpm test",
      what: "code",
      copy: async (words: string) => {
        copied.push(words);
      },
    }),
  );
  await press();
  expect(copied).toEqual(["pnpm test"]);
  expect(shownGlyph()).toBe(drawing(CheckIcon));
  expect(said("status")).toBe("Copied");
  expect(button().getAttribute("aria-label")).toBe("Copy code");
  act(() => vi.advanceTimersByTime(HOLD_MS - 1));
  expect(shownGlyph()).toBe(drawing(CheckIcon));
  act(() => vi.advanceTimersByTime(1));
  expect(shownGlyph()).toBe(drawing(GLYPH.COPY));
  expect(said("status")).toBe("");
});

test("a refused copy shows the alert and says so, then turns back after the hold", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  draw(
    createElement(CopyButton, {
      text: "pnpm test",
      what: "code",
      copy: () => Promise.reject(new Error("The clipboard refused")),
    }),
  );
  await press();
  expect(shownGlyph()).toBe(drawing(GLYPH.FAILED));
  expect(said("alert")).toBe("Could not copy");
  expect(said("status")).toBe("");
  act(() => vi.advanceTimersByTime(HOLD_MS));
  expect(shownGlyph()).toBe(drawing(GLYPH.COPY));
  expect(said("alert"), "the refusal is taken back with the glyph").toBe("");
});

test("a refused copy answered by a retry that lands leaves no refusal behind", async () => {
  let refuses = true;
  draw(
    createElement(CopyButton, {
      text: "pnpm test",
      what: "code",
      copy: () =>
        refuses ? Promise.reject(new Error("The clipboard refused")) : Promise.resolve(),
    }),
  );
  await press();
  expect(said("alert")).toBe("Could not copy");
  refuses = false;
  await press();
  expect(said("status")).toBe("Copied");
  expect(said("alert")).toBe("");
});

test("a copy act that throws before it answers is a refused copy too", async () => {
  draw(
    createElement(CopyButton, {
      text: "pnpm test",
      what: "code",
      copy: () => {
        throw new Error("No clipboard here");
      },
    }),
  );
  await press();
  expect(shownGlyph()).toBe(drawing(GLYPH.FAILED));
  expect(said("alert")).toBe("Could not copy");
});

test("the copy act runs within the press, while a browser's clipboard still takes a write", () => {
  const copied: string[] = [];
  draw(
    createElement(CopyButton, {
      text: "pnpm test",
      what: "code",
      copy: async (words: string) => {
        copied.push(words);
      },
    }),
  );
  act(() => button().click());
  expect(copied).toEqual(["pnpm test"]);
});

test("a second press starts the hold over from its own answer", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  draw(createElement(CopyButton, { text: "main", what: "branch name", copy: async () => {} }));
  await press();
  act(() => vi.advanceTimersByTime(HOLD_MS - 1));
  await press();
  act(() => vi.advanceTimersByTime(HOLD_MS - 1));
  expect(shownGlyph()).toBe(drawing(CheckIcon));
  act(() => vi.advanceTimersByTime(1));
  expect(shownGlyph()).toBe(drawing(GLYPH.COPY));
  expect(said("status")).toBe("");
});
