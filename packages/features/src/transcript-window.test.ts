import assert from "node:assert/strict";
import { MESSAGE_ROLE } from "@luke/wire";
import { test } from "vitest";
import {
  joinedWindowRows,
  TRANSCRIPT_WINDOW,
  type TranscriptWindowPartRow,
  type TranscriptWindowRow,
  windowMessagesOf,
} from "./transcript-window.js";

/**
 * A window followed by cursor joins each answer past the cursor onto the
 * rows it holds by message id, so the messages the answer names stand as it
 * names them, a message moved to a later place among them, and every other
 * message the window holds stands as it was, the newest `TRANSCRIPT_WINDOW`
 * kept.
 */

/** A developer's line of the window, at its place, holding as many parts as it names. */
function row(id: string, seq: number, partCount: number): TranscriptWindowRow {
  return {
    id,
    seq,
    clientId: id,
    turnId: null,
    role: MESSAGE_ROLE.USER,
    partCount,
    metadata: null,
    placedAt: seq,
    finishedAt: null,
    sender: null,
    senderName: null,
    senderModel: null,
    memberId: null,
    memberName: null,
    agentId: null,
    agentTaskId: null,
    journalId: null,
    afterStep: null,
    askTurnId: null,
    askAfterStep: null,
    turnStartedAt: null,
    turnStatus: null,
    turnModel: null,
    turnEffort: null,
    turnUsage: null,
    turnFailure: null,
    turnFastRefused: null,
  };
}

/** One part of a message, its words. */
function part(messageId: string, index: number, text: string): TranscriptWindowPartRow {
  return {
    messageId,
    index,
    part: { type: "text", text },
    cutField: null,
    bytes: null,
    head: null,
    tail: null,
  };
}

test("a window followed by cursor joins an answer past the cursor by message id: a message it moved stands once at its new place, grown, the rest as held, the newest window kept", () => {
  const held = Array.from({ length: TRANSCRIPT_WINDOW }, (_, at) => `line-${at + 1}`);
  const window = {
    window: held.map((id, at) => row(id, at + 1, 1)),
    windowParts: held.map((id) => part(id, 0, id)),
  };
  const answer = {
    window: [row("line-2", TRANSCRIPT_WINDOW + 1, 2), row("reply", TRANSCRIPT_WINDOW + 2, 1)],
    windowParts: [
      part("line-2", 0, "line-2"),
      part("line-2", 1, "and more"),
      part("reply", 0, "reply"),
    ],
  };

  const joined = joinedWindowRows(window, answer);
  const drawn = windowMessagesOf(joined.window, joined.windowParts);

  assert.deepEqual(
    drawn.map((message) => message.id),
    [...held.slice(2), "line-2", "reply"],
  );
  assert.deepEqual(drawn.find((message) => message.id === "line-2")?.parts, [
    { type: "text", text: "line-2" },
    { type: "text", text: "and more" },
  ]);
});
