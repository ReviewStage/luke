// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { layContainersAt, shown } from "../testing/container-width.js";

/**
 * narrow-chat-head.test.ts -- a Chat place's head on a phone keeps a topic's
 * menu. In a narrow room the head leads with the way back and gives its
 * name the room, so what is said beside the name gives way; the topic's
 * menu at its end does not, since it is the only way to edit, archive, or
 * bring back a topic. jsdom lays nothing out, so the sheets are laid for a
 * touch screen (`testing/container-width.ts`) and the head is built in the
 * markup `chat-pane.tsx`'s `PlaceHead` draws.
 */

let laid: HTMLStyleElement | undefined;

afterEach(() => {
  laid?.remove();
  laid = undefined;
  document.body.replaceChildren();
});

/** A topic's head in a shell of the room given: the way back, its name, its purpose, and its menu. */
function topicHead(room: string) {
  laid = layContainersAt({}, { touch: room === "narrow" });
  const shell = document.body.appendChild(document.createElement("div"));
  shell.className = "desktop-shell";
  shell.dataset.room = room;
  const head = shell.appendChild(document.createElement("header"));
  head.className = "desktop-toolbar chat-head";
  const back = head.appendChild(document.createElement("button"));
  back.setAttribute("aria-label", "Back to Chat");
  head.appendChild(document.createElement("h2")).textContent = "#design";
  const meta = head.appendChild(document.createElement("span"));
  meta.textContent = "Where the design is talked through";
  const actions = head.appendChild(document.createElement("span"));
  actions.className = "chat-head-actions";
  const menu = actions.appendChild(document.createElement("button"));
  menu.setAttribute("aria-label", "#design actions");
  return { back, meta, menu };
}

test("in a narrow room a topic's head keeps the way back and its menu, and its purpose gives way", () => {
  const { back, meta, menu } = topicHead("narrow");
  assert.ok(shown(back), "the way back");
  assert.ok(shown(menu), "the topic's menu");
  assert.ok(!shown(meta), "the purpose gives way");
});

test("in a wide room a topic's head shows its purpose and its menu", () => {
  const { meta, menu } = topicHead("wide");
  assert.ok(shown(meta), "the purpose");
  assert.ok(shown(menu), "the topic's menu");
});
