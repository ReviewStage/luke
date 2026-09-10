import assert from "node:assert/strict";
import test from "node:test";
import { REALTIME_TOOL } from "@sidecar/actions";
import {
  ABC,
  acceptedRunId,
  answered,
  ask,
  type BrainClientAnswer,
  call,
  edge,
  FakeClient,
  harness,
  message,
  NOW,
  PLAIN_PREPARATION,
  settle,
  submit,
} from "./harness.js";
import { BRAIN_REQUEST_ORIGIN, BRAIN_REQUEST_STATUS } from "./requests.js";
import {
  BRAIN_RUN_EVENT,
  type BrainRunEvent,
  replySentences,
  SLOW_STEP_KIND,
  slowStepOf,
} from "./run-events.js";
import { BRAIN_TOOL, brainToolCatalog, resolveTurnToolPolicy } from "./tools.js";
import { BRAIN_TURN_KIND, BRAIN_TURN_TRIGGER, type BrainTurnDescription } from "./turn.js";

function listen(h: ReturnType<typeof harness>): BrainRunEvent[] {
  const events: BrainRunEvent[] = [];
  h.agent.onRunEvent((event) => events.push(event));
  return events;
}

const readAbc = call("read_1", BRAIN_TOOL.READ_TRANSCRIPT, {
  provider_id: ABC.providerId,
  provider_session_id: ABC.providerSessionId,
});

const messageAbc = (callId: string) =>
  call(callId, REALTIME_TOOL.SEND_SESSION_MESSAGE, {
    provider_id: ABC.providerId,
    provider_session_id: ABC.providerSessionId,
    text: "run the tests",
  });

