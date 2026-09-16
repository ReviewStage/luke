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
import {
  foldLiveLines,
  LIVE_LINE_HOLD_MS,
  LIVE_LINE_RECORD_SLACK_MS,
  LIVE_LINE_SETTLED_HOLD_MS,
  liveLinesExpireAt,
  NO_LIVE_LINES,
  shownLiveEntries,
} from "./conversation-live-lines";

/**
 * The hand-off from a line still being said to its row on record, driven by
 * hand: reports arrive, the record arrives, the clock moves, and what the
 * panel draws at each step is what the developer would expect to keep
 * seeing — never a line vanishing between the settle and the read, never a
 * line drawn twice once its row is up.
 */

const OPENED = Date.parse("2026-09-14T09:00:00.000Z");

function line(
  rowId: string,
  kind: typeof CONVERSATION_ENTRY_KIND.ASK | typeof CONVERSATION_ENTRY_KIND.REPLY,
  words: string,
  settled = false,
): LiveConversationLine {
  return { rowId, entry: { kind, words }, settled };
}

let ids = 0;

/** One stored row of the view as the sync holds it: a finished text message under a turn group of its own. */
function recorded(role: MessageRole, text: string, createdAt: number): ConversationViewMessage {
  ids += 1;
  const message: StoredUIMessage =
    role === MESSAGE_ROLE.USER
      ? {
          id: `m${ids}`,
          role,
          parts: [{ type: "text", text, state: "done" }],
          metadata: {
            author: MESSAGE_AUTHOR.DEVELOPER,
            channel: MESSAGE_CHANNEL.VOICE,
            voice_session_id: "vs_1",
            from_ms: 0,
            to_ms: 1,
          },
        }
      : {
          id: `m${ids}`,
          role: MESSAGE_ROLE.ASSISTANT,
          parts: [{ type: "text", text, state: "done" }],
          metadata: { author: MESSAGE_AUTHOR.VOICE_MODEL },
        };
  return { message, seq: ids, createdAt, tools: [] };
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

test("a reported line is drawn, settled or not, until the record shows it, and then not twice", () => {
  const asked = line("row-1", CONVERSATION_ENTRY_KIND.ASK, "Which agent is waiting");
  let hold = foldLiveLines(NO_LIVE_LINES, [asked], OPENED);
  assert.equal(hold.openedAt, OPENED);
  assert.deepEqual(shownLiveEntries(hold, EMPTY), [asked.entry]);

  // The row grows and settles: the same row, still drawn, since no row of it is on record yet.
  const grown = line("row-1", CONVERSATION_ENTRY_KIND.ASK, "Which agent is waiting on me?", true);
  hold = foldLiveLines(hold, [grown], OPENED + 3_000);
  assert.deepEqual(hold.held, []);
  assert.deepEqual(shownLiveEntries(hold, EMPTY), [grown.entry]);

  // The record shows the row: the line is not drawn beside it.
  const onRecord = view(
    recorded(MESSAGE_ROLE.USER, "Which agent is waiting on me?", OPENED + 3_100),
  );
  assert.deepEqual(shownLiveEntries(hold, onRecord), []);

  // Luke's reply row appears beside it and is drawn until its own row lands.
  const reply = line("row-2", CONVERSATION_ENTRY_KIND.REPLY, "The fixture agent is.", true);
  hold = foldLiveLines(hold, [grown, reply], OPENED + 6_000);
  assert.deepEqual(shownLiveEntries(hold, onRecord), [reply.entry]);
  assert.deepEqual(
    shownLiveEntries(
      hold,
      view(
        ...onRecord.groups.flatMap((group) => group.messages),
        recorded(MESSAGE_ROLE.ASSISTANT, "The fixture agent is.", OPENED + 6_100),
      ),
    ),
    [],
  );
});

test("a report that moved nothing answers the same hold, so nothing is redrawn for it", () => {
  const lines = [line("row-1", CONVERSATION_ENTRY_KIND.ASK, "Hello")];
  const hold = foldLiveLines(NO_LIVE_LINES, lines, OPENED);
  assert.equal(
    foldLiveLines(hold, [line("row-1", CONVERSATION_ENTRY_KIND.ASK, "Hello")], OPENED + 1),
    hold,
  );
});

test("a line that left the report is held until the record shows it or the bound passes, and the clock is told when", () => {
  const asked = line("row-1", CONVERSATION_ENTRY_KIND.ASK, "Open the failing one.", true);
  const said = line("row-2", CONVERSATION_ENTRY_KIND.REPLY, "Opening it.", true);
  let hold = foldLiveLines(NO_LIVE_LINES, [asked, said], OPENED);
  // The call closes: the report empties, and both lines are held from now.
  hold = foldLiveLines(hold, [], OPENED + 10_000);
  assert.deepEqual(hold.lines, []);
  assert.equal(hold.openedAt, OPENED, "the call's opening stands while lines are held");
  assert.deepEqual(
    hold.held.map((held) => [held.entry.words, held.since]),
    [
      ["Open the failing one.", OPENED + 10_000],
      ["Opening it.", OPENED + 10_000],
    ],
  );
  assert.equal(liveLinesExpireAt(hold), OPENED + 10_000 + LIVE_LINE_HOLD_MS);
  assert.deepEqual(shownLiveEntries(hold, EMPTY), [asked.entry, said.entry]);

  // The record shows the developer's line: only Luke's is still drawn.
  const lineOnRecord = view(recorded(MESSAGE_ROLE.USER, "Open the failing one.", OPENED + 9_000));
  assert.deepEqual(shownLiveEntries(hold, lineOnRecord), [said.entry]);

  // The bound passes with Luke's row never arriving: the hold lets it go, and the clock has nothing left to wait for.
  hold = foldLiveLines(hold, [], OPENED + 10_000 + LIVE_LINE_HOLD_MS);
  assert.deepEqual(hold.held, []);
  assert.equal(hold.openedAt, undefined, "nothing standing or held opens the next call afresh");
  assert.equal(liveLinesExpireAt(hold), undefined);
  assert.deepEqual(shownLiveEntries(hold, EMPTY), []);
});

test("the next call's row 1 is not the held row 1 of the last call unless it carries the same words on", () => {
  const first = line("row-1", CONVERSATION_ENTRY_KIND.ASK, "What needs me?", true);
  let hold = foldLiveLines(NO_LIVE_LINES, [first], OPENED);
  hold = foldLiveLines(hold, [], OPENED + 5_000);
  const next = line("row-1", CONVERSATION_ENTRY_KIND.ASK, "Anything new?");
  hold = foldLiveLines(hold, [next], OPENED + 8_000);
  assert.deepEqual(shownLiveEntries(hold, EMPTY), [first.entry, next.entry]);
  // A held line the report carries again — a row that came back grown — is drawn once, as the reported one.
  const returned = line("row-1", CONVERSATION_ENTRY_KIND.ASK, "What needs me? Anything.");
  hold = foldLiveLines(hold, [returned], OPENED + 9_000);
  assert.deepEqual(shownLiveEntries(hold, EMPTY), [next.entry, returned.entry]);
});

test("the record covers a line by its words: an utterance inside a wider ask, a cut that ended inside the utterance, a reading beside its own spoken row, never a row of another speaker or of before the call", () => {
  const firstHalf = line("row-1", CONVERSATION_ENTRY_KIND.ASK, "Open the failing one.", true);
  const secondHalf = line("row-2", CONVERSATION_ENTRY_KIND.ASK, "Please.", true);
  const overrun = line("row-3", CONVERSATION_ENTRY_KIND.ASK, "And then run it. Thanks", true);
  const reading = line(
    "row-4",
    CONVERSATION_ENTRY_KIND.REPLY,
    "Opening it now! It is on the failing test",
    true,
  );
  const hold = foldLiveLines(NO_LIVE_LINES, [firstHalf, secondHalf, overrun, reading], OPENED);
  const record = view(
    // The delegation cut both utterances into one ask.
    recorded(MESSAGE_ROLE.USER, "Open the failing one. Please.", OPENED + 2_000),
    // The next cut ended at the delegation's offset, inside the utterance.
    recorded(MESSAGE_ROLE.USER, "And then run it.", OPENED + 5_000),
    // Luke's own spoken row of the reading, cut from the same transcript the line was drawn from.
    recorded(MESSAGE_ROLE.ASSISTANT, "Opening it now! It is on the failing test", OPENED + 6_000),
  );
  assert.deepEqual(shownLiveEntries(hold, record), []);

  // Luke's row never covers the developer's line, and a row from before the call covers nothing of it.
  const wrongSpeaker = view(
    recorded(MESSAGE_ROLE.ASSISTANT, "Open the failing one. Please.", OPENED + 2_000),
  );
  assert.deepEqual(
    shownLiveEntries(hold, wrongSpeaker).map((entry) => entry.words),
    [firstHalf.entry.words, secondHalf.entry.words, overrun.entry.words, reading.entry.words],
  );
  const stale = view(
    recorded(
      MESSAGE_ROLE.USER,
      "Open the failing one. Please.",
      OPENED - LIVE_LINE_RECORD_SLACK_MS - 1,
    ),
  );
  assert.equal(shownLiveEntries(hold, stale).length, 4);
});

test("a row covers each line inside it once: the same words said twice stand twice until the record holds the words twice", () => {
  const once = line("row-1", CONVERSATION_ENTRY_KIND.ASK, "Yes.", true);
  const twice = line("row-2", CONVERSATION_ENTRY_KIND.ASK, "Yes.", true);
  const hold = foldLiveLines(NO_LIVE_LINES, [once, twice], OPENED);
  const oneRow = view(recorded(MESSAGE_ROLE.USER, "Yes.", OPENED + 1_000));
  assert.deepEqual(shownLiveEntries(hold, oneRow), [twice.entry]);
  const twoRows = view(
    recorded(MESSAGE_ROLE.USER, "Yes.", OPENED + 1_000),
    recorded(MESSAGE_ROLE.USER, "Yes.", OPENED + 4_000),
  );
  assert.deepEqual(shownLiveEntries(hold, twoRows), []);
  // One ask cut from both utterances covers both, as the delegation's wider cut does.
  const oneCut = view(recorded(MESSAGE_ROLE.USER, "Yes. Yes.", OPENED + 4_000));
  assert.deepEqual(shownLiveEntries(hold, oneCut), []);
});

test("a settled line the record never shows is let go after its bound, and the clock is told when; an unsettled one stands", () => {
  const greeting = line("row-1", CONVERSATION_ENTRY_KIND.REPLY, "Hey, I'm here and ready to help.");
  let hold = foldLiveLines(NO_LIVE_LINES, [greeting], OPENED);
  assert.equal(liveLinesExpireAt(hold), undefined, "a line still being said stands on no clock");
  const settled = { ...greeting, settled: true };
  hold = foldLiveLines(hold, [settled], OPENED + 2_000);
  assert.equal(liveLinesExpireAt(hold), OPENED + 2_000 + LIVE_LINE_SETTLED_HOLD_MS);
  assert.deepEqual(shownLiveEntries(hold, EMPTY), [greeting.entry]);
  // Reported again, still settled, the stamp holds: the bound runs from the first settle.
  hold = foldLiveLines(hold, [settled], OPENED + 10_000);
  assert.equal(liveLinesExpireAt(hold), OPENED + 2_000 + LIVE_LINE_SETTLED_HOLD_MS);
  // The bound passes with the session still open and no row: the line goes, and nothing waits.
  hold = foldLiveLines(hold, [settled], OPENED + 2_000 + LIVE_LINE_SETTLED_HOLD_MS);
  assert.deepEqual(shownLiveEntries(hold, EMPTY), []);
  assert.equal(hold.lines.length, 1, "the report is still mirrored for the next diff");
  // A new row on the same call is drawn as before.
  const asked = line("row-2", CONVERSATION_ENTRY_KIND.ASK, "Anything new?");
  hold = foldLiveLines(hold, [settled, asked], OPENED + 2_000 + LIVE_LINE_SETTLED_HOLD_MS + 500);
  assert.deepEqual(shownLiveEntries(hold, EMPTY), [asked.entry]);
});

test("the clock re-arms for the next settled line once the first has been let go", () => {
  const first = line("row-1", CONVERSATION_ENTRY_KIND.REPLY, "Hey, I'm here.", true);
  let hold = foldLiveLines(NO_LIVE_LINES, [first], OPENED);
  assert.equal(liveLinesExpireAt(hold), OPENED + LIVE_LINE_SETTLED_HOLD_MS);
  // The first is let go; a second settled later stands under its own bound, which is what the clock is told now.
  const second = line("row-2", CONVERSATION_ENTRY_KIND.REPLY, "Anything else?", true);
  hold = foldLiveLines(hold, [first, second], OPENED + 20_000);
  assert.equal(liveLinesExpireAt(hold), OPENED + LIVE_LINE_SETTLED_HOLD_MS);
  hold = foldLiveLines(hold, [first, second], OPENED + LIVE_LINE_SETTLED_HOLD_MS);
  assert.deepEqual(shownLiveEntries(hold, EMPTY), [second.entry]);
  assert.equal(liveLinesExpireAt(hold), OPENED + 20_000 + LIVE_LINE_SETTLED_HOLD_MS);
  hold = foldLiveLines(hold, [first, second], OPENED + 20_000 + LIVE_LINE_SETTLED_HOLD_MS);
  assert.deepEqual(shownLiveEntries(hold, EMPTY), []);
  assert.equal(liveLinesExpireAt(hold), undefined);
});

test("a line is covered by whole words only: a short line is not found inside a longer word of an earlier row", () => {
  const yes = line("row-1", CONVERSATION_ENTRY_KIND.ASK, "Yes.", true);
  const no = line("row-2", CONVERSATION_ENTRY_KIND.ASK, "No", true);
  const hold = foldLiveLines(NO_LIVE_LINES, [yes, no], OPENED);
  const longer = view(
    recorded(MESSAGE_ROLE.USER, "Yesterday it passed, and nothing else.", OPENED + 1_000),
  );
  assert.deepEqual(shownLiveEntries(hold, longer), [yes.entry, no.entry]);
  const words = view(recorded(MESSAGE_ROLE.USER, "Yes, no.", OPENED + 1_000));
  assert.deepEqual(shownLiveEntries(hold, words), []);
  // A cut that ended inside the utterance covers it only at a word's end.
  const cutShort = line("row-3", CONVERSATION_ENTRY_KIND.ASK, "Restart the fixture agent", true);
  const cut = foldLiveLines(NO_LIVE_LINES, [cutShort], OPENED);
  assert.deepEqual(
    shownLiveEntries(cut, view(recorded(MESSAGE_ROLE.USER, "Restart the fix", OPENED + 1_000))),
    [cutShort.entry],
  );
  assert.deepEqual(
    shownLiveEntries(cut, view(recorded(MESSAGE_ROLE.USER, "Restart the fixture", OPENED + 1_000))),
    [],
  );
});
