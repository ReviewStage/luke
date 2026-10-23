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
import { MENTION_KIND, mentionMarkdown } from "@luke/features/mention-link";
import { TASK_SECTION_ICON_KIND, type TaskSectionIcon } from "@luke/features/task-section-wire";
import { test } from "vitest";
import {
  CHAT_RUN_SPAN,
  type ChatNames,
  channelLabel,
  channelThreads,
  chatKeywords,
  chatMentionables,
  chatRail,
  chatWho,
  continuesRun,
  FOR_YOU_REASON,
  firstUnreadSeq,
  forYou,
  messageMarkdown,
  postsIn,
  reachedIn,
  toldPastBound,
  topicName,
  topicNameProblem,
} from "./chat-model.js";

/** A section's icon, an emoji, as the sidebar's section wears it. */
const ROCKET: TaskSectionIcon = { kind: TASK_SECTION_ICON_KIND.EMOJI, emoji: "🚀" };

const ME = "00000000-0000-4000-8000-0000000000a1";
const AGENT = "00000000-0000-4000-8000-0000000000a2";
const HELPER = "00000000-0000-4000-8000-0000000000a3";
const MARIA = "00000000-0000-4000-8000-0000000000a4";
const AGENT_ID = "00000000-0000-4000-8000-0000000000b1";
const TASK_ID = "00000000-0000-4000-8000-0000000000c1";

const GENERAL: ChatChannel = {
  id: "general",
  kind: CHANNEL_KIND.GENERAL,
  name: "general",
  archived: false,
};
const TASK_CHANNEL: ChatChannel = {
  id: "plan",
  kind: CHANNEL_KIND.TASK,
  name: "invites",
  planId: TASK_ID,
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
  tasks: new Map([[TASK_ID, "Teammate invitations"]]),
  agentTasks: new Map([[AGENT_ID, TASK_ID]]),
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
      { id: ME, kind: MEMBER_KIND.HUMAN, name: "Dean", userId: "user-dean", left: false },
      { id: AGENT, kind: MEMBER_KIND.AGENT, agentId: AGENT_ID, left: false },
      { id: MARIA, kind: MEMBER_KIND.HUMAN, name: "Maria Chen", userId: "user-maria", left: false },
    ],
    channels: [WITH_AGENT, TOPIC, OLD, TASK_CHANNEL, WITH_MARIA, GENERAL],
    messages,
    cursor: String(readSeq),
  };
}

