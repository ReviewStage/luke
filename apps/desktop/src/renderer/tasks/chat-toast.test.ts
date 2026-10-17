// @vitest-environment jsdom

import assert from "node:assert/strict";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { fakeAppBridge } from "#testing/app-bridge";
import { onRegistry } from "#testing/copy-feedback";
import { ToastHost } from "../toast";
import { useChatToasts } from "./chat-toast";

/**
 * chat-toast.test.ts -- a message waiting in chat says so in the window's
 * toast until Chat stands on the workspace it waits in, and Chat on
 * another workspace leaves it standing. Synthetic messages throughout.
 */

/** A waiting message as main hands it to the window. */
interface Waiting {
  readonly messageId: string;
  readonly workspaceId: string;
  readonly words: string;
  readonly detail: string;
}

let waiting: ((message: Waiting) => void) | undefined;
let root: Root | undefined;
let rerender: ((shownIn: string | null) => void) | undefined;

beforeEach(() => {
  fakeAppBridge({
    onChatMessageWaiting: (listener: (message: Waiting) => void) => {
      waiting = listener;
      return () => {
        waiting = undefined;
      };
    },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = "";
});

function Harness({ shownIn }: { shownIn: string | null }): React.JSX.Element {
  useChatToasts(() => undefined, shownIn);
  return createElement(Fragment, null, createElement(ToastHost));
}

function mount(shownIn: string | null): void {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const registry = AtomRegistry.make();
  const draw = (next: string | null) =>
    act(() => root?.render(onRegistry(registry, createElement(Harness, { shownIn: next }))));
  rerender = draw;
  draw(shownIn);
}

/** What each toast standing says, leaving out those on their way out. */
function standing(): string[] {
  return [...document.querySelectorAll(".toast:not([data-leaving]) .toast-words")].map(
    (words) => words.textContent ?? "",
  );
}

test("a message's toast stands while Chat shows another workspace, and goes once Chat stands on its own", () => {
  mount(null);
  act(() =>
    waiting?.({
      messageId: "m-1",
      workspaceId: "workspace-beta",
      words: "@agent-2 mentioned you",
      detail: "Chat",
    }),
  );
  assert.deepEqual(standing(), ["@agent-2 mentioned you"]);
  rerender?.("workspace-acme");
  assert.deepEqual(
    standing(),
    ["@agent-2 mentioned you"],
    "Chat on Acme leaves Beta's message told",
  );
  rerender?.("workspace-beta");
  assert.deepEqual(standing(), []);
});
