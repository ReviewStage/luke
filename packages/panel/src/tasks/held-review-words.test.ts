// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  DIFF_SIDE,
  type PendingReviewComment,
  type ReviewThread,
} from "@luke/features/coding-agent-wire";
import {
  PULL_REQUEST_ACTION,
  PULL_REQUEST_WRITE_OUTCOME,
  type PullRequestActionRequest,
} from "@luke/features/pull-request-write-wire";
import { ACT_KIND } from "@luke/host/acts";
import type { TiptapEditorHTMLElement } from "@tiptap/core";
import { Effect } from "effect";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { editorBundleLanded, installEditorLayout } from "../testing/composer.js";
import { PendingComment } from "./pending-comments.js";
import { ThreadActions, ThreadWritesProvider } from "./pull-request-thread-actions.js";

/**
 * held-review-words.test.ts -- the words of a GitHub thread's reply and of a pending comment's edit survive Esc: the reply or the edit opened again brings them back, and sending or saving lets them go. The box is the real one, from its bundle; GitHub is the act port's answer. Synthetic thread and comment.
 */

const THREAD: ReviewThread = {
  path: "src/a.ts",
  line: 4,
  startLine: null,
  originalLine: 4,
  originalStartLine: null,
  side: DIFF_SIDE.RIGHT,
  startSide: null,
  diffHunk: "",
  resolved: false,
  outdated: false,
  comments: [{ by: { login: "octo", bot: false }, html: null, body: "Why?", at: 1, url: "r1" }],
  more: 0,
  id: "PRRT_published",
};

const PENDING: PendingReviewComment = {
  id: "PRRC_pending",
  by: { login: "dana", bot: false },
  path: "src/a.ts",
  line: 30,
  startLine: null,
  side: DIFF_SIDE.RIGHT,
  startSide: null,
  html: null,
  body: "Pending words",
  at: 2,
};

let root: Root | undefined;
/** Every change the tab asked GitHub for, in order. */
let changes: PullRequestActionRequest[] = [];

beforeAll(() => Effect.runPromise(editorBundleLanded));

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  installEditorLayout();
  changes = [];
  fakeAppBridge({});
  fakeActPort({
    [ACT_KIND.CODING_AGENTS_PULL_REQUEST_ACTION]: ({ request }) => {
      changes.push(request);
      return Promise.resolve({ outcome: PULL_REQUEST_WRITE_OUTCOME.DONE });
    },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** The thread's controls and a pending comment, under one tab's provider. */
function draw(): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      createElement(ThreadWritesProvider, {
        value: { agentId: "agent-1", onWritten: () => undefined },
        children: [
          createElement(ThreadActions, { key: "thread", thread: THREAD }),
          createElement(PendingComment, {
            key: "pending",
            draft: PENDING,
            words: createElement("p", null, PENDING.body),
          }),
        ],
      }),
    ),
  );
  return container;
}

/** The button of the given words. */
function button(container: HTMLElement, words: string): HTMLButtonElement {
  return (
    [...container.querySelectorAll("button")].find((each) => each.textContent === words) ??
    assert.fail(`${words} is offered`)
  );
}

/** The open box of the given label. */
function box(container: HTMLElement, label: string): TiptapEditorHTMLElement {
  return (
    container.querySelector<TiptapEditorHTMLElement>(`.ProseMirror[aria-label^="${label}"]`) ??
    assert.fail(`the ${label} box is open`)
  );
}

/** Presses Esc in the box. */
async function esc(element: HTMLElement): Promise<void> {
  act(() => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
  await settle();
}

/** Types words at the end of the box, as its own input inserts them. */
function typeAtEnd(element: TiptapEditorHTMLElement, words: string): void {
  const editor = element.editor ?? assert.fail("the box is running");
  act(() => {
    editor.commands.focus("end");
    editor.view.dispatch(editor.state.tr.insertText(words));
  });
}

test("a reply typed and let go with Esc is there when Reply… opens again, and sending it lets the words go", async () => {
  const container = draw();

  act(() => button(container, "Reply…").click());
  typeAtEnd(box(container, "Reply"), "Fixed in the next commit");
  await esc(box(container, "Reply"));
  assert.equal(container.querySelector('.ProseMirror[aria-label^="Reply"]'), null, "Esc closes it");

  act(() => button(container, "Reply…").click());
  assert.match(box(container, "Reply").textContent ?? "", /Fixed in the next commit/u);

  act(() => button(container, "Reply").click());
  await settle();
  assert.deepEqual(changes, [
    {
      action: PULL_REQUEST_ACTION.REPLY_TO_THREAD,
      threadId: "PRRT_published",
      body: "Fixed in the next commit",
    },
  ]);

  act(() => button(container, "Reply…").click());
  assert.equal(box(container, "Reply").textContent, "", "sent words are not brought back");
});

test("a pending comment's edit typed and let go with Esc is there when Edit opens again, and saving it lets the words go", async () => {
  const container = draw();

  act(() => button(container, "Edit").click());
  typeAtEnd(box(container, "Pending comment"), ", and more");
  await esc(box(container, "Pending comment"));
  assert.equal(container.querySelector('.ProseMirror[aria-label^="Pending"]'), null);

  act(() => button(container, "Edit").click());
  assert.match(box(container, "Pending comment").textContent ?? "", /Pending words, and more/u);

  act(() => button(container, "Save").click());
  await settle();
  assert.deepEqual(changes, [
    {
      action: PULL_REQUEST_ACTION.EDIT_REVIEW_COMMENT,
      commentId: "PRRC_pending",
      body: "Pending words, and more",
    },
  ]);

  act(() => button(container, "Edit").click());
  assert.equal(
    box(container, "Pending comment").textContent,
    "Pending words",
    "saved words are not brought back over the comment's own",
  );
});

test("Cancel, unlike Esc, lets a reply's words go", async () => {
  const container = draw();

  act(() => button(container, "Reply…").click());
  typeAtEnd(box(container, "Reply"), "Never mind");
  act(() => button(container, "Cancel").click());

  act(() => button(container, "Reply…").click());
  assert.equal(box(container, "Reply").textContent, "");
});

/** The kind of every change asked of GitHub so far. */
function actionsSent(): string[] {
  return changes.map((change) => change.action);
}

test("Enter sends a reply and saves an edit, and Shift+Enter sends neither", async () => {
  const container = draw();
  const press = (element: HTMLElement, init: KeyboardEventInit) =>
    act(() => {
      element.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
      );
    });

  act(() => button(container, "Reply…").click());
  typeAtEnd(box(container, "Reply"), "Thanks");
  press(box(container, "Reply"), { key: "Enter", shiftKey: true });
  await settle();
  assert.deepEqual(actionsSent(), [], "Shift+Enter sends nothing");
  press(box(container, "Reply"), { key: "Enter" });
  await settle();
  assert.deepEqual(actionsSent(), [PULL_REQUEST_ACTION.REPLY_TO_THREAD]);

  act(() => button(container, "Edit").click());
  typeAtEnd(box(container, "Pending comment"), "!");
  press(box(container, "Pending comment"), { key: "Enter" });
  await settle();
  assert.deepEqual(actionsSent(), [
    PULL_REQUEST_ACTION.REPLY_TO_THREAD,
    PULL_REQUEST_ACTION.EDIT_REVIEW_COMMENT,
  ]);
});
