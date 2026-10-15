// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  ASK_STATUS,
  CHANNEL_KIND,
  CHAT_ASK,
  CHAT_BLOCK,
  CHAT_CURSOR_START,
  CHAT_REPLY,
  type ChatAnswer,
  type ChatMessage,
  MEMBER_KIND,
} from "@luke/features/chat-wire";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentChatAnswerView,
  type CodingAgentChatParams,
  type CodingAgentChatPostParams,
  type CodingAgentChatWriteAnswerView,
} from "@luke/features/coding-agent-view";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { CHAT_NOT_TAKEN, useWorkspaceChat, type WorkspaceChatControl } from "./use-workspace-chat";

const ME = "00000000-0000-4000-8000-0000000000a1";
const AGENT = "00000000-0000-4000-8000-0000000000a2";
const CHANNEL = "00000000-0000-4000-8000-0000000000c1";

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

function message(seq: number, more: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `m${seq}`,
    seq,
    touchedSeq: seq,
    channelId: CHANNEL,
    authorId: AGENT,
    blocks: [{ type: CHAT_BLOCK.MARKDOWN, text: `message ${seq}` }],
    mentions: [],
    postedAt: seq,
    ...more,
  };
}

/** The chat a read answers: the roster, the channel, the messages given, and the cursor after them. */
function answered(messages: readonly ChatMessage[], cursor: string, readSeq = 0): ChatAnswer {
  return {
    self: ME,
    readSeq,
    members: [
      { id: ME, kind: MEMBER_KIND.HUMAN, handle: "dean", left: false },
      { id: AGENT, kind: MEMBER_KIND.AGENT, handle: "agent-2", left: false },
    ],
    channels: [{ id: CHANNEL, kind: CHANNEL_KIND.PLAN, name: "invites", archived: false }],
    messages,
    cursor,
  };
}

/** A service the test answers by hand: each read and write waits until the test settles it. */
function scriptedService() {
  const reads: {
    params: CodingAgentChatParams;
    settle: (answer: CodingAgentChatAnswerView) => void;
  }[] = [];
  const writes: {
    params: CodingAgentChatPostParams;
    settle: (answer: CodingAgentChatWriteAnswerView) => void;
  }[] = [];
  return {
    reads,
    writes,
    readChat: (params: CodingAgentChatParams) =>
      new Promise<CodingAgentChatAnswerView>((settle) => reads.push({ params, settle })),
    writeChat: (params: CodingAgentChatPostParams) =>
      new Promise<CodingAgentChatWriteAnswerView>((settle) => writes.push({ params, settle })),
  };
}

