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
import { CONVERSATION_EVENT_KIND, TURN_ORIGIN, TURN_STATUS } from "@sidecar/wire";
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
  sync.applyEvents([speech(2, 1, CONVERSATION_EVENT_KIND.SPEECH_EXPIRED)], "e1");
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
  sync.applyEvents([speech(1, 2, CONVERSATION_EVENT_KIND.SPEECH_EXPIRED)], "e1");
  assert.equal(heard(), false);
  // An earlier event arriving late does not undo a later one; a later spoken does.
  sync.applyEvents([speech(1, 1, CONVERSATION_EVENT_KIND.SPEECH_OFFERED)], "e2");
  assert.equal(heard(), false);
  sync.applyEvents([speech(1, 3, CONVERSATION_EVENT_KIND.SPEECH_SPOKEN)], "e3");
  assert.equal(heard(), true);
  // A rating is not a speech event.
  const before = sync.revision;
  sync.applyEvents([speech(1, 4, CONVERSATION_EVENT_KIND.RATING)], "e4");
  assert.equal(sync.revision, before);
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
