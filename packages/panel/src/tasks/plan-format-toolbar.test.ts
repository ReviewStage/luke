// @vitest-environment jsdom

import assert from "node:assert/strict";
import { PLAN_COMMENT_SCOPE, type PlanCommentStartRequest } from "@luke/features/plan-comment-wire";
import type { Task } from "@luke/features/task-wire";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { type PlanCommentsControl, PlanCommentsProvider } from "@luke/ui/plan-comments";
import type { Editor, TiptapEditorHTMLElement } from "@tiptap/core";
import { Effect } from "effect";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { useAppCommand, useAppKeymap } from "../app-commands.js";
import type { AnyAct, FakeActAnswer } from "../testing/app-bridge.js";
import { FAKE_ANSWER } from "../testing/app-bridge.js";
import { editorBundleLanded, installEditorLayout } from "../testing/composer.js";
import { DOCUMENT_TASK } from "../testing/document-task.js";
import { PlanBody } from "./plan-body.js";
import { CommentFocusScope } from "./plan-comments.js";

/**
 * plan-format-toolbar.test.ts -- the format toolbar over words selected in
 * the plan's open text: standing once the pointer is let go over them, never
 * in code, and in place of the read view's Comment bubble; its marks, Turn
 * into, and Comment acting on the words; and ⌘K linking them, or left to the
 * window's command palette where no words are selected. The editor is the
 * real one, from its bundle. Synthetic text.
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
  "## Approach",
  "Admins can withdraw an invite from [the members page](https://example.com/members).",
  "- Send the email\n- Record the invite",
  "> Only admins invite.",
  "",
].join("\n\n");

const PLAN: Task = { ...DOCUMENT_TASK, document: { body: TEXT, assumptions: [] } };

/** The plan's own page's links, which say the page is the plan's own and so takes comments. */
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

/** The window's keymap, its command palette's every opening recorded. */
function KeyedWindow({ opened }: { opened: string[] }): ReactElement | null {
  useAppKeymap(true);
  useAppCommand(APP_COMMAND.COMMAND_PALETTE, () => opened.push("command palette"));
  return null;
}

/** The plan's page with its text open in the editor from the Goal block's Enter, each thread started kept, and each palette opened. */
async function opened() {
  const started: PlanCommentStartRequest[] = [];
  const palette: string[] = [];
  const control: PlanCommentsControl = {
    planId: PLAN.id,
    threads: [],
    read: true,
    failed: false,
    onRetry: () => undefined,
    notes: new Map(),
    start: async (start) => {
      started.push(start);
      return { note: "not in this test" };
    },
    act: async () => true,
  };
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(
        PlanCommentsProvider,
        { value: control },
        createElement(KeyedWindow, { opened: palette }),
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
  return { container, element: element as TiptapEditorHTMLElement, editor, started, palette };
}

/** Where `words` stand in the editor's text, as positions. */
function positionsOf(editor: Editor, words: string): { from: number; to: number } {
  let found: { from: number; to: number } | undefined;
  editor.state.doc.descendants((node, pos) => {
    const at = node.isText ? (node.text ?? "").indexOf(words) : -1;
    if (found === undefined && at >= 0) found = { from: pos + at, to: pos + at + words.length };
  });
  return found ?? assert.fail(`${words} is in the text`);
}

/** `words` selected in the editor, as the keyboard selects them. */
function select(editor: Editor, words: string): void {
  act(() => {
    editor.commands.setTextSelection(positionsOf(editor, words));
  });
}

/** The toolbar over the selection, where it stands. */
function toolbarIn(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[role="toolbar"][aria-label="Formatting"]');
}

/** The standing toolbar's button named `name`. */
function press(container: HTMLElement, name: string): HTMLButtonElement {
  const toolbar = toolbarIn(container) ?? assert.fail("the toolbar stands");
  const button = [...toolbar.querySelectorAll("button")].find(
    (each) => (each.getAttribute("aria-label") ?? each.textContent) === name,
  );
  return button ?? assert.fail(`the toolbar holds ${name}`);
}

/** The block named `block` chosen from the standing toolbar's Turn into. */
function turnInto(container: HTMLElement, block: string): void {
  const toolbar = toolbarIn(container) ?? assert.fail("the toolbar stands");
  const opener =
    [...toolbar.querySelectorAll("button")].find((each) =>
      (each.getAttribute("aria-label") ?? each.textContent ?? "").startsWith("Turn into"),
    ) ?? assert.fail("the toolbar holds Turn into");
  act(() => opener.click());
  const menu =
    document.querySelector<HTMLElement>('[role="menu"]') ?? assert.fail("the menu opens");
  const row =
    [...menu.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].find(
      (each) => each.querySelector(".luke-menu-item-label")?.textContent === block,
    ) ?? assert.fail(`the menu offers ${block}`);
  act(() => row.click());
}

/** The element the words stand in, by its tag, and whether a list or a quote holds it. */
function blockOf(element: HTMLElement, words: string): { tag: string; wrapped: boolean } {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let text = walker.nextNode(); text !== null; text = walker.nextNode()) {
    const block = text.parentElement?.closest("p, h1, h2, h3, pre");
    if (!(text.textContent ?? "").includes(words) || block == null) continue;
    return { tag: block.tagName.toLowerCase(), wrapped: block.closest("li, blockquote") !== null };
  }
  return assert.fail(`${words} is drawn`);
}

