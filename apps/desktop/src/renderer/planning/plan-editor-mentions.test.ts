// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { Plan } from "@sidecar/hosted/plan-wire";
import { PLAN_TREE_ENTRY } from "@sidecar/hosted/plan-wire";
import type { TiptapEditorHTMLElement } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "#shared/messages/acts";
import { installEditorBundle, installEditorLayout } from "#testing/composer";
import { DOCUMENT_PLAN } from "#testing/document-plan";
import { PlanBody } from "./plan-body";

/**
 * `@` in the plan's editor over the real editor bundle: the word typed
 * opens the list of the plan's sections and the repository's files,
 * grouped by kind and narrowed by the word; Enter writes the highlighted
 * row as its mention, drawn in the editor as its chip. Synthetic plan and
 * repository.
 */

const PLAN: Plan = {
  ...DOCUMENT_PLAN,
  document: { body: "## Goal\n\nInvite by email.\n\n## Rollout\n\nStore first.", assumptions: [] },
};

const roots: Root[] = [];

beforeEach(() => {
  installEditorBundle();
  installEditorLayout();
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      act: (request: Act): Promise<ActOutcome> =>
        Promise.resolve(
          request.kind === ACT_KIND.PLANNING_TREE
            ? {
                status: ACT_OUTCOME_STATUS.DONE,
                value: {
                  folder: {
                    path: "",
                    repository: "acme/relay",
                    branch: "main",
                    entries: [
                      { name: "apps/web/rollout-store.ts", kind: PLAN_TREE_ENTRY.FILE },
                      { name: "apps/web", kind: PLAN_TREE_ENTRY.FOLDER },
                    ],
                    truncated: false,
                  },
                },
              }
            : { status: ACT_OUTCOME_STATUS.UNKNOWN_ACT },
        ),
      recordSurfaceEvent: () => undefined,
    },
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The plan's page drawn editable with its mentions, its editor opened on Rollout. */
async function opened() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(PlanBody, {
        plan: PLAN,
        live: false,
        onEdit: () => Promise.reject(new Error("Nothing is saved in this test.")),
        sectionLinks: { onOpen: () => undefined, onOpenFile: () => undefined, reveal: undefined },
      }),
    ),
  );
  const rollout = container.querySelector<HTMLElement>('[role="group"][aria-label="Rollout"]');
  assert.ok(rollout);
  // Opened by Enter on its block, which places the caret by section rather than by a point jsdom cannot lay out.
  act(() => rollout.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  await act(async () => undefined);
  const element = container.querySelector<TiptapEditorHTMLElement>(".plan-document-text");
  const editor = element?.editor;
  assert.ok(element && editor, "the plan's editor is open");
  /** The words typed at the end of the text, as the editor's own input inserts them. */
  const typeAtEnd = async (words: string) => {
    act(() => {
      editor.view.focus();
      const end = TextSelection.atEnd(editor.state.doc);
      editor.view.dispatch(editor.state.tr.setSelection(end));
      editor.view.dispatch(editor.state.tr.insertText(words));
    });
    await act(async () => undefined);
  };
  const press = (key: string) =>
    act(() => {
      element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    });
  /** The words typed right after the words given, as the editor's own input inserts them. */
  const typeAfter = async (words: string, typed: string) => {
    act(() => {
      let at: number | undefined;
      editor.state.doc.descendants((node, position) => {
        if (at === undefined && node.isText && node.text?.includes(words)) {
          at = position + (node.text.indexOf(words) + words.length);
        }
      });
      assert.ok(at !== undefined, `the text holds ${words}`);
      editor.view.focus();
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at)),
      );
      editor.view.dispatch(editor.state.tr.insertText(typed));
    });
    await act(async () => undefined);
  };
  return { container, typeAtEnd, typeAfter, press };
}

/** The list's groups as it draws them: each heading and its rows' names. */
function listed(container: HTMLElement): [string, string[]][] {
  return [...container.querySelectorAll('.mention-menu [role="group"]')].map((group) => [
    group.getAttribute("aria-label") ?? "",
    [...group.querySelectorAll(".plan-compose-menu-name")].map((name) => name.textContent ?? ""),
  ]);
}

test("an @ typed in the plan offers the plan's sections and, as the word is typed, the repository's files, grouped by kind", async () => {
  const plan = await opened();

  await plan.typeAtEnd(" See @");
  const empty = listed(plan.container);
  await plan.typeAtEnd("roll");

  assert.deepEqual(empty, [["Plan", ["Goal", "Rollout", "Teammate invitations"]]]);
  assert.deepEqual(listed(plan.container), [
    ["Files and folders", ["rollout-store.ts"]],
    ["Plan", ["Rollout"]],
  ]);
});

test("Enter writes the highlighted row as its mention, drawn in the editor as its chip, and closes the list", async () => {
  const plan = await opened();

  await plan.typeAtEnd(" See @roll");
  plan.press("ArrowDown");
  plan.press("Enter");
  await act(async () => undefined);

  const chips = [...plan.container.querySelectorAll(".plan-document-text .mention-chip")];
  assert.deepEqual(
    chips.map((chip) => chip.textContent),
    ["Rollout"],
  );
  assert.equal(plan.container.querySelector(".mention-menu"), null);
});

test("Escape closes the list and leaves the editor open", async () => {
  const plan = await opened();

  await plan.typeAtEnd(" See @roll");
  plan.press("Escape");

  assert.equal(plan.container.querySelector(".mention-menu"), null);
  assert.notEqual(plan.container.querySelector(".plan-document-text"), null);
});

test("a heading just renamed is offered by its new words, before the editor hands its draft over", async () => {
  const plan = await opened();

  await plan.typeAfter("Rollout", " plan");
  await plan.typeAtEnd(" See @roll");

  assert.deepEqual(
    listed(plan.container).find(([group]) => group === "Plan"),
    ["Plan", ["Rollout plan"]],
  );
});
