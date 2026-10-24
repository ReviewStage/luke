// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { PlanCommentActionRequest } from "@luke/features/plan-comment-wire";
import {
  PLAN_COMMENT_ACTOR,
  PLAN_COMMENT_BOUNDS,
  PLAN_COMMENT_ENTRY,
  PLAN_COMMENT_SCOPE,
  PLAN_COMMENT_STATUS,
  type PlanCommentThread,
} from "@luke/features/plan-comment-wire";
import { type PlanCommentsControl, PlanCommentsProvider } from "@luke/ui/plan-comments";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { type AnyAct, FAKE_ANSWER, type FakeActAnswer } from "../testing/app-bridge.js";
import { attachmentChipName } from "../testing/attachment-chip.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { CommentFocusScope, PlanCommentsTab } from "./plan-comments.js";

/**
 * A plan comment the service refuses goes back to its box above whatever
 * was typed or pasted while it was out, so neither the refused words and
 * files nor the newer ones are dropped; where the two together are more
 * than one comment carries, the refused one stands apart, marked as not
 * sent, with Retry under its key. Synthetic thread, plain field.
 */

const THREAD_ID = "0f9b5f6e-6a8e-4c51-9a0e-2c1f2f0b7a11";

const THREAD: PlanCommentThread = {
  id: THREAD_ID,
  scope: PLAN_COMMENT_SCOPE.WORDS,
  quote: "single-use link",
  anchor: { from: 0, to: 15 },
  section: "Goal",
  status: PLAN_COMMENT_STATUS.OPEN,
  entries: [
    {
      id: "0f9b5f6e-6a8e-4c51-9a0e-2c1f2f0baaaa",
      kind: PLAN_COMMENT_ENTRY.COMMENT,
      writer: {
        actor: PLAN_COMMENT_ACTOR.MEMBER,
        by: { userId: "u-charles", name: "Charles Pan" },
      },
      words: "Should this be a setting?",
      at: 1,
    },
  ],
  createdAt: 1,
  updatedAt: 1,
  revision: 1,
};

const roots: Root[] = [];

beforeEach(() => {
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
  window.localStorage.clear();
});