/** ⌘K pressed in the editor, answering the press. */
function commandK(element: HTMLElement): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "k",
    code: "KeyK",
    keyCode: 75,
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    element.dispatchEvent(event);
  });
  return event;
}

test("words selected with the pointer raise the toolbar once it is let go, in place of the Comment bubble, and words the keyboard selects raise it at once", async () => {
  const { container, element, editor } = await opened();

  act(() => {
    element.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  });
  select(editor, "invites a teammate");
  assert.equal(toolbarIn(container), null, "nothing stands while the pointer is down");
  act(() => {
    element.dispatchEvent(new Event("pointerup", { bubbles: true }));
  });
  assert.ok(toolbarIn(container), "the toolbar stands once it is let go");
  assert.equal(container.querySelector(".comment-bubble"), null, "no bubble stands beside it");

  act(() => {
    editor.commands.setTextSelection(positionsOf(editor, "invites").to);
  });
  assert.equal(toolbarIn(container), null, "a caret raises nothing");
  select(editor, "withdraw");
  assert.ok(toolbarIn(container), "the keyboard's selection raises it at once");
  assert.equal(press(container, "Turn into Text").textContent, "Text");
});

test("words in a code block raise no toolbar", async () => {
  const { container, editor } = await opened();

  select(editor, "send(email)");

  assert.equal(toolbarIn(container), null);
});

test("Bold on the toolbar bolds the words selected, and stands pressed over them", async () => {
  const { container, element, editor } = await opened();
  select(editor, "a teammate");

  act(() => press(container, "Bold").click());

  assert.equal(element.querySelector("strong")?.textContent, "a teammate");
  assert.equal(press(container, "Bold").getAttribute("aria-pressed"), "true");
  assert.equal(editor.state.selection.empty, false, "the words stay selected");
});

test("Turn into Heading 2 turns the line the words stand in into a heading", async () => {
  const { container, element, editor } = await opened();
  select(editor, "withdraw");

  act(() => press(container, "Turn into Text").click());
  const menu =
    document.querySelector<HTMLElement>('[role="menu"]') ?? assert.fail("the menu opens");
  const heading = [...menu.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].find((row) =>
    row.textContent?.includes("Heading 2"),
  );
  act(() => heading?.click());

  const headings = [...element.querySelectorAll("h2")].map((each) => each.textContent);
  assert.ok(
    headings.includes("Admins can withdraw an invite from the members page."),
    "the line is a heading",
  );
  assert.ok(container.querySelector(".ProseMirror"), "the editor stays open");
});

