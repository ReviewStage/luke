import assert from "node:assert/strict";
import {
  ASK_STATUS,
  CHANNEL_KIND,
  CHAT_ASK,
  CHAT_BLOCK,
  type ChatAnswer,
  type ChatChannel,
  type ChatMessage,
  MEMBER_KIND,
} from "@luke/features/chat-wire";
import { CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import { test } from "vitest";
import {
  type ChatNames,
  channelThreads,
  chatRail,
  chatWho,
  FOR_YOU_REASON,
  forYou,
} from "./chat-model.js";

const ME = "00000000-0000-4000-8000-0000000000a1";
const AGENT = "00000000-0000-4000-8000-0000000000a2";
const LUKE = "00000000-0000-4000-8000-0000000000a3";
const MARIA = "00000000-0000-4000-8000-0000000000a4";
const AGENT_ID = "00000000-0000-4000-8000-0000000000b1";
const PLAN_ID = "00000000-0000-4000-8000-0000000000c1";

const GENERAL: ChatChannel = {
  id: "general",
  kind: CHANNEL_KIND.GENERAL,
  name: "general",
  archived: false,
};
const PLAN: ChatChannel = {
  id: "plan",
  kind: CHANNEL_KIND.PLAN,
  name: "invites",
  planId: PLAN_ID,
  archived: false,
};
const TOPIC: ChatChannel = {
  id: "topic",
  kind: CHANNEL_KIND.TOPIC,
  name: "alpha",
  archived: false,
};
const OLD: ChatChannel = { id: "old", kind: CHANNEL_KIND.TOPIC, name: "aardvark", archived: true };
const WITH_AGENT: ChatChannel = {
  id: "dm-agent",
  kind: CHANNEL_KIND.DM,
  members: [ME, AGENT],
  archived: false,
};
const WITH_MARIA: ChatChannel = {
  id: "dm-maria",
  kind: CHANNEL_KIND.DM,
  members: [MARIA, ME],
  archived: false,
};

const NAMES: ChatNames = {
  agents: new Map([
    [
      AGENT_ID,
      {
        id: AGENT_ID,
        title: "Invite emails",
        model: "openai/gpt-6-astra",
        effort: "high",
        status: CODING_AGENT_STATUS.RUNNING,
      },
    ],
  ]),
  plans: new Map([[PLAN_ID, "Teammate invitations"]]),
  selfName: "Dean Stratakos",
};

/** A message of words, posted at `seq` by `authorId` in `channelId`. */
function message(
  seq: number,
  authorId: string,
  channelId: string,
  more: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id: `m${seq}`,
    seq,
    touchedSeq: seq,
    channelId,
    authorId,
    blocks: [{ type: CHAT_BLOCK.MARKDOWN, text: `message ${seq}` }],
    mentions: [],
    postedAt: seq,
    ...more,
  };
}

/** An ask of the approval kind, standing as `status`. */
function asking(status: (typeof ASK_STATUS)[keyof typeof ASK_STATUS]) {
  return {
    ask: {
      key: "k",
      revision: 1,
      status,
      response: { type: CHAT_ASK.APPROVAL },
      needsReply: true,
    },
  } as const;
}

/** A chat read up to `readSeq`, holding the channels and messages given. */
function chatOf(readSeq: number, messages: readonly ChatMessage[]): ChatAnswer {
  return {
    self: ME,
    readSeq,
    members: [
      { id: ME, kind: MEMBER_KIND.HUMAN, handle: "dean", left: false },
      { id: AGENT, kind: MEMBER_KIND.AGENT, handle: "agent-2", agentId: AGENT_ID, left: false },
      { id: LUKE, kind: MEMBER_KIND.PLANNER, handle: "luke", planId: PLAN_ID, left: false },
      { id: MARIA, kind: MEMBER_KIND.HUMAN, handle: "maria", left: false },
    ],
    channels: [WITH_AGENT, TOPIC, OLD, PLAN, WITH_MARIA, GENERAL],
    messages,
    cursor: String(readSeq),
  };
}

