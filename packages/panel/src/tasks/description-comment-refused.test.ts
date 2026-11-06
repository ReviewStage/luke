// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { DescriptionCommentActionRequest } from "@repo/features/description-comment-wire";
import {
  DESCRIPTION_COMMENT_ACTOR,
  DESCRIPTION_COMMENT_BOUNDS,
  DESCRIPTION_COMMENT_ENTRY,
  DESCRIPTION_COMMENT_SCOPE,
  DESCRIPTION_COMMENT_STATUS,
  type DescriptionCommentThread,
} from "@repo/features/description-comment-wire";
import type { Task } from "@repo/features/task-wire";
import { EXPERIMENT } from "@repo/settings";
import { experimentsOn } from "@repo/settings/testing";
import {
  type DescriptionCommentsControl,
  DescriptionCommentsProvider,
} from "@repo/ui/description-comments";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { useDraftsOwner } from "../composer-drafts.js";
import { type AnyAct, FAKE_ANSWER, type FakeActAnswer } from "../testing/app-bridge.js";
import { registryWith } from "../testing/app-state.js";
import { attachmentChipName } from "../testing/attachment-chip.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { DOCUMENT_TASK } from "../testing/document-task.js";
import { DescriptionBody } from "./description-body.js";
import { CommentFocusScope } from "./description-comments.js";

const THREAD_ID = "0f9b5f6e-6a8e-4c51-9a0e-2c1f2f0b7a11";