test("Turn into Text takes a bullet or a quote out of its list or quote, and Turn into Heading 1 a bullet out of its list", async () => {
  const { container, element, editor } = await opened();

  select(editor, "Send the email");
  turnInto(container, "Text");
  assert.deepEqual(blockOf(element, "Send the email"), { tag: "p", wrapped: false });

  select(editor, "Only admins invite");
  turnInto(container, "Text");
  assert.deepEqual(blockOf(element, "Only admins invite"), { tag: "p", wrapped: false });

  select(editor, "Record the invite");
  turnInto(container, "Heading 1");
  assert.deepEqual(blockOf(element, "Record the invite"), { tag: "h1", wrapped: false });
});

test("⌘K over words selected opens the link field, whose Enter links them, a web page's scheme added", async () => {
  const { container, element, editor, palette } = await opened();
  select(editor, "a teammate");

  const pressed = commandK(element);
  assert.ok(pressed.defaultPrevented, "the editor takes ⌘K over words");
  const field =
    container.querySelector<HTMLInputElement>('input[type="url"]') ?? assert.fail("the link field");
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
      field,
      "example.com/invites",
    );
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });

  const link = element.querySelector("a");
  assert.equal(link?.textContent, "a teammate");
  assert.equal(link?.getAttribute("href"), "https://example.com/invites");
  assert.equal(container.querySelector('input[type="url"]'), null, "the field closes");
  assert.deepEqual(palette, [], "the palette never opens");
});

test("⌘K with no words selected and no link under the caret is the window's, which opens its command palette", async () => {
  const { container, element, editor, palette } = await opened();
  act(() => {
    editor.commands.setTextSelection(positionsOf(editor, "invites").to);
  });

  commandK(element);

  assert.equal(container.querySelector('input[type="url"]'), null, "no link field opens");
  assert.deepEqual(palette, ["command palette"]);
});

test("⌘K with the caret in a link opens the field holding it, whose Remove unlinks the whole link", async () => {
  const { container, element, editor } = await opened();
  act(() => {
    editor.commands.setTextSelection(positionsOf(editor, "members").from);
  });

  commandK(element);
  const field =
    container.querySelector<HTMLInputElement>('input[type="url"]') ?? assert.fail("the link field");
  assert.equal(field.value, "https://example.com/members");
  const remove =
    container.querySelector<HTMLButtonElement>('button[aria-label="Remove link"]') ??
    assert.fail("Remove stands beside a link");
  act(() => remove.click());

  assert.equal(element.querySelector("a"), null, "the words are linked no more");
  assert.ok(element.textContent?.includes("the members page"), "and kept");
});

test("Remove over a few words of a link unlinks those words alone, leaving the rest of the link", async () => {
  const { container, element, editor } = await opened();
  select(editor, "members");

  commandK(element);
  const remove =
    container.querySelector<HTMLButtonElement>('button[aria-label="Remove link"]') ??
    assert.fail("Remove stands beside a link");
  act(() => remove.click());

  assert.deepEqual(
    [...element.querySelectorAll("a")].map((link) => [link.textContent, link.getAttribute("href")]),
    [
      ["the ", "https://example.com/members"],
      [" page", "https://example.com/members"],
    ],
  );
});

test("Comment on the toolbar starts a thread on the words selected", async () => {
  const { container, editor, started } = await opened();
  select(editor, "a teammate");

  act(() => press(container, "Comment").click());
  const field =
    container.querySelector<HTMLTextAreaElement>(`.comment-card[data-thread="pending"] textarea`) ??
    assert.fail("the thread is being started");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
      field,
      "Only admins?",
    );
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });

  assert.deepEqual(
    started.map((start) => [
      start.scope,
      start.quote,
      TEXT.slice(start.anchor.from, start.anchor.to),
    ]),
    [[PLAN_COMMENT_SCOPE.WORDS, "a teammate", "a teammate"]],
  );
});

test("⌥⌘M starts a thread on the words selected while the toolbar stands over them, as its Comment does", async () => {
  const { container, element, editor } = await opened();
  const pending = () => container.querySelector(`.comment-card[data-thread="pending"]`);
  const commentKey = () =>
    act(() => {
      element.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "µ",
          code: "KeyM",
          metaKey: true,
          altKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

  commentKey();
  assert.equal(pending(), null, "with nothing selected, no thread is started");

  select(editor, "a teammate");
  commentKey();
  assert.ok(pending(), "the thread is being started");
});
