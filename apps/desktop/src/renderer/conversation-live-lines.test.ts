import assert from "node:assert/strict";
import {
  CONVERSATION_ENTRY_KIND,
  CONVERSATION_VIEW_SOURCE,
  type ConversationViewMessage,
  type ConversationViewSnapshot,
  type LiveConversationLine,
} from "@sidecar/session";
import type { StoredUIMessage } from "@sidecar/session/ui-messages";
import { MESSAGE_AUTHOR, MESSAGE_CHANNEL, MESSAGE_ROLE, type MessageRole } from "@sidecar/wire";
import { test } from "vitest";
import { foldLiveLines, NO_LIVE_LINES, shownLiveEntries } from "./conversation-live-lines";

/**
 * The hand-off from a line still being said to its row on record, driven by
 * hand: reports arrive, the record arrives, and what the panel draws at each
 * step is what the developer would expect to keep seeing — never a line
 * vanishing before its row is up, never a line drawn twice once it is. Rows
 * are matched to lines by speaker and span on the call's own session, and
 * by nothing in their words.
 */

/** When the last call's session started, and when this call's did, on the service's clock. */
const LAST_SESSION_START = Date.parse("2026-09-14T08:50:00.000Z");
const SESSION_START = Date.parse("2026-09-14T09:00:00.000Z");
const LAST_SESSION = "vs_last";
const SESSION = "vs_this";

function line(
  rowId: string,
  kind: typeof CONVERSATION_ENTRY_KIND.ASK | typeof CONVERSATION_ENTRY_KIND.REPLY,
  words: string,
  startMs: number,
  endMs: number,
  settled = false,
): LiveConversationLine {
  return { rowId, entry: { kind, words }, startMs, endMs, settled };
}

let ids = 0;

/** One voice row of the record: a finished text message cut from a session over a span, placed where the session's start and its offset put it. */
function recorded(
  role: MessageRole,
  text: string,
  span: { session?: string; start?: number; fromMs: number; toMs: number },
): ConversationViewMessage {
  ids += 1;
  const sessionId = span.session ?? SESSION;
  const sessionStart = span.start ?? SESSION_START;
  const voice = {
    channel: MESSAGE_CHANNEL.VOICE,
    voice_session_id: sessionId,
    from_ms: span.fromMs,
    to_ms: span.toMs,
  } as const;
  const message: StoredUIMessage =
    role === MESSAGE_ROLE.USER
      ? {
          id: `m${ids}`,
          role,
          parts: [{ type: "text", text, state: "done" }],
          metadata: { author: MESSAGE_AUTHOR.DEVELOPER, ...voice },
        }
      : {
          id: `m${ids}`,
          role: MESSAGE_ROLE.ASSISTANT,
          parts: [{ type: "text", text, state: "done" }],
          metadata: { author: MESSAGE_AUTHOR.VOICE_MODEL, ...voice },
        };
  const placedAt = sessionStart + span.fromMs;
  return { message, seq: ids, createdAt: placedAt + 300, placedAt, tools: [] };
}

/** A row of the record that was not spoken: the brain's written reply, placed when it was created. */
function written(text: string, createdAt: number): ConversationViewMessage {
  ids += 1;
  const message: StoredUIMessage = {
    id: `m${ids}`,
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [{ type: "text", text, state: "done" }],
    metadata: { author: MESSAGE_AUTHOR.BRAIN },
  };
  return { message, seq: ids, createdAt, placedAt: createdAt, tools: [] };
}

function view(...messages: ConversationViewMessage[]): ConversationViewSnapshot {
  return {
    settled: true,
    groups: messages.map((message) => ({
      turnId: `turn-${message.message.id}`,
      turn: undefined,
      source: { kind: CONVERSATION_VIEW_SOURCE.MAIN },
      messages: [message],
    })),
  };
}

const EMPTY = view();
const UNREAD: ConversationViewSnapshot = { groups: [], settled: false };

/** The last call's rows, on record before this call opens: the developer at the session's first seconds, then Luke. */
const LAST_CALL = view(
  recorded(MESSAGE_ROLE.USER, "What needs me?", {
    session: LAST_SESSION,
    start: LAST_SESSION_START,
    fromMs: 200,
    toMs: 1_400,
  }),
  recorded(MESSAGE_ROLE.ASSISTANT, "Two sessions are waiting.", {
    session: LAST_SESSION,
    start: LAST_SESSION_START,
    fromMs: 2_000,
    toMs: 4_500,
  }),
);

function words(shown: ReturnType<typeof shownLiveEntries>): string[] {
  return shown.map((placed) => placed.entry.words);
}

