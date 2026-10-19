// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CHANNEL_KIND, type ChatAnswer } from "@luke/features/chat-wire";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { type ChannelDialogs, useChannelDialogs } from "./chat-channel-dialogs.js";

/**
 * chat-channel-dialogs.test.ts -- a channel's questions go with the workspace they were asked in.
 */

const TOPIC = "00000000-0000-4000-8000-0000000000c1";

const CHAT: ChatAnswer = {
  self: "00000000-0000-4000-8000-0000000000a1",
  readSeq: 0,
  members: [],
  channels: [{ id: TOPIC, kind: CHANNEL_KIND.TOPIC, name: "release", archived: false }],
  messages: [],
  cursor: "0",
};

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** The questions drawn over the workspace given, the latest kept for the test to ask through. */
function mounted() {
  let latest: ChannelDialogs | undefined;
  function Questions({ workspaceId, chat }: { workspaceId: string; chat: ChatAnswer }) {
    latest = useChannelDialogs(workspaceId, chat, () => Promise.resolve(undefined), true);
    return createElement(Fragment, null, latest.dialog);
  }
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const show = (workspaceId: string, chat: ChatAnswer = CHAT) =>
    act(() => root?.render(createElement(Questions, { workspaceId, chat })));
  show("acme");
  return {
    show,
    dialogs: (): ChannelDialogs => {
      assert.ok(latest, "the questions are drawn");
      return latest;
    },
  };
}

const open = () => document.querySelector('[role="dialog"], [role="alertdialog"]');

test("a question asked in one workspace goes away once another is listed, and an archive goes with its channel", () => {
  const view = mounted();
  const [first] = CHAT.channels;
  assert.ok(first);
  act(() => view.dialogs().askEdit(first));
  assert.ok(open(), "Edit channel stands");
  view.show("beta");
  assert.equal(open(), null, "another workspace puts it away");

  view.show("acme");
  const [topic] = CHAT.channels;
  assert.ok(topic);
  act(() => view.dialogs().askArchive(topic));
  assert.ok(open(), "Archive channel stands");
  view.show("acme", { ...CHAT, channels: [] });
  assert.equal(open(), null, "a channel gone from the chat takes its question with it");
});
