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
  CHANNEL_VIEW,
  channelSlug,
  repliesLine,
  STREAM_ROW,
  shownChannel,
  streamRows,
  viewedThreads,
} from "./channels-model.js";

/**
 * channels-model.test.ts -- a channel's stream as its views list it: Mine
 * holds the reader's own threads and Needs me only open asks waiting on
 * them; the stream divides its days and draws the New line before the first
 * thread someone else posted since the reader looked; a post's replies line
 * says who replied and who the ask waits on; a typed name is written as a
 * channel's; and the stream opens on #general where none is chosen.
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

test("the stream runs oldest first, a divider before each day, the New line before the first thread someone else posted since the reader looked", () => {
  const yesterday = thread("yesterday", NOON - 24 * HOUR, [said("y", undefined)]);
  const seen = thread("seen", NOON - 3 * HOUR, [said("s", undefined)]);
  const mine = thread("mine-after", NOON - HOUR, [said("o", ME)]);
  const fresh = thread("fresh", NOON, [said("f", undefined)]);
  const rows = streamRows([fresh, seen, mine, yesterday], {
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
    ["Yesterday", "yesterday", "Today", "seen", "mine-after", "New", "fresh"],
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

test("the stream opens on the channel chosen while it stands, else on #general", () => {
  const channel = (id: string, name: string): Channel => ({
    id,
    name,
    purpose: "A purpose",
    project: false,
    createdAt: NOON,
    waiting: 0,
  });
  const app = channel("c-app", "app");
  const general = channel("c-general", "general");
  assert.equal(shownChannel([app, general], "c-app"), app);
  assert.equal(shownChannel([app, general], "c-archived"), general);
  assert.equal(shownChannel([app, general], undefined), general);
});