test("a reported line is drawn until a row of the same speaker overlapping its span is on record, and then not twice", () => {
  const asked = line("row-1", CONVERSATION_ENTRY_KIND.ASK, "Which agent is waiting", 300, 1_500);
  let hold = foldLiveLines(NO_LIVE_LINES, [asked], EMPTY);
  assert.deepEqual(words(shownLiveEntries(hold, EMPTY)), [asked.entry.words]);

  // The row grows and settles: still drawn, since no row of it is on record yet.
  const grown = line(
    "row-1",
    CONVERSATION_ENTRY_KIND.ASK,
    "Which agent is waiting on me?",
    300,
    2_200,
    true,
  );
  hold = foldLiveLines(hold, [grown], EMPTY);
  assert.deepEqual(words(shownLiveEntries(hold, EMPTY)), [grown.entry.words]);

  // The record shows the row, a fragment short of the caption: the line is not drawn beside it.
  const onRecord = view(
    recorded(MESSAGE_ROLE.USER, "Which agent is waiting on", { fromMs: 300, toMs: 1_900 }),
  );
  assert.deepEqual(shownLiveEntries(hold, onRecord), []);

  // Luke's reply is drawn until its own row lands; the developer's row does not stand for it.
  const reply = line(
    "row-2",
    CONVERSATION_ENTRY_KIND.REPLY,
    "The fixture agent is.",
    2_600,
    4_000,
    true,
  );
  hold = foldLiveLines(hold, [grown, reply], onRecord);
  assert.deepEqual(words(shownLiveEntries(hold, onRecord)), [reply.entry.words]);
  const both = view(
    ...onRecord.groups.flatMap((group) => group.messages),
    recorded(MESSAGE_ROLE.ASSISTANT, "The fixture agent is.", { fromMs: 2_600, toMs: 4_000 }),
  );
  assert.deepEqual(shownLiveEntries(hold, both), []);
});

test("a row for a different utterance does not stand for the line, and overlap at the boundary counts", () => {
  const first = line("row-1", CONVERSATION_ENTRY_KIND.ASK, "Yes.", 1_000, 1_400, true);
  const second = line("row-2", CONVERSATION_ENTRY_KIND.ASK, "Yes.", 6_000, 6_400, true);
  const hold = foldLiveLines(NO_LIVE_LINES, [first, second], EMPTY);
  // The same word said twice: the first row stands for the first line alone.
  const oneRow = view(recorded(MESSAGE_ROLE.USER, "Yes.", { fromMs: 1_000, toMs: 1_400 }));
  assert.deepEqual(words(shownLiveEntries(hold, oneRow)), [second.entry.words]);
  // A row whose span ends exactly where the line begins shares that instant, since a fragment's end is the next one's start.
  const touching = view(recorded(MESSAGE_ROLE.USER, "Yes.", { fromMs: 400, toMs: 1_000 }));
  assert.deepEqual(words(shownLiveEntries(hold, touching)), [second.entry.words]);
  // A row a millisecond short of the line's start stands for nothing.
  const apart = view(recorded(MESSAGE_ROLE.USER, "Yes.", { fromMs: 400, toMs: 999 }));
  assert.deepEqual(words(shownLiveEntries(hold, apart)), [first.entry.words, second.entry.words]);
  // Luke's row over the same span never stands for the developer's line.
  const wrongSpeaker = view(
    recorded(MESSAGE_ROLE.ASSISTANT, "Yes.", { fromMs: 1_000, toMs: 1_400 }),
  );
  assert.deepEqual(words(shownLiveEntries(hold, wrongSpeaker)), [
    first.entry.words,
    second.entry.words,
  ]);
});

test("the last call's rows never stand for this call's lines, whatever their spans, and this call's session is told from theirs", () => {
  // The developer opens this call with the same words at the same offsets as last time.
  const asked = line("row-1", CONVERSATION_ENTRY_KIND.ASK, "What needs me?", 200, 1_400, true);
  let hold = foldLiveLines(NO_LIVE_LINES, [asked], LAST_CALL);
  assert.deepEqual(words(shownLiveEntries(hold, LAST_CALL)), [asked.entry.words]);
  // With no row of this call on record, the line has no instant yet and closes the thread.
  assert.deepEqual(
    shownLiveEntries(hold, LAST_CALL).map((placed) => placed.at),
    [undefined],
  );
  // The last call's row arriving late on the record is still the last call's.
  const lateRow = view(
    ...LAST_CALL.groups.flatMap((group) => group.messages),
    recorded(MESSAGE_ROLE.USER, "Thanks.", {
      session: LAST_SESSION,
      start: LAST_SESSION_START,
      fromMs: 200,
      toMs: 900,
    }),
  );
  assert.deepEqual(words(shownLiveEntries(hold, lateRow)), [asked.entry.words]);
  // This call's row lands: it stands for the line, and places it where the row is.
  const thisCall = view(
    ...lateRow.groups.flatMap((group) => group.messages),
    recorded(MESSAGE_ROLE.USER, "What needs me?", { fromMs: 200, toMs: 1_400 }),
  );
  assert.deepEqual(shownLiveEntries(hold, thisCall), []);
  const reply = line("row-2", CONVERSATION_ENTRY_KIND.REPLY, "Nothing yet.", 3_000, 3_900);
  hold = foldLiveLines(hold, [asked, reply], thisCall);
  assert.deepEqual(
    shownLiveEntries(hold, thisCall).map((placed) => [placed.entry.words, placed.at]),
    [[reply.entry.words, SESSION_START + 3_000]],
  );
});