/** The Comments tab over the one open thread, whose reply the service answers with `landing`. */
function drawn(
  landing: () => Promise<boolean>,
  asked: PlanCommentActionRequest[] = [],
  registry: AtomRegistry.AtomRegistry = AtomRegistry.make(),
): HTMLElement {
  const control: PlanCommentsControl = {
    planId: "plan-1",
    threads: [THREAD],
    read: true,
    failed: false,
    onRetry: () => undefined,
    notes: new Map(),
    start: async () => ({ note: "not in this test" }),
    act: async (_thread, action) => {
      asked.push(action);
      return landing();
    },
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const tab = createElement(PlanCommentsTab, {
    doors: { agents: undefined, me: "u-dean" },
    onShowDocument: () => undefined,
  });
  const tree = createElement(
    PlanCommentsProvider,
    { value: control },
    createElement(CommentFocusScope, { reveal: undefined, children: tab }),
  );
  act(() => root.render(onRegistry(registry, tree)));
  return (
    container.querySelector<HTMLElement>(`.comment-card[data-thread="${THREAD_ID}"]`) ??
    assert.fail("no card")
  );
}

/** Types `words` into the plain field, as a keyboard's input lands. */
function typeInto(field: HTMLTextAreaElement, words: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(field, words);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Pastes a picture named `name` into the plain field, and waits for it to be read. */
async function pastePicture(field: HTMLTextAreaElement, name: string): Promise<void> {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);
  const paste = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(paste, "clipboardData", {
    value: { files: [new File([png], name, { type: "image/png" })] },
  });
  await act(async () => {
    field.dispatchEvent(paste);
  });
  // Note that a file is read off the disk before it lands in the field.
  for (let round = 0; round < 4; round += 1) await act(() => Promise.resolve());
}

/** The files the card's field holds, by name. */
function heldFiles(card: HTMLElement): (string | null)[] {
  const field = card.querySelector(".comment-field") ?? assert.fail("no reply field");
  return [...field.querySelectorAll('[aria-label="Attached files"] > li')].map(attachmentChipName);
}

test("a refused reply goes back above the words typed while it was out, and neither is dropped", async () => {
  const answer = Promise.withResolvers<boolean>();
  const card = drawn(() => answer.promise);
  const field = card.querySelector("textarea") ?? assert.fail("no textarea");
  typeInto(field, "Not for v1.");
  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  assert.equal(field.value, "", "the field empties as the words are sent");

  typeInto(field, "Ask Charles first.");
  await act(async () => answer.resolve(false));

  assert.equal(field.value, "Not for v1.\n\nAsk Charles first.");
});

test("a refused reply's files go back before the files pasted while it was out", async () => {
  const answer = Promise.withResolvers<boolean>();
  const card = drawn(() => answer.promise);
  const field = card.querySelector("textarea") ?? assert.fail("no textarea");
  await pastePicture(field, "before.png");
  typeInto(field, "Like this.");
  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  assert.deepEqual(heldFiles(card), [], "the files go with the words");

  await pastePicture(field, "after.png");
  await act(async () => answer.resolve(false));

  assert.deepEqual(heldFiles(card), ["before.png", "after.png"]);
  assert.equal(field.value, "Like this.");
});

/** Draws the thread, sends `refused`, types `newer` while it is out, and has the service refuse it; later sends land. */
async function refusedBesideNewer(refused: string, newer: string) {
  const answer = Promise.withResolvers<boolean>();
  const asked: PlanCommentActionRequest[] = [];
  const registry = AtomRegistry.make();
  const landing = () => (asked.length === 1 ? answer.promise : Promise.resolve(true));
  const card = drawn(landing, asked, registry);
  const field = card.querySelector("textarea") ?? assert.fail("no textarea");
  typeInto(field, refused);
  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  typeInto(field, newer);
  await act(async () => answer.resolve(false));
  return { card, field, asked, redraw: () => drawn(landing, asked, registry) };
}

/** The key each comment was sent under, in order. */
function keys(asked: readonly PlanCommentActionRequest[]): (string | undefined)[] {
  return asked.map((each) => ("clientKey" in each ? each.clientKey : undefined));
}

const TOO_LONG = {
  REFUSED: `Not for v1. ${"a".repeat(5_000)}`,
  NEWER: "b".repeat(PLAN_COMMENT_BOUNDS.MAX_WORDS_CHARS - 1_000),
} as const;

test("a refused reply too long to go back beside the newer words stands apart as not sent, outlasting its field, its Retry sending it under its key", async () => {
  const drawnFirst = await refusedBesideNewer(TOO_LONG.REFUSED, TOO_LONG.NEWER);
  assert.equal(drawnFirst.field.value, TOO_LONG.NEWER, "the newer words stay in the box as typed");
  assert.ok(drawnFirst.card.querySelector("[data-unsent]"), "the refused reply is marked not sent");

  // Note that the field goes with its thread, as a press away closes it, and comes back as it opens again.
  for (const root of roots.splice(0)) act(() => root.unmount());
  const card = drawnFirst.redraw();
  const line = card.querySelector("[data-unsent]") ?? assert.fail("no line marked as not sent");
  assert.ok(line.textContent?.includes("Not for v1."));
  const retry = [...line.querySelectorAll("button")].find((each) => each.textContent === "Retry");
  assert.ok(retry, "the line offers Retry");

  await act(async () => retry.click());
  const [first, again] = keys(drawnFirst.asked);
  assert.ok(first !== undefined);
  assert.equal(again, first, "Retry sends under the refused send's key");
  assert.equal(card.querySelector("[data-unsent]"), null, "and the line goes once it is sent");
  assert.equal(card.querySelector("textarea")?.value, TOO_LONG.NEWER);
});

test("words written again after a not-sent reply is discarded go under a new key", async () => {
  const { card, field, asked } = await refusedBesideNewer(TOO_LONG.REFUSED, TOO_LONG.NEWER);
  const line = card.querySelector("[data-unsent]") ?? assert.fail("no line marked as not sent");
  const discard = [...line.querySelectorAll("button")].find(
    (each) => each.textContent === "Discard",
  );
  assert.ok(discard, "the line offers Discard");
  act(() => discard.click());
  const confirm = [
    ...document.querySelectorAll('[role="alertdialog"] button, [role="dialog"] button'),
  ]
    .filter((each): each is HTMLButtonElement => each instanceof HTMLButtonElement)
    .find((each) => each.textContent === "Discard");
  assert.ok(confirm, "Discard asks first");
  await act(async () => confirm.click());
  assert.equal(card.querySelector("[data-unsent]"), null, "the line goes once discarded");

  typeInto(field, TOO_LONG.REFUSED);
  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await act(async () => undefined);
  const [first, again] = keys(asked);
  assert.ok(first !== undefined && again !== undefined);
  assert.notEqual(again, first);
});
