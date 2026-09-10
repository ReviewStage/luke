/**
 * The words of the reply under way, as the surface is handed them.
 *
 * The harness these read the call through is `#testing/conversation-call-harness`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { BRIEFING_SPEECH_KIND, REALTIME_SERVER_EVENT } from "@sidecar/realtime";
import {
  armDeveloperTurn,
  askBrainDone,
  brainAnswer,
  deviceArrives,
  harness,
  holdTurn,
} from "#testing/conversation-call-harness";

test("the caption grows with the deltas and the final text supersedes them", async () => {
  const context = harness();
  await context.session.connect();
  await holdTurn(context);
  context.session.endTurn(true);

  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    delta: "Two sessions ",
  });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    delta: "need review.",
  });
  // The server's own rendering of the reply corrects whatever the deltas
  // built, so a delta lost to the channel cannot leave a hole on screen.
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DONE,
    transcript: "Two sessions need review, and one failed.",
  });

  assert.deepEqual(context.captions, [
    ["Two sessions "],
    ["Two sessions need review."],
    ["Two sessions need review, and one failed."],
  ]);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("back-to-back responses stack as captions instead of running together", async () => {
  const context = harness();
  await context.session.connect();
  await holdTurn(context);
  context.session.endTurn(true);

  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED,
    item: { id: "item-one" },
  });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    item_id: "item-one",
    delta: "First response.",
  });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED,
    item: { id: "item-two" },
  });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    item_id: "item-two",
    delta: "Second response.",
  });

  // The second response's words start a caption of their own rather than
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // being spliced onto the first's without so much as a space.
  assert.deepEqual(context.captions.at(-1), ["First response.", "Second response."]);

  // The first response's own final rendering lands on its own caption — even
  // though the turn has moved on — instead of erasing the pair.
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DONE,
    item_id: "item-one",
    transcript: "First response, corrected.",
  });
  assert.deepEqual(context.captions.at(-1), ["First response, corrected.", "Second response."]);

  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DONE,
    item_id: "item-two",
    transcript: "Second response, finished.",
  });
  assert.deepEqual(context.captions.at(-1), [
    "First response, corrected.",
    "Second response, finished.",
  ]);

  // A third response is kept with the rest: the call reports the whole reply,
  // and how many of its segments fit under the housing is the surface's own
  // question, answered from the room it has rather than a count.
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED,
    item: { id: "item-three" },
  });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    item_id: "item-three",
    delta: "Third.",
  });
  assert.deepEqual(context.captions.at(-1), [
    "First response, corrected.",
    "Second response, finished.",
    "Third.",
  ]);
});

test("a brain follow-up keeps the words said before the ask and stacks the answer", async () => {
  const context = harness({ askBrain: async () => brainAnswer("Sent.") });
  await context.session.connect();
  await armDeveloperTurn(context);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-1" } });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED,
    item: { id: "item-ask" },
  });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    item_id: "item-ask",
    delta: "Sending that now.",
  });
  context.emit(askBrainDone("add tests", { responseId: "resp-1" }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  // The follow-up continues the exchange, so the sentence spoken before the
  // ask stays on the strip and the answer's words stack under it, instead of
  // the answer erasing words still being read.
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED,
    item: { id: "item-outcome" },
  });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    item_id: "item-outcome",
    delta: "Sent.",
  });
  assert.deepEqual(context.captions.at(-1), ["Sending that now.", "Sent."]);
});

test("the caption leaves when the reply does", async () => {
  const context = harness();
  await context.session.connect();
  await holdTurn(context);
  context.session.endTurn(true);
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    delta: "All quiet.",
  });
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_DONE });
  // Generation finishing is not speech finishing: the words stay up while
  // Luke is still saying them.
  assert.deepEqual(context.captions, [["All quiet."]]);

  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED });

  assert.deepEqual(context.captions, [["All quiet."], undefined]);
});

test("a briefing's caption clears with the reply, and a conversation's stands on its own", async () => {
  const context = harness();
  await context.session.connect();

  context.session.speak({
    kind: BRIEFING_SPEECH_KIND,
    briefing: "Checkout just finished, and billing wants the migration approved.",
    decidedAt: Date.now(),
  });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    delta: "Checkout just finished.",
  });
  assert.deepEqual(context.captions, [undefined, ["Checkout just finished."]]);

  // The reply ending takes the words with it.
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_DONE });
  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED });
  assert.equal(context.captions.at(-1), undefined);

  // A conversation reply is nobody's briefing, whatever was said before.
  await holdTurn(context);
  context.session.endTurn(true);
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    delta: "Two sessions need review.",
  });
  assert.deepEqual(context.captions.at(-1), ["Two sessions need review."]);
});

test("taking the turn cuts the caption with the audio", async () => {
  const context = harness();
  await context.session.connect();
  context.deliverRemoteTrack();
  await holdTurn(context);
  context.session.endTurn(true);
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    delta: "A sentence the developer is about to talk over",
  });

  // The caption already holds words the room has not heard — the text runs
  // ahead of the speech — so an interrupt must take it down at once rather
  // than leaving Luke finishing a sentence he was stopped from saying. The
  // cut lands at the press, before the device has even opened.
  context.session.beginTurn();

  assert.equal(context.captions.at(-1), undefined);
  assert.equal(context.captions.length, 2);
});

test("a cancelled reply's late transcript cannot pollute the next caption", async () => {
  const context = harness();
  await context.session.connect();
  context.deliverRemoteTrack();
  await holdTurn(context);
  context.session.endTurn(true);
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED,
    item: { id: "item-first" },
  });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    item_id: "item-first",
    delta: "The first reply",
  });

  // Talking over the reply cuts it, but the server had already produced the
  // rest of its transcript, which keeps arriving — around the interrupt, and
  // even after the next reply has been asked for.
  context.session.beginTurn();
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    item_id: "item-first",
    delta: ", still streaming in",
  });
  await deviceArrives();
  context.session.stopListening(true);
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DONE,
    item_id: "item-first",
    transcript: "The first reply, finished anyway.",
  });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED,
    item: { id: "item-second" },
  });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    item_id: "item-second",
    delta: "The second reply",
  });

  assert.deepEqual(context.captions.at(-1), ["The second reply"]);
  assert.equal(
    context.captions.some((caption) => caption?.includes("The first reply, finished anyway.")),
    false,
  );
});
