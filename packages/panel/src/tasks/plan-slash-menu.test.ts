// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { Task } from "@luke/features/task-wire";
import type { Editor, TiptapEditorHTMLElement } from "@tiptap/core";
import { Effect } from "effect";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import type { AnyAct, FakeActAnswer } from "../testing/app-bridge.js";
import { FAKE_ANSWER } from "../testing/app-bridge.js";
import { editorBundleLanded, installEditorLayout } from "../testing/composer.js";
import { DOCUMENT_TASK } from "../testing/document-task.js";
import { PlanBody } from "./plan-body.js";
import { CommentFocusScope } from "./plan-comments.js";

/**
 * plan-slash-menu.test.ts -- the `/` menu in the plan's open text: opened by
 * a `/` at a line's start or after a space, outside code; narrowed by the
 * words after it, by name and by alias, and closed by a space or a run that
 * matches nothing; Enter laying the block in place of the `/` word; Escape
 * closing it for that `/` alone; and the selection toolbar standing aside
 * for it. The editor is the real one, from its bundle. Synthetic text.
 */

// Note that the editor's keymap reads the platform once, as it loads, to say which key Mod is, so the page is a Mac's before anything is imported.
vi.hoisted(() => {
  Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
});

const TEXT = [
  "## Goal",
  "An admin invites a teammate by email.",
  "```",
  "const invite = send(email);",
  "```",
  "| Role | Invites |\n| --- | --- |\n| Admin | Anyone |",
  "",
].join("\n\n");

const PLAN: Task = { ...DOCUMENT_TASK, document: { body: TEXT, assumptions: [] } };

/** The plan's own page's links, which say the page is the plan's own and so takes mentions and pictures. */
const PAGE_LINKS = { workspace: "acme", onOpen: () => undefined, reveal: undefined };

const roots: Root[] = [];

// Landed before the plan renders, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(editorBundleLanded));

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  installEditorLayout();
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      act: (_request: AnyAct): Promise<FakeActAnswer> =>
        Promise.resolve({ status: FAKE_ANSWER.UNKNOWN_ACT }),
      recordSurfaceEvent: () => undefined,
    },
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The plan's page with its text open in the editor from the Goal block's Enter. */
async function opened() {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(CommentFocusScope, {
        reveal: undefined,
        children: createElement(PlanBody, {
          task: PLAN,
          live: false,
          sectionLinks: PAGE_LINKS,
          onEdit: () => Promise.resolve({ saved: true } as const),
        }),
      }),
    ),
  );
  const goal = container.querySelector<HTMLElement>('[role="group"][aria-label="Goal"]');
  assert.ok(goal, "the Goal block");
  act(() => goal.focus());
  act(() => {
    goal.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await act(async () => undefined);
  const element = container.querySelector<TiptapEditorHTMLElement>(".ProseMirror");
  const editor = element?.editor ?? assert.fail("the editor is running");
  return { container, element: element as TiptapEditorHTMLElement, editor };
}

/** Where `words` end in the editor's text, as a position. */
function endOf(editor: Editor, words: string): number {
  let found: number | undefined;
  editor.state.doc.descendants((node, pos) => {
    const at = node.isText ? (node.text ?? "").indexOf(words) : -1;
    if (found === undefined && at >= 0) found = pos + at + words.length;
  });
  return found ?? assert.fail(`${words} is in the text`);
}

/** The caret put at `at`, and `words` typed there as the editor's own input inserts them. */
function typeAt(editor: Editor, at: number, words: string): void {
  act(() => {
    editor.view.focus();
    editor.commands.setTextSelection(at);
  });
  typed(editor, words);
}

/** `words` typed at the caret, one character at a time. */
function typed(editor: Editor, words: string): void {
  for (const character of words) {
    act(() => {
      editor.view.dispatch(editor.state.tr.insertText(character));
    });
  }
}

/** A new empty line under the one `words` end, the caret on it. */
function newLineAfter(editor: Editor, words: string): void {
  act(() => {
    editor.view.focus();
    editor.chain().setTextSelection(endOf(editor, words)).splitBlock().run();
  });
}

/** The menu's rows, by their names, where it stands. */
function menuRows(container: HTMLElement): string[] | undefined {
  const menu = container.querySelector<HTMLElement>('[role="listbox"][aria-label="Blocks"]');
  if (menu === null) return undefined;
  return [...menu.querySelectorAll<HTMLElement>('[role="option"]')].map((row) =>
    (row.querySelector(".luke-combobox-option-label")?.textContent ?? row.textContent ?? "").trim(),
  );
}

/** The menu's group headings, where it stands. */
function menuGroups(container: HTMLElement): string[] {
  const menu = container.querySelector<HTMLElement>('[role="listbox"][aria-label="Blocks"]');
  return [...(menu?.querySelectorAll<HTMLElement>('[role="group"]') ?? [])].map(
    (group) => group.getAttribute("aria-label") ?? "",
  );
}

/** A key pressed in the editor. */
function press(element: HTMLElement, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    element.dispatchEvent(event);
  });
  return event;
}

test("a `/` on an empty line opens the menu under it, every block in its groups", async () => {
  const { container, editor } = await opened();
  newLineAfter(editor, "by email.");

  typed(editor, "/");

  assert.deepEqual(menuGroups(container), ["Basic", "Lists", "Blocks", "Insert"]);
  assert.deepEqual(menuRows(container), [
    "Text",
    "Heading 1",
    "Heading 2",
    "Heading 3",
    "Bulleted list",
    "Numbered list",
    "To-do list",
    "Quote",
    "Code block",
    "Diagram",
    "Table",
    "Divider",
    "Picture",
    "Mention",
  ]);
});