const THREAD: DescriptionCommentThread = {
  id: THREAD_ID,
  scope: DESCRIPTION_COMMENT_SCOPE.WORDS,
  quote: "single-use link",
  anchor: { from: 0, to: 15 },
  section: "Goal",
  status: DESCRIPTION_COMMENT_STATUS.OPEN,
  entries: [
    {
      id: "0f9b5f6e-6a8e-4c51-9a0e-2c1f2f0baaaa",
      kind: DESCRIPTION_COMMENT_ENTRY.COMMENT,
      writer: {
        actor: DESCRIPTION_COMMENT_ACTOR.MEMBER,
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

const PLAN: Task = {
  ...DOCUMENT_TASK,
  id: "plan-1",
  document: { body: "## Goal\n\nAn invite is a single-use link.", assumptions: [] },
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

interface Identity {
  readonly id?: string;
  readonly email: string;
}

const DEAN = { id: "u-dean", email: "dean@example.com" } as const;

function SignedIn({ account }: { account: Identity }): null {
  useDraftsOwner(account);
  return null;
}

function drawn(
  landing: () => Promise<boolean>,
  asked: DescriptionCommentActionRequest[] = [],
  registry: AtomRegistry.AtomRegistry = registryWith(experimentsOn(EXPERIMENT.DESCRIPTIONS)),
  account: Identity = DEAN,
): HTMLElement {
  const control: DescriptionCommentsControl = {
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
  const draw = (reader: Identity) => {
    const tab = createElement(DescriptionBody, {
      task: PLAN,
      reader: { readerId: reader.id },
      sectionLinks: { workspace: "acme", onOpen: () => undefined, reveal: undefined },
    });
    const tree = createElement(
      Fragment,
      null,
      createElement(SignedIn, { account: reader }),
      createElement(
        DescriptionCommentsProvider,
        { value: control },
        createElement(CommentFocusScope, { reveal: undefined, children: tab }),
      ),
    );
    act(() => root.render(onRegistry(registry, tree)));
  };
  draw(account);
  act(() => container.querySelector<HTMLButtonElement>(".comments-toggle button")?.click());
  redrawAs = draw;
  return (
    container.querySelector<HTMLElement>(`.comment-card[data-thread="${THREAD_ID}"]`) ??
    assert.fail("no card")
  );
}

let redrawAs: (account: Identity) => void = () => assert.fail("nothing drawn");

function typeInto(field: HTMLTextAreaElement, words: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(field, words);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function pastePicture(field: HTMLTextAreaElement, name: string): Promise<void> {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);
  const paste = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(paste, "clipboardData", {
    value: { files: [new File([png], name, { type: "image/png" })] },
  });
  await act(async () => {
    field.dispatchEvent(paste);
  });
  for (let round = 0; round < 4; round += 1) await act(() => Promise.resolve());
}

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

async function refusedBesideNewer(refused: string, newer: string, account: Identity = DEAN) {
  const answer = Promise.withResolvers<boolean>();
  const asked: DescriptionCommentActionRequest[] = [];
  const registry = registryWith(experimentsOn(EXPERIMENT.DESCRIPTIONS));
  const landing = () => (asked.length === 1 ? answer.promise : Promise.resolve(true));
  const card = drawn(landing, asked, registry, account);
  const field = card.querySelector("textarea") ?? assert.fail("no textarea");
  typeInto(field, refused);
  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  typeInto(field, newer);
  await act(async () => answer.resolve(false));
  return {
    card,
    field,
    asked,
    redraw: (account?: Identity) => drawn(landing, asked, registry, account),
  };
}

function keys(asked: readonly DescriptionCommentActionRequest[]): (string | undefined)[] {
  return asked.map((each) => ("clientKey" in each ? each.clientKey : undefined));
}

const TOO_LONG = {
  REFUSED: `Not for v1. ${"a".repeat(5_000)}`,
  NEWER: "b".repeat(DESCRIPTION_COMMENT_BOUNDS.MAX_WORDS_CHARS - 1_000),
} as const;

test("a refused reply too long to go back beside the newer words stands apart as not sent, outlasting its field, its Retry sending it under its key", async () => {
  const drawnFirst = await refusedBesideNewer(TOO_LONG.REFUSED, TOO_LONG.NEWER);
  assert.equal(drawnFirst.field.value, TOO_LONG.NEWER, "the newer words stay in the box as typed");
  assert.ok(drawnFirst.card.querySelector("[data-unsent]"), "the refused reply is marked not sent");

  for (const root of roots.splice(0)) act(() => root.unmount());
  const other = drawnFirst.redraw({ id: "u-charles", email: "charles@example.com" });
  assert.equal(
    other.querySelector("[data-unsent]") === null,
    true,
    "another reader in the window sees none",
  );
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
  assert.equal(
    card.querySelector("[data-unsent]") === null,
    true,
    "and the line goes once it is sent",
  );
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
    .find((each) => each.textContent === "Discard comment");
  assert.ok(confirm, "Discard asks first");
  await act(async () => confirm.click());
  assert.equal(card.querySelector("[data-unsent]") === null, true, "the line goes once discarded");

  typeInto(field, TOO_LONG.REFUSED);
  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await act(async () => undefined);
  const [first, again] = keys(asked);
  assert.ok(first !== undefined && again !== undefined);
  assert.notEqual(again, first);
});

test("a reply refused while only the reader's address was known stands with its picture and its Retry once their identity learns its id", async () => {
  const answer = Promise.withResolvers<boolean>();
  const asked: DescriptionCommentActionRequest[] = [];
  const landing = () => (asked.length === 1 ? answer.promise : Promise.resolve(true));
  const card = drawn(landing, asked, registryWith(experimentsOn(EXPERIMENT.DESCRIPTIONS)), {
    email: DEAN.email,
  });
  const field = card.querySelector("textarea") ?? assert.fail("no textarea");
  await pastePicture(field, "invite.png");
  typeInto(field, TOO_LONG.REFUSED);
  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  typeInto(field, TOO_LONG.NEWER);
  await act(async () => answer.resolve(false));
  assert.ok(card.querySelector("[data-unsent]"), "the refused reply is marked not sent");

  redrawAs(DEAN);
  const line = card.querySelector("[data-unsent]") ?? assert.fail("no line marked as not sent");
  assert.ok(line.textContent?.includes("Not for v1."));
  assert.deepEqual(
    [...line.querySelectorAll('[aria-label="Attached files"] > li')].map(attachmentChipName),
    ["invite.png"],
  );
  const retry = [...line.querySelectorAll("button")].find((each) => each.textContent === "Retry");
  assert.ok(retry, "the line offers Retry");
  await act(async () => retry.click());
  const [first, again] = keys(asked);
  assert.equal(again, first, "Retry sends under the refused send's key");
});
