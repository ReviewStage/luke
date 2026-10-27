import assert from "node:assert/strict";
import type { Channel, ChannelThread } from "@luke/features/channel-wire";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
  type InboxMessage,
} from "@luke/features/inbox-wire";
import { test } from "vitest";
import {
  CHANNEL_SHOWN,
  CHANNEL_VIEW,
  channelShown,
  channelSlug,
  channelUnread,
  ownsThread,
  repliesLine,
  STREAM_ROW,
  streamRows,
  viewedThreads,
} from "./channels-model.js";

/**
 * channels-model.test.ts -- a channel's stream as its views list it: Mine
 * holds the reader's own threads and Needs me only open asks waiting on
 * them, a thread being owned by its task's assignee, else its agent's
 * starter, never its task's creator; the stream divides its days and draws the New line before the first
 * thread someone else posted since the reader looked; a post's replies line
 * says who replied and who the ask waits on; a typed name is written as a
 * channel's; the stream opens on #general where none is chosen and says a
 * channel chosen that stands no more is gone; ⌥↑ and ⌥↓ walk the channels
 * in the sidebar's order, wrapping round; and a channel reads unread while
 * something was posted since the reader looked.
 */

const ME = { userId: "user-me", name: "Me Reader" } as const;
const MATE = { userId: "user-mate", name: "Mate Teammate" } as const;
const CHANNEL_ID = "00000000-0000-4000-8000-0000000000c1";

/** Noon on the 20th of October 2026, in the reader's own time zone, which the stream's days are counted in. */
const NOON = new Date(2026, 9, 20, 12).getTime();
const HOUR = 60 * 60 * 1000;

function agentAsks(id: string, open: boolean): InboxMessage {
  return {
    id,
    author: INBOX_MESSAGE_AUTHOR.AGENT,
    text: "Which one?",
    ask: {
      type: INBOX_ASK.DECIDE,
      options: [{ label: "This" }, { label: "That" }],
      status: open ? INBOX_ASK_STATUS.OPEN : INBOX_ASK_STATUS.ANSWERED,
    },
    createdAt: NOON,
  };
}

function said(
  id: string,
  member: { readonly userId: string; readonly name: string } | undefined,
  text = "Noted",
): InboxMessage {
  return member === undefined
    ? { id, author: INBOX_MESSAGE_AUTHOR.AGENT, text, createdAt: NOON }
    : { id, author: INBOX_MESSAGE_AUTHOR.MEMBER, member, text, createdAt: NOON };
}

function thread(
  id: string,
  postedAt: number,
  messages: readonly InboxMessage[],
  standing: Partial<ChannelThread> = {},
): ChannelThread {
  return {
    id,
    agentId: "00000000-0000-4000-8000-0000000000a1",
    key: id,
    revision: 1,
    version: 5,
    title: `Thread ${id}`,
    needsReply: false,
    status: INBOX_STATUS.OPEN,
    startedBy: MATE,
    waitsOn: MATE,
    thread: messages,
    postedAt,
    updatedAt: postedAt,
    channelId: CHANNEL_ID,
    ...standing,
  };
}

test("Mine lists the reader's own threads and Needs me only the open asks waiting on them", () => {
  const asksMe = thread("asks-me", NOON, [agentAsks("m1", true)], { waitsOn: ME });
  const answeredMine = thread("answered", NOON, [agentAsks("m2", false)], {
    waitsOn: ME,
    status: INBOX_STATUS.ANSWERED,
  });
  const ownTask = thread("own-task", NOON, [said("m3", undefined)]);
  const wroteIn = thread("wrote-in", NOON, [said("m4", undefined), said("m5", ME)]);
  const matesAsk = thread("mates-ask", NOON, [agentAsks("m6", true)]);
  // A notice waiting on a nod, an ask withdrawn, and one standing on a thread no longer open ask nothing of anyone.
  const noticeForMe = thread("notice", NOON, [said("m7", undefined)], { waitsOn: ME });
  const doForMe = thread(
    "do",
    NOON,
    [
      {
        ...said("m8", undefined),
        ask: { type: INBOX_ASK.DO, steps: [], status: INBOX_ASK_STATUS.OPEN },
      },
    ],
    { waitsOn: ME },
  );
  const withdrawn = thread(
    "withdrawn",
    NOON,
    [
      {
        ...agentAsks("m9", true),
        ask: {
          type: INBOX_ASK.DECIDE,
          options: [{ label: "This" }],
          status: INBOX_ASK_STATUS.WITHDRAWN,
        },
      },
    ],
    { waitsOn: ME, status: INBOX_STATUS.CLOSED },
  );
  const settledOverAsk = thread("settled-over-ask", NOON, [agentAsks("m10", true)], {
    waitsOn: ME,
    status: INBOX_STATUS.ANSWERED,
  });
  const all = [
    asksMe,
    answeredMine,
    ownTask,
    wroteIn,
    matesAsk,
    noticeForMe,
    doForMe,
    withdrawn,
    settledOverAsk,
  ];
  const ids = (view: (typeof CHANNEL_VIEW)[keyof typeof CHANNEL_VIEW]) =>
    viewedThreads(all, view, ME.userId, (each) => each.id === "own-task").map(({ id }) => id);

  assert.deepEqual(ids(CHANNEL_VIEW.MINE), ["asks-me", "own-task", "wrote-in", "do"]);
  assert.deepEqual(ids(CHANNEL_VIEW.NEEDS_ME), ["asks-me", "do"]);
  assert.deepEqual(
    ids(CHANNEL_VIEW.EVERYONE),
    all.map(({ id }) => id),
  );
});