test("the words after the `/` narrow the menu by name and by alias, and a space or a run that matches nothing closes it", async () => {
  const { container, editor } = await opened();
  const after = endOf(editor, "a teammate");

  typeAt(editor, after, " /h2");
  assert.deepEqual(menuRows(container), ["Heading 2"]);

  typed(editor, " ");
  assert.equal(menuRows(container), undefined, "a space closes it");

  typed(editor, "/todo");
  assert.deepEqual(menuRows(container), ["To-do list"]);
  typed(editor, " /table");
  assert.deepEqual(menuRows(container), ["Table"]);
  typed(editor, " /mermaid");
  assert.deepEqual(menuRows(container), ["Diagram"]);
  typed(editor, " /list");
  assert.deepEqual(menuRows(container), ["Bulleted list", "Numbered list", "To-do list"]);

  typed(editor, "zz");
  assert.equal(menuRows(container), undefined, "a run that matches nothing closes it");
});

test("Enter on Heading 2 turns the line into one, the `/h2` gone, and the caret stays in the editor", async () => {
  const { container, element, editor } = await opened();
  newLineAfter(editor, "by email.");
  typed(editor, "Rollout /h2");

  const pressed = press(element, "Enter");

  assert.ok(pressed.defaultPrevented, "the menu takes the Enter");
  assert.equal(menuRows(container), undefined, "the menu closes");
  const headings = [...element.querySelectorAll("h2")].map((each) => each.textContent);
  assert.deepEqual(headings, ["Goal", "Rollout "]);
  assert.ok(!element.textContent?.includes("/h2"), "the `/h2` is gone");
  assert.equal(document.activeElement, element, "the caret stays in the editor");
});

test("↓ moves the highlight and Tab chooses the row it stands on", async () => {
  const { element, editor } = await opened();
  newLineAfter(editor, "by email.");
  typed(editor, "/list");

  press(element, "ArrowDown");
  press(element, "Tab");

  assert.equal(element.querySelector("ol")?.textContent, "", "a numbered list stands, empty");
  assert.ok(!element.textContent?.includes("/list"));
});

test("Table lays in three rows of three cells under a header row", async () => {
  const { element, editor } = await opened();
  newLineAfter(editor, "by email.");
  typed(editor, "/table");

  press(element, "Enter");

  const table = element.querySelector("table") ?? assert.fail("a table stands");
  assert.equal(table.querySelectorAll("tr").length, 3);
  assert.equal(table.querySelectorAll("th").length, 3);
  assert.equal(table.querySelectorAll("td").length, 6);
});

test("Mention lays in an `@`, which opens the `@` list in the menu's place", async () => {
  const { container, element, editor } = await opened();
  newLineAfter(editor, "by email.");
  typed(editor, "/mention");

  press(element, "Enter");

  assert.equal(menuRows(container), undefined, "the menu closes");
  assert.ok(
    [...element.querySelectorAll("p")].some((line) => line.textContent === "@"),
    "an `@` stands where the `/` word stood",
  );
  assert.ok(
    container.querySelector('[role="listbox"]:not([aria-label="Blocks"])'),
    "the `@` list stands",
  );
});

test("Escape closes the menu for that `/` alone, leaving the editor open, and a new `/` opens it again", async () => {
  const { container, element, editor } = await opened();
  newLineAfter(editor, "by email.");
  typed(editor, "/h");

  const pressed = press(element, "Escape");

  assert.ok(pressed.defaultPrevented, "the menu takes the Escape");
  assert.equal(menuRows(container), undefined, "the menu closes");
  assert.ok(container.querySelector(".ProseMirror"), "the editor stays open");
  typed(editor, "2");
  assert.equal(menuRows(container), undefined, "the `/` closed stays closed as it is typed on");

  typed(editor, " /h2");
  assert.deepEqual(menuRows(container), ["Heading 2"], "a new `/` opens it");
});

test("a `/` in code or inside a word opens nothing", async () => {
  const { container, editor } = await opened();

  typeAt(editor, endOf(editor, "send(email);"), " /");
  assert.equal(menuRows(container), undefined, "none in a code block");

  typeAt(editor, endOf(editor, "invites"), "/");
  assert.equal(menuRows(container), undefined, "none inside a word");
});

test("a `/` in a table's cell opens nothing, since a cell holds one line of words", async () => {
  const { container, editor } = await opened();

  typeAt(editor, endOf(editor, "Anyone"), " /");
  assert.equal(menuRows(container), undefined, "none in a cell");
  typed(editor, "table");
  assert.equal(menuRows(container), undefined, "nor as the words after it are typed");
});

test("words selected close the menu and raise the toolbar in its place, never both at once", async () => {
  const { container, editor } = await opened();
  newLineAfter(editor, "by email.");
  typed(editor, "/");
  assert.ok(menuRows(container), "the menu stands");

  act(() => {
    editor.commands.setTextSelection({ from: endOf(editor, "An"), to: endOf(editor, "An admin") });
  });

  assert.equal(menuRows(container), undefined, "a selection leaves no `/` word");
  assert.ok(
    container.querySelector('[role="toolbar"][aria-label="Formatting"]'),
    "the toolbar stands",
  );
});
