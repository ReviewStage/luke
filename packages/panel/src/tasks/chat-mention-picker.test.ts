// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { ChatTarget } from "@luke/ui/chat-mention";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import type { ComposerTrigger } from "../plan-editor/contract.js";
import { type ChatMentionPicker, useChatMentionPicker } from "./chat-mention-picker.js";

/**
 * chat-mention-picker.test.ts -- the chat box's `@` and `#` list as the editor's two reports drive it: what it lists, and a list closed with Escape.
 */

const TARGETS: readonly ChatTarget[] = [
  { sigil: "@", name: "agent-1", detail: "Add teammate invitations" },
  { sigil: "#", name: "general", detail: undefined },
];

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** The picker drawn on its own, the latest it answered kept for the test to drive. */
function mounted() {
  let latest: ChatMentionPicker | undefined;
  function Picker() {
    latest = useChatMentionPicker({ targets: TARGETS, onChoose: () => undefined });
    return createElement(Fragment, null, latest.menu);
  }
  const page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
  act(() => root?.render(createElement(Picker)));
  return {
    picker: (): ChatMentionPicker => {
      assert.ok(latest, "the picker is drawn");
      return latest;
    },
    page,
  };
}

/** A word the editor reports at the start of the words, typed as far as `query`. */
function word(query: string): ComposerTrigger {
  return { start: 0, query, rect: { left: 0, top: 0, bottom: 0 } };
}

const options = (page: HTMLElement) =>
  [...page.querySelectorAll('[role="option"]')].map((row) => row.textContent);

test("an @ list closed with Escape stays closed in its word, and a # written over that @ opens the channels", () => {
  const { picker, page } = mounted();
  act(() => picker().onMemberTrigger(word("")));
  assert.deepEqual(options(page), ["@agent-1Add teammate invitations"]);
  act(() => {
    picker().onKey(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
  });
  assert.deepEqual(options(page), []);
  act(() => picker().onMemberTrigger(word("")));
  assert.deepEqual(options(page), [], "the closed word stays closed");
  // The editor reports both words as one change lands: the `@` gone, a `#` at the same place.
  act(() => {
    picker().onMemberTrigger(undefined);
    picker().onChannelTrigger(word(""));
  });
  assert.deepEqual(options(page), ["#general"]);
});