test("For you lists every open ask someone else posted, the oldest first, then each unread direct message and mention of the reader, the oldest first", () => {
  const chat = chatOf(5, [
    message(9, AGENT, TASK_CHANNEL.id, asking(ASK_STATUS.OPEN)),
    message(8, HELPER, TASK_CHANNEL.id, { mentions: [ME] }),
    message(7, AGENT, WITH_AGENT.id),
    message(6, AGENT, TASK_CHANNEL.id),
    // Read already, so neither the direct message nor the mention waits.
    message(4, AGENT, WITH_AGENT.id),
    message(3, HELPER, TASK_CHANNEL.id, { mentions: [ME] }),
    // An ask waits until it is answered, read or not, and the reader's own never does.
    message(2, AGENT, TASK_CHANNEL.id, asking(ASK_STATUS.OPEN)),
    message(10, ME, TASK_CHANNEL.id, asking(ASK_STATUS.OPEN)),
    message(11, AGENT, TASK_CHANNEL.id, asking(ASK_STATUS.ANSWERED)),
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

/** Every channel row the rail draws above the direct messages, in its order: the channels, then the tasks' groups. */
function placed(rail: ReturnType<typeof chatRail>) {
  return [...rail.channels, ...rail.tasks.flatMap((group) => group.rows)];
}

test("the rail counts For you, lists #general and the topics, then the tasks' channels, and the direct messages the latest spoken in first, each counting what others posted past the reader's cursor", () => {
  const chat = chatOf(3, [
    message(2, MARIA, WITH_MARIA.id),
    message(4, AGENT, WITH_AGENT.id),
    message(5, AGENT, TASK_CHANNEL.id),
    message(6, ME, TASK_CHANNEL.id),
    message(7, MARIA, TASK_CHANNEL.id, { parentId: "m5" }),
    message(1, MARIA, GENERAL.id),
  ]);
  const rail = chatRail(chat, NAMES);
  assert.equal(rail.forYou, 1);
  assert.deepEqual(
    placed(rail).map((row) => [row.label, row.unread]),
    [
      ["general", 0],
      ["alpha", 0],
      ["invites", 2],
    ],
  );
  assert.deepEqual(
    rail.direct.map((row) => [row.label, row.unread]),
    [
      ["Invite emails", 1],
      ["Maria Chen", 0],
    ],
  );
});

test("a channel read further on its own cursor counts only what came past that, and leaves every other channel counted from the cursor everywhere", () => {
  const chat = {
    ...chatOf(3, [
      message(4, AGENT, WITH_AGENT.id),
      message(5, AGENT, TASK_CHANNEL.id),
      message(6, MARIA, TASK_CHANNEL.id),
      message(7, MARIA, TASK_CHANNEL.id),
    ]),
    reads: [{ channelId: TASK_CHANNEL.id, readSeq: 6 }],
  };
  const rail = chatRail(chat, NAMES);
  assert.deepEqual(
    placed(rail).map((row) => [row.label, row.unread]),
    [
      ["general", 0],
      ["alpha", 0],
      ["invites", 1],
    ],
  );
  assert.deepEqual(
    rail.direct.map((row) => [row.label, row.unread]),
    [
      ["Invite emails", 1],
      ["Maria Chen", 0],
    ],
  );
});

test("a message changed past the reader's cursor counts unread again, as the service counts it, though it was posted before", () => {
  const chat = {
    ...chatOf(3, [
      message(2, AGENT, TASK_CHANNEL.id, { touchedSeq: 7 }),
      message(3, MARIA, TASK_CHANNEL.id),
    ]),
    reads: [{ channelId: TASK_CHANNEL.id, readSeq: 5 }],
  };
  const rail = chatRail(chat, NAMES);
  assert.equal(placed(rail).find((row) => row.label === "invites")?.unread, 1);
});

test("a channel reads as its roots in the order posted, each with its thread's replies under it, and a reply whose root was not read stands as a root", () => {
  const chat = chatOf(0, [
    message(3, MARIA, TASK_CHANNEL.id, { parentId: "m1" }),
    message(1, AGENT, TASK_CHANNEL.id),
    message(4, AGENT, TASK_CHANNEL.id, { parentId: "m-unread" }),
    message(2, HELPER, TASK_CHANNEL.id),
    message(5, AGENT, TASK_CHANNEL.id, { parentId: "m1" }),
    message(6, AGENT, GENERAL.id),
  ]);
  assert.deepEqual(
    channelThreads(chat, TASK_CHANNEL.id).map((thread) => [
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

test("a channel's New line stands before the first root someone else posted past the reader's cursor there, never before a reply, the reader's own, or an old message changed since", () => {
  const chat = {
    ...chatOf(2, [
      message(1, AGENT, TASK_CHANNEL.id, { touchedSeq: 9 }),
      message(4, AGENT, TASK_CHANNEL.id, { parentId: "m1" }),
      message(5, ME, TASK_CHANNEL.id),
      message(6, MARIA, TASK_CHANNEL.id),
      message(7, AGENT, TASK_CHANNEL.id),
      message(8, AGENT, GENERAL.id),
    ]),
    reads: [{ channelId: GENERAL.id, readSeq: 8 }],
  };
  assert.equal(firstUnreadSeq(chat, TASK_CHANNEL.id), 6);
  assert.equal(firstUnreadSeq(chat, GENERAL.id), undefined);
});

test("a message copies as Markdown, a block a paragraph: its words as written, a link by its label and address, a code block by its lines on GitHub, and no picture", () => {
  const copied = messageMarkdown(
    message(1, AGENT, TASK_CHANNEL.id, {
      blocks: [
        { type: CHAT_BLOCK.MARKDOWN, text: "See **this**" },
        { type: CHAT_BLOCK.IMAGE, attachmentId: "a1", alt: "the page" },
        { type: CHAT_BLOCK.LINK, url: "https://example.com/a_(b)", label: "PR [draft]" },
        {
          type: CHAT_BLOCK.CODE,
          repo: "acme/app",
          path: "src/a b.ts",
          startLine: 3,
          endLine: 5,
          sha: "0123456789abcdef0123456789abcdef01234567",
        },
      ],
    }),
  );
  assert.equal(
    copied,
    [
      "See **this**",
      "[PR \\[draft\\]](https://example.com/a_%28b%29)",
      "https://github.com/acme/app/blob/0123456789abcdef0123456789abcdef01234567/src/a%20b.ts#L3-L5",
    ].join("\n\n"),
  );
});

test("a root continues its author's run within five minutes of their last one, and a different author, a longer gap, or a thread between breaks it", () => {
  const root = (
    seq: number,
    authorId: string,
    postedAt: number,
    replies: readonly ChatMessage[] = [],
  ) => ({
    message: message(seq, authorId, TASK_CHANNEL.id, { postedAt }),
    replies,
  });
  const first = root(1, AGENT, 0);
  assert.equal(continuesRun(undefined, first), false);
  assert.equal(continuesRun(first, root(2, AGENT, CHAT_RUN_SPAN)), true);
  assert.equal(continuesRun(first, root(2, AGENT, CHAT_RUN_SPAN + 1)), false);
  assert.equal(continuesRun(first, root(2, MARIA, 1)), false);
  const threaded = root(1, AGENT, 0, [message(3, MARIA, TASK_CHANNEL.id, { parentId: "m1" })]);
  assert.equal(continuesRun(threaded, root(2, AGENT, 1)), false);
});

test("a line names an agent by its title, or by the name the read gave it, with its task, the reader by their own name, a person by theirs, and one whose agent or account is gone as former", () => {
  const chat = {
    ...chatOf(0, []),
    members: [
      ...chatOf(0, []).members,
      {
        id: HELPER,
        kind: MEMBER_KIND.AGENT,
        name: "Fix the flaky test",
        agentId: "00000000-0000-4000-8000-0000000000b3",
        planId: TASK_ID,
        left: false,
      },
      { id: "gone-agent", kind: MEMBER_KIND.AGENT, left: true },
      { id: "gone-person", kind: MEMBER_KIND.HUMAN, left: true },
    ],
  };
  assert.deepEqual(
    [AGENT, HELPER, ME, MARIA, "gone-agent", "gone-person"].map((id) => {
      const who = chatWho(chat, NAMES, id);
      return [who.name, who.taskName];
    }),
    [
      ["Invite emails", undefined],
      ["Fix the flaky test", "Teammate invitations"],
      ["Dean Stratakos", undefined],
      ["Maria Chen", undefined],
      ["Former agent", undefined],
      ["Former member", undefined],
    ],
  );
});

test("an agent with no title is named by its model's name, as its tab is, whether the window holds its line or only the id the read gives it", () => {
  const line = NAMES.agents.get(AGENT_ID);
  assert.ok(line);
  const untitled: ChatNames = {
    ...NAMES,
    agents: new Map([[AGENT_ID, { ...line, title: null, model: "anthropic/claude-opus-5.5" }]]),
  };
  assert.equal(chatWho(chatOf(0, []), untitled, AGENT).name, "Opus 5.5");
  const chat = {
    ...chatOf(0, []),
    members: [
      ...chatOf(0, []).members,
      { id: HELPER, kind: MEMBER_KIND.AGENT, name: "openai/gpt-6-astra", left: false },
    ],
  };
  assert.equal(chatWho(chat, NAMES, HELPER).name, "GPT 6 Astra");
  // A title holding a slash is no model's id, and is named as it was written.
  const titled = {
    ...chat,
    members: chat.members.map((member) =>
      member.id === HELPER ? { ...member, name: "UI/API" } : member,
    ),
  };
  assert.equal(chatWho(titled, NAMES, HELPER).name, "UI/API");
});

test("the reader posts in a standing channel and in a direct message of their own, never in an archived channel or a direct message between two others, which is named by both", () => {
  const between: ChatChannel = {
    id: "dm-others",
    kind: CHANNEL_KIND.DM,
    members: [AGENT, MARIA],
    archived: false,
  };
  const chat = { ...chatOf(0, []), channels: [GENERAL, OLD, WITH_MARIA, between] };
  assert.deepEqual(
    [GENERAL, OLD, WITH_MARIA, between].map((channel) => postsIn(chat, channel)),
    [true, false, true, false],
  );
  assert.deepEqual(
    [WITH_MARIA, between].map((channel) => channelLabel(chat, NAMES, channel)),
    ["Maria Chen", "Invite emails ↔ Maria Chen"],
  );
});

test("nothing in a direct message between two others waits on the reader, neither an open ask nor an unread line", () => {
  const between: ChatChannel = {
    id: "dm-others",
    kind: CHANNEL_KIND.DM,
    members: [AGENT, MARIA],
    archived: false,
  };
  const chat = {
    ...chatOf(0, [
      message(1, AGENT, between.id, asking(ASK_STATUS.OPEN)),
      message(2, MARIA, between.id),
      message(3, MARIA, WITH_MARIA.id),
    ]),
    channels: [WITH_MARIA, between],
  };
  assert.deepEqual(
    forYou(chat).map((entry) => entry.message.seq),
    [3],
  );
});

test("a dictation in the chat listens for every person still here by name, each agent's title, and each standing channel's name, once each", () => {
  const chat = {
    ...chatOf(0, []),
    members: [
      ...chatOf(0, []).members,
      { id: "gone", kind: MEMBER_KIND.HUMAN, name: "Gone Person", left: true },
    ],
  };
  const words = chatKeywords(chat, NAMES);
  assert.deepEqual(
    ["Dean", "Maria Chen", "Invite emails", "general", "invites", "alpha"].filter(
      (word) => !words.includes(word),
    ),
    [],
  );
  assert.equal(words.includes("Gone Person"), false, "a member who left is not listened for");
  assert.equal(words.includes("aardvark"), false, "an archived channel is not");
  assert.equal(new Set(words).size, words.length, "each word once");
});

test("every member but the reader is offered by name, a person by their account and an agent by its id under its task, and every standing channel that is no DM", () => {
  const chat = {
    ...chatOf(0, []),
    members: [
      ...chatOf(0, []).members.map((member) =>
        member.id === AGENT ? { ...member, planId: TASK_ID } : member,
      ),
      { id: HELPER, kind: MEMBER_KIND.HUMAN, name: "Gone Person", userId: "user-gone", left: true },
    ],
  };
  const offered = chatMentionables(chat, NAMES);
  assert.deepEqual(offered.people, [{ memberId: MARIA, userId: "user-maria", name: "Maria Chen" }]);
  assert.deepEqual(offered.agents, [
    {
      memberId: AGENT,
      agentId: AGENT_ID,
      name: "Invite emails",
      task: { id: TASK_ID, name: "Teammate invitations" },
    },
  ]);
  assert.deepEqual(
    offered.channels.map((channel) => [channel.name, channel.taskId, channel.detail]),
    [
      ["alpha", undefined, undefined],
      ["invites", TASK_ID, "Teammate invitations"],
      ["general", undefined, undefined],
    ],
  );
});

test("a composer offers only the members a post in its channel reaches: its task's agent in the task's channel, people alone in the general one and a topic, and a DM's own two", () => {
  const chat = {
    ...chatOf(0, []),
    members: chatOf(0, []).members.map((member) =>
      member.id === AGENT ? { ...member, planId: TASK_ID } : member,
    ),
  };
  const offered = (channel: ChatChannel) => {
    const { people, agents } = chatMentionables(chat, NAMES, channel);
    return [...agents, ...people].map((member) => member.name);
  };
  assert.deepEqual(offered(TASK_CHANNEL), ["Invite emails", "Maria Chen"]);
  assert.deepEqual(offered(GENERAL), ["Maria Chen"]);
  assert.deepEqual(offered(TOPIC), ["Maria Chen"]);
  assert.deepEqual(offered(WITH_AGENT), ["Invite emails"]);
  // An agent on no task is reached in the general channel, where it talks.
  const taskless = chat.members.find((member) => member.id === AGENT);
  assert.ok(taskless !== undefined);
  const { planId: _planId, ...noTask } = taskless;
  assert.equal(reachedIn(noTask, GENERAL), true);
  assert.equal(reachedIn(noTask, TASK_CHANNEL), false);
});

test("a post addresses more members than it tells only past the bound, each member it reaches counted once and the reader not at all, a reply's thread counted after its mentions, and never in a direct message", () => {
  const more = ["Ada", "Bo", "Cy"].map((name) => ({
    id: `member-${name}`,
    kind: MEMBER_KIND.HUMAN,
    name,
    userId: `user-${name}`,
    left: false,
  }));
  const chat = { ...chatOf(0, []), members: [...chatOf(0, []).members, ...more] };
  const place = { workspace: "acme", repository: null };
  const person = (userId: string, name: string) =>
    mentionMarkdown({ kind: MENTION_KIND.PERSON, userId }, name, place);
  const three = [
    person("user-maria", "Maria Chen"),
    person("user-Ada", "Ada"),
    person("user-Bo", "Bo"),
  ].join(" ");
  const agent = mentionMarkdown(
    { kind: MENTION_KIND.AGENT, agentId: AGENT_ID },
    "Invite emails",
    place,
  );
  assert.equal(
    toldPastBound(chat, GENERAL, `${three} ${person("user-dean", "Dean")} ${three}`),
    false,
    "the reader, and a member named again, add no one",
  );
  assert.equal(toldPastBound(chat, GENERAL, `${three} ${person("user-Cy", "Cy")}`), true);
  assert.equal(
    toldPastBound(chat, TOPIC, `${three} ${agent}`),
    false,
    "an agent a topic does not reach is told nothing there",
  );
  assert.equal(
    toldPastBound(chat, WITH_MARIA, `${three} ${person("user-Cy", "Cy")}`),
    false,
    "a direct message tells its other member alone",
  );
  assert.equal(
    toldPastBound(chat, GENERAL, three, [MARIA, ME]),
    false,
    "a thread's author already mentioned, and the reader, add no one",
  );
  assert.equal(
    toldPastBound(chat, GENERAL, three, ["member-Cy"]),
    true,
    "a thread's replier past three mentions is not told",
  );
});

test("a topic's name is written as a channel's, and refused where it breaks the grammar or another channel, general among them, holds it", () => {
  const chat = chatOf(0, []);
  assert.equal(topicName("  Release Train  "), "release-train");
  assert.deepEqual(
    ["", "-dash", "ok.name_1", "general", "alpha", "x".repeat(81)].map(
      (name) => topicNameProblem(chat, name, undefined) === undefined,
    ),
    [false, false, true, false, false, false],
  );
  assert.equal(topicNameProblem(chat, "alpha", TOPIC.id), undefined, "a topic keeps its own name");
});

test("the tasks' channels stand as the sidebar groups their tasks: pinned in the pins' order, each section in its order, the rest under Tasks, each section wearing its own icon; and the archived channels apart", () => {
  const task = (id: string, name: string, archived = false): ChatChannel => ({
    id: `channel-${id}`,
    kind: CHANNEL_KIND.TASK,
    name,
    planId: id,
    archived,
  });
  const chat = {
    ...chatOf(0, []),
    channels: [
      GENERAL,
      TOPIC,
      OLD,
      task("t1", "billing"),
      task("t2", "invites"),
      task("t3", "schema"),
      task("t4", "zeta"),
      task("t5", "gone", true),
    ],
  };
  const grouped = chatRail(chat, NAMES, {
    pinned: ["t3"],
    sections: [{ id: "launch", title: "Launch", icon: ROCKET, taskIds: ["t2", "t3", "t1"] }],
  });
  assert.deepEqual(
    grouped.tasks.map((group) => [group.title, group.icon, group.rows.map((row) => row.label)]),
    [
      ["Pinned", undefined, ["schema"]],
      ["Launch", ROCKET, ["invites", "billing"]],
      ["Tasks", undefined, ["zeta"]],
    ],
  );
  assert.deepEqual(
    grouped.archived.map((row) => row.label),
    ["gone", "aardvark"],
  );
  const flat = chatRail(chat, NAMES);
  assert.deepEqual(
    flat.tasks.map((group) => [group.title, group.rows.length]),
    [["Tasks", 4]],
  );
});

/** A number written in three digits, so names sort as their numbers do. */
const three = (at: number) => String(at).padStart(3, "0");

/**
 * A workspace's chat at the size the service holds one at: 400 people, 100
 * agents on 50 tasks, 60 topics named out of order, 10 archived, 50 tasks'
 * channels, and 120 direct messages, each holding a message or a few, some
 * past the reader's cursor of 1000.
 */
function crowdedChat() {
  const people = Array.from({ length: 400 }, (_, at) => ({
    id: `person-${three(at)}`,
    kind: MEMBER_KIND.HUMAN,
    name: `Person ${three(at)}`,
    userId: `user-${three(at)}`,
    // Every tenth person has left the workspace.
    left: at % 10 === 9,
  }));
  const agents = Array.from({ length: 100 }, (_, at) => ({
    id: `agent-member-${three(at)}`,
    kind: MEMBER_KIND.AGENT,
    name: `Agent ${three(at)}`,
    agentId: `agent-${three(at)}`,
    planId: `task-${three(at % 50)}`,
    left: false,
  }));
  // Note that the topics are listed in a scrambled order, so the rail's order is its own sort.
  const topics: ChatChannel[] = Array.from({ length: 70 }, (_, at) => {
    const named = (at * 37) % 70;
    return {
      id: `topic-${three(named)}`,
      kind: CHANNEL_KIND.TOPIC,
      name: `topic-${three(named)}`,
      archived: named >= 60,
    };
  });
  const tasks: ChatChannel[] = Array.from({ length: 50 }, (_, at) => ({
    id: `task-channel-${three(at)}`,
    kind: CHANNEL_KIND.TASK,
    name: `plan-${three((at * 7) % 50)}`,
    planId: `task-${three(49 - at)}`,
    archived: false,
  }));
  const direct: ChatChannel[] = Array.from({ length: 120 }, (_, at) => ({
    id: `dm-${three(at)}`,
    kind: CHANNEL_KIND.DM,
    members: [ME, `person-${three(at)}`],
    archived: false,
  }));
  // Each direct message's one message is posted in a scrambled order, its seq telling which was spoken in last.
  const said = direct.map((channel, at) =>
    message(1 + ((at * 53) % 120), `person-${three(at)}`, channel.id),
  );
  // Topic n holds n % 4 messages, each from a person, seqs past the reader's cursor for an odd topic.
  const talk = topics.flatMap((channel, at) =>
    Array.from({ length: at % 4 }, (_, each) =>
      message((at % 2 === 1 ? 2000 : 500) + at * 4 + each, `person-${three(each)}`, channel.id),
    ),
  );
  const names: ChatNames = {
    ...NAMES,
    tasks: new Map(tasks.map((channel, at) => [channel.planId ?? "", `Task ${three(49 - at)}`])),
  };
  const chat: ChatAnswer = {
    self: ME,
    readSeq: 1000,
    members: [
      { id: ME, kind: MEMBER_KIND.HUMAN, name: "Dean", userId: "user-dean", left: false },
      ...people,
      ...agents,
    ],
    channels: [GENERAL, ...topics, ...tasks, ...direct],
    messages: [...said, ...talk],
    cursor: "1000",
  };
  return { chat, names, people, agents, topics, direct, said };
}

test("over a workspace of hundreds of members and channels, the rail lists #general and the topics by name, the tasks' channels by name, the archived apart, and the direct messages the latest spoken in first, each counting its unread", () => {
  const { chat, names, topics, direct, said } = crowdedChat();
  const rail = chatRail(chat, names);
  const standing = topics.filter((channel) => !channel.archived);
  assert.deepEqual(
    rail.channels.map((row) => row.label),
    ["general", ...Array.from({ length: 60 }, (_, at) => `topic-${three(at)}`)],
  );
  assert.deepEqual(
    rail.tasks.map((group) => [group.title, group.rows.map((row) => row.label)]),
    [["Tasks", Array.from({ length: 50 }, (_, at) => `plan-${three(at)}`)]],
  );
  assert.deepEqual(
    rail.archived.map((row) => row.label),
    Array.from({ length: 10 }, (_, at) => `topic-${three(60 + at)}`),
  );
  // The direct message whose message has the highest seq is spoken in last, so it leads.
  const latestFirst = direct
    .map((channel, at) => ({ id: channel.id, seq: said[at]?.seq ?? 0 }))
    .toSorted((one, other) => other.seq - one.seq)
    .map((each) => each.id);
  assert.deepEqual(
    rail.direct.map((row) => row.channel.id),
    latestFirst,
  );
  assert.equal(
    rail.direct[0]?.label,
    "Person 043",
    "43 × 53 is 119 past a multiple of 120, the highest seq",
  );
  // A direct message's one message predates the cursor, so none is unread; an odd topic's messages all are.
  assert.ok(rail.direct.every((row) => row.unread === 0));
  const unread = new Map(rail.channels.map((row) => [row.channel.id, row.unread]));
  for (const [at, channel] of topics.entries()) {
    if (channel.archived) continue;
    assert.equal(unread.get(channel.id), at % 2 === 1 ? at % 4 : 0, channel.id);
  }
  assert.equal(standing.length, 60);
  assert.equal(rail.forYou, 0);
});

test("over a workspace of hundreds of members, a task's channel offers every person still here and that task's agents alone, the general channel the people alone, each by name in the roster's order", () => {
  const { chat, names, people, agents } = crowdedChat();
  const here = people.filter((person) => !person.left);
  const inTask = chat.channels.find((channel) => channel.id === "task-channel-000");
  assert.ok(inTask?.planId === "task-049");
  const offered = chatMentionables(chat, names, inTask);
  assert.deepEqual(
    offered.people.map((person) => person.name),
    here.map((person) => person.name),
  );
  assert.deepEqual(
    offered.agents.map((agent) => [agent.name, agent.task]),
    agents
      .filter((agent) => agent.planId === "task-049")
      .map((agent) => [agent.name, { id: "task-049", name: "Task 049" }]),
  );
  const general = chatMentionables(chat, names, GENERAL);
  assert.equal(general.people.length, here.length);
  assert.deepEqual(general.agents, []);
  // Every standing channel that is no DM is offered by `#`: #general, 60 topics, and 50 tasks'.
  assert.equal(general.channels.length, 111);
});