test("a run that reads a transcript tells its slow step once, then its actions settling, then each sentence, then its end", async () => {
  const h = harness();
  const events = listen(h);
  h.client.answers.push(
    answered([readAbc]),
    answered([message("The tests pass. Nothing needs you!")]),
  );
  const record = await ask(h, "how is it going?");
  assert.equal(record?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
  const runId = record?.runId ?? "";
  assert.deepEqual(events, [
    { kind: BRAIN_RUN_EVENT.SLOW_STEP, runId, step: SLOW_STEP_KIND.TRANSCRIPT_READ },
    { kind: BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId },
    { kind: BRAIN_RUN_EVENT.REPLY_SENTENCE, runId, sentence: "The tests pass." },
    { kind: BRAIN_RUN_EVENT.REPLY_SENTENCE, runId, sentence: "Nothing needs you!" },
    {
      kind: BRAIN_RUN_EVENT.ENDED,
      runId,
      status: BRAIN_REQUEST_STATUS.SUCCEEDED,
      text: "The tests pass. Nothing needs you!",
    },
  ]);
  await h.agent.stop();
});

test("two provider writes are one slow step, and the reply streams only after both are journaled", async () => {
  const h = harness();
  const events = listen(h);
  h.client.answers.push(
    answered([message("Sending."), messageAbc("send_1")]),
    answered([messageAbc("send_2")]),
    answered([message("Both sent.")]),
  );
  const record = await ask(h, "tell them to run the tests, twice");
  assert.equal(record?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
  assert.equal(h.performed.length, 2);
  const kinds = events.map((event) => event.kind);
  assert.deepEqual(kinds, [
    BRAIN_RUN_EVENT.SLOW_STEP,
    BRAIN_RUN_EVENT.ACTIONS_SETTLED,
    BRAIN_RUN_EVENT.REPLY_SENTENCE,
    BRAIN_RUN_EVENT.REPLY_SENTENCE,
    BRAIN_RUN_EVENT.ENDED,
  ]);
  const [slow] = events;
  assert.equal(
    slow?.kind === BRAIN_RUN_EVENT.SLOW_STEP && slow.step,
    SLOW_STEP_KIND.PROVIDER_WRITE,
  );
  // Every sentence follows the settle, and the words said before the action
  // are part of the reply as much as the words after.
  assert.deepEqual(
    events.flatMap((event) =>
      event.kind === BRAIN_RUN_EVENT.REPLY_SENTENCE ? [event.sentence] : [],
    ),
    ["Sending.", "Both sent."],
  );
  await h.agent.stop();
});

/** A model that answers what it is given and then never answers again. */
class HangingClient extends FakeClient {
  hang = false;

  override respond(...args: Parameters<FakeClient["respond"]>): Promise<BrainClientAnswer> {
    if (this.hang) return new Promise(() => {});
    return super.respond(...args);
  }
}

test("a run with no slow step still settles its actions before its sentences, and a cancelled run ends with its end alone", async () => {
  const client = new HangingClient();
  const h = harness({ client });
  const events = listen(h);
  client.answers.push(answered([message("Hello there.")]));
  const first = await ask(h, "hello");
  assert.equal(first?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
  assert.deepEqual(
    events.map((event) => event.kind),
    [BRAIN_RUN_EVENT.ACTIONS_SETTLED, BRAIN_RUN_EVENT.REPLY_SENTENCE, BRAIN_RUN_EVENT.ENDED],
  );
  events.length = 0;

  client.hang = true;
  const accepted = await submit(h, "wait forever");
  const runId = acceptedRunId(accepted);
  await settle();
  await h.agent.cancelAsk(runId);
  await settle();
  assert.equal(h.agent.request(runId)?.status, BRAIN_REQUEST_STATUS.CANCELLED);
  assert.deepEqual(events, [
    { kind: BRAIN_RUN_EVENT.ENDED, runId, status: BRAIN_REQUEST_STATUS.CANCELLED },
  ]);
  await h.agent.stop();
});

test("an observation turn tells nothing, however many transcripts it reads", async () => {
  const h = harness();
  const events = listen(h);
  await h.agent.wake([edge(ABC)]);
  h.client.answers.push(answered([readAbc]), answered([message("")]));
  await h.clock.advance(NOW + 3_000);
  assert.equal(h.wholeReads.length, 1);
  assert.deepEqual(events, []);
  await h.agent.stop();
});

test("a spoken ask's turn is prepared with the spoken origin, and a typed ask's with the typed one", async () => {
  const prepared: BrainTurnDescription[] = [];
  const h = harness({
    prepareTurn: (turn) => {
      prepared.push(turn);
      return PLAIN_PREPARATION(turn);
    },
  });
  h.client.answers.push(answered([message("Yes.")]), answered([message("No.")]));
  const spoken = await h.agent.submitAsk({
    submissionId: "spoken-1",
    question: "is it done?",
    origin: BRAIN_REQUEST_ORIGIN.SPOKEN,
  });
  await h.agent.waitAsk(acceptedRunId(spoken), 60_000);
  assert.equal((await ask(h, "and now?"))?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
  assert.deepEqual(prepared, [
    {
      kind: BRAIN_TURN_KIND.TURN,
      trigger: BRAIN_TURN_TRIGGER.ASK,
      askOrigin: BRAIN_REQUEST_ORIGIN.SPOKEN,
    },
    {
      kind: BRAIN_TURN_KIND.TURN,
      trigger: BRAIN_TURN_TRIGGER.ASK,
      askOrigin: BRAIN_REQUEST_ORIGIN.TYPED,
    },
  ]);
  await h.agent.stop();
});

test("a listener that throws ends no run", async () => {
  const h = harness();
  h.agent.onRunEvent(() => {
    throw new Error("listener");
  });
  h.client.answers.push(answered([message("Fine.")]));
  const record = await ask(h, "hello");
  assert.equal(record?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
  assert.equal(record?.text, "Fine.");
  await h.agent.stop();
});

test("the slow steps are the whole-transcript read and the performer's writes, only when the policy offers them", () => {
  const full = resolveTurnToolPolicy(brainToolCatalog(), {}, BRAIN_TURN_TRIGGER.ASK);
  assert.equal(slowStepOf(full, BRAIN_TOOL.READ_TRANSCRIPT), SLOW_STEP_KIND.TRANSCRIPT_READ);
  assert.equal(slowStepOf(full, REALTIME_TOOL.SEND_SESSION_MESSAGE), SLOW_STEP_KIND.PROVIDER_WRITE);
  assert.equal(slowStepOf(full, BRAIN_TOOL.LIST_SESSIONS), undefined);
  assert.equal(slowStepOf(full, BRAIN_TOOL.WRITE_WORKSPACE_FILE), undefined);
  assert.equal(slowStepOf(full, "no_such_tool"), undefined);
  const noActions = resolveTurnToolPolicy(
    brainToolCatalog(),
    { agent: { deny: [REALTIME_TOOL.SEND_SESSION_MESSAGE] } },
    BRAIN_TURN_TRIGGER.ASK,
  );
  assert.equal(slowStepOf(noActions, REALTIME_TOOL.SEND_SESSION_MESSAGE), undefined);
});

test("a reply splits into its sentences at sentence ends and line breaks, trimmed, none empty", () => {
  assert.deepEqual(replySentences("One. Two!  Three?\nFour…\n\n  Five (done.) Six"), [
    "One.",
    "Two!",
    "Three?",
    "Four…",
    "Five (done.)",
    "Six",
  ]);
  assert.deepEqual(replySentences("Version 2.5 is out. e.g. now"), [
    "Version 2.5 is out.",
    "e.g.",
    "now",
  ]);
  assert.deepEqual(replySentences(""), []);
  assert.deepEqual(replySentences("   \n  "), []);
});
