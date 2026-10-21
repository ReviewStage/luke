// @vitest-environment jsdom

import assert from "node:assert/strict";
import { personActor } from "@luke/ui/actor-model";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import type { ComposerTrigger } from "../plan-editor/contract.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { MENTION_MENU_SIDE, type MentionPicker, useMentionPicker } from "./mention-picker.js";
import { NO_TASK } from "./task-mentions.js";

/**
 * mention-picker.test.ts -- the `@` list where the words are a chat message's, as the editor's two reports drive it: the members a mention tells offered in place of the workspace's, and a list closed with Escape, which a `#` written over its word opens again on the channels.
 */

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** The list drawn as a chat box draws it, the latest it answered kept for the test to drive. */
function mounted() {
  let latest: MentionPicker | undefined;
  function Picker() {
    const room = useRef<HTMLDivElement>(null);
    latest = useMentionPicker({
      source: {
        taskId: NO_TASK,
        taskName: "",
        workspace: "acme",
        repository: null,
        text: () => "",
      },
      members: {
        people: [
          {
            userId: "maria",
            name: "Maria Chen",
            email: "maria@example.com",
            actor: personActor({ userId: "maria", name: "Maria Chen" }, undefined, undefined, []),
          },
        ],
        agents: [],
      },
      channels: {
        known: [{ name: "general", taskId: undefined, detail: undefined }],
        onChoose: () => undefined,
      },
      room,
      side: MENTION_MENU_SIDE.ABOVE,
      onChoose: () => undefined,
    });
    return createElement("div", { ref: room }, latest.menu);
  }
  const page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
  act(() => root?.render(onRegistry(AtomRegistry.make(), createElement(Picker))));
  return {
    picker: (): MentionPicker => {
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

/** The rows the open list draws, by name. */
const rows = (page: HTMLElement) =>
  [...page.querySelectorAll(".luke-combobox-option-label")].map((row) => row.textContent);

test("an @ list closed with Escape stays closed in its word, and a # written over that @ opens the channels", () => {
  const { picker, page } = mounted();
  act(() => picker().onTrigger(word("mar")));
  assert.deepEqual(rows(page), ["Maria Chen"]);
  act(() => {
    picker().onKey(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
  });
  assert.deepEqual(rows(page), []);
  act(() => picker().onTrigger(word("mar")));
  assert.deepEqual(rows(page), [], "the closed word stays closed");
  // The editor reports both words as one change lands: the `@` gone, a `#` at the same place.
  act(() => {
    picker().onTrigger(undefined);
    picker().onChannelTrigger(word(""));
  });
  assert.deepEqual(rows(page), ["general"]);
});