/** The hook mounted over the service, its workspace and whether a channel is shown as given, the latest control kept. */
function mount(service: ReturnType<typeof scriptedService>, workspaceId = "acme", reading = false) {
  let control: WorkspaceChatControl | undefined;
  let set: ((next: { workspaceId: string; reading: boolean }) => void) | undefined;
  function Harness(props: { workspaceId: string; reading: boolean }) {
    control = useWorkspaceChat({ ...props, active: true, ...service });
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const render = (next: { workspaceId: string; reading: boolean }) =>
    act(() => root?.render(createElement(Harness, next)));
  set = render;
  render({ workspaceId, reading });
  return {
    control: () => {
      assert.ok(control);
      return control;
    },
    rerender: (next: { workspaceId: string; reading: boolean }) => set?.(next),
  };
}

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

test("the chat is read from the start and then past each cursor the service hands back, a newer word on a message taking its place and an older one setting nothing back", async () => {
  const service = scriptedService();
  const tab = mount(service);
  assert.deepEqual(
    service.reads.map((read) => read.params),
    [{ workspaceId: "acme", after: CHAT_CURSOR_START }],
  );
  service.reads[0]?.settle(answered([message(1), message(2)], "2"));
  await settle();
  assert.deepEqual(
    tab.control().chat?.messages.map((each) => each.id),
    ["m1", "m2"],
  );
  assert.equal(service.reads[1]?.params.after, "2");

  const edited = message(1, {
    touchedSeq: 4,
    blocks: [{ type: CHAT_BLOCK.MARKDOWN, text: "edited" }],
  });
  service.reads[1]?.settle(answered([edited, message(3)], "4"));
  await settle();
  // A slower read still carrying the message as it first stood never sets it back.
  service.reads[2]?.settle(answered([message(1)], "4"));
  await settle();
  const held = tab.control().chat?.messages ?? [];
  assert.deepEqual(
    held.map((each) => [each.id, each.touchedSeq]),
    [
      ["m1", 4],
      ["m2", 2],
      ["m3", 3],
    ],
  );
  assert.equal(service.reads[3]?.params.after, "4");
});

test("a read that did not answer ends the loop and says so, and Try again reads from the start", async () => {
  const service = scriptedService();
  const tab = mount(service);
  service.reads[0]?.settle({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
  await settle();
  assert.equal(tab.control().failed, true);
  assert.equal(service.reads.length, 1);
  act(() => tab.control().onRetry());
  await settle();
  assert.equal(tab.control().failed, false);
  assert.deepEqual(service.reads[1]?.params, { workspaceId: "acme", after: CHAT_CURSOR_START });
});

test("a post sent again after a reply that never came goes under the same key, and the message the service answers stands at once", async () => {
  const service = scriptedService();
  const tab = mount(service);
  service.reads[0]?.settle(answered([message(1)], "1"));
  await settle();
  const post = { text: "hold the template", to: "#invites" };
  let said: Promise<string | undefined> | undefined;
  act(() => {
    said = tab.control().onPost(post);
  });
  service.writes[0]?.settle({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
  await settle();
  assert.ok(await said);
  act(() => {
    said = tab.control().onPost(post);
  });
  const [first, second] = service.writes.map((write) => write.params.write);
  assert.ok(first && "clientKey" in first && second && "clientKey" in second);
  assert.equal(second.clientKey, first.clientKey);
  service.writes[1]?.settle({
    posted: message(2, {
      authorId: ME,
      blocks: [{ type: CHAT_BLOCK.MARKDOWN, text: "hold the template" }],
    }),
    receipt: { told: [], held: [], left: [], unresolved: [] },
  });
  await settle();
  assert.equal(await said, undefined);
  assert.deepEqual(
    tab.control().chat?.messages.map((each) => each.id),
    ["m1", "m2"],
  );
});

test("an answer the service did not take, its ask changed first, says so and leaves the ask as the service answered it", async () => {
  const service = scriptedService();
  const tab = mount(service);
  const ask = {
    key: "expiry",
    revision: 2,
    status: ASK_STATUS.OPEN,
    response: { type: CHAT_ASK.APPROVAL },
    needsReply: true,
  } as const;
  service.reads[0]?.settle(answered([message(1, { ask: { ...ask, revision: 1 } })], "1"));
  await settle();
  let said: Promise<string | undefined> | undefined;
  act(() => {
    said = tab.control().onAnswer({ seq: 1, revision: 1, reply: { reply: CHAT_REPLY.APPROVED } });
  });
  service.writes[0]?.settle({ ask: message(1, { touchedSeq: 3, ask }), taken: false });
  await settle();
  assert.equal(await said, CHAT_NOT_TAKEN);
  assert.equal(tab.control().chat?.messages[0]?.ask?.revision, 2);
});

test("while a channel is shown the developer has read to the newest message, told once per place it moves to; For you moves nothing", async () => {
  const service = scriptedService();
  const tab = mount(service);
  service.reads[0]?.settle(answered([message(1), message(2)], "2"));
  await settle();
  assert.equal(service.writes.length, 0);
  tab.rerender({ workspaceId: "acme", reading: true });
  await settle();
  assert.deepEqual(
    service.writes.map((write) => write.params.write),
    [{ readTo: 2 }],
  );
  tab.rerender({ workspaceId: "acme", reading: true });
  await settle();
  assert.equal(service.writes.length, 1);
  service.writes[0]?.settle({ readSeq: 2 });
  service.reads[1]?.settle(answered([message(3)], "3", 2));
  await settle();
  assert.deepEqual(
    service.writes.map((write) => write.params.write),
    [{ readTo: 2 }, { readTo: 3 }],
  );
});

test("another workspace's chat starts from nothing of the last one's", async () => {
  const service = scriptedService();
  const tab = mount(service);
  service.reads[0]?.settle(answered([message(1)], "1"));
  await settle();
  tab.rerender({ workspaceId: "ledger", reading: false });
  await settle();
  assert.equal(tab.control().chat, undefined);
  assert.deepEqual(service.reads.at(-1)?.params, {
    workspaceId: "ledger",
    after: CHAT_CURSOR_START,
  });
  // The first workspace's read answering late is kept for nobody.
  service.reads[1]?.settle(answered([message(9)], "9"));
  await settle();
  assert.equal(tab.control().chat, undefined);
});
