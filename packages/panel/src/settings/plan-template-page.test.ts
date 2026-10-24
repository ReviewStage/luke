// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACT_KIND } from "@luke/host/acts";
import { ACTOR_KIND, type PersonActor } from "@luke/ui/actor-model";
import type { Editor, TiptapEditorHTMLElement } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { editorBundleLanded, installEditorLayout } from "../testing/composer.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { newestToastAction } from "../testing/toast.js";
import { ToastHost } from "../toast.js";
import { PlanTemplatePage } from "./plan-template-page.js";

/**
 * plan-template-page.test.ts -- the reset's Undo stands only while it would
 * put back the reset and nothing since: an edit saved after the reset, or the
 * page leaving, withdraws it. Over the real editor bundle; synthetic template.
 */

const ACCOUNT: PersonActor = { kind: ACTOR_KIND.PERSON, userId: "user-1", name: "Ada", you: true };

const MINE = "# Mine\n\nOurs.\n";

const DEFAULT = "# Default\n\nTheirs.\n";

let root: Root | undefined;
let registry: AtomRegistry.AtomRegistry | undefined;

/** Every template the page wrote, `null` for a reset. */
let written: (string | null)[] = [];

beforeAll(() => Effect.runPromise(editorBundleLanded));

beforeEach(() => {
  installEditorLayout();
  fakeAppBridge({});
  written = [];
  fakeActPort({
    [ACT_KIND.PLAN_TEMPLATE_READ]: () => Promise.resolve({ template: MINE, custom: true }),
    [ACT_KIND.PLAN_TEMPLATE_WRITE]: ({ template }) => {
      written.push(template);
      return Promise.resolve({ template: template ?? DEFAULT, custom: template !== null });
    },
  });
});

afterEach(async () => {
  act(() => root?.unmount());
  root = undefined;
  for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
  registry?.dispose();
  registry = undefined;
  document.body.innerHTML = "";
});

/** The window's toasts, beside the template's page while `page` stands. */
function draw(page: boolean): void {
  const drawn = createElement(
    Fragment,
    null,
    page
      ? createElement(PlanTemplatePage, {
          account: ACCOUNT,
          keep: "Follows your account",
          lead: undefined,
          hidden: false,
          onShowHistory: () => undefined,
        })
      : null,
    createElement(ToastHost),
  );
  act(() => root?.render(onRegistry(registry ?? AtomRegistry.make(), drawn)));
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** The template's page, read and then reset, its Undo standing. */
async function resetPage(): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  registry = AtomRegistry.make();
  draw(true);
  await settle();
  const reset = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Reset to defaults",
  );
  assert.ok(reset, "a template of the account's own offers its reset");
  act(() => reset.click());
  await settle();
  assert.equal(newestToastAction()?.textContent, "Undo");
  return container;
}

/** The template's editor, opened on its one section by Enter on its block. */
async function opened(container: HTMLElement): Promise<Editor> {
  const section = container.querySelector<HTMLElement>('[role="group"][aria-label="Default"]');
  assert.ok(section, "the default stands as a section");
  act(() => section.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  await act(async () => undefined);
  const editor = container.querySelector<TiptapEditorHTMLElement>(".plan-document-text")?.editor;
  assert.ok(editor, "the template's editor is open");
  return editor;
}

test("an edit saved after the reset withdraws its Undo, so the Undo can never write the old template over it", async () => {
  const container = await resetPage();
  const editor = await opened(container);

  act(() => {
    editor.view.focus();
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.atEnd(editor.state.doc)));
    editor.view.dispatch(editor.state.tr.insertText(" Mine now."));
  });
  act(() => {
    editor.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
  await settle();

  assert.equal(written.length, 2, "the reset, then the edit");
  assert.equal(written[0], null);
  assert.equal(written[1]?.includes("Mine now."), true);
  assert.notEqual(newestToastAction()?.textContent, "Undo");
});

test("leaving the page withdraws the reset's Undo, since the page opened next would not hear its write", async () => {
  await resetPage();

  draw(false);
  await settle();

  assert.notEqual(newestToastAction()?.textContent, "Undo");
  assert.deepEqual(written, [null]);
});
