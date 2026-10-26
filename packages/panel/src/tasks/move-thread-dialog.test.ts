// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { Channel, ChannelThread } from "@luke/features/channel-wire";
import { INBOX_STATUS, INBOX_WIRE_VERSION } from "@luke/features/inbox-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { onRegistry } from "../testing/copy-feedback.js";
import { useMoveThreadDialog } from "./move-thread-dialog.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * move-thread-dialog.test.ts -- Move to channel's question goes with its
 * thread: a thread that leaves the stream while it is asked, as when a
 * teammate moves it first, takes the dialog with it, so nothing stale moves
 * it a second time.
 */

const GENERAL: Channel = {
  id: "c0ffee00-0000-4000-8000-000000000001",
  name: "general",
  purpose: "Everything else",
  project: false,
  createdAt: 1,
  waiting: 0,
};
const APP: Channel = { ...GENERAL, id: "c0ffee00-0000-4000-8000-000000000002", name: "app" };

const THREAD: ChannelThread = {
  id: "a1b2c3d4-0000-4000-8000-000000000001",
  agentId: "a1b2c3d4-0000-4000-8000-0000000000a1",
  key: "0001",
  revision: 1,
  version: INBOX_WIRE_VERSION,
  title: "Alert at 80%?",
  needsReply: false,
  status: INBOX_STATUS.OPEN,
  postedAt: 1,
  updatedAt: 1,
  channelId: GENERAL.id,
};

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

test("a thread moved away by someone else while Move to channel is asked takes the dialog with it", () => {
  let ask: ((thread: ChannelThread) => void) | undefined;
  function Stream({ threads }: { threads: readonly ChannelThread[] }) {
    const move = useMoveThreadDialog({
      channels: [GENERAL, APP],
      from: GENERAL.id,
      threads,
      shown: true,
      onMove: () => Promise.resolve(undefined),
      onMoved: () => undefined,
    });
    ask = move.ask;
    return move.dialog;
  }
  const registry = AtomRegistry.make();
  const draw = (threads: readonly ChannelThread[]) =>
    act(() => root?.render(onRegistry(registry, createElement(Stream, { threads }))));
  root = createRoot(document.body.appendChild(document.createElement("div")));
  draw([THREAD]);
  act(() => ask?.(THREAD));
  assert.ok(document.querySelector('[role="dialog"]'), "the move is asked");

  draw([]);
  assert.ok(
    document.querySelector('[role="dialog"][data-open]') === null,
    "the question went with its thread",
  );
});
