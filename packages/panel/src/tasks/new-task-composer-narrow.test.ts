// @vitest-environment jsdom

import assert from "node:assert/strict";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { editorBundleLanded, installEditorLayout, typeInComposer } from "../testing/composer.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { tasksControl } from "../testing/tasks-control.js";
import { MENTION_MENU_SIDE, type MentionMenuSide } from "./mention-picker.js";
import { NewTaskComposer } from "./new-task-composer.js";

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

/** The card on a repository, its lists opening under the line as Home's do, or over it as the dialog's do. */
async function mount(listSide: MentionMenuSide = MENTION_MENU_SIDE.BELOW): Promise<HTMLElement> {
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
          listSide,
        }),
      ),
    ),
  );
  await settle();
  return container;
}

/** Which side of the caret's line a list opened in the card hangs on, as the layer it hangs in says. */
function sideOf(list: HTMLElement): string | null {
  const layer = list.closest(".luke-rect-float") ?? assert.fail("the list hangs in a layer");
  return layer.getAttribute("data-side");
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
  const container = await mount(MENTION_MENU_SIDE.ABOVE);
  assert.equal(sideOf(await listOpenedBy(container, "@", ".mention-menu")), "above");
});

test("in the dialog the / list still opens over the line too", async () => {
  const container = await mount(MENTION_MENU_SIDE.ABOVE);
  assert.equal(sideOf(await listOpenedBy(container, "/", ".skill-menu")), "above");
});

test("the / list closes on a press outside it and the box, and a press in the box leaves it open", async () => {
  const container = await mount();
  const list = await listOpenedBy(container, "/", ".skill-menu");
  const press = (target: Element) =>
    act(() => {
      target.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
  press(list);
  const field = container.querySelector(".composer-editor") ?? assert.fail("the box's editor");
  press(field);
  const keptOpen = container.querySelector(".skill-menu") !== null;
  press(document.body);
  assert.equal(keptOpen, true, "a press in the list or the box leaves it open");
  assert.equal(container.querySelector(".skill-menu") !== null, false, "a press outside closes it");
});
