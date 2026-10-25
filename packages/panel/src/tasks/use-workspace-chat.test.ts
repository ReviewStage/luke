// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  ASK_STATUS,
  CHANNEL_KIND,
  CHAT_ASK,
  CHAT_BLOCK,
  CHAT_IMAGE_TYPE,
  CHAT_REPLY,
  type ChatAnswer,
  type ChatMessage,
  MEMBER_KIND,
} from "@luke/features/chat-wire";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentChatAnswerView,
  type CodingAgentChatAttachmentParams,
  type CodingAgentChatPostParams,
  type CodingAgentChatWriteAnswerView,
  type CodingAgentInboxAttachmentView,
} from "@luke/features/coding-agent-view";
import { Duration } from "effect";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import {
  CHAT_READ_PAUSE,
  chatFollowerOf,
  useWorkspaceChat,
  type WorkspaceChatControl,
} from "./use-workspace-chat.js";

const ME = "00000000-0000-4000-8000-0000000000a1";
const AGENT = "00000000-0000-4000-8000-0000000000a2";
const CHANNEL = "00000000-0000-4000-8000-0000000000c1";

let root: Root | undefined;

afterEach(() => {
  vi.useRealTimers();
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

/** The chat a push carries: the roster, the channel, and the messages given; a pushed chat carries no cursor. */
function answered(messages: readonly ChatMessage[], readSeq = 0): ChatAnswer {
  return {
    self: ME,
    readSeq,
    members: [
      { id: ME, kind: MEMBER_KIND.HUMAN, name: "Dean", left: false },
      { id: AGENT, kind: MEMBER_KIND.AGENT, name: "Invite emails", left: false },
    ],
    channels: [{ id: CHANNEL, kind: CHANNEL_KIND.TASK, name: "invites", archived: false }],
    messages,
    cursor: "",
  };
}

/** The host as the test plays it: the follows held open and let go, a push down one, and each write waiting until the test settles it. */
function scriptedService() {
  const asked: string[] = [];
  const hearers = new Map<string, Set<(chat: CodingAgentChatAnswerView) => void>>();
  const writes: {
    params: CodingAgentChatPostParams;
    settle: (answer: CodingAgentChatWriteAnswerView) => void;
  }[] = [];
  const pictures: CodingAgentChatAttachmentParams[] = [];
  return {
    asked,
    writes,
    /** A chat pushed down every stream of the workspace's held open. */
    push: (workspaceId: string, chat: CodingAgentChatAnswerView) => {
      for (const hear of hearers.get(workspaceId) ?? []) hear(chat);
    },
    followChat: (workspaceId: string, hear: (chat: CodingAgentChatAnswerView) => void) => {
      asked.push(`follow:${workspaceId}`);
      const standing = hearers.get(workspaceId) ?? new Set();
      standing.add(hear);
      hearers.set(workspaceId, standing);
      return () => {
        asked.push(`unfollow:${workspaceId}`);
        standing.delete(hear);
      };
    },
    writeChat: (params: CodingAgentChatPostParams) =>
      new Promise<CodingAgentChatWriteAnswerView>((settle) => writes.push({ params, settle })),
    pictures,
    readPicture: (params: CodingAgentChatAttachmentParams) => {
      pictures.push(params);
      return Promise.resolve<CodingAgentInboxAttachmentView>({
        contentType: CHAT_IMAGE_TYPE.PNG,
        base64: "iVBORw0KGgo=",
      });
    },
  };
}

/** What the hook is mounted over: the workspace, the channel shown, and the account where another than Dean's. */
interface Shown {
  readonly workspaceId: string;
  readonly reading: string | undefined;
  readonly account?: string;
}

/** The hook mounted over the service, its workspace and whether a channel is shown as given, the latest control kept. */
function mount(
  service: ReturnType<typeof scriptedService>,
  workspaceId = "acme",
  reading: string | undefined = undefined,
) {
  let control: WorkspaceChatControl | undefined;
  let set: ((next: Shown) => void) | undefined;
  function Harness(props: Shown) {
    control = useWorkspaceChat({
      account: "dean@example.com",
      ...props,
      active: true,
      followChat: service.followChat,
      writeChat: service.writeChat,
      readPicture: service.readPicture,
    });
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const render = (next: Shown) => act(() => root?.render(createElement(Harness, next)));
  set = render;
  render({ workspaceId, reading });
  return {
    control: () => {
      assert.ok(control);
      return control;
    },
    rerender: (next: Shown) => set?.(next),
  };
}

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/** Lets the pause a read waits on run out, and what it tells go. */
async function pauseRunsOut(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(Duration.toMillis(CHAT_READ_PAUSE));
  });
  await settle();
}

test("the chat is followed and each push taken in, a newer word on a message taking its place and an older one setting nothing back", async () => {
  const service = scriptedService();
  const tab = mount(service);
  assert.deepEqual(service.asked, ["follow:acme"]);
  service.push("acme", answered([message(1), message(2)]));
  await settle();
  assert.deepEqual(
    tab.control().chat?.messages.map((each) => each.id),
    ["m1", "m2"],
  );

  const edited = message(1, {
    touchedSeq: 4,
    blocks: [{ type: CHAT_BLOCK.MARKDOWN, text: "edited" }],
  });
  service.push("acme", answered([edited, message(2), message(3)]));
  // A push still carrying the message as it first stood never sets it back.
  service.push("acme", answered([message(1), message(2), message(3)]));
  await settle();
  assert.deepEqual(
    (tab.control().chat?.messages ?? []).map((each) => [each.id, each.touchedSeq]),
    [
      ["m1", 4],
      ["m2", 2],
      ["m3", 3],
    ],
  );
  // A message the push no longer holds, fallen past a channel's newest, is let go.
  service.push("acme", answered([edited, message(3)]));
  await settle();
  assert.deepEqual(
    tab.control().chat?.messages.map((each) => each.id),
    ["m1", "m3"],
  );
  assert.deepEqual(service.asked, ["follow:acme"]);
});

test("a message the window posted stands through a push read before it landed, and the push that holds it takes over", async () => {
  const service = scriptedService();
  const tab = mount(service);
  service.push("acme", answered([message(1)]));
  await settle();
  let said: Promise<string | undefined> | undefined;
  act(() => {
    said = tab.control().onPost({ text: "hold the template", to: "#invites" }, "key-1");
  });
  const posted = message(2, { authorId: ME });
  service.writes[0]?.settle({
    posted,
    receipt: { told: [], held: [], left: [], unresolved: [] },
  });
  await settle();
  assert.equal(await said, undefined);
  service.push("acme", answered([message(1)]));
  await settle();
  assert.deepEqual(
    tab.control().chat?.messages.map((each) => each.id),
    ["m1", "m2"],
    "the older push sets the post nothing back",
  );
  const edited = message(2, { authorId: ME, touchedSeq: 5 });
  service.push("acme", answered([message(1), edited]));
  await settle();
  service.push("acme", answered([message(1), edited]));
  await settle();
  assert.equal(tab.control().chat?.messages[1]?.touchedSeq, 5);
});

test("a chat stream that ends though the window still follows it says it could not be read", async () => {
  let opened: ((chat: CodingAgentChatAnswerView) => void) | undefined;
  let end: (() => void) | undefined;
  // SAFETY: the follower opens one stream through the act it is handed and reads it with for-await alone.
  const follower = chatFollowerOf(((_kind: unknown) =>
    Promise.resolve(
      (async function* () {
        while (true) {
          const next = await new Promise<CodingAgentChatAnswerView | undefined>((resolve) => {
            opened = resolve;
            end = () => resolve(undefined);
          });
          if (next === undefined) return;
          yield next;
        }
      })(),
    )) as unknown as Parameters<typeof chatFollowerOf>[0]);
  const heard: CodingAgentChatAnswerView[] = [];
  const stop = follower("acme", (chat) => heard.push(chat));
  await settle();
  opened?.(answered([message(1)]));
  await settle();
  end?.();
  await settle();
  assert.deepEqual(heard, [
    answered([message(1)]),
    { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED },
  ]);
  stop();
});

test("a chat that could not be read is let go and says so, and Try again follows it anew", async () => {
  const service = scriptedService();
  const tab = mount(service);
  service.push("acme", { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
  await settle();
  assert.equal(tab.control().failed, true);
  assert.deepEqual(service.asked, ["follow:acme", "unfollow:acme"]);
  act(() => tab.control().onRetry());
  await settle();
  assert.equal(tab.control().failed, false);
  assert.deepEqual(service.asked, ["follow:acme", "unfollow:acme", "follow:acme"]);
});

test("a post goes under the key the window hands it, so one sent again after a reply that never came goes under the same key, and the message the service answers stands at once", async () => {
  const service = scriptedService();
  const tab = mount(service);
  service.push("acme", answered([message(1)]));
  await settle();
  const post = { text: "hold the template", to: "#invites" };
  let said: Promise<string | undefined> | undefined;
  act(() => {
    said = tab.control().onPost(post, "key-1");
  });
  service.writes[0]?.settle({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
  await settle();
  assert.ok(await said);
  act(() => {
    said = tab.control().onPost(post, "key-1");
  });
  const [first, second] = service.writes.map((write) => write.params.write);
  assert.ok(first && "clientKey" in first && second && "clientKey" in second);
  assert.equal(first.clientKey, "key-1");
  assert.equal(second.clientKey, "key-1");
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

test("a message's picture is read in the workspace shown, by the message and the attachment its block names", async () => {
  const service = scriptedService();
  const tab = mount(service);
  const picture = await tab.control().readPicture("m1", "p1");
  assert.deepEqual(picture, { contentType: CHAT_IMAGE_TYPE.PNG, base64: "iVBORw0KGgo=" });
  tab.rerender({ workspaceId: "globex", reading: undefined });
  await tab.control().readPicture("m2", "p2");
  assert.deepEqual(service.pictures, [
    { workspaceId: "acme", messageId: "m1", attachmentId: "p1" },
    { workspaceId: "globex", messageId: "m2", attachmentId: "p2" },
  ]);
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
  service.push("acme", answered([message(1, { ask: { ...ask, revision: 1 } })]));
  await settle();
  let said: Promise<string | undefined> | undefined;
  act(() => {
    said = tab.control().onAnswer({ seq: 1, revision: 1, reply: { reply: CHAT_REPLY.APPROVED } });
  });
  service.writes[0]?.settle({ ask: message(1, { touchedSeq: 3, ask }), taken: false });
  await settle();
  assert.equal(
    await said,
    "The ask changed before your answer landed. Answer it as it stands now.",
  );
  assert.equal(tab.control().chat?.messages[0]?.ask?.revision, 2);
});

test("while a channel is shown the developer has read it to its newest message, at once in the window and told of that channel once per place it moves to; For you moves nothing", async () => {
  vi.useFakeTimers();
  const service = scriptedService();
  const tab = mount(service);
  service.push("acme", answered([message(1), message(2)]));
  await settle();
  await pauseRunsOut();
  assert.equal(service.writes.length, 0);
  tab.rerender({ workspaceId: "acme", reading: CHANNEL });
  await settle();
  assert.equal(tab.control().chat?.reads?.[0]?.readSeq, 2, "the window reads it at once");
  await pauseRunsOut();
  assert.deepEqual(
    service.writes.map((write) => write.params.write),
    [{ readTo: 2, channelId: CHANNEL }],
  );
  tab.rerender({ workspaceId: "acme", reading: CHANNEL });
  await settle();
  assert.equal(service.writes.length, 1);
  service.writes[0]?.settle({ readSeq: 0, reads: [{ channelId: CHANNEL, readSeq: 2 }] });
  service.push("acme", answered([message(1), message(2), message(3)]));
  await settle();
  await pauseRunsOut();
  assert.deepEqual(
    service.writes.map((write) => write.params.write),
    [
      { readTo: 2, channelId: CHANNEL },
      { readTo: 3, channelId: CHANNEL },
    ],
  );
});

test("another workspace's chat starts from nothing of the last one's, which is let go", async () => {
  const service = scriptedService();
  const tab = mount(service);
  service.push("acme", answered([message(1)]));
  await settle();
  tab.rerender({ workspaceId: "ledger", reading: undefined });
  await settle();
  assert.equal(tab.control().chat, undefined);
  assert.deepEqual(service.asked, ["follow:acme", "unfollow:acme", "follow:ledger"]);
  // The first workspace's push, arriving late, is kept for nobody.
  service.push("acme", answered([message(9)]));
  await settle();
  assert.equal(tab.control().chat, undefined);
});

test("a channel's read the service did not take is set back in the window, and told again once the channel is shown again", async () => {
  vi.useFakeTimers();
  const service = scriptedService();
  const tab = mount(service, "acme", CHANNEL);
  service.push("acme", answered([message(1), message(2)]));
  await settle();
  await pauseRunsOut();
  assert.equal(service.writes.length, 1);
  service.writes[0]?.settle({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
  await settle();
  assert.equal(tab.control().chat?.reads, undefined, "the window's read is set back");
  await pauseRunsOut();
  assert.equal(service.writes.length, 1, "nothing is told again while the channel stands");
  tab.rerender({ workspaceId: "acme", reading: undefined });
  tab.rerender({ workspaceId: "acme", reading: CHANNEL });
  await settle();
  await pauseRunsOut();
  assert.deepEqual(
    service.writes.map((write) => write.params.write),
    [
      { readTo: 2, channelId: CHANNEL },
      { readTo: 2, channelId: CHANNEL },
    ],
  );
});

test("another account signed in to the same workspace starts from nothing of the last account's chat, following it anew as its own", async () => {
  const service = scriptedService();
  const tab = mount(service);
  service.push("acme", answered([message(1)]));
  await settle();
  assert.ok(tab.control().chat);
  tab.rerender({ workspaceId: "acme", reading: undefined, account: "ada@example.com" });
  await settle();
  assert.equal(tab.control().chat, undefined);
  assert.deepEqual(service.asked, ["follow:acme", "unfollow:acme", "follow:acme"]);
});

test("another account signed in with the same channel shown marks it read as its own, whatever the last account told", async () => {
  vi.useFakeTimers();
  const service = scriptedService();
  const tab = mount(service, "acme", CHANNEL);
  service.push("acme", answered([message(1), message(2)]));
  await settle();
  await pauseRunsOut();
  service.writes[0]?.settle({ readSeq: 2 });
  tab.rerender({ workspaceId: "acme", reading: CHANNEL, account: "ada@example.com" });
  await settle();
  service.push("acme", answered([message(1), message(2)]));
  await settle();
  await pauseRunsOut();
  assert.deepEqual(
    service.writes.map((write) => write.params.write),
    [
      { readTo: 2, channelId: CHANNEL },
      { readTo: 2, channelId: CHANNEL },
    ],
  );
});

test("a channel the window wrote stands through pushes read before the write landed, and is let go once a push holds it or the hold has passed", async () => {
  const service = scriptedService();
  const tab = mount(service);
  service.push("acme", answered([message(1)]));
  await settle();
  let said: Promise<string | undefined> | undefined;
  act(() => {
    said = tab.control().onChannel({ edit: { channelId: CHANNEL, name: "invites-v2" } });
  });
  const renamed = { id: CHANNEL, kind: CHANNEL_KIND.TOPIC, name: "invites-v2", archived: false };
  service.writes[0]?.settle({ channel: renamed });
  await settle();
  assert.equal(await said, undefined);
  assert.equal(tab.control().chat?.channels[0]?.name, "invites-v2");
  // Pushes read before the rename landed, however many, set nothing back.
  service.push("acme", answered([message(1)]));
  service.push("acme", answered([message(1)]));
  await settle();
  assert.equal(
    tab.control().chat?.channels[0]?.name,
    "invites-v2",
    "the older pushes set nothing back",
  );
  // Past the hold, a push is the chat's own word again.
  const now = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(now + 31_000);
  service.push("acme", {
    ...answered([message(1)]),
    channels: [{ ...renamed, name: "invites-v3" }],
  });
  await settle();
  assert.equal(tab.control().chat?.channels[0]?.name, "invites-v3");
  clock.mockRestore();

  // A push that holds the write lets it go at once.
  act(() => {
    void tab.control().onChannel({ edit: { channelId: CHANNEL, name: "invites-v4" } });
  });
  const again = { ...renamed, name: "invites-v4" };
  service.writes[1]?.settle({ channel: again });
  await settle();
  service.push("acme", { ...answered([message(1)]), channels: [again] });
  service.push("acme", {
    ...answered([message(1)]),
    channels: [{ ...renamed, name: "invites-v5" }],
  });
  await settle();
  assert.equal(tab.control().chat?.channels[0]?.name, "invites-v5");
});

test("a channel the last account wrote, answered after another account signed in, is laid over nothing of the new account's chat", async () => {
  const service = scriptedService();
  const tab = mount(service);
  service.push("acme", answered([message(1)]));
  await settle();
  act(() => {
    void tab.control().onChannel({ edit: { channelId: CHANNEL, name: "alpha" } });
  });
  tab.rerender({ workspaceId: "acme", reading: undefined, account: "ada@example.com" });
  await settle();
  service.writes[0]?.settle({
    channel: { id: CHANNEL, kind: CHANNEL_KIND.TOPIC, name: "alpha", archived: false },
  });
  await settle();
  service.push("acme", {
    ...answered([message(1)]),
    channels: [{ id: CHANNEL, kind: CHANNEL_KIND.TOPIC, name: "beta", archived: false }],
  });
  await settle();
  assert.equal(tab.control().chat?.channels[0]?.name, "beta");
});

test("Mark as read reads each channel named to its newest message, leaving one with nothing past its cursor alone, and an answer landing late sets no channel back", async () => {
  const other = "00000000-0000-4000-8000-0000000000c2";
  const read = "00000000-0000-4000-8000-0000000000c3";
  const service = scriptedService();
  const tab = mount(service);
  const base = answered([
    message(1),
    message(2, { channelId: other }),
    message(3, { channelId: read }),
  ]);
  service.push("acme", {
    ...base,
    channels: [
      ...base.channels,
      { id: other, kind: CHANNEL_KIND.TOPIC, name: "other", archived: false },
      { id: read, kind: CHANNEL_KIND.TOPIC, name: "read", archived: false },
    ],
    reads: [{ channelId: read, readSeq: 3 }],
  });
  await settle();
  act(() => tab.control().onRead([CHANNEL, other, read]));
  await settle();
  assert.deepEqual(
    service.writes.map((write) => write.params.write),
    [
      { readTo: 1, channelId: CHANNEL },
      { readTo: 2, channelId: other },
    ],
  );
  // The second read's answer lands first, the first's after it, holding less.
  service.writes[1]?.settle({
    readSeq: 0,
    reads: [
      { channelId: CHANNEL, readSeq: 1 },
      { channelId: other, readSeq: 2 },
      { channelId: read, readSeq: 3 },
    ],
  });
  await settle();
  service.writes[0]?.settle({
    readSeq: 0,
    reads: [
      { channelId: CHANNEL, readSeq: 1 },
      { channelId: read, readSeq: 3 },
    ],
  });
  await settle();
  const reads = new Map(tab.control().chat?.reads?.map((each) => [each.channelId, each.readSeq]));
  assert.deepEqual([reads.get(CHANNEL), reads.get(other), reads.get(read)], [1, 2, 3]);
});

test("a push read before Mark as read landed sets the channel's cursor back no further than the read put it", async () => {
  const service = scriptedService();
  const tab = mount(service);
  const stale = {
    ...answered([message(1), message(2)]),
    reads: [{ channelId: CHANNEL, readSeq: 1 }],
  };
  service.push("acme", stale);
  await settle();
  act(() => tab.control().onRead([CHANNEL]));
  await settle();
  service.writes[0]?.settle({ readSeq: 0, reads: [{ channelId: CHANNEL, readSeq: 2 }] });
  await settle();
  service.push("acme", stale);
  await settle();
  assert.deepEqual(tab.control().chat?.reads, [{ channelId: CHANNEL, readSeq: 2 }]);
});

test("a push carrying no channel's cursor, read before Mark as read landed, keeps the cursor the read put", async () => {
  const service = scriptedService();
  const tab = mount(service);
  const stale = answered([message(1), message(2)]);
  service.push("acme", stale);
  await settle();
  act(() => tab.control().onRead([CHANNEL]));
  await settle();
  service.writes[0]?.settle({ readSeq: 0, reads: [{ channelId: CHANNEL, readSeq: 2 }] });
  await settle();
  service.push("acme", stale);
  await settle();
  assert.deepEqual(tab.control().chat?.reads, [{ channelId: CHANNEL, readSeq: 2 }]);
});

test("a burst of messages in the channel shown is read in the window as each lands and told to the service once, at the newest", async () => {
  vi.useFakeTimers();
  const service = scriptedService();
  const tab = mount(service, "acme", CHANNEL);
  const held: ChatMessage[] = [];
  for (let seq = 1; seq <= 5; seq += 1) {
    held.push(message(seq));
    service.push("acme", answered([...held]));
    await settle();
    assert.equal(tab.control().chat?.reads?.[0]?.readSeq, seq, "the window reads each as it lands");
  }
  assert.equal(service.writes.length, 0, "nothing is told while the burst runs");
  await pauseRunsOut();
  assert.deepEqual(
    service.writes.map((write) => write.params.write),
    [{ readTo: 5, channelId: CHANNEL }],
  );
});

test("a read still waiting on its pause is told to the workspace it was read in as another workspace is shown", async () => {
  vi.useFakeTimers();
  const service = scriptedService();
  const tab = mount(service, "acme", CHANNEL);
  service.push("acme", answered([message(1), message(2)]));
  await settle();
  assert.equal(service.writes.length, 0, "the pause is still running");
  tab.rerender({ workspaceId: "ledger", reading: undefined });
  await settle();
  assert.deepEqual(
    service.writes.map((write) => write.params),
    [{ workspaceId: "acme", write: { readTo: 2, channelId: CHANNEL } }],
  );
  await pauseRunsOut();
  assert.equal(service.writes.length, 1, "nothing is told twice");
});

test("a read still waiting on its pause as another account signs in is let go, never told as the new account's", async () => {
  vi.useFakeTimers();
  const service = scriptedService();
  const tab = mount(service, "acme", CHANNEL);
  service.push("acme", answered([message(1), message(2)]));
  await settle();
  tab.rerender({ workspaceId: "acme", reading: undefined, account: "ada@example.com" });
  await settle();
  await pauseRunsOut();
  assert.deepEqual(service.writes, []);
});
