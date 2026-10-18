// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { ChatShown } from "@luke/host/acts";
import { Duration } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { fakeAppBridge } from "#testing/app-bridge";
import { onRegistry } from "#testing/copy-feedback";
import { TOAST_HOLD, ToastHost } from "../toast";
import { useChatToasts } from "./chat-toast";

/**
 * chat-toast.test.ts -- a message waiting in chat says so in the window's
 * toast, which leaves by itself, goes once the Chat it is read in stands,
 * and whose View opens its workspace's Chat. Synthetic messages throughout.
 */

/** A waiting message as main hands it to the window. */
interface Waiting {
  readonly messageId: string;
  readonly workspaceId: string;
  readonly taskId: string | null;
  readonly words: string;
  readonly detail: string;
}

let waiting: ((message: Waiting) => void) | undefined;
let root: Root | undefined;
let rerender: ((shown: ChatShown | null) => void) | undefined;
let viewed: string[] = [];

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
  vi.useRealTimers();
  viewed = [];
  act(() => root?.unmount());
  document.body.innerHTML = "";
});

function Harness({ shown }: { shown: ChatShown | null }): React.JSX.Element {
  useChatToasts((workspaceId) => viewed.push(workspaceId), shown);
  return createElement(Fragment, null, createElement(ToastHost));
}

function mount(shown: ChatShown | null): void {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const registry = AtomRegistry.make();
  const draw = (next: ChatShown | null) =>
    act(() => root?.render(onRegistry(registry, createElement(Harness, { shown: next }))));
  rerender = draw;
  draw(shown);
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
      taskId: null,
      words: "@agent-2 mentioned you",
      detail: "Chat",
    }),
  );
  assert.deepEqual(standing(), ["@agent-2 mentioned you"]);
  rerender?.({ workspaceId: "workspace-acme", taskId: null });
  assert.deepEqual(
    standing(),
    ["@agent-2 mentioned you"],
    "Chat on Acme leaves Beta's message told",
  );
  rerender?.({ workspaceId: "workspace-beta", taskId: null });
  assert.deepEqual(standing(), []);
});

test("a task's Chat tab withdraws only what waits in its plan's channel", () => {
  mount(null);
  act(() => {
    waiting?.({
      messageId: "m-plan",
      workspaceId: "workspace-acme",
      taskId: "plan-invites",
      words: "@agent-2 asked you",
      detail: "Teammate invitations",
    });
    waiting?.({
      messageId: "m-dm",
      workspaceId: "workspace-acme",
      taskId: null,
      words: "@agent-3 messaged you",
      detail: "Chat",
    });
  });
  rerender?.({ workspaceId: "workspace-acme", taskId: "plan-billing" });
  const otherTab = standing();
  rerender?.({ workspaceId: "workspace-acme", taskId: "plan-invites" });

  assert.deepEqual(otherTab, ["@agent-2 asked you", "@agent-3 messaged you"]);
  assert.deepEqual(standing(), ["@agent-3 messaged you"]);
});

test("a message's toast leaves by itself once the news's hold runs out, and its View opens the Chat of the workspace it waits in", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  mount({ workspaceId: "workspace-acme", taskId: null });
  act(() =>
    waiting?.({
      messageId: "m-1",
      workspaceId: "workspace-beta",
      taskId: null,
      words: "@agent-2 mentioned you",
      detail: "Chat",
    }),
  );
  const view =
    [...document.querySelectorAll<HTMLButtonElement>(".toast button")].find(
      (button) => button.textContent === "View",
    ) ?? assert.fail("the toast's View");
  act(() => view.click());
  assert.deepEqual(viewed, ["workspace-beta"]);

  act(() =>
    waiting?.({
      messageId: "m-2",
      workspaceId: "workspace-beta",
      taskId: null,
      words: "@agent-3 messaged you",
      detail: "Chat",
    }),
  );
  act(() => {
    vi.advanceTimersByTime(Duration.toMillis(TOAST_HOLD.NEWS) * 2);
  });
  assert.deepEqual(standing(), []);
});