test("For you lists every open ask someone else posted, the oldest first, then each unread direct message and mention of the reader, the oldest first", () => {
  const chat = chatOf(5, [
    message(9, AGENT, PLAN.id, asking(ASK_STATUS.OPEN)),
    message(8, LUKE, PLAN.id, { mentions: [ME] }),
    message(7, AGENT, WITH_AGENT.id),
    message(6, AGENT, PLAN.id),
    // Read already, so neither the direct message nor the mention waits.
    message(4, AGENT, WITH_AGENT.id),
    message(3, LUKE, PLAN.id, { mentions: [ME] }),
    // An ask waits until it is answered, read or not, and the reader's own never does.
    message(2, AGENT, PLAN.id, asking(ASK_STATUS.OPEN)),
    message(10, ME, PLAN.id, asking(ASK_STATUS.OPEN)),
    message(11, AGENT, PLAN.id, asking(ASK_STATUS.ANSWERED)),
    // A message in an archived channel waits nowhere.
    message(12, AGENT, OLD.id, { mentions: [ME] }),
  ]);
  assert.deepEqual(
    forYou(chat).map((entry) => [entry.message.seq, entry.reason]),
    [
      [2, FOR_YOU_REASON.ASK],
      [9, FOR_YOU_REASON.ASK],
      [7, FOR_YOU_REASON.DIRECT],
      [8, FOR_YOU_REASON.MENTION],
    ],
  );
});

test("the rail counts For you, lists #general, then the plans' channels, then the topics, and the direct messages the latest spoken in first, each counting what others posted past the reader's cursor", () => {
  const chat = chatOf(3, [
    message(2, MARIA, WITH_MARIA.id),
    message(4, AGENT, WITH_AGENT.id),
    message(5, AGENT, PLAN.id),
    message(6, ME, PLAN.id),
    message(7, MARIA, PLAN.id, { parentId: "m5" }),
    message(1, MARIA, GENERAL.id),
  ]);
  const rail = chatRail(chat, NAMES);
  assert.equal(rail.forYou, 1);
  assert.deepEqual(
    rail.channels.map((row) => [row.label, row.unread]),
    [
      ["general", 0],
      ["invites", 2],
      ["alpha", 0],
    ],
  );
  assert.deepEqual(
    rail.direct.map((row) => [row.label, row.sub, row.unread]),
    [
      ["agent-2", "Invite emails", 1],
      ["maria", undefined, 0],
    ],
  );
});

test("a channel read further on its own cursor counts only what came past that, and leaves every other channel counted from the cursor everywhere", () => {
  const chat = {
    ...chatOf(3, [
      message(4, AGENT, WITH_AGENT.id),
      message(5, AGENT, PLAN.id),
      message(6, MARIA, PLAN.id),
      message(7, MARIA, PLAN.id),
    ]),
    reads: [{ channelId: PLAN.id, readSeq: 6 }],
  };
  const rail = chatRail(chat, NAMES);
  assert.deepEqual(
    rail.channels.map((row) => [row.label, row.unread]),
    [
      ["general", 0],
      ["invites", 1],
      ["alpha", 0],
    ],
  );
  assert.deepEqual(
    rail.direct.map((row) => [row.label, row.unread]),
    [
      ["agent-2", 1],
      ["maria", 0],
    ],
  );
});

test("a message changed past the reader's cursor counts unread again, as the service counts it, though it was posted before", () => {
  const chat = {
    ...chatOf(3, [message(2, AGENT, PLAN.id, { touchedSeq: 7 }), message(3, MARIA, PLAN.id)]),
    reads: [{ channelId: PLAN.id, readSeq: 5 }],
  };
  const rail = chatRail(chat, NAMES);
  assert.equal(rail.channels.find((row) => row.label === "invites")?.unread, 1);
});

test("a channel reads as its roots in the order posted, each with its thread's replies under it, and a reply whose root was not read stands as a root", () => {
  const chat = chatOf(0, [
    message(3, MARIA, PLAN.id, { parentId: "m1" }),
    message(1, AGENT, PLAN.id),
    message(4, AGENT, PLAN.id, { parentId: "m-unread" }),
    message(2, LUKE, PLAN.id),
    message(5, AGENT, PLAN.id, { parentId: "m1" }),
    message(6, AGENT, GENERAL.id),
  ]);
  assert.deepEqual(
    channelThreads(chat, PLAN.id).map((thread) => [
      thread.message.seq,
      thread.replies.map((reply) => reply.seq),
    ]),
    [
      [1, [3, 5]],
      [2, []],
      [4, []],
    ],
  );
});

test("a line names an agent by its title, a plan's planner as Luke, the reader by their own name, and anyone else by their handle", () => {
  const chat = chatOf(0, []);
  assert.deepEqual(
    [AGENT, LUKE, ME, MARIA].map((id) => {
      const who = chatWho(chat, NAMES, id);
      return [who.name, who.handle, who.planName];
    }),
    [
      ["Invite emails", "agent-2", undefined],
      ["Luke", "luke", "Teammate invitations"],
      ["Dean Stratakos", "dean", undefined],
      ["maria", "maria", undefined],
    ],
  );
});
