// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { layContainersAt } from "#testing/container-width";
import { PlanBanner } from "./desktop/plan-banner";
import { ArchivedBanner, ArchivedComposerNote } from "./planning/archived-plan";

/**
 * banner.test.ts -- a plan's notices at the widths a column or the side panel leaves them: narrow, the presses take a line of their own beneath the words, each as wide as the line, and the words wrap rather than being squeezed or cut; wide, words and presses share one line.
 *
 * jsdom lays nothing out, so each width is the stylesheets' `banner`
 * container queries resolved for a strip that wide
 * (`#testing/container-width`). Synthetic throughout.
 */

/** The strip's own width in each place it stands. */
const STRIP = {
  /** The archived card in a 280px column beside a wide side panel. */
  CARD_IN_NARROWEST_COLUMN: 146,
  /** The composer's row in the same column. */
  COMPOSER_IN_NARROWEST_COLUMN: 186,
  /** The slim line across a 280px column. */
  LINE_IN_NARROWEST_COLUMN: 280,
  /** Any of them in a comfortable column. */
  WIDE: 680,
} as const;

let root: Root | undefined;
let style: HTMLStyleElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  style?.remove();
  document.body.innerHTML = "";
});

/** Draws a strip with its stylesheets resolved for a strip `width` pixels wide, answering the strip. */
function drawnAt(width: number, strip: ReactNode): HTMLElement {
  style = layContainersAt({ banner: width });
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(strip));
  const section = container.querySelector<HTMLElement>("section");
  assert.ok(section, "the strip is drawn");
  return section;
}

/** Whether the strip's presses stand on a line of their own beneath its words, each as wide as the line allows. */
function pressesBeneath(section: HTMLElement): boolean {
  const row = section.querySelector<HTMLElement>(".banner-row");
  const presses = section.querySelector<HTMLElement>(".banner-actions");
  assert.ok(row && presses, "the strip has its row and its presses");
  const own =
    getComputedStyle(row).flexWrap === "wrap" && getComputedStyle(presses).flexBasis === "100%";
  const filled = [...presses.children].every((press) => getComputedStyle(press).flexGrow === "1");
  return own && filled;
}

/** What a reader hears the strip named: the words it is labelled by. */
function named(section: HTMLElement): string | undefined {
  return (
    document.getElementById(section.getAttribute("aria-labelledby") ?? "")?.textContent ?? undefined
  );
}

/** The press a strip carries with these words. */
function press(section: HTMLElement, words: string): HTMLButtonElement {
  const found = [...section.querySelectorAll("button")].find(
    (button) => button.textContent === words,
  );
  assert.ok(found, `the strip carries ${words}`);
  return found;
}

test("an archived task's card puts Unarchive beneath its words in the narrowest column, and beside them in a wide one", () => {
  const narrow = drawnAt(
    STRIP.CARD_IN_NARROWEST_COLUMN,
    createElement(ArchivedBanner, { onUnarchive: () => undefined }),
  );
  assert.equal(named(narrow), "This task is archived");
  assert.equal(pressesBeneath(narrow), true);
  press(narrow, "Unarchive");
  act(() => root?.unmount());
  style?.remove();
  const wide = drawnAt(STRIP.WIDE, createElement(ArchivedBanner, { onUnarchive: () => undefined }));
  assert.equal(pressesBeneath(wide), false);
});

test("an archived task's agent's composer row puts Stop and Unarchive beneath its words in the narrowest column", () => {
  const note = createElement(ArchivedComposerNote, {
    onUnarchive: () => undefined,
    stop: () => Promise.resolve(),
  });
  const narrow = drawnAt(STRIP.COMPOSER_IN_NARROWEST_COLUMN, note);
  assert.equal(named(narrow), "Unarchive to send messages");
  assert.equal(pressesBeneath(narrow), true);
  press(narrow, "Stop");
  press(narrow, "Unarchive");
  act(() => root?.unmount());
  style?.remove();
  assert.equal(pressesBeneath(drawnAt(STRIP.WIDE, note)), false);
});

test("a plan's slim banner wraps its words and drops its press beneath them in the narrowest column, and keeps one cut line in a wide one", () => {
  const banner = createElement(PlanBanner, {
    action: { label: "Move to Northwind Platform Infrastructure", onPress: () => undefined },
    children: "This task's repository belongs to Northwind Platform Infrastructure",
  });
  const narrow = drawnAt(STRIP.LINE_IN_NARROWEST_COLUMN, banner);
  const words = narrow.querySelector<HTMLElement>(".plan-banner-words");
  assert.ok(words, "the banner has its words");
  assert.equal(getComputedStyle(words).whiteSpace, "normal");
  assert.equal(pressesBeneath(narrow), true);
  act(() => root?.unmount());
  style?.remove();
  const wide = drawnAt(STRIP.WIDE, banner);
  const line = wide.querySelector<HTMLElement>(".plan-banner-words");
  assert.ok(line, "the banner has its words");
  assert.equal(getComputedStyle(line).whiteSpace, "nowrap");
  assert.equal(pressesBeneath(wide), false);
});
