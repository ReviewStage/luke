// @vitest-environment jsdom

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { holdExits } from "@luke/ui/testing/held-exits";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { EXAMPLES } from "./examples.js";

/**
 * overlay-exits.test.ts -- every overlay the catalog draws fades out rather
 * than vanishing. Each example that draws an overlay is drawn afresh, and each button of it that
 * opens a dialog (`aria-haspopup="dialog"`) is pressed: the overlay stands,
 * then Escape puts it away, and it is still drawn in its ending state, taking
 * no press, until its exit has run, and only then goes. The exit is held
 * rather than waited on (`holdExits`), so no real time passes. An overlay
 * example with no such button is told apart in the last test, so a new one
 * cannot slip past unpressed.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SOURCE = path.dirname(fileURLToPath(import.meta.url));

/** The examples whose overlay leaves by another way, each with it. */
const EXEMPT: Readonly<Record<string, string>> = {
  "picture-tiles":
    "its picture's exit is the flight back into its tile, played by `expand.close` before its owner unmounts the card, so it never closes through `open`",
};

/** What an overlay's example presses to open it. */
const OPENER = "button[aria-haspopup='dialog']";

/** What an overlay's card is called, whichever of the components draws it. */
const OVERLAY = "[role='dialog'], [role='alertdialog']";

/** The components an example draws an overlay with. */
const OVERLAY_COMPONENTS = [
  "AnchoredPopover",
  "CommandAsk",
  "CommandDialog",
  "ConfirmDialog",
  "Dialog",
  "PopoverPanel",
  "SearchableMenu",
] as const;

/** An observer of what jsdom never lays out, which tells nothing. */
class StillObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}

const roots: Root[] = [];
let exits: ReturnType<typeof holdExits>;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StillObserver);
  vi.stubGlobal("IntersectionObserver", StillObserver);
  Element.prototype.scrollIntoView ??= () => undefined;
  // Note that only the frame clock is held, because a card takes focus and answers Escape a frame after it stands.
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
  exits = holdExits();
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  exits.restore();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The example drawn afresh into the page. */
async function draw(Render: () => React.JSX.Element): Promise<HTMLElement> {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(createElement(Render)));
  return container;
}

/** Whether `card` is drawn in its ending state: marked as Base UI marks a popup leaving, or as a held disclosure is. */
function ending(card: Element): boolean {
  return card.closest("[data-ending-style], [data-leaving='true']") !== null;
}

/** The overlay cards standing now. */
function cards(): Element[] {
  return [...document.body.querySelectorAll(OVERLAY)];
}

/** The overlay `opener` opens, named `where` if it opens none. */
async function opened(opener: HTMLElement, where: string): Promise<Element> {
  const before = new Set(cards());
  await act(async () => opener.click());
  await act(async () => vi.advanceTimersToNextFrame());
  return cards().find((card) => !before.has(card)) ?? assert.fail(`${where} opened no overlay`);
}

/** Escape pressed where focus stands, as many times as the card needs to go: a card holding a draft keeps itself open for the first. */
async function putAway(card: Element): Promise<void> {
  for (let attempt = 0; attempt < 2 && !ending(card); attempt += 1) {
    const target = document.activeElement ?? card;
    await act(async () =>
      target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
  }
}

/** The overlay example files, those drawing one of the overlay components. */
function overlayFiles(): readonly string[] {
  const drawn = new RegExp(`<(${OVERLAY_COMPONENTS.join("|")})[\\s>/]`, "u");
  return readdirSync(path.join(SOURCE, "examples"))
    .filter((file) => file.endsWith(".tsx"))
    .filter((file) => drawn.test(readFileSync(path.join(SOURCE, "examples", file), "utf8")));
}

test("every overlay an example opens stays drawn in its ending state until its exit has run, then goes", async () => {
  const left: string[] = [];
  let opening = 0;
  const drawing = overlayFiles().map((file) => path.basename(file, ".tsx"));
  for (const example of EXAMPLES.filter(
    ({ id }) => drawing.includes(id) && EXEMPT[id] === undefined,
  )) {
    const page = await draw(example.Render);
    const count = page.querySelectorAll(OPENER).length;
    for (let at = 0; at < count; at += 1) {
      const opener = page.querySelectorAll<HTMLElement>(OPENER)[at];
      if (opener === undefined) break;
      const where = `${example.id}: "${opener.textContent?.trim()}"`;
      const card = await opened(opener, where);
      opening += 1;
      await putAway(card);
      await act(async () => vi.advanceTimersToNextFrame());
      if (!card.isConnected) left.push(`${where} vanished the moment it was put away`);
      else if (!ending(card)) left.push(`${where} stayed drawn but not in its ending state`);
      await act(async () => exits.finish());
      await act(async () => vi.advanceTimersToNextFrame());
      if (card.isConnected) left.push(`${where} stayed drawn after its exit had run`);
    }
  }
  assert.deepEqual(left, [], "these overlays do not leave through their exit");
  assert.ok(opening >= 10, `only ${opening} overlays were opened`);
});

test("every example file that draws an overlay is the example of that name", () => {
  const ids = new Set(EXAMPLES.map(({ id }) => id));
  const unnamed = overlayFiles()
    .map((file) => path.basename(file, ".tsx"))
    .filter((name) => !ids.has(name));
  assert.deepEqual(unnamed, [], "these files draw an overlay under no example of their name");
});

test("every example file that draws an overlay has a button that opens it, or is exempt by name", () => {
  const without = overlayFiles()
    .map((file) => path.basename(file, ".tsx"))
    .filter(
      (name) =>
        EXEMPT[name] === undefined &&
        !readFileSync(path.join(SOURCE, "examples", `${name}.tsx`), "utf8").includes(
          'aria-haspopup="dialog"',
        ),
    );
  assert.deepEqual(without, [], "these examples draw an overlay no test presses open");
  const stale = Object.keys(EXEMPT).filter((name) => !overlayFiles().includes(`${name}.tsx`));
  assert.deepEqual(stale, [], "these exemptions name no overlay example: delete the row");
});
