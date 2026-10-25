// @vitest-environment jsdom

import assert from "node:assert/strict";
import { INBOX_REPLY } from "@luke/features/inbox-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { sentStamp } from "./inbox-model.js";
import { InboxStamp } from "./inbox-stamp.js";

/**
 * inbox-stamp.test.ts -- an answer that holds back, Declined or Couldn't do
 * it, is stamped in the neutral tone, since nothing failed, sent or
 * attached, while one that goes ahead is stamped complete. Synthetic answers.
 */

const ASK_ID = "e1b2c3d4-0000-4000-8000-000000000001";

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** The tone and words of the stamp an answer of `reply` draws, sent, or attached to the box where `attached`. */
function stamped(
  reply: typeof INBOX_REPLY.DECLINED | typeof INBOX_REPLY.NOT_DONE | typeof INBOX_REPLY.APPROVED,
  attached = false,
): [string | undefined, string | null] {
  const page = document.body.appendChild(document.createElement("div"));
  root = createRoot(page);
  const stamp = sentStamp({ ask: ASK_ID, reply }, undefined);
  act(() =>
    root?.render(
      createElement(InboxStamp, { stamp, onRemove: attached ? () => undefined : undefined }),
    ),
  );
  const toned = page.querySelector<HTMLElement>("[data-inbox-stamp] [data-tone]");
  const shown: [string | undefined, string | null] = [toned?.dataset.tone, page.textContent];
  act(() => root?.unmount());
  root = undefined;
  page.remove();
  return shown;
}

test("a held-back answer is stamped in the neutral tone, sent or attached, and one going ahead complete", () => {
  assert.deepEqual(stamped(INBOX_REPLY.DECLINED), ["neutral", "Declined"]);
  assert.deepEqual(stamped(INBOX_REPLY.NOT_DONE), ["neutral", "Couldn't do it"]);
  assert.equal(stamped(INBOX_REPLY.DECLINED, true)[0], "neutral");
  assert.deepEqual(stamped(INBOX_REPLY.APPROVED), ["complete", "Approved"]);
});
