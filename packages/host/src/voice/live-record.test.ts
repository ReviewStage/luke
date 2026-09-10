import assert from "node:assert/strict";
import test from "node:test";
import { MAIN_SESSION_KEY, type SessionKey } from "@sidecar/runtime/vocabulary";
import { CONVERSATION_ENTRY_KIND, type ConversationEntry } from "@sidecar/session";
import { conversationLiveRecord } from "./live-record.js";

function writer() {
  const written: { entry: ConversationEntry; recordedAt: number; sessionKey: SessionKey }[] = [];
  let ids = 0;
  const record = conversationLiveRecord({
    recordConversationEntry: (entry, recordedAt, sessionKey) => {
      written.push({ entry, recordedAt, sessionKey });
      return true;
    },
    createEventId: () => `event-${++ids}`,
  });
  return { record, written };
}

test("a developer utterance is main's spoken-ask line tied to its run, carrying none of the session's identifiers", async () => {
  const { record, written } = writer();
  const taken = await record.writeDeveloperUtterance({
    text: "  what needs me? ",
    voiceSessionId: "sess_1",
    delegationId: "item_1",
    askContext: { sinceMs: 0, untilMs: 2500 },
    startMs: 1000,
    endMs: 2400,
    runId: "run-1",
    recordedAt: 42,
  });
  assert.equal(taken, true);
  assert.deepEqual(written, [
    {
      entry: {
        kind: CONVERSATION_ENTRY_KIND.SPOKEN_ASK,
        words: "what needs me?",
        eventId: "event-1",
        requestId: "run-1",
      },
      recordedAt: 42,
      sessionKey: MAIN_SESSION_KEY,
    },
  ]);
});

test("a developer utterance with no run carries no request id", async () => {
  const { record, written } = writer();
  await record.writeDeveloperUtterance({
    text: "hello",
    voiceSessionId: "sess_1",
    delegationId: null,
    askContext: undefined,
    startMs: 0,
    endMs: 400,
    recordedAt: 7,
  });
  assert.deepEqual(Object.keys(written[0]?.entry ?? {}).sort(), ["eventId", "kind", "words"]);
});

test("a Luke utterance is his line of the role given, and the two writes stay two kinds", async () => {
  const { record, written } = writer();
  await record.writeLukeUtterance({
    role: CONVERSATION_ENTRY_KIND.REPLY,
    text: "Two tests are failing.",
    voiceSessionId: "sess_1",
    startMs: 3000,
    endMs: 4200,
    recordedAt: 9,
  });
  await record.writeLukeUtterance({
    role: CONVERSATION_ENTRY_KIND.ANNOUNCEMENT,
    text: "Nukualofa finished.",
    voiceSessionId: "sess_1",
    startMs: 5000,
    endMs: 5600,
    recordedAt: 10,
  });
  assert.deepEqual(
    written.map((line) => [line.entry.kind, line.entry.words, line.recordedAt]),
    [
      [CONVERSATION_ENTRY_KIND.REPLY, "Two tests are failing.", 9],
      [CONVERSATION_ENTRY_KIND.ANNOUNCEMENT, "Nukualofa finished.", 10],
    ],
  );
});

test("a blank utterance is refused rather than written as an empty line", async () => {
  const { record, written } = writer();
  assert.equal(
    await record.writeLukeUtterance({
      role: CONVERSATION_ENTRY_KIND.REPLY,
      text: "   ",
      voiceSessionId: "sess_1",
      startMs: 0,
      endMs: 1,
      recordedAt: 1,
    }),
    false,
  );
  assert.deepEqual(written, []);
});
