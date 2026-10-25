// @vitest-environment jsdom

import assert from "node:assert/strict";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { sideBundles } from "../bundle-loader.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { onSideBundles } from "../testing/side-bundles.js";
import { ChatComposer, type ChatComposerMentions } from "./chat-composer.js";

/**
 * chat-composer-plain.test.ts -- the plain box Chat stands up where the
 * editor's bundle could not be loaded, on the editor box's terms: it takes
 * the caret where its place was opened, and Escape leaves it keeping the
 * words, rather than going on to the window.
 */

/** The channel the box posts in. */
const GENERAL = "c0a1b2c3-d4e5-4f60-8a7b-9c0d1e2f3a4b";

/** What a box standing alone offers: no member, no task, and no channel, only the dates. */
const NO_MENTIONS: ChatComposerMentions = {
  source: { taskId: "", taskName: "", workspace: "", repository: null, text: () => "" },
  members: { people: [], agents: [] },
  channels: [],
  crowded: () => false,
};

let root: Root | undefined;

beforeEach(() => {
  fakeAppPlatform(QUIET_PANEL);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  window.localStorage.clear();
});

/** A channel's box over an editor bundle that failed to load, opened as `takesCaret` says; answers its textarea. */
async function plainBox(takesCaret: boolean): Promise<HTMLTextAreaElement> {
  const bundles = sideBundles({
    planEditor: () => Promise.reject(new Error("the editor could not be loaded")),
  });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        onSideBundles(
          bundles,
          createElement(ChatComposer, {
            channelId: GENERAL,
            label: "Message #general",
            mentions: NO_MENTIONS,
            keywords: [],
            takesCaret,
            onSend: () => undefined,
          }),
        ),
      ),
    ),
  );
  const field = container.querySelector<HTMLTextAreaElement>(".chat-composer textarea");
  assert.ok(field, "the plain box stands in for the editor");
  return field;
}

test("the plain box takes the caret where its place was opened, and leaves it where K or J stepped there", async () => {
  const opened = await plainBox(true);
  assert.ok(document.activeElement === opened, "a place opened hands its box the caret");
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  const stepped = await plainBox(false);
  assert.ok(document.activeElement !== stepped, "a place stepped to leaves the caret out");
});

test("the plain box opened while the developer types in another field leaves the caret there", async () => {
  const search = document.createElement("input");
  document.body.append(search);
  search.focus();
  const field = await plainBox(true);
  assert.ok(document.activeElement === search, "the field typed in keeps the caret");
  assert.ok(document.activeElement !== field);
});

test("Escape in the plain box leaves it, keeps its words, and is marked taken so the window passes it by", async () => {
  const field = await plainBox(true);
  act(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    set?.call(field, "half a thought");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const pressed = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  act(() => {
    field.dispatchEvent(pressed);
  });
  assert.equal(pressed.defaultPrevented, true, "the window's Escape passes a taken press by");
  assert.ok(document.activeElement !== field, "the caret left the box");
  assert.equal(field.value, "half a thought");
});
