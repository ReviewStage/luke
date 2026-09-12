import assert from "node:assert/strict";
import type { BrainTurnRecord, ConversationReadEvent } from "@sidecar/hosted";
import {
  CONVERSATION_VIEW_SOURCE,
  CONVERSATION_VIEW_TOOL_KIND,
  type ConversationViewMessage,
  type ConversationViewTurn,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  TOOL_PART_STATE,
} from "@sidecar/session";
import {
  CONVERSATION_EVENT_KIND,
  MESSAGE_RATING,
  type MessageRating,
  TURN_ORIGIN,
  TURN_STATUS,
} from "@sidecar/wire";
import { test } from "vitest";
import {
  CONVERSATION_VIEW_BOUNDS,
  ConversationViewSync,
  type ReadMessagesPage,
  type ReadTurnGroup,
} from "./conversation-view-sync.js";

const MAIN = "3c000000-0000-4000-8000-000000000001";
const OBSERVED = "3c000000-0000-4000-8000-000000000002";
const NEW_MAIN = "3c000000-0000-4000-8000-000000000003";
const SESSION = { providerId: "conductor", providerSessionId: "chat-1" };
const NOW = 1_757_505_600_000;

function turnId(n: number): string {
  return `1a000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function messageId(n: number): string {
  return `2b000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function ask(id: number, seq: number, text: string, createdAt: number): ConversationViewMessage {
  return {
    message: {
      id: messageId(id),
      role: MESSAGE_ROLE.USER,
      metadata: { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.TYPED },
      parts: [{ type: "text", text }],
    },
    seq,
    createdAt,
    tools: [],
  };
}

function announcement(
  id: number,
  seq: number,
  createdAt: number,
  unspoken: boolean,
): ConversationViewMessage {
  return {
    message: {
      id: messageId(id),
      role: MESSAGE_ROLE.ASSISTANT,
      metadata: { author: MESSAGE_AUTHOR.BRAIN },
      parts: [
        {
          type: "tool-announce",
          toolCallId: `call_${id}`,
          state: TOOL_PART_STATE.OUTPUT_AVAILABLE,
          input: { briefing: "A word." },
          output: {},
        },
      ],
    },
    seq,
    createdAt,
    tools: [
      {
        toolCallId: `call_${id}`,
        toolName: "announce",
        state: TOOL_PART_STATE.OUTPUT_AVAILABLE,
        kind: CONVERSATION_VIEW_TOOL_KIND.ANNOUNCE,
        unspoken,
      },
    ],
  };
}

function turn(
  id: string,
  status: ConversationViewTurn["status"],
  queuedAt: number,
): ConversationViewTurn {
  return { id, origin: TURN_ORIGIN.TYPED, status, queuedAt };
}

function mainGroup(
  id: string,
  messages: readonly ConversationViewMessage[],
  held?: ConversationViewTurn,
): ReadTurnGroup {
  return {
    turnId: id,
    conversationId: MAIN,
    source: { kind: CONVERSATION_VIEW_SOURCE.MAIN },
    ...(held ? { turn: held } : undefined),
    messages,
  };
}

/** When the mains of these tests opened: well before any row they hold, so nothing is windowed out unless a test says so. */
const MAIN_OPENED_AT = NOW - 60 * 60_000;

function page(
  groups: readonly ReadTurnGroup[],
  next = "cursor",
  standing = [MAIN],
  openedAt = MAIN_OPENED_AT,
): ReadMessagesPage {
  return {
    conversations: standing.map((id) =>
      id === OBSERVED
        ? { id, kind: CONVERSATION_VIEW_SOURCE.OBSERVED, session: SESSION }
        : { id, kind: CONVERSATION_VIEW_SOURCE.MAIN, openedAt },
    ),
    groups,
    next,
  };
}

function turnRecord(
  id: string,
  status: BrainTurnRecord["status"],
  queuedAt: number,
  conversationId = MAIN,
): BrainTurnRecord {
  return {
    id,
    conversationId,
    origin: TURN_ORIGIN.TYPED,
    status,
    queuedAt,
    cursor: `turn-cursor-${id}`,
  };
}

function speech(
  messageIdNumber: number,
  seq: number,
  kind: ConversationReadEvent["kind"],
  conversationId = OBSERVED,
): ConversationReadEvent {
  return {
    id: `4d000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    conversationId,
    seq,
    messageId: messageId(messageIdNumber),
    kind,
    createdAt: NOW + seq,
  };
}

test("groups merge by turn and a message is replaced at its sequence, so the copy held is always the latest", () => {
  const sync = new ConversationViewSync();
  sync.applyMessages(
    page([
      mainGroup(turnId(1), [ask(1, 1, "first", NOW)], turn(turnId(1), TURN_STATUS.RUNNING, NOW)),
    ]),
  );
  // The reply is still being written: the next page answers the same turn with the row grown.
  sync.applyMessages(
    page([
      mainGroup(
        turnId(1),
        [ask(2, 2, "half a", NOW + 500)],
        turn(turnId(1), TURN_STATUS.RUNNING, NOW),
      ),
    ]),
  );
  sync.applyMessages(
    page([
      mainGroup(
        turnId(1),
        [ask(2, 2, "half a sentence, whole", NOW + 500)],
        turn(turnId(1), TURN_STATUS.SETTLED, NOW),
      ),
    ]),
  );
  const snapshot = sync.snapshot();
  assert.equal(snapshot.groups.length, 1);
  const [group] = snapshot.groups;
  assert.ok(group);
  assert.deepEqual(
    group.messages.map((message) => [message.seq, message.message.parts[0]]),
    [
      [1, { type: "text", text: "first" }],
      [2, { type: "text", text: "half a sentence, whole" }],
    ],
  );
  assert.equal(group.turn?.status, TURN_STATUS.SETTLED);
  assert.equal(snapshot.settled, true);
  assert.equal(sync.cursors().messages, "cursor");
});

test("a conversation the answer no longer lists takes its groups, turns, and events with it, which is how a Clear lands", () => {
  const sync = new ConversationViewSync();
  sync.applyMessages(
    page(
      [
        mainGroup(turnId(1), [ask(1, 1, "kept?", NOW)]),
        {
          turnId: turnId(2),
          conversationId: OBSERVED,
          source: { kind: CONVERSATION_VIEW_SOURCE.OBSERVED, session: SESSION },
          messages: [announcement(2, 1, NOW + 1000, false)],
        },
      ],
      "c1",
      [MAIN, OBSERVED],
    ),
  );
  sync.applyTurns([turnRecord(turnId(1), TURN_STATUS.SETTLED, NOW)], "t1");
  sync.applyEvents([speech(2, 1, CONVERSATION_EVENT_KIND.SPEECH_EXPIRED)], "e1", false);
  assert.equal(sync.snapshot().groups.length, 2);
  const before = sync.revision;

  sync.applyMessages(page([], "c2", [NEW_MAIN, OBSERVED]));
  const snapshot = sync.snapshot();
  assert.deepEqual(
    snapshot.groups.map((group) => group.turnId),
    [turnId(2)],
  );
  assert.ok(sync.revision > before);
  // The observed conversation's announcement still reads its event.
  assert.equal(
    snapshot.groups[0]?.messages[0]?.tools[0]?.kind,
    CONVERSATION_VIEW_TOOL_KIND.ANNOUNCE,
  );
  const tool = snapshot.groups[0]?.messages[0]?.tools[0];
  assert.ok(tool?.kind === CONVERSATION_VIEW_TOOL_KIND.ANNOUNCE && tool.unspoken === true);
});

test("groups stand in the view's order however the pages arrived: earliest message, then the turn's queue instant, then the id", () => {
  const sync = new ConversationViewSync();
  sync.applyMessages(
    page([
      mainGroup(
        turnId(3),
        [ask(3, 3, "third", NOW + 3000)],
        turn(turnId(3), TURN_STATUS.SETTLED, NOW + 3000),
      ),
    ]),
  );
  sync.applyMessages(
    page([
      mainGroup(turnId(1), [ask(1, 1, "first", NOW)], turn(turnId(1), TURN_STATUS.SETTLED, NOW)),
      mainGroup(
        turnId(2),
        [ask(2, 2, "second", NOW)],
        turn(turnId(2), TURN_STATUS.SETTLED, NOW + 1),
      ),
    ]),
  );
  assert.deepEqual(
    sync.snapshot().groups.map((group) => group.turnId),
    [turnId(1), turnId(2), turnId(3)],
  );
});

test("a turn answered again replaces the one held, and a group with no turn row reads the turns resource's", () => {
  const sync = new ConversationViewSync();
  sync.applyMessages(page([mainGroup(turnId(1), [ask(1, 1, "go", NOW)])]));
  assert.equal(sync.snapshot().groups[0]?.turn, undefined);
  const before = sync.revision;
  sync.applyTurns([turnRecord(turnId(1), TURN_STATUS.RUNNING, NOW)], "t1");
  assert.ok(sync.revision > before);
  assert.equal(sync.snapshot().groups[0]?.turn?.status, TURN_STATUS.RUNNING);
  const running = sync.revision;
  // The same row again moves nothing.
  sync.applyTurns([turnRecord(turnId(1), TURN_STATUS.RUNNING, NOW)], "t2");
  assert.equal(sync.revision, running);
  assert.equal(sync.cursors().turns, "t2");
  sync.applyTurns([turnRecord(turnId(1), TURN_STATUS.SETTLED, NOW)], "t3");
  assert.equal(sync.snapshot().groups[0]?.turn?.status, TURN_STATUS.SETTLED);
  assert.equal(sync.cursors().turns, "t3");
  // An answer with no cursor is an account with no turn, as after a Clear that
  // emptied them: the cursor held goes with it, so it reads equal to the
  // change signal's absent head rather than re-reading turns every poll.
  sync.applyTurns([], undefined);
  assert.equal(sync.cursors().turns, undefined);
});

test("the latest speech event on a message decides whether its announcement was heard", () => {
  const sync = new ConversationViewSync();
  sync.applyMessages(
    page(
      [
        {
          turnId: turnId(1),
          conversationId: OBSERVED,
          source: { kind: CONVERSATION_VIEW_SOURCE.OBSERVED, session: SESSION },
          messages: [announcement(1, 1, NOW, false)],
        },
      ],
      "c1",
      [MAIN, OBSERVED],
    ),
  );
  const heard = () => {
    const tool = sync.snapshot().groups[0]?.messages[0]?.tools[0];
    assert.ok(tool?.kind === CONVERSATION_VIEW_TOOL_KIND.ANNOUNCE);
    return !tool.unspoken;
  };
  assert.equal(heard(), true);
  // The expiry arrives after the page named the announcement as standing: nobody heard it.
  sync.applyEvents([speech(1, 2, CONVERSATION_EVENT_KIND.SPEECH_EXPIRED)], "e1", false);
  assert.equal(heard(), false);
  // An earlier event arriving late does not undo a later one; a later spoken does.
  sync.applyEvents([speech(1, 1, CONVERSATION_EVENT_KIND.SPEECH_OFFERED)], "e2", false);
  assert.equal(heard(), false);
  sync.applyEvents([speech(1, 3, CONVERSATION_EVENT_KIND.SPEECH_SPOKEN)], "e3", false);
  assert.equal(heard(), true);
  // A rating is not a speech event: the mark stands, and one whose payload
  // spells no verdict rates nothing.
  sync.applyEvents([speech(1, 4, CONVERSATION_EVENT_KIND.RATING)], "e4", false);
  assert.equal(heard(), true);
  assert.equal(sync.snapshot().groups[0]?.messages[0]?.rating, undefined);
  assert.equal(sync.cursors().events, "e4");
});

test("only the newest turns are kept, and the ones let go of do not come back", () => {
  const sync = new ConversationViewSync();
  const total = CONVERSATION_VIEW_BOUNDS.MAX_GROUPS + 3;
  const groups = Array.from({ length: total }, (_, index) =>
    mainGroup(turnId(index + 1), [ask(index + 1, index + 1, `ask ${index + 1}`, NOW + index)]),
  );
  sync.applyMessages(page(groups));
  const snapshot = sync.snapshot();
  assert.equal(snapshot.groups.length, CONVERSATION_VIEW_BOUNDS.MAX_GROUPS);
  assert.equal(snapshot.groups[0]?.turnId, turnId(4));
  assert.equal(snapshot.groups.at(-1)?.turnId, turnId(total));
  assert.equal(sync.snapshot().groups.length, CONVERSATION_VIEW_BOUNDS.MAX_GROUPS);
});

test("an unreadable row is held on the snapshot until a page reads, and a reset forgets everything", () => {
  const sync = new ConversationViewSync();
  const start = sync.revision;
  assert.deepEqual(sync.snapshot(), { groups: [], settled: false });
  sync.markUnreadable({ conversationId: MAIN, seq: 4 });
  assert.ok(sync.revision > start);
  assert.deepEqual(sync.snapshot(), {
    groups: [],
    settled: true,
    unreadable: { conversationId: MAIN, seq: 4 },
  });
  const marked = sync.revision;
  sync.markUnreadable({ conversationId: MAIN, seq: 4 });
  assert.equal(sync.revision, marked);
  sync.applyMessages(page([mainGroup(turnId(1), [ask(1, 1, "read", NOW)])], "c1"));
  assert.equal(sync.snapshot().unreadable, undefined);
  sync.reset();
  assert.deepEqual(sync.snapshot(), { groups: [], settled: false });
  assert.deepEqual(sync.cursors(), {});
});

test("a Clear that opened a new main takes the observed crossing rows from before it off the screen, and leaves the ones after it", () => {
  const sync = new ConversationViewSync();
  const observedGroup = (id: string, at: number): ReadTurnGroup => ({
    turnId: id,
    conversationId: OBSERVED,
    source: { kind: CONVERSATION_VIEW_SOURCE.OBSERVED, session: SESSION },
    messages: [announcement(Number(id.slice(-2)), Number(id.slice(-2)), at, false)],
  });
  sync.applyMessages(
    page(
      [mainGroup(turnId(1), [ask(1, 1, "before", NOW)]), observedGroup(turnId(11), NOW + 500)],
      "c1",
      [MAIN, OBSERVED],
    ),
  );
  assert.equal(sync.snapshot().groups.length, 2);
  // The Clear: a new main opened after both rows, the observed conversation still standing.
  const clearedAt = NOW + 10_000;
  sync.applyMessages(page([], "c2", [NEW_MAIN, OBSERVED], clearedAt));
  assert.deepEqual(sync.snapshot().groups, []);
  // A crossing row written after the new main opened is the new main's window's, and stays.
  sync.applyMessages(
    page([observedGroup(turnId(12), clearedAt + 1)], "c3", [NEW_MAIN, OBSERVED], clearedAt),
  );
  assert.deepEqual(
    sync.snapshot().groups.map((group) => group.turnId),
    [turnId(12)],
  );
  // Reading the same window again drops nothing further.
  const settled = sync.revision;
  sync.applyMessages(page([], "c4", [NEW_MAIN, OBSERVED], clearedAt));
  assert.equal(sync.revision, settled);
});

test("a turn still running across a Clear keeps only the rows it wrote after the new main opened", () => {
  const sync = new ConversationViewSync();
  sync.applyMessages(
    page(
      [
        {
          turnId: turnId(21),
          conversationId: OBSERVED,
          source: { kind: CONVERSATION_VIEW_SOURCE.OBSERVED, session: SESSION },
          turn: {
            id: turnId(21),
            origin: TURN_ORIGIN.ROSTER_DIFF,
            status: TURN_STATUS.RUNNING,
            queuedAt: NOW,
          },
          messages: [
            announcement(21, 1, NOW + 500, false),
            announcement(22, 2, NOW + 20_000, false),
          ],
        },
      ],
      "c1",
      [MAIN, OBSERVED],
    ),
  );
  sync.applyClear(NOW + 10_000);
  const [group] = sync.snapshot().groups;
  assert.ok(group);
  assert.deepEqual(
    group.messages.map((message) => message.seq),
    [2],
  );
  // A later page of the same turn merges its new rows and is held to the same window.
  sync.applyMessages(
    page(
      [
        {
          turnId: turnId(21),
          conversationId: OBSERVED,
          source: { kind: CONVERSATION_VIEW_SOURCE.OBSERVED, session: SESSION },
          messages: [
            announcement(21, 1, NOW + 500, false),
            announcement(23, 3, NOW + 30_000, false),
          ],
        },
      ],
      "c2",
      [NEW_MAIN, OBSERVED],
      NOW + 10_000,
    ),
  );
  assert.deepEqual(
    sync.snapshot().groups[0]?.messages.map((message) => message.seq),
    [2, 3],
  );
});

test("a Clear the service confirmed empties the picture from the answer alone: main's groups go, and observed rows from before the new main opened go with them", () => {
  const sync = new ConversationViewSync();
  const observedGroup = (id: string, at: number): ReadTurnGroup => ({
    turnId: id,
    conversationId: OBSERVED,
    source: { kind: CONVERSATION_VIEW_SOURCE.OBSERVED, session: SESSION },
    messages: [announcement(Number(id.slice(-2)), Number(id.slice(-2)), at, false)],
  });
  sync.applyMessages(
    page(
      [
        mainGroup(turnId(1), [ask(1, 1, "before", NOW)]),
        observedGroup(turnId(11), NOW + 500),
        observedGroup(turnId(12), NOW + 20_000),
      ],
      "c1",
      [MAIN, OBSERVED],
    ),
  );
  const before = sync.revision;
  sync.applyClear(NOW + 10_000);
  assert.ok(sync.revision > before);
  assert.deepEqual(
    sync.snapshot().groups.map((group) => group.turnId),
    [turnId(12)],
  );
  // The cursors stand until the read that follows moves them.
  assert.equal(sync.cursors().messages, "c1");
  const cleared = sync.revision;
  sync.applyClear(NOW + 10_000);
  assert.equal(sync.revision, cleared);
  // A row the last read could not read back was the stamped thread's; the Clear takes the notice with it.
  sync.markUnreadable({ conversationId: MAIN, seq: 9 });
  assert.equal(sync.snapshot().unreadable?.seq, 9);
  const epoch = sync.clearEpoch;
  sync.applyClear(NOW + 10_000);
  assert.equal(sync.snapshot().unreadable, undefined);
  assert.equal(sync.clearEpoch, epoch + 1);
  // A page a pass read before the Clear, landing after it, lists the stamped
  // main as it stood; the window does not move back for it, and its rows drop on arrival.
  sync.applyMessages(
    page(
      [mainGroup(turnId(2), [ask(2, 2, "stale", NOW + 1)]), observedGroup(turnId(13), NOW + 2)],
      "c2",
      [MAIN, OBSERVED],
    ),
  );
  assert.deepEqual(
    sync.snapshot().groups.map((group) => group.turnId),
    [turnId(12)],
  );
  assert.equal(sync.cursors().messages, "c2");
});

function ratingEvent(
  messageIdNumber: number,
  seq: number,
  rating: MessageRating | undefined,
  conversationId = MAIN,
): ConversationReadEvent {
  return {
    ...speech(messageIdNumber, seq, CONVERSATION_EVENT_KIND.RATING, conversationId),
    deviceId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    ...(rating === undefined ? undefined : { payload: { rating } }),
  };
}

function rated(
  message: ConversationViewMessage,
  rating: MessageRating | undefined,
): ConversationViewMessage {
  const { rating: _folded, ...unrated } = message;
  return rating === undefined ? unrated : { ...unrated, rating: { rating } };
}

function reply(id: number, seq: number, createdAt: number): ConversationViewMessage {
  return {
    message: {
      id: messageId(id),
      role: MESSAGE_ROLE.ASSISTANT,
      metadata: { author: MESSAGE_AUTHOR.BRAIN },
      parts: [{ type: "text", text: "A reply.", state: "done" }],
    },
    seq,
    createdAt,
    tools: [],
  };
}

function ratingOf(sync: ConversationViewSync, id: number): MessageRating | undefined {
  for (const group of sync.snapshot().groups) {
    for (const message of group.messages) {
      if (message.message.id === messageId(id)) return message.rating?.rating;
    }
  }
  throw new Error(`message ${id} is not held`);
}

test("the rating a page folds onto a message stands until the events read has caught up, and is then amended by the newer event", () => {
  const sync = new ConversationViewSync();
  sync.applyMessages(
    page([
      mainGroup(turnId(1), [
        ask(1, 1, "well?", NOW),
        rated(reply(2, 2, NOW + 1), MESSAGE_RATING.UP),
      ]),
    ]),
  );
  assert.equal(ratingOf(sync, 2), MESSAGE_RATING.UP);
  // A replay from the record's beginning: an older verdict, with more to come, stands behind the fold.
  sync.applyEvents([ratingEvent(2, 1, MESSAGE_RATING.DOWN)], "e1", true);
  assert.equal(ratingOf(sync, 2), MESSAGE_RATING.UP);
  // The replay ends: what it holds now carries everything the fold did.
  sync.applyEvents([ratingEvent(2, 2, MESSAGE_RATING.UP)], "e2", false);
  assert.equal(ratingOf(sync, 2), MESSAGE_RATING.UP);
  // A verdict given on another device since, read as a newer event, amends the fold.
  const before = sync.revision;
  sync.applyEvents([ratingEvent(2, 3, MESSAGE_RATING.DOWN)], "e3", false);
  assert.equal(ratingOf(sync, 2), MESSAGE_RATING.DOWN);
  assert.ok(sync.revision > before);
  // An older event arriving late does not undo it.
  sync.applyEvents([ratingEvent(2, 2, MESSAGE_RATING.UP)], "e4", false);
  assert.equal(ratingOf(sync, 2), MESSAGE_RATING.DOWN);
  // The newest event's payload spells no verdict: the developer's last word is no rating.
  sync.applyEvents([ratingEvent(2, 4, undefined)], "e5", false);
  assert.equal(ratingOf(sync, 2), undefined);
});

test("a rating this device wrote shows at once, whatever the events read has reached, and the same event read back moves nothing", () => {
  const sync = new ConversationViewSync();
  sync.applyMessages(page([mainGroup(turnId(1), [ask(1, 1, "well?", NOW), reply(2, 2, NOW + 1)])]));
  assert.equal(ratingOf(sync, 2), undefined);
  const before = sync.revision;
  sync.recordRating(messageId(2), 5, { rating: MESSAGE_RATING.DOWN });
  assert.equal(ratingOf(sync, 2), MESSAGE_RATING.DOWN);
  assert.ok(sync.revision > before);
  const shown = sync.revision;
  // The events read is still replaying older events; the own write stands over them.
  sync.applyEvents([ratingEvent(2, 3, MESSAGE_RATING.UP)], "e1", true);
  assert.equal(ratingOf(sync, 2), MESSAGE_RATING.DOWN);
  // The write's own event, read back: nothing newer, nothing moved.
  sync.applyEvents([ratingEvent(2, 5, MESSAGE_RATING.DOWN)], "e2", false);
  assert.equal(ratingOf(sync, 2), MESSAGE_RATING.DOWN);
  assert.equal(sync.revision, shown);
  // A rating on a message this device does not hold lands nowhere.
  sync.recordRating(messageId(9), 6, { rating: MESSAGE_RATING.UP });
  assert.equal(sync.revision, shown);
});

test("only one of Luke's messages this device holds is rateable, named by whether it is a briefing", () => {
  const sync = new ConversationViewSync();
  sync.applyMessages(
    page(
      [
        mainGroup(turnId(1), [ask(1, 1, "well?", NOW), reply(2, 2, NOW + 1)]),
        {
          turnId: turnId(2),
          conversationId: OBSERVED,
          source: { kind: CONVERSATION_VIEW_SOURCE.OBSERVED, session: SESSION },
          messages: [announcement(3, 1, NOW + 2, false)],
        },
      ],
      "c1",
      [MAIN, OBSERVED],
    ),
  );
  assert.equal(sync.rateable(messageId(1)), undefined);
  assert.deepEqual(sync.rateable(messageId(2)), { announcement: false });
  assert.deepEqual(sync.rateable(messageId(3)), { announcement: true });
  assert.equal(sync.rateable(messageId(4)), undefined);
});

test("a rating goes with the conversation it was about, and a reset forgets the events read had caught up", () => {
  const sync = new ConversationViewSync();
  sync.applyMessages(
    page([mainGroup(turnId(1), [ask(1, 1, "well?", NOW), reply(2, 2, NOW + 1)])], "c1"),
  );
  sync.applyEvents([ratingEvent(2, 1, MESSAGE_RATING.DOWN)], "e1", false);
  assert.equal(ratingOf(sync, 2), MESSAGE_RATING.DOWN);
  // A Clear: the new main lists no rows, and the old main's rating goes with its message.
  sync.applyMessages(page([mainGroup(turnId(3), [reply(5, 1, NOW + 10)])], "c2", [NEW_MAIN]));
  sync.applyMessages(
    page([{ ...mainGroup(turnId(1), [reply(2, 2, NOW + 1)]), conversationId: NEW_MAIN }], "c3", [
      NEW_MAIN,
    ]),
  );
  assert.equal(ratingOf(sync, 2), undefined);

  sync.reset();
  sync.applyMessages(
    page([mainGroup(turnId(1), [rated(reply(2, 2, NOW + 1), MESSAGE_RATING.UP)])], "c4"),
  );
  // Replaying from the beginning again: an older event stands behind the fold until the replay ends.
  sync.applyEvents([ratingEvent(2, 1, MESSAGE_RATING.DOWN)], "e1", true);
  assert.equal(ratingOf(sync, 2), MESSAGE_RATING.UP);
});

test("a message read again carries a fold newer than any mark read back, so a walk cut short cannot leave an older mark standing over it", () => {
  const sync = new ConversationViewSync();
  sync.applyMessages(
    page([mainGroup(turnId(1), [ask(1, 1, "well?", NOW), reply(2, 2, NOW + 1)])], "c1"),
  );
  sync.applyEvents([], "e0", false);
  // Another device rates twice between two polls; this poll's messages page
  // folds the newer verdict, and its events walk is cut after the older one.
  sync.applyMessages(
    page([mainGroup(turnId(1), [rated(reply(2, 2, NOW + 1), MESSAGE_RATING.DOWN)])], "c2"),
  );
  sync.applyEvents([ratingEvent(2, 5, MESSAGE_RATING.UP)], "e1", true);
  assert.equal(ratingOf(sync, 2), MESSAGE_RATING.UP);
  // The next poll answers the row again with the same fold: the fold is the newer word.
  sync.applyMessages(
    page([mainGroup(turnId(1), [rated(reply(2, 2, NOW + 1), MESSAGE_RATING.DOWN)])], "c3"),
  );
  assert.equal(ratingOf(sync, 2), MESSAGE_RATING.DOWN);
  // The walk then delivers the newer event too, and the verdict stands.
  sync.applyEvents([ratingEvent(2, 10, MESSAGE_RATING.DOWN)], "e2", false);
  assert.equal(ratingOf(sync, 2), MESSAGE_RATING.DOWN);
  // An own write is never forgotten for a page: it is newer than the fold by construction.
  sync.recordRating(messageId(2), 11, { rating: MESSAGE_RATING.UP });
  sync.applyMessages(
    page([mainGroup(turnId(1), [rated(reply(2, 2, NOW + 1), MESSAGE_RATING.DOWN)])], "c4"),
  );
  assert.equal(ratingOf(sync, 2), MESSAGE_RATING.UP);
});

test("an event that supersedes this device's own write is newer than the fold too, and shows before the replay ends", () => {
  const sync = new ConversationViewSync();
  sync.applyMessages(page([mainGroup(turnId(1), [ask(1, 1, "well?", NOW), reply(2, 2, NOW + 1)])]));
  sync.recordRating(messageId(2), 500, { rating: MESSAGE_RATING.UP });
  assert.equal(ratingOf(sync, 2), MESSAGE_RATING.UP);
  // Still replaying from the record's beginning when a newer verdict from another device arrives.
  sync.applyEvents([ratingEvent(2, 501, MESSAGE_RATING.DOWN)], "e1", true);
  assert.equal(ratingOf(sync, 2), MESSAGE_RATING.DOWN);
});

test("the marks about a message the window or the group bound let go of go with it", () => {
  const sync = new ConversationViewSync();
  sync.applyMessages(page([mainGroup(turnId(1), [reply(2, 1, NOW)])], "c1"));
  sync.applyEvents([ratingEvent(2, 1, MESSAGE_RATING.DOWN)], "e1", false);
  assert.equal(ratingOf(sync, 2), MESSAGE_RATING.DOWN);
  // A Clear windows the row out; the same id answered again later starts from the fold alone.
  sync.applyClear(NOW + 5);
  assert.deepEqual(sync.snapshot().groups, []);
  sync.applyMessages(page([mainGroup(turnId(1), [reply(2, 1, NOW + 6)])], "c2", [MAIN], NOW + 5));
  assert.equal(ratingOf(sync, 2), undefined);
});

test("a message answered again at a fresh sequence stands once, where its latest delivery placed it: a spoken line taken into its turn leaves its standalone group, and a journal moved behind the line draws after it", () => {
  const sync = new ConversationViewSync();
  // Read early: the developer's line stands as a group of its own under its message id, and the
  // turn's journal, still being written, was previewed in the turn's group.
  sync.applyMessages(page([mainGroup(messageId(1), [ask(1, 1, "what needs me?", NOW)])], "c1"));
  sync.applyMessages(
    page(
      [mainGroup(turnId(1), [reply(2, 2, NOW + 500)], turn(turnId(1), TURN_STATUS.RUNNING, NOW))],
      "c2",
    ),
  );
  assert.deepEqual(
    sync
      .snapshot()
      .groups.map((group) => [
        group.turnId,
        group.messages.map((message) => [message.message.id, message.seq]),
      ]),
    [
      [messageId(1), [[messageId(1), 1]]],
      [turnId(1), [[messageId(2), 2]]],
    ],
  );
  const before = sync.revision;
  // The store placed the line into the turn at a fresh sequence and moved the journal behind it.
  sync.applyMessages(
    page(
      [
        mainGroup(
          turnId(1),
          [ask(1, 3, "what needs me?", NOW), reply(2, 4, NOW + 500)],
          turn(turnId(1), TURN_STATUS.SETTLED, NOW),
        ),
      ],
      "c3",
    ),
  );
  assert.ok(sync.revision > before);
  assert.deepEqual(
    sync
      .snapshot()
      .groups.map((group) => [
        group.turnId,
        group.messages.map((message) => [message.message.id, message.seq]),
      ]),
    [
      [
        turnId(1),
        [
          [messageId(1), 3],
          [messageId(2), 4],
        ],
      ],
    ],
  );
  // The moved message is still the one a rating finds, at its new place.
  assert.deepEqual(sync.rateable(messageId(2)), { announcement: false });
  // The same page again moves nothing.
  const settled = sync.revision;
  sync.applyMessages(
    page(
      [
        mainGroup(
          turnId(1),
          [ask(1, 3, "what needs me?", NOW), reply(2, 4, NOW + 500)],
          turn(turnId(1), TURN_STATUS.SETTLED, NOW),
        ),
      ],
      "c4",
    ),
  );
  assert.equal(sync.revision, settled);
});
