// @vitest-environment jsdom

/**
 * chat-pane-redraws.test.ts -- what a push of the workspace's chat draws again in a channel shown: the row of the message it brought or changed, and no other.
 *
 * The chat is followed through `useWorkspaceChat` over a scripted host, each
 * push a new tree as the host hands it, and drawn by `ChatPane` on the
 * channel. What is drawn again is read through a wrapper around an agent's
 * words, which each message's row draws, counted by the words.
 */

import assert from "node:assert/strict";
import {
  CHANNEL_KIND,
  CHAT_BLOCK,
  type ChatAnswer,
  type ChatMessage,
  MEMBER_KIND,
} from "@luke/features/chat-wire";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentChatAnswerView,
  type CodingAgentChatWriteAnswerView,
} from "@luke/features/coding-agent-view";
import { CHAT_PLACE, type ChatPlace, chatNames } from "@luke/ui/chat-model";
import { Effect } from "effect";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { ChatPane } from "./chat-pane.js";
import { useWorkspaceChat } from "./use-workspace-chat.js";

/** How many times each message's words were drawn, by the words. */
const draws = vi.hoisted(() => new Map<string, number>());

// Note that the wrapper draws the real words beneath it and only counts.
vi.mock("./transcript-blocks.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./transcript-blocks.js")>();
  const { createElement: draw } = await import("react");
  return {
    ...actual,
    TranscriptWords: (props: Parameters<typeof actual.TranscriptWords>[0]) => {
      draws.set(props.text, (draws.get(props.text) ?? 0) + 1);
      return draw(actual.TranscriptWords, props);
    },
  };
});

const ME = "00000000-0000-4000-8000-0000000000a1";
const AGENT = "00000000-0000-4000-8000-0000000000a2";
const CHANNEL = "00000000-0000-4000-8000-0000000000c1";
const AT = Date.parse("2026-10-14T10:00:00Z");
const NAMES = chatNames([], [], "Dean Stratakos");
const PLACE: ChatPlace = { kind: CHAT_PLACE.CHANNEL, channelId: CHANNEL };

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let root: Root | undefined;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return Effect.runPromise(markdownHtmlParserLanded);
});

beforeEach(() => {
  draws.clear();
  fakeAppPlatform(QUIET_PANEL);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** A message of the agent's words, posted at `seq`, an hour apart so each stands as its own run. */
function message(seq: number, more: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `m${seq}`,
    seq,
    touchedSeq: seq,
    channelId: CHANNEL,
    authorId: AGENT,
    blocks: [{ type: CHAT_BLOCK.MARKDOWN, text: `message ${seq}` }],
    mentions: [],
    postedAt: AT + seq * 3_600_000,
    ...more,
  };
}

/** The chat a push carries, read to its newest message so no read is told. */
function answered(messages: readonly ChatMessage[]): ChatAnswer {
  return {
    self: ME,
    readSeq: 100,
    members: [
      { id: ME, kind: MEMBER_KIND.HUMAN, name: "Dean", left: false },
      { id: AGENT, kind: MEMBER_KIND.AGENT, name: "Invite emails", left: false },
    ],
    channels: [{ id: CHANNEL, kind: CHANNEL_KIND.TOPIC, name: "invites", archived: false }],
    messages,
    cursor: "",
  };
}

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/** The channel drawn over the chat followed, and the way to push the chat down its stream as the host would, a new tree each time. */
function drawChannel(): (chat: ChatAnswer) => Promise<void> {
  let hear: ((chat: CodingAgentChatAnswerView) => void) | undefined;
  const followChat = (_workspaceId: string, heard: (chat: CodingAgentChatAnswerView) => void) => {
    hear = heard;
    return () => undefined;
  };
  const writeChat = () => new Promise<CodingAgentChatWriteAnswerView>(() => undefined);
  const openLink = () => undefined;
  function Page() {
    const control = useWorkspaceChat({
      account: "dean@example.com",
      workspaceId: "acme",
      active: true,
      reading: undefined,
      followChat,
      writeChat,
      readPicture: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND }),
    });
    if (control.chat === undefined) return null;
    return createElement(ChatPane, {
      chat: control.chat,
      names: NAMES,
      place: PLACE,
      openLink,
      onPost: control.onPost,
      onAnswer: control.onAnswer,
      readPicture: control.readPicture,
    });
  }
  root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => root?.render(createElement(Page)));
  return async (chat) => {
    act(() => hear?.(structuredClone(chat)));
    await settle();
  };
}

test("a new message in the channel shown draws its own row, and an edited one its own, and no other row again", async () => {
  const push = drawChannel();
  await push(answered([message(1), message(2), message(3)]));
  assert.equal(document.querySelectorAll(".chat-message").length, 3);
  assert.equal(draws.get("message 1"), 1, "each row is drawn as the channel opens");
  draws.clear();

  await push(answered([message(1), message(2), message(3), message(4)]));
  assert.equal(document.querySelectorAll(".chat-message").length, 4);
  assert.deepEqual([...draws.keys()], ["message 4"], "only the new message's row is drawn");
  draws.clear();

  const edited = message(2, {
    touchedSeq: 5,
    blocks: [{ type: CHAT_BLOCK.MARKDOWN, text: "message 2, edited" }],
  });
  await push(answered([message(1), edited, message(3), message(4)]));
  assert.deepEqual([...draws.keys()], ["message 2, edited"], "only the edited row is drawn");
});