test("a thread is its task's assignee's, else its agent's starter's, never that of whoever made the task or started its agent", () => {
  const startedByMe = thread("started-by-me", NOON, [said("o1", undefined)], {
    startedBy: ME,
    waitsOn: MATE,
  });

  // Assigned to a teammate since the reader started its agent: the teammate's, not the reader's.
  assert.equal(ownsThread(ME.userId, startedByMe, { assignee: MATE }), false);
  assert.equal(ownsThread(MATE.userId, startedByMe, { assignee: MATE }), true);
  // Nobody assigned: its starter's.
  assert.equal(ownsThread(ME.userId, startedByMe, {}), true);
  // Its task unread by the Inbox: whom the service says it waits on.
  assert.equal(ownsThread(ME.userId, startedByMe, undefined), false);
});

test("the stream runs by latest activity, a divider before each day a thread last moved on, the New line before the first thread someone else moved since the reader looked", () => {
  const yesterday = thread("yesterday", NOON - 24 * HOUR, [said("y", undefined)]);
  const seen = thread("seen", NOON - 3 * HOUR, [said("s", undefined)]);
  const mine = thread("mine-after", NOON - HOUR, [said("o", ME)]);
  // Posted two days ago, and a teammate replied half an hour ago.
  const revived = thread("revived", NOON - 48 * HOUR, [said("r", undefined), said("rr", MATE)], {
    updatedAt: NOON - HOUR / 2,
  });
  const fresh = thread("fresh", NOON, [said("f", undefined)]);
  // The reader replied before they looked, and the agent closed it since, which writes no message.
  const closed = thread(
    "closed",
    NOON - 4 * HOUR,
    [said("c", undefined), { ...said("cr", ME), createdAt: NOON - 3 * HOUR }],
    { status: INBOX_STATUS.CLOSED, updatedAt: NOON - 90 * 60 * 1000 },
  );
  const rows = streamRows([fresh, revived, closed, seen, mine, yesterday], {
    lookedAt: NOON - 2 * HOUR,
    readerId: ME.userId,
    now: NOON + HOUR,
  });

  assert.deepEqual(
    rows.map((row) =>
      row.kind === STREAM_ROW.THREAD
        ? row.thread.id
        : row.kind === STREAM_ROW.DAY
          ? row.words
          : "New",
    ),
    ["Yesterday", "yesterday", "Today", "seen", "New", "closed", "mine-after", "revived", "fresh"],
  );
  assert.equal(
    streamRows([fresh], { lookedAt: undefined, readerId: ME.userId, now: NOON }).some(
      (row) => row.kind === STREAM_ROW.NEW,
    ),
    false,
    "a channel never looked at draws no New line",
  );
});

test("the replies line counts every reply, shows each replier once, and says who the open ask waits on", () => {
  const asking = thread(
    "asking",
    NOON,
    [agentAsks("a", true), said("b", MATE), said("c", undefined), said("d", MATE)],
    { waitsOn: ME },
  );
  const line = repliesLine(asking, ME.userId);
  assert.equal(line.words, "3 replies");
  assert.deepEqual(
    line.repliers.map(({ id }) => id),
    ["b", "c"],
  );
  assert.equal(line.waiting, "Waiting on you");
  assert.equal(repliesLine(asking, MATE.userId).waiting, "Waiting on Me Reader");

  const quiet = repliesLine(thread("quiet", NOON, [said("q", undefined)]), ME.userId);
  assert.deepEqual(quiet, { repliers: [], words: "Reply in thread", waiting: undefined });
});

test("a typed name is written as a channel's", () => {
  assert.equal(channelSlug("  Release Train!  v2 "), "release-train-v2");
});

/** A channel of the workspace, standing or a project's. */
function channelOf(id: string, name: string, project = false): Channel {
  return { id, name, purpose: "A purpose", project, createdAt: NOON, waiting: 0 };
}

test("the stream opens on the channel chosen while it stands, on none where none is chosen, and says a channel chosen that stands no more is gone", () => {
  const app = channelOf("c-app", "app");
  const general = channelOf("c-general", "general");
  assert.deepEqual(channelShown([app, general], "c-app"), {
    kind: CHANNEL_SHOWN.CHANNEL,
    channel: app,
  });
  assert.deepEqual(channelShown([app, general], undefined), { kind: CHANNEL_SHOWN.NONE });
  assert.deepEqual(channelShown([app, general], "c-archived"), { kind: CHANNEL_SHOWN.MISSING });
  assert.deepEqual(channelShown(undefined, "c-app"), { kind: CHANNEL_SHOWN.NONE });
});

test("a channel chosen among the archived ones is shown to read, and one neither open nor archived is gone", () => {
  const general = channelOf("c-general", "general");
  const old = { ...channelOf("c-old", "old-app"), archivedAt: NOON };
  assert.deepEqual(channelShown([general], "c-old", [old]), {
    kind: CHANNEL_SHOWN.ARCHIVED,
    channel: old,
  });
  assert.deepEqual(channelShown([general], "c-unknown", [old]), { kind: CHANNEL_SHOWN.MISSING });
});

test("a channel reads unread once something is posted after the reader's look, or where they never looked at one holding a thread", () => {
  const channel = (seen: Partial<Channel>): Channel => ({
    id: "c-app",
    name: "app",
    purpose: "A purpose",
    project: false,
    createdAt: NOON,
    waiting: 0,
    ...seen,
  });
  assert.equal(channelUnread(channel({ lookedAt: NOON, latestPostedAt: NOON + HOUR })), true);
  assert.equal(channelUnread(channel({ lookedAt: NOON + HOUR, latestPostedAt: NOON })), false);
  assert.equal(channelUnread(channel({ latestPostedAt: NOON })), true);
  assert.equal(channelUnread(channel({})), false);
});
