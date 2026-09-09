import assert from "node:assert/strict";
import test from "node:test";
import { REALTIME_CLIENT_EVENT } from "@sidecar/realtime";
import type { WireRecord } from "@sidecar/wire";
import { Interruption } from "./interruption";

const SPAN = { itemId: "item-1", audioEndMs: 1_200 } as const;

function ledger(): { interruption: Interruption; sent: WireRecord[]; errors: string[] } {
  const sent: WireRecord[] = [];
  const errors: string[] = [];
  return {
    interruption: new Interruption({
      send: (events) => sent.push(...events),
      onError: (message) => errors.push(message),
    }),
    sent,
    errors,
  };
}

function types(sent: readonly WireRecord[]): readonly unknown[] {
  return sent.map((event) => event.type);
}

function eventId(sent: readonly WireRecord[], type: string): unknown {
  return sent.find((event) => event.type === type)?.event_id;
}

test("a cut with generation outstanding cancels, clears, and trims", () => {
  const context = ledger();
  context.interruption.cut({ cancelGeneration: true, truncate: SPAN });

  assert.deepEqual(types(context.sent), [
    REALTIME_CLIENT_EVENT.RESPONSE_CANCEL,
    REALTIME_CLIENT_EVENT.OUTPUT_AUDIO_BUFFER_CLEAR,
    REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_TRUNCATE,
  ]);
});

test("a reply the server has already concluded is cleared without a cancel", () => {
  const context = ledger();
  context.interruption.cut({ cancelGeneration: false, truncate: SPAN });

  assert.deepEqual(types(context.sent), [
    REALTIME_CLIENT_EVENT.OUTPUT_AUDIO_BUFFER_CLEAR,
    REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_TRUNCATE,
  ]);
});

test("nothing heard leaves nothing to correct", () => {
  const context = ledger();
  context.interruption.cut({ cancelGeneration: true, truncate: undefined });

  assert.deepEqual(types(context.sent), [
    REALTIME_CLIENT_EVENT.RESPONSE_CANCEL,
    REALTIME_CLIENT_EVENT.OUTPUT_AUDIO_BUFFER_CLEAR,
  ]);
});

test("each cut stamps its own names, so no two cuts' refusals can be confused", () => {
  const context = ledger();
  context.interruption.cut({ cancelGeneration: true, truncate: SPAN });
  const first = eventId(context.sent, REALTIME_CLIENT_EVENT.RESPONSE_CANCEL);
  context.sent.length = 0;
  context.interruption.cut({ cancelGeneration: true, truncate: SPAN });

  assert.notEqual(eventId(context.sent, REALTIME_CLIENT_EVENT.RESPONSE_CANCEL), first);
});

test("the answers still owed are bounded, oldest dropped first", () => {
  const context = ledger();
  // Twelve cuts of two requests each fill the bound exactly; the thirteenth
  // has to evict the first cut's names to fit.
  for (let index = 0; index < 13; index += 1) {
    context.interruption.cut({ cancelGeneration: true, truncate: undefined });
  }

  assert.equal(
    context.interruption.error({
      message: "Cancellation failed: no active response.",
      eventId: "response_cancel_1",
      errorType: "invalid_request_error",
    }),
    false,
    "the first cut's name was dropped to make room",
  );
  assert.equal(
    context.interruption.error({
      message: "Cancellation failed: no active response.",
      eventId: "response_cancel_13",
      errorType: "invalid_request_error",
    }),
    true,
  );
});

test("the documented no-active-response race is answered and never shown", () => {
  const context = ledger();
  context.interruption.cut({ cancelGeneration: true, truncate: undefined });
  const cancellationEventId = String(eventId(context.sent, REALTIME_CLIENT_EVENT.RESPONSE_CANCEL));

  const answered = context.interruption.error({
    message: "Cancellation failed: no active response.",
    eventId: cancellationEventId,
    errorType: "invalid_request_error",
  });

  assert.equal(answered, true);
  assert.deepEqual(context.errors, []);
});

test("a cancellation refused for any other reason still reaches the developer", () => {
  const context = ledger();
  context.interruption.cut({ cancelGeneration: true, truncate: undefined });
  const cancellationEventId = String(eventId(context.sent, REALTIME_CLIENT_EVENT.RESPONSE_CANCEL));

  const answered = context.interruption.error({
    message: "Cancellation failed: the session is closed.",
    eventId: cancellationEventId,
    errorType: "invalid_request_error",
  });

  assert.equal(answered, true);
  assert.deepEqual(context.errors, ["Cancellation failed: the session is closed."]);
});

test("a clear or a trim refused is reported however the cancel would have been read", () => {
  const context = ledger();
  context.interruption.cut({ cancelGeneration: true, truncate: SPAN });
  const truncationEventId = String(
    eventId(context.sent, REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_TRUNCATE),
  );

  // The benign sentence belongs to a cancellation alone: read against a trim
  // it is an error nobody has explained, and staying quiet would hide it.
  context.interruption.error({
    message: "Cancellation failed: no active response.",
    eventId: truncationEventId,
    errorType: "invalid_request_error",
  });

  assert.deepEqual(context.errors, ["Cancellation failed: no active response."]);
});

test("an error naming no event, or one this ledger never sent, is not its own", () => {
  const context = ledger();
  context.interruption.cut({ cancelGeneration: true, truncate: undefined });

  assert.equal(context.interruption.error({ message: "The session expired." }), false);
  assert.equal(
    context.interruption.error({ message: "The session expired.", eventId: "someone_else_1" }),
    false,
  );
  assert.deepEqual(context.errors, []);
});

test("an answer is taken once", () => {
  const context = ledger();
  context.interruption.cut({ cancelGeneration: false, truncate: undefined });
  const clearEventId = String(
    eventId(context.sent, REALTIME_CLIENT_EVENT.OUTPUT_AUDIO_BUFFER_CLEAR),
  );

  assert.equal(context.interruption.error({ message: "Refused.", eventId: clearEventId }), true);
  assert.equal(context.interruption.error({ message: "Refused.", eventId: clearEventId }), false);
  assert.deepEqual(context.errors, ["Refused."]);
});

test("a trim refused past the audio's end is recognized by its sentence alone", () => {
  assert.equal(
    Interruption.pastAudioEnd("Audio content of 4200ms is already shorter than 4300ms."),
    true,
  );
  assert.equal(Interruption.pastAudioEnd("Audio content could not be trimmed."), false);
});

test("a call's answers go with it, and the names keep counting", () => {
  const context = ledger();
  context.interruption.cut({ cancelGeneration: false, truncate: undefined });
  const clearEventId = String(
    eventId(context.sent, REALTIME_CLIENT_EVENT.OUTPUT_AUDIO_BUFFER_CLEAR),
  );
  context.sent.length = 0;

  context.interruption.reset();

  assert.equal(context.interruption.error({ message: "Refused.", eventId: clearEventId }), false);
  context.interruption.cut({ cancelGeneration: false, truncate: undefined });
  assert.notEqual(
    eventId(context.sent, REALTIME_CLIENT_EVENT.OUTPUT_AUDIO_BUFFER_CLEAR),
    clearEventId,
  );
});