test("the record read after the call opened tells this call's session, so a call that opens before the first read still matches its rows", () => {
  const asked = line("row-1", CONVERSATION_ENTRY_KIND.ASK, "What needs me?", 200, 1_400);
  let hold = foldLiveLines(NO_LIVE_LINES, [asked], UNREAD);
  assert.equal(hold.before, undefined);
  assert.deepEqual(words(shownLiveEntries(hold, UNREAD)), [asked.entry.words]);
  // The first read lands with the last call's rows: they are what was before, and the line still stands.
  hold = foldLiveLines(hold, [asked], LAST_CALL);
  assert.ok(hold.before);
  assert.deepEqual(words(shownLiveEntries(hold, LAST_CALL)), [asked.entry.words]);
  const thisCall = view(
    ...LAST_CALL.groups.flatMap((group) => group.messages),
    recorded(MESSAGE_ROLE.USER, "What needs me?", { fromMs: 200, toMs: 1_400 }),
  );
  assert.deepEqual(shownLiveEntries(hold, thisCall), []);
});

test("a report that moved nothing answers the same hold, so nothing is redrawn for it", () => {
  const lines = [line("row-1", CONVERSATION_ENTRY_KIND.ASK, "Hello", 0, 500)];
  const hold = foldLiveLines(NO_LIVE_LINES, lines, EMPTY);
  assert.equal(
    foldLiveLines(hold, [line("row-1", CONVERSATION_ENTRY_KIND.ASK, "Hello", 0, 500)], EMPTY),
    hold,
  );
  // A later read moves the record but not the hold, whose stamp was taken at the opening.
  assert.equal(foldLiveLines(hold, lines, LAST_CALL), hold);
});

test("the call's report ending drops every line, row or no row, and the next call opens afresh against what is on record then", () => {
  const asked = line(
    "row-1",
    CONVERSATION_ENTRY_KIND.ASK,
    "Open the failing one.",
    500,
    2_000,
    true,
  );
  const said = line("row-2", CONVERSATION_ENTRY_KIND.REPLY, "Opening it.", 2_500, 3_500, true);
  let hold = foldLiveLines(NO_LIVE_LINES, [asked, said], EMPTY);
  const askOnly = view(
    recorded(MESSAGE_ROLE.USER, "Open the failing one.", { fromMs: 500, toMs: 2_000 }),
  );
  assert.deepEqual(words(shownLiveEntries(hold, askOnly)), [said.entry.words]);
  // The call closes: the report empties, and Luke's line goes with it, its row flushed at the close or never coming.
  hold = foldLiveLines(hold, [], askOnly);
  assert.equal(hold, NO_LIVE_LINES);
  assert.deepEqual(shownLiveEntries(hold, askOnly), []);
  // The next call: this session's rows are now before it, so its own first row is the one matched.
  const next = line("row-1", CONVERSATION_ENTRY_KIND.ASK, "Open the failing one.", 500, 2_000);
  hold = foldLiveLines(hold, [next], askOnly);
  assert.deepEqual(words(shownLiveEntries(hold, askOnly)), [next.entry.words]);
  const nextRow = view(
    ...askOnly.groups.flatMap((group) => group.messages),
    recorded(MESSAGE_ROLE.USER, "Open the failing one.", {
      session: "vs_next",
      start: SESSION_START + 60_000,
      fromMs: 500,
      toMs: 2_000,
    }),
  );
  assert.deepEqual(shownLiveEntries(hold, nextRow), []);
});

test("a line is placed at the session's start plus its offset, so it sits among the rows where its own will land", () => {
  const asked = line("row-1", CONVERSATION_ENTRY_KIND.ASK, "And the other one?", 9_000, 10_200);
  const hold = foldLiveLines(NO_LIVE_LINES, [asked], EMPTY);
  const record = view(
    recorded(MESSAGE_ROLE.USER, "Which agent is waiting?", { fromMs: 300, toMs: 1_900 }),
    written("The fixture agent, on its tests.", SESSION_START + 4_000),
    recorded(MESSAGE_ROLE.ASSISTANT, "The fixture agent.", { fromMs: 2_600, toMs: 4_000 }),
  );
  assert.deepEqual(
    shownLiveEntries(hold, record).map((placed) => [placed.entry.words, placed.at]),
    [[asked.entry.words, SESSION_START + 9_000]],
  );
});
