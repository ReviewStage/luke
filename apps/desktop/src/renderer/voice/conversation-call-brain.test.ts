/**
 * Asking the brain, and the follow-up that voices its answer.
 *
 * The harness these read the call through is `#testing/conversation-call-harness`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { BRAIN_ASK_PENDING_NOTE } from "@sidecar/brain/requests";
import { BRAIN_ASK_PENDING_STATUS, type BrainAskResult } from "@sidecar/brain/requests-wire";
import {
  ASK_BRAIN_TOOL,
  REALTIME_CLIENT_EVENT,
  REALTIME_SERVER_EVENT,
  REALTIME_STATUS,
} from "@sidecar/realtime";
import { REPLY_KIND } from "@sidecar/voice/orchestrator";
import { ACTION_RESULT_STATUS, isRecord } from "@sidecar/wire";
import type { ParsedJsonObject } from "@sidecar/wire/testing";
import {
  armDeveloperTurn,
  askBrainCall,
  askBrainDone,
  brainAnswer,
  brainPending,
  briefingAbout,
  deviceArrives,
  harness,
  holdTurn,
  responseCreates,
  settleReply,
  toolOutputs,
} from "#testing/conversation-call-harness";
import { BRAIN_ASK_SETTLE_TIMEOUT_MS, REALTIME_SETTLE_TIMEOUT_MS } from "./speak-only-call";

test("a typed ask's reply trims the interrupted reply to what was heard", async () => {
  let now = 10_000;
  const context = harness({ now: () => now });
  await context.session.connect();
  context.deliverRemoteTrack();
  await armDeveloperTurn(context);
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED,
    item: { id: "item-1" },
  });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    item_id: "item-1",
    delta: "There are two sessions",
  });
  context.session.reportRemoteAudioActive();
  now = 11_200;
  const sentBefore = context.sent.length;

  assert.equal(context.session.speakReply("Opening the Codex one."), true);

  // The reply being talked over is cut the way holding the talk key cuts it:
  // silenced at once, cancelled, and trimmed to what was actually heard.
  assert.equal(context.lukeAudible(), false);
  assert.deepEqual(
    context.sent.slice(sentBefore).map((event) => event.type),
    [
      REALTIME_CLIENT_EVENT.RESPONSE_CANCEL,
      REALTIME_CLIENT_EVENT.OUTPUT_AUDIO_BUFFER_CLEAR,
      REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_TRUNCATE,
      REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_CREATE,
      REALTIME_CLIENT_EVENT.RESPONSE_CREATE,
    ],
  );
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
});

test("an ask the brain has not finished with is answered pending under the call's own id, and the turn is released", async () => {
  const context = harness({ askBrain: async () => brainPending() });
  await context.session.connect();
  await armDeveloperTurn(context);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-a" } });
  const before = context.sent.length;
  context.emit(
    askBrainDone("read every transcript", { callId: "call-slow", responseId: "resp-a" }),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  // The tool call's id is the submission, so the service repeating the call
  // finds the same run rather than opening a second one.
  assert.deepEqual(context.asked, ["read every transcript"]);
  assert.deepEqual(context.submissions, ["call-slow"]);
  // The output says the run goes on; the follow-up voices that, and nothing
  // here holds the turn open for the eventual reply.
  assert.deepEqual(toolOutputs(context, before), [
    { status: BRAIN_ASK_PENDING_STATUS, note: BRAIN_ASK_PENDING_NOTE },
  ]);
  assert.equal(responseCreates(context, before).length, 1);
});

test("a cancelled reply's late finish cannot ask the brain in the turn that replaced it", async () => {
  const context = harness({ askBrain: async () => brainAnswer("Done.") });
  await context.session.connect();
  // A spoken turn opens reply A, and the server confirms it by name.
  await armDeveloperTurn(context);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-a" } });
  // The developer speaks over it, opening a new turn.
  await armDeveloperTurn(context);
  const sentBefore = context.sent.length;

  // Reply A's finished form arrives late — the server had completed it before
  // the cancel landed — carrying the very ask the developer interrupted.
  context.emit(askBrainDone("do it anyway", { callId: "call-stale", responseId: "resp-a" }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  // Nothing reached the brain: only the freshness of the reply stands between
  // the call and the ask, and it holds against a turn the developer moved on
  // from.
  assert.deepEqual(context.asked, []);
  assert.deepEqual(toolOutputs(context, sentBefore), [
    {
      status: ACTION_RESULT_STATUS.REJECTED,
      reason: "That turn is over; ask again if it still matters.",
    },
  ]);
  // No reply was opened to voice the refusal, and the new turn is still under way.
  assert.deepEqual(responseCreates(context, sentBefore), []);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);

  // The reply the new turn actually asked for still asks in full.
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-b" } });
  context.emit(askBrainDone("status?", { callId: "call-fresh", responseId: "resp-b" }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(context.asked, ["status?"]);
});

test("a cancelled reply's late finish does not end the turn that replaced it", async () => {
  const context = harness();
  await context.session.connect();
  context.deliverRemoteTrack();
  await armDeveloperTurn(context);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-a" } });
  assert.equal(context.session.speakReply("Two sessions need you."), true);

  // Reply A finishes late with nothing to say, while reply B is still in the
  // quiet gap before its first word.
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_DONE, response: { id: "resp-a" } });
  context.session.reportRemoteAudioIdle();

  // A stale finish must not mark generation done: paired with that gap's
  // quiet, it would end a reply that has not begun to be heard.
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
});

test("a typed ask's reply before the call is open reports it could not go", () => {
  const context = harness();

  assert.equal(context.session.speakReply("Two sessions need you."), false);
  assert.deepEqual<ParsedJsonObject[]>(context.sent, []);
});

test("a spoken ask goes to the brain and its answer is voiced", async () => {
  const context = harness({
    askBrain: async () => brainAnswer("Claude Code is on the tests now."),
  });
  await context.session.connect();
  // The call arrives inside a turn the developer opened by speaking.
  await armDeveloperTurn(context);
  const sentBefore = context.sent.length;

  context.emit(askBrainDone("ask claude code to add tests"));
  await new Promise((resolve) => setTimeout(resolve, 0));

  // The developer's words reach the brain as the voice passed them, and the
  // brain's reply is the tool's output, for the follow-up to say.
  assert.deepEqual(context.asked, ["ask claude code to add tests"]);
  assert.deepEqual(toolOutputs(context, sentBefore), [
    { reply: "Claude Code is on the tests now." },
  ]);
  // The follow-up that says it carries no tools: it was opened to say what the
  // brain answered, not to ask it again.
  assert.deepEqual(responseCreates(context, sentBefore), [
    { type: REALTIME_CLIENT_EVENT.RESPONSE_CREATE, response: { tools: [], tool_choice: "none" } },
  ]);
  assert.equal(context.sent.at(-1)?.type, REALTIME_CLIENT_EVENT.RESPONSE_CREATE);
  // The turn never ended: the reply resumes over the answer.
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);

  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED,
    item: { id: "item-answer" },
  });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    item_id: "item-answer",
    delta: "Claude Code is on the tests now.",
  });
  settleReply(context);

  // Conversation records the words as a reply, naming the run whose end they voice.
  assert.deepEqual(context.replyEndings, [
    {
      texts: ["Claude Code is on the tests now."],
      kind: REPLY_KIND.REPLY,
      runId: "run-1",
    },
  ]);
});

test("a rejected answer's reason is the tool's output, and the follow-up still speaks", async () => {
  const context = harness({
    askBrain: async () => ({
      status: ACTION_RESULT_STATUS.REJECTED,
      reason: "That session is no longer observed.",
    }),
  });
  await context.session.connect();
  await armDeveloperTurn(context);
  const sentBefore = context.sent.length;

  context.emit(askBrainDone("open the codex one"));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(toolOutputs(context, sentBefore), [
    { status: ACTION_RESULT_STATUS.REJECTED, reason: "That session is no longer observed." },
  ]);
  // The refusal is voiced like any answer.
  assert.equal(responseCreates(context, sentBefore).length, 1);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
});

test("a call with no brain behind it is refused, and the refusal is voiced", async () => {
  const context = harness();
  await context.session.connect();
  await armDeveloperTurn(context);
  const sentBefore = context.sent.length;

  context.emit(askBrainDone("what needs me?"));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(toolOutputs(context, sentBefore), [
    {
      status: ACTION_RESULT_STATUS.REJECTED,
      reason: "Luke's judgment is not available on this call.",
    },
  ]);
  assert.equal(responseCreates(context, sentBefore).length, 1);
});

test("an ask carrying no words never reaches the brain", async () => {
  const context = harness({ askBrain: async () => brainAnswer("Done.") });
  await context.session.connect();
  await armDeveloperTurn(context);
  const sentBefore = context.sent.length;

  context.emit(askBrainDone("   "));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(context.asked, []);
  assert.deepEqual(toolOutputs(context, sentBefore), [
    { status: ACTION_RESULT_STATUS.REJECTED, reason: "The ask carried no words." },
  ]);
});

test("a call to a tool the voice was never given is refused before the brain", async () => {
  const context = harness({ askBrain: async () => brainAnswer("Done.") });
  await context.session.connect();
  await armDeveloperTurn(context);
  const sentBefore = context.sent.length;

  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: {
      output: [
        {
          type: "function_call",
          name: "send_session_message",
          call_id: "call-1",
          arguments:
            '{"provider_id":"claude-code","provider_session_id":"session-a","text":"add tests"}',
        },
      ],
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(context.asked, []);
  assert.deepEqual(toolOutputs(context, sentBefore), [
    { status: ACTION_RESULT_STATUS.REJECTED, reason: "No such tool exists." },
  ]);
});

test("a response waits for every ask's answer before one tool-free follow-up", async () => {
  const pending = new Map<string, (result: BrainAskResult) => void>();
  const context = harness({
    askBrain: (question) => new Promise((resolve) => pending.set(question, resolve)),
  });
  await context.session.connect();
  await armDeveloperTurn(context);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-tools" } });
  const sentBefore = context.sent.length;

  const calls = [askBrainCall("first", "call-first"), askBrainCall("second", "call-second")];
  for (const item of calls) {
    context.emit({ type: "response.output_item.done", response_id: "resp-tools", item });
  }
  await Promise.resolve();

  pending.get("second")?.(brainAnswer("Second."));
  await new Promise((resolve) => setTimeout(resolve, 0));
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: { id: "resp-tools", output: calls },
  });
  assert.deepEqual(responseCreates(context, sentBefore), []);

  pending.get("first")?.(brainAnswer("First."));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(responseCreates(context, sentBefore), [
    { type: REALTIME_CLIENT_EVENT.RESPONSE_CREATE, response: { tools: [], tool_choice: "none" } },
  ]);
});

test("malformed SDK call details are refused before the brain", async () => {
  const context = harness({ askBrain: async () => brainAnswer("Done.") });
  await context.session.connect();

  assert.deepEqual(await context.executeSdkTool(ASK_BRAIN_TOOL.name, undefined), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: "The tool call was malformed.",
  });
  assert.deepEqual(
    await context.executeSdkTool(ASK_BRAIN_TOOL.name, {
      toolCall: { type: "function_call", callId: "call-1", name: ASK_BRAIN_TOOL.name },
    }),
    { status: ACTION_RESULT_STATUS.REJECTED, reason: "The tool arguments were malformed." },
  );
  assert.deepEqual(context.asked, []);
});

test("a brain that throws is refused with a bounded reason", async () => {
  const context = harness({
    askBrain: async () => {
      throw new Error("The bridge dropped the ask.");
    },
  });
  await context.session.connect();
  await armDeveloperTurn(context);
  const sentBefore = context.sent.length;

  context.emit(askBrainDone("add tests"));
  await new Promise((resolve) => setTimeout(resolve, 0));

  // The error's own words never reach the model; the refusal is fixed by the build.
  assert.deepEqual(toolOutputs(context, sentBefore), [
    { status: ACTION_RESULT_STATUS.REJECTED, reason: "Luke's judgment did not answer." },
  ]);
});

test("the brain's reply to a typed ask is spoken on the briefing's own terms", async () => {
  const context = harness();
  await context.session.connect();
  const sentBefore = context.sent.length;

  assert.equal(context.session.speakReply("Two sessions need you."), true);

  // The reply travels on the briefing's own terms: one marked item joining
  // the conversation, spoken by a response with its tools withheld.
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  assert.deepEqual(
    context.sent.slice(sentBefore).map((event) => event.type),
    [REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_CREATE, REALTIME_CLIENT_EVENT.RESPONSE_CREATE],
  );
  const [request] = responseCreates(context, sentBefore);
  assert.ok(isRecord(request?.response));
  assert.equal(request.response.conversation, undefined);
  assert.equal(request.response.instructions, undefined);
  assert.deepEqual(request.response.tools, []);

  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    delta: "Two sessions need you.",
  });
  settleReply(context);
  assert.deepEqual(context.replyEndings, [
    {
      texts: ["Two sessions need you."],
      kind: REPLY_KIND.REPLY,
    },
  ]);
  // A reply with nothing to say opens nothing.
  assert.equal(context.session.speakReply("   "), false);
});

test("the brain's reply interrupts the reply it arrives over, never the developer's microphone", async () => {
  const context = harness();
  await context.session.connect();
  context.deliverRemoteTrack();
  await armDeveloperTurn(context);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-1" } });
  const sentBefore = context.sent.length;

  assert.equal(context.session.speakReply("Here is the answer."), true);
  assert.equal(context.lukeAudible(), false);
  assert.deepEqual(
    context.sent.slice(sentBefore).map((event) => event.type),
    [
      REALTIME_CLIENT_EVENT.RESPONSE_CANCEL,
      REALTIME_CLIENT_EVENT.OUTPUT_AUDIO_BUFFER_CLEAR,
      REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_CREATE,
      REALTIME_CLIENT_EVENT.RESPONSE_CREATE,
    ],
  );
  settleReply(context);

  // Half a spoken question is still the developer's.
  await holdTurn(context);
  assert.equal(context.session.speakReply("Here is the answer."), false);
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);
});

test("the brain's answer is not spoken over a turn the developer has taken", async () => {
  let answer: ((result: BrainAskResult) => void) | undefined;
  const context = harness({
    askBrain: () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  });
  await context.session.connect();
  await armDeveloperTurn(context);
  const sentBefore = context.sent.length;

  context.emit(askBrainDone("add tests"));
  // Let the call reach the point where it is awaiting the brain.
  await Promise.resolve();
  // The developer takes the turn while the ask is still out.
  context.session.beginTurn();
  await deviceArrives();
  answer?.(brainAnswer("Sent."));
  await new Promise((resolve) => setTimeout(resolve, 0));

  // The answer was still delivered as an item, so the model is not left
  // waiting — but no reply was opened to voice it over the microphone now open.
  assert.deepEqual(toolOutputs(context, sentBefore), [{ reply: "Sent." }]);
  assert.deepEqual(responseCreates(context, sentBefore), []);
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);
});

test("a drained reply that asked the brain holds the turn for the follow-up it owes", async () => {
  let answer: ((result: BrainAskResult) => void) | undefined;
  const context = harness({
    askBrain: () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  });
  await context.session.connect();
  await armDeveloperTurn(context);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-1" } });

  // The spoken half's audio drains before the done that carries the call.
  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED });
  context.emit(askBrainDone("add tests", { responseId: "resp-1" }));
  await Promise.resolve();

  // The turn holds while the brain thinks: the READY an ending here would
  // offer is the edge the briefing queue rides, and a briefing taken there
  // would abandon the follow-up that is the answer's only voice.
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  assert.equal(context.session.speak(briefingAbout("session-b")), false);

  answer?.(brainAnswer("Sent."));
  await new Promise((resolve) => setTimeout(resolve, 0));

  // The follow-up opened: the answer is voiced rather than abandoned.
  assert.equal(responseCreates(context).length, 2);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
});

test("an ask out to the brain gets a clock of its own, longer than a reply's", async (t) => {
  const context = harness({ askBrain: () => new Promise(() => undefined) });
  await context.session.connect();
  await armDeveloperTurn(context);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-1" } });

  // The drain arms a backstop for the missing done, and nearly spends it.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED });
  t.mock.timers.tick(REALTIME_SETTLE_TIMEOUT_MS - 1);

  // The done it was watching for arrives, carrying the ask: the hold that
  // follows is the ask's, not the tail of the drain's clock.
  context.emit(askBrainDone("add tests", { responseId: "resp-1" }));
  await Promise.resolve();

  // The drain's leftover moment must not cut the hold while the brain
  // thinks, and neither may a reply's whole settle window: a brain turn reads
  // and may act before it answers.
  t.mock.timers.tick(1);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  t.mock.timers.tick(REALTIME_SETTLE_TIMEOUT_MS);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);

  // An ask that hangs past even the brain's own window still meets a
  // backstop: a turn that never ends is worse than one that ends early.
  assert.ok(BRAIN_ASK_SETTLE_TIMEOUT_MS > REALTIME_SETTLE_TIMEOUT_MS);
  t.mock.timers.tick(BRAIN_ASK_SETTLE_TIMEOUT_MS - REALTIME_SETTLE_TIMEOUT_MS);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("audio draining while the ask is out holds the turn the same way", async () => {
  let answer: ((result: BrainAskResult) => void) | undefined;
  const context = harness({
    askBrain: () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  });
  await context.session.connect();
  await armDeveloperTurn(context);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-1" } });

  // The ordinary order: the done carrying the ask lands while the spoken half
  // is still audible, and the audio drains while the brain thinks.
  context.emit(askBrainDone("add tests", { responseId: "resp-1" }));
  await Promise.resolve();
  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED });

  // The same hold, in the mirror order: no READY edge mid-ask for the
  // briefing queue to take the turn on.
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  assert.equal(context.session.speak(briefingAbout("session-b")), false);

  answer?.(brainAnswer("Sent."));
  await new Promise((resolve) => setTimeout(resolve, 0));

  // The follow-up opened: the answer is voiced rather than abandoned.
  assert.equal(responseCreates(context).length, 2);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
});

test("an answer that outlives the backstop cannot speak out of the spent turn", async (t) => {
  let answer: ((result: BrainAskResult) => void) | undefined;
  const context = harness({
    askBrain: () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  });
  await context.session.connect();
  await armDeveloperTurn(context);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-1" } });

  t.mock.timers.enable({ apis: ["setTimeout"] });
  context.emit(askBrainDone("add tests", { responseId: "resp-1" }));
  await Promise.resolve();

  // The ask hangs past the brain's whole window; the backstop declares the
  // turn over, and the developer has been shown the silence.
  t.mock.timers.tick(BRAIN_ASK_SETTLE_TIMEOUT_MS);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
  t.mock.timers.reset();

  const sentBefore = context.sent.length;
  answer?.(brainAnswer("Sent."));
  await new Promise((resolve) => setTimeout(resolve, 0));

  // The answer is still delivered as an item, so the model is not left
  // waiting — but no reply opens out of a silence already declared.
  assert.deepEqual(toolOutputs(context, sentBefore), [{ reply: "Sent." }]);
  assert.deepEqual(responseCreates(context, sentBefore), []);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("a done that outlives the settle backstop cannot ask the brain out of the spent turn", async (t) => {
  const context = harness({ askBrain: async () => brainAnswer("Done.") });
  await context.session.connect();
  await armDeveloperTurn(context);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-1" } });

  // The audio drains, the done never follows, and the backstop ends the turn.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED });
  t.mock.timers.tick(REALTIME_SETTLE_TIMEOUT_MS);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
  t.mock.timers.reset();

  const sentBefore = context.sent.length;
  context.emit(askBrainDone("add tests", { responseId: "resp-1" }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  // The turn ended with the backstop: the late call is answered refused
  // rather than asked out of a turn the developer was already told had
  // ended, and no reply opens over the quiet.
  assert.deepEqual(context.asked, []);
  assert.deepEqual(toolOutputs(context, sentBefore), [
    {
      status: ACTION_RESULT_STATUS.REJECTED,
      reason: "That turn is over; ask again if it still matters.",
    },
  ]);
  assert.deepEqual(responseCreates(context, sentBefore), []);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
});
