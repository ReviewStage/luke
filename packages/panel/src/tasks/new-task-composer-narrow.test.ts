// @vitest-environment jsdom

import assert from "node:assert/strict";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { editorBundleLanded, installEditorLayout, typeInComposer } from "../testing/composer.js";
import { layContainersAt, shown } from "../testing/container-width.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { tasksControl } from "../testing/tasks-control.js";
import { NewTaskComposer } from "./new-task-composer.js";

/**
 * New task's card on a phone's screen: where it stands on Home, at the top
 * of its page, its `@` and `/` lists open under the caret's line, since a
 * list risen over the card is cut off under the page's head, while the
 * dialog's card keeps them over it; and a card too narrow for every press
 * has its Plan toggle draw its pencil alone, still named and still pressed,
 * so the round Start stands inside the card. jsdom lays nothing out, so the
 * card's width is its form's, given as the window would lay it, and what is
 * drawn at a width is the stylesheets' container queries resolved for a card
 * that wide (`testing/container-width.ts`). Synthetic throughout.
 */

/** The card's width: Home's on a 360px phone, and the dialog's on a desktop. */
const CARD = {
  PHONE: 312,
  DESKTOP: 720,
} as const;

/** The Plan toggle's name, which its tooltip says too. */
const MODE_TOGGLE = "Plan with Luke first";

const roots: Root[] = [];

// Landed before any card renders, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(editorBundleLanded));

beforeEach(() => {
  installScrollIntoView();
  installEditorLayout();
  fakeAppBridge({});
  fakeActPort({});
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/** The card on a repository, as Home draws it (no title) or as the dialog does (`heading`). */
async function mount(heading?: ReactNode): Promise<HTMLElement> {
  const control = tasksControl();
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(NewTaskComposer, {
          newTask: {
            ...control.newTask,
            workspaceId: "workspace-acme",
            repositoriesIn: () => ({ ...control.repositories, recent: ["acme/web"] }),
          },
          workspaceId: "workspace-acme",
          onLeave: () => undefined,
          heading,
        }),
      ),
    ),
  );
  await settle();
  return container;
}

/** Where a list opened in the card stands against the caret's line: over it where its foot is set from the line, under it where its top is. */
function sideOf(list: HTMLElement): "below" | "above" {
  if (list.style.bottom !== "") return "above";
  assert.match(list.style.top, /px$/u, "a list under the line sets its top from it");
  return "below";
}

/** The list a word typed at the start of the box opens, by its class. */
async function listOpenedBy(container: HTMLElement, word: string, list: string) {
  typeInComposer(container, word);
  await settle();
  return container.querySelector<HTMLElement>(list) ?? assert.fail(`${word} opens its list`);
}

test("on Home the @ list opens under the caret's line, where the page's head cannot cut it off", async () => {
  const container = await mount();
  assert.equal(sideOf(await listOpenedBy(container, "@", ".mention-menu")), "below");
});

test("on Home the / list opens under the caret's line too", async () => {
  const container = await mount();
  assert.equal(sideOf(await listOpenedBy(container, "/", ".skill-menu")), "below");
});

test("in the dialog, whose card is not at a page's top, the @ list still opens over the line", async () => {
  const container = await mount(createElement("h2", null, "New task"));
  assert.equal(sideOf(await listOpenedBy(container, "@", ".mention-menu")), "above");
});

test("in the dialog the / list still opens over the line too", async () => {
  const container = await mount(createElement("h2", null, "New task"));
  assert.equal(sideOf(await listOpenedBy(container, "/", ".skill-menu")), "above");
});

/** The toggle that turns Plan mode on, as the card draws it. */
function modeToggle(container: HTMLElement): HTMLButtonElement {
  return (
    container.querySelector<HTMLButtonElement>(`button[aria-label="${MODE_TOGGLE}"]`) ??
    assert.fail("the Plan toggle stands")
  );
}

test("on a phone-wide card the Plan toggle draws its pencil alone, keeps its name, and still turns Plan mode on and off", async () => {
  vi.spyOn(HTMLFormElement.prototype, "clientWidth", "get").mockReturnValue(CARD.PHONE);
  layContainersAt({ composer: CARD.PHONE }, { touch: true });
  const container = await mount();
  const toggle = modeToggle(container);
  const word = toggle.querySelector(".luke-chip-name") ?? assert.fail("the toggle holds its word");

  assert.equal(getComputedStyle(word).width, "1px", "its word is drawn nowhere");
  assert.equal(shown(toggle.querySelector("svg") ?? assert.fail("it holds its pencil")), true);
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
  act(() => toggle.click());
  assert.equal(modeToggle(container).getAttribute("aria-pressed"), "true");
});

test("on a desktop-wide card the Plan toggle says Plan beside its pencil", async () => {
  vi.spyOn(HTMLFormElement.prototype, "clientWidth", "get").mockReturnValue(CARD.DESKTOP);
  layContainersAt({ composer: CARD.DESKTOP });
  const container = await mount();
  const word =
    modeToggle(container).querySelector(".luke-chip-name") ??
    assert.fail("the toggle holds its word");
  assert.equal(shown(word), true);
  assert.notEqual(getComputedStyle(word).width, "1px", "its word is drawn");
  assert.equal(word.textContent, "Plan");
});

test("on a phone-wide card the placeholder wraps in the card's five lines rather than being cut short, and stays one line on a desktop", async () => {
  const placeholder = async (width: number) => {
    const sheet = layContainersAt({ composer: width });
    const container = await mount();
    const drawn =
      container.querySelector(".agent-composer-placeholder") ?? assert.fail("the box is empty");
    const wraps = getComputedStyle(drawn).whiteSpace;
    act(() => {
      for (const root of roots.splice(0)) root.unmount();
    });
    document.body.innerHTML = "";
    window.localStorage.clear();
    sheet.remove();
    return wraps;
  };
  assert.equal(await placeholder(CARD.PHONE), "normal");
  assert.equal(await placeholder(CARD.DESKTOP), "nowrap");
});
