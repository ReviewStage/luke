// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { AppInboxTask } from "@luke/host/app-state";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { announcedPolitely } from "../testing/announcer.js";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { ToastHost } from "../toast.js";
import { useInboxToasts } from "./inbox-toast.js";

/**
 * inbox-toast.test.ts -- the items one read found opened are said in one
 * toast: one item by its own words under its task, several by how many,
 * read aloud once. Synthetic items throughout.
 */

/** An item as main hands it to the window. */
interface Opened {
  readonly taskId: string;
  readonly itemId: string;
  readonly words: string;
  readonly detail: string;
}

let opened: ((read: { items: readonly Opened[] }) => void) | undefined;
let root: Root | undefined;

beforeEach(() => {
  fakeAppBridge({
    onInboxItemOpened: (listener: (read: { items: readonly Opened[] }) => void) => {
      opened = listener;
      return () => {
        opened = undefined;
      };
    },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = "";
});

const NOTHING_WAITING: readonly AppInboxTask[] = [];

function Harness(): React.JSX.Element {
  useInboxToasts(() => undefined, NOTHING_WAITING, -1, null);
  return createElement(Fragment, null, createElement(ToastHost));
}

function mount(): void {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const registry = AtomRegistry.make();
  act(() => root?.render(onRegistry(registry, createElement(Harness))));
}

/** What each toast standing says, leaving out those on their way out. */
function standing(): string[] {
  return [...document.querySelectorAll(".luke-toast:not([data-leaving]) .luke-toast-words")].map(
    (words) => words.textContent ?? "",
  );
}

const RELEASE: Opened = {
  taskId: "plan-invites",
  itemId: "item-1",
  words: "Fix invitations: Push to the release branch?",
  detail: "Teammate invitations",
};

const STAGING: Opened = {
  taskId: "plan-keys",
  itemId: "item-2",
  words: "Key rotation: Rotate the staging key?",
  detail: "Staging keys",
};

test("two items that opened together are one toast saying 2, read aloud once", () => {
  mount();
  act(() => opened?.({ items: [RELEASE, STAGING] }));
  assert.deepEqual(standing(), ["2 new items in your inbox"]);
  assert.equal(
    announcedPolitely(),
    "2 new items in your inbox. Teammate invitations and Staging keys",
  );
});

test("one item that opened is its own toast, under its task", () => {
  mount();
  act(() => opened?.({ items: [RELEASE] }));
  assert.deepEqual(standing(), ["Fix invitations: Push to the release branch?"]);
});
