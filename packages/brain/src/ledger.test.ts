import assert from "node:assert/strict";
import test from "node:test";
import { RESPONSES_INPUT_ITEM_TYPE } from "@sidecar/hosted";
import { drainMicrotasks } from "@sidecar/runtime/testing";
import { RUN_ORIGIN } from "@sidecar/runtime/vocabulary";
import { ACTION_RESULT_STATUS, isWireString, type WireRecord } from "@sidecar/wire";
import { BrainAgent } from "./agent.js";
import { type BrainPersistedState, freshBrainState } from "./envelope.js";
import {
  ABC,
  acceptedRunId,
  adapterOf,
  answered,
  ask,
  type BrainClient,
  type BrainClientAnswer,
  CARRIES_A_RUNNING_RUN,
  call,
  claude,
  completedRun,
  edge,
  FakeClient,
  failedAnswer,
  functionOutputs,
  gatedClient,
  harness,
  heldPerformer,
  holdNextWrite,
  holdWriteMatching,
  itemsOfType,
  message,
  messageAction,
  NOW,
  nextRunId,
  PLAIN_PREPARATION,
  RECORD_CAP,
  runtimeOver,
  seededRequests,
  submissionsIssued,
  submit,
} from "./harness.js";
import { UNKNOWN_ACTION_RESULT } from "./journal.js";
import {
  BRAIN_REQUEST_FAILURE,
  BRAIN_REQUEST_ORIGIN,
  BRAIN_REQUEST_STATUS,
  BRAIN_SUBMISSION_OUTCOME,
  BRAIN_SUBMISSION_REJECTION,
  type BrainRequestRecord,
  isTerminalBrainRequestStatus,
} from "./requests.js";
import { BrainStateStore } from "./state-store.js";
import { type FakeBrainStateRepository, fakeBrainStateRepository } from "./testing.js";

/**
 * The ledger's own guarantees: an acceptance nobody hears of until its record
 * is written, a mark that never stands in memory before it stands on disk, a
 * run's end staged behind the write that keeps it, and the ordering every
 * overlapping save keeps because the store composes each envelope inside its
 * own queue.
 */

test("a checkpoint that fails before an action refuses it, and acceptance itself needs the record written", async () => {
  const inner = new FakeClient();
  inner.answers.push(
    answered([messageAction("call_1", "one")]),
    answered([message("Nothing sent.")]),
  );
  const gated = gatedClient(inner);
  const h = harness({ client: gated.client });
  h.repository.refuse();
  assert.deepEqual(await submit(h, "send"), {
    outcome: BRAIN_SUBMISSION_OUTCOME.REJECTED,
    reason: BRAIN_SUBMISSION_REJECTION.PERSISTENCE,
  });
  assert.equal(h.agent.requests().length, 0);
  h.repository.accept();
  const runId = acceptedRunId(await submit(h, "send"));
  await drainMicrotasks(20);
  h.repository.refuse();
  gated.open();
  await drainMicrotasks(20);
  const record = h.agent.request(runId);
  assert.equal(record?.status, BRAIN_REQUEST_STATUS.FAILED);
  assert.equal(record?.failure, BRAIN_REQUEST_FAILURE.PERSISTENCE);
  assert.equal(record?.performedActions, 0);
  assert.equal(h.performed.length, 0);
  const refusal = functionOutputs(inner.inputs[1] ?? [])[0];
  assert.ok(refusal?.output.includes("could not be recorded before running"));
  // The disk never saw a started act it could mistake for one that ran.
  assert.equal(h.repository.state?.journal.length, 0);
});

test("a checkpoint that fails after an action keeps its result in memory, blocks further actions, and reports the failure", async () => {
  let acted = 0;
  let repository: FakeBrainStateRepository | undefined;
  const h = harness({
    actions: {
      perform: async (): Promise<WireRecord> => {
        acted += 1;
        // The disk goes away from the moment the first effect has happened.
        repository?.refuse();
        return { status: ACTION_RESULT_STATUS.ACCEPTED };
      },
    },
  });
  repository = h.repository;
  h.client.answers.push(
    answered([messageAction("call_1", "one"), messageAction("call_2", "two")]),
    answered([message("Sent.")]),
  );
  const record = await ask(h, "send two");
  assert.equal(acted, 1);
  assert.equal(record?.status, BRAIN_REQUEST_STATUS.FAILED);
  assert.equal(record?.failure, BRAIN_REQUEST_FAILURE.PERSISTENCE);
  assert.equal(record?.performedActions, 1);
  assert.equal(record?.text, "Sent.");
  const outputs = functionOutputs(h.client.inputs[1] ?? []);
  assert.ok(outputs[0]?.output.includes(ACTION_RESULT_STATUS.ACCEPTED));
  assert.ok(outputs[1]?.output.includes("could not be recorded"));
  // The disk holds the started entry with no result, which a restart reads as unknown.
  const stored = h.repository.state;
  assert.equal(stored?.journal.length, 1);
  assert.equal(stored?.journal[0]?.outputJson, undefined);
  assert.equal(stored?.requests[0]?.status, BRAIN_REQUEST_STATUS.RUNNING);
});

test("a restart marks unfinished runs interrupted and pairs a started act as unknown, never replaying it", async () => {
  const held = heldPerformer();
  const h = harness({ actions: held.actions });
  h.client.answers.push(answered([messageAction("call_1")]), answered([message("Sent.")]));
  const runId = acceptedRunId(await submit(h, "send"));
  await drainMicrotasks(20);
  // The process dies here: the action has started, its result never recorded.
  const stored = h.repository.state;
  assert.equal(stored?.requests[0]?.status, BRAIN_REQUEST_STATUS.RUNNING);
  assert.equal(stored?.journal[0]?.outputJson, undefined);
  assert.equal(functionOutputs(stored?.items ?? []).length, 0);

  const relaunched = harness({}, fakeBrainStateRepository(stored));
  await relaunched.agent.ready();
  const record = relaunched.agent.request(runId);
  assert.equal(record?.status, BRAIN_REQUEST_STATUS.INTERRUPTED);
  assert.equal(relaunched.performed.length, 0);
  const restored = relaunched.repository.state;
  assert.equal(restored?.requests[0]?.status, BRAIN_REQUEST_STATUS.INTERRUPTED);
  const paired = functionOutputs(restored?.items ?? []);
  assert.equal(paired.length, 1);
  assert.ok(paired[0]?.output.includes(UNKNOWN_ACTION_RESULT.status));
  // The next ask opens on a memory with no dangling call, and runs no old act.
  relaunched.client.answers.push(answered([message("Hello.")]));
  const next = await ask(relaunched, "hi");
  assert.equal(next?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
  assert.equal(relaunched.performed.length, 0);
  assert.equal(
    itemsOfType(relaunched.client.inputs[0] ?? [], RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL_OUTPUT)
      .length,
    1,
  );
  // A wait on the interrupted run answers at once; a wait on an unknown run answers nothing.
  assert.equal(
    (await relaunched.agent.waitAsk(runId, 1))?.status,
    BRAIN_REQUEST_STATUS.INTERRUPTED,
  );
  assert.equal(await relaunched.agent.waitAsk("never", 1), undefined);
});

test("a retry of a submission whose acceptance is still being written awaits the same answer", async () => {
  const h = harness();
  await h.agent.ready();
  const releaseWrite = h.repository.hold();
  h.client.answers.push(answered([message("once")]));

  const first = submit(h, "send", "sub-1");
  await drainMicrotasks(20);
  const retry = submit(h, "send", "sub-1");
  const other = submit(h, "send", "sub-1").then(() => h.agent.requests().length);
  await drainMicrotasks(20);
  // Nobody has been told anything yet, and no run stands to be found.
  assert.equal(h.agent.requests().length, 0);
  // The write refuses: every caller hears the same refusal, and no run remains.
  releaseWrite?.(false);
  const answers = await Promise.all([first, retry]);
  assert.deepEqual(answers, [
    { outcome: BRAIN_SUBMISSION_OUTCOME.REJECTED, reason: BRAIN_SUBMISSION_REJECTION.PERSISTENCE },
    { outcome: BRAIN_SUBMISSION_OUTCOME.REJECTED, reason: BRAIN_SUBMISSION_REJECTION.PERSISTENCE },
  ]);
  assert.equal(await other, 0);
  assert.equal(h.agent.requests().length, 0);

  // The write lands: both callers hear the one run, which executes once.
  const accepted = await Promise.all([submit(h, "send", "sub-1"), submit(h, "send", "sub-1")]);
  assert.equal(accepted[0]?.outcome, BRAIN_SUBMISSION_OUTCOME.ACCEPTED);
  assert.deepEqual(accepted[0], accepted[1]);
  await drainMicrotasks(20);
  assert.equal(h.client.inputs.length, 1);
  assert.equal(h.agent.requests().length, 1);
  // The same id with other words, or another origin, is a conflict, not a retry.
  assert.deepEqual(await submit(h, "send something else", "sub-1"), {
    outcome: BRAIN_SUBMISSION_OUTCOME.REJECTED,
    reason: BRAIN_SUBMISSION_REJECTION.CONFLICT,
  });
  assert.equal(
    (
      await h.agent.submitAsk({
        submissionId: "sub-1",
        question: "send",
        origin: BRAIN_REQUEST_ORIGIN.SPOKEN,
      })
    ).outcome,
    BRAIN_SUBMISSION_OUTCOME.REJECTED,
  );
});

test("a stop while an acceptance is being written interrupts the run it accepted", async () => {
  const h = harness();
  await h.agent.ready();
  const releaseWrite = h.repository.hold();
  const pending = submit(h, "send", "sub-1");
  await drainMicrotasks(20);
  const stopping = h.agent.stop();
  releaseWrite?.(true);
  const accepted = await pending;
  await stopping;
  assert.equal(accepted.outcome, BRAIN_SUBMISSION_OUTCOME.ACCEPTED);
  await drainMicrotasks(20);
  const record = h.agent.requests()[0];
  assert.equal(record?.status, BRAIN_REQUEST_STATUS.INTERRUPTED);
  assert.equal(h.client.inputs.length, 0);
});

test("a run's history mark is kept once and survives a relaunch", async () => {
  const h = harness();
  h.client.answers.push(answered([message("Hi.")]));
  const record = await ask(h, "hello");
  assert.ok(record);
  assert.equal(record.conversationRecordedAt, undefined);
  await h.agent.markConversationRecorded(record.runId, NOW + 5);
  await h.agent.markConversationRecorded(record.runId, NOW + 9);
  assert.equal(h.agent.request(record.runId)?.conversationRecordedAt, NOW + 5);
  const relaunched = harness({}, fakeBrainStateRepository(h.repository.state));
  await relaunched.agent.ready();
  assert.equal(relaunched.agent.request(record.runId)?.conversationRecordedAt, NOW + 5);
});

test("stop settles only after a held acceptance, which the successor then finds interrupted and cannot be written over", async () => {
  const h = harness();
  await h.agent.ready();
  const releaseWrite = h.repository.hold();
  const pending = submit(h, "send", "sub-1");
  await drainMicrotasks(20);
  let stopped = false;
  const stopping = h.agent.stop().then(() => {
    stopped = true;
  });
  await drainMicrotasks(20);
  assert.equal(stopped, false, "stop waits for the acceptance to settle");
  releaseWrite?.(true);
  await stopping;
  assert.equal((await pending).outcome, BRAIN_SUBMISSION_OUTCOME.ACCEPTED);
  assert.equal(h.agent.requests()[0]?.status, BRAIN_REQUEST_STATUS.INTERRUPTED);
  assert.equal(h.client.inputs.length, 0);

  // The successor takes the store's lease: the old agent's late checkpoint
  // — here, a mark — lands nowhere, while the successor's own writes do.
  const successorModel = adapterOf(new FakeClient());
  const successor = new BrainAgent({
    runtime: runtimeOver(successorModel),
    prepareTurn: PLAIN_PREPARATION,
    actions: { perform: async () => ({ status: ACTION_RESULT_STATUS.ACCEPTED }) },
    roster: () => ({ text: "", identities: [] }),
    standingContext: () => "",
    readTranscriptSince: async () => ({ status: ACTION_RESULT_STATUS.REJECTED, reason: "no" }),
    readTranscript: async () => ({ status: ACTION_RESULT_STATUS.REJECTED, reason: "no" }),
    deliver: () => undefined,
    store: h.store,
    createRunId: () => `successor-${nextRunId()}`,
    report: () => {},
    clock: h.clock,
  });
  await successor.ready();
  const runId = h.agent.requests()[0]?.runId ?? "";
  assert.equal(await h.agent.markConversationRecorded(runId, NOW + 1), false);
  assert.equal(h.repository.state?.requests[0]?.conversationRecordedAt, undefined);
  assert.equal(await successor.markConversationRecorded(runId, NOW + 1), true);
  assert.equal(h.repository.state?.requests[0]?.conversationRecordedAt, NOW + 1);
  await successor.stop();
});

test("a copy taken before the second model answer already carries the actions the journal established", async () => {
  // One accepted act, then a held model call.
  const inner = new FakeClient();
  inner.answers.push(answered([messageAction("call_1", "one")]));
  let release: ((answer: BrainClientAnswer) => void) | undefined;
  let calls = 0;
  const client: BrainClient = {
    respond: (input, options) => {
      calls += 1;
      if (calls === 1) return inner.respond(input, options);
      return new Promise((resolve) => {
        release = resolve;
      });
    },
    quietUntil: () => undefined,
  };
  const h = harness({ client });
  await submit(h, "send");
  await drainMicrotasks(20);
  assert.ok(release, "the second model call is held");
  const copy = h.repository.state;
  const stored = copy;
  assert.equal(stored?.requests[0]?.status, BRAIN_REQUEST_STATUS.RUNNING);
  assert.equal(stored?.requests[0]?.performedActions, 1);
  const relaunched = harness({}, fakeBrainStateRepository(copy));
  await relaunched.agent.ready();
  const record = relaunched.agent.requests()[0];
  assert.equal(record?.status, BRAIN_REQUEST_STATUS.INTERRUPTED);
  assert.equal(record?.performedActions, 1);
  assert.equal(record?.unknownActions, 0);
  // A second relaunch of the recovered file says the same.
  const again = harness({}, fakeBrainStateRepository(relaunched.repository.state));
  await again.agent.ready();
  assert.equal(again.agent.requests()[0]?.performedActions, 1);

  // One explicitly unknown action, one confirmed refusal, one started-unanswered
  // act, then the crash: each counted once from the journal.
  const held = heldPerformer();
  let dispatched = 0;
  const mixed = harness({
    actions: {
      perform: (functionCall, execution) => {
        dispatched += 1;
        if (dispatched === 1) return Promise.reject(new Error("socket closed after send"));
        if (dispatched === 2) {
          return Promise.resolve({ status: ACTION_RESULT_STATUS.REJECTED, reason: "not observed" });
        }
        return held.actions.perform(functionCall, execution);
      },
    },
  });
  mixed.client.answers.push(
    answered([
      messageAction("m1", "one"),
      messageAction("m2", "two"),
      messageAction("m3", "three"),
    ]),
  );
  await submit(mixed, "send three");
  await drainMicrotasks(20);
  const midway = mixed.repository.state;
  assert.equal(midway?.requests[0]?.unknownActions, 1);
  assert.equal(midway?.journal.length, 3);
  const recovered = harness({}, fakeBrainStateRepository(mixed.repository.state));
  await recovered.agent.ready();
  const mixedRecord = recovered.agent.requests()[0];
  assert.equal(mixedRecord?.status, BRAIN_REQUEST_STATUS.INTERRUPTED);
  assert.equal(mixedRecord?.performedActions, 0);
  assert.equal(mixedRecord?.unknownActions, 2);
});

test("a history mark the store refused is not held either, and the next attempt writes it", async () => {
  const h = harness();
  h.client.answers.push(answered([message("Hi.")]));
  const record = await ask(h, "hello");
  assert.ok(record);
  h.repository.refuse();
  assert.equal(await h.agent.markConversationRecorded(record.runId, NOW + 5), false);
  assert.equal(h.agent.request(record.runId)?.conversationRecordedAt, undefined);
  h.repository.accept();
  assert.equal(await h.agent.markConversationRecorded(record.runId, NOW + 6), true);
  assert.equal(h.agent.request(record.runId)?.conversationRecordedAt, NOW + 6);
  assert.equal(h.repository.state?.requests[0]?.conversationRecordedAt, NOW + 6);
  // The same terms for the ask's own mark.
  h.repository.refuse();
  assert.equal(await h.agent.markAskRecorded(record.runId, NOW), false);
  assert.equal(h.agent.request(record.runId)?.askRecordedAt, undefined);
  h.repository.accept();
  assert.equal(await h.agent.markAskRecorded(record.runId, NOW), true);
});

test("a mark is not visible or acknowledged before its write lands, and marking the same field twice shares one answer", async () => {
  const h = harness();
  h.client.answers.push(answered([message("Hi.")]));
  const record = await ask(h, "hello");
  assert.ok(record);
  const releaseWrite = h.repository.hold();
  const first = h.agent.markConversationRecorded(record.runId, NOW + 5);
  await drainMicrotasks(20);
  // Nothing reads the mark while the write is out, and a second caller waits
  // on the same write rather than being told yes.
  assert.equal(h.agent.request(record.runId)?.conversationRecordedAt, undefined);
  let secondAnswered = false;
  const second = h.agent.markConversationRecorded(record.runId, NOW + 7).then((written) => {
    secondAnswered = true;
    return written;
  });
  // The ask marker is another field: it stages its own write and touches
  // nothing of the history marker's.
  const other = h.agent.markAskRecorded(record.runId, NOW);
  await drainMicrotasks(20);
  assert.equal(secondAnswered, false);
  releaseWrite(false);
  assert.deepEqual(await Promise.all([first, second]), [false, false]);
  assert.equal(h.agent.request(record.runId)?.conversationRecordedAt, undefined);
  assert.equal(h.repository.state?.requests[0]?.conversationRecordedAt, undefined);
  // The ask marker's write queued behind the held one and landed on its own
  // terms once storage answered again: one marker's refusal is not the other's.
  assert.equal(await other, true);
  assert.equal(h.agent.request(record.runId)?.askRecordedAt, NOW);
  // A retry after storage recovers writes the mark, and lands beside fields
  // that advanced meanwhile rather than over them.
  assert.equal(await h.agent.markConversationRecorded(record.runId, NOW + 9), true);
  const marked = h.agent.request(record.runId);
  assert.equal(marked?.conversationRecordedAt, NOW + 9);
  assert.equal(marked?.askRecordedAt, NOW);
  assert.equal(marked?.text, "Hi.");
  assert.deepEqual(h.repository.state?.requests[0], marked);
});

test("a run's success is seen by no reader before the write that keeps it has landed", async () => {
  let releaseWrite: ((landed: boolean) => void) | undefined;
  const inner = new FakeClient();
  inner.answers.push(answered([message("hi")]));
  const gated = gatedClient(inner);
  const h = harness({ client: gated.client });
  await h.agent.ready();
  const runId = acceptedRunId(await submit(h, "hello"));
  const seen: BrainRequestRecord["status"][] = [];
  h.agent.subscribe((records) => {
    const record = records.find((entry) => entry.runId === runId);
    if (record) seen.push(record.status);
  });
  await drainMicrotasks(20);
  // Hold the write that would carry the success; the turn's own end
  // checkpoint lands first, so the held one is the settle.
  let writes = 0;
  const landed = h.repository.save;
  h.repository.save = (state, transcript) => {
    writes += 1;
    if (writes < 2) return landed(state, transcript);
    return new Promise<boolean>((resolve) => {
      releaseWrite = (written) => resolve(written ? landed(state, transcript) : false);
    });
  };
  gated.open();
  await drainMicrotasks(20);
  assert.ok(releaseWrite, "the settle write is held");
  // Every public reader still sees the run under way.
  assert.equal(h.agent.request(runId)?.status, BRAIN_REQUEST_STATUS.RUNNING);
  assert.equal(h.agent.requests()[0]?.status, BRAIN_REQUEST_STATUS.RUNNING);
  const waited = h.agent.waitAsk(runId, 1_000);
  await drainMicrotasks(20);
  await h.clock.advance(h.clock.instant + 1_000);
  assert.equal((await waited)?.status, BRAIN_REQUEST_STATUS.RUNNING);
  assert.ok(!seen.includes(BRAIN_REQUEST_STATUS.SUCCEEDED));
  assert.equal(h.repository.state?.requests[0]?.status, BRAIN_REQUEST_STATUS.RUNNING);
  // The write fails: the run ends as the persistence failure it is, the reply
  // kept, and that is the first terminal state anyone sees.
  h.repository.save = landed;
  releaseWrite?.(false);
  await drainMicrotasks(20);
  const ended = h.agent.request(runId);
  assert.equal(ended?.status, BRAIN_REQUEST_STATUS.FAILED);
  assert.equal(ended?.failure, BRAIN_REQUEST_FAILURE.PERSISTENCE);
  assert.equal(ended?.text, "hi");
  assert.equal(seen.at(-1), BRAIN_REQUEST_STATUS.FAILED);
  assert.ok(!seen.includes(BRAIN_REQUEST_STATUS.SUCCEEDED));
  assert.equal(h.repository.state?.requests[0]?.status, BRAIN_REQUEST_STATUS.FAILED);

  // The write lands: success is seen only then, and only as success.
  const okInner = new FakeClient();
  okInner.answers.push(answered([message("hi")]));
  const okGate = gatedClient(okInner);
  const ok = harness({ client: okGate.client });
  await ok.agent.ready();
  const okLanded = ok.repository.save;
  const okRun = acceptedRunId(await submit(ok, "hello"));
  await drainMicrotasks(20);
  let okRelease: (() => void) | undefined;
  let okWrites = 0;
  ok.repository.save = (state, transcript) => {
    okWrites += 1;
    if (okWrites < 2) return okLanded(state, transcript);
    return new Promise<boolean>((resolve) => {
      okRelease = () => resolve(okLanded(state, transcript));
    });
  };
  okGate.open();
  await drainMicrotasks(20);
  assert.equal(ok.agent.request(okRun)?.status, BRAIN_REQUEST_STATUS.RUNNING);
  ok.repository.save = okLanded;
  okRelease?.();
  await drainMicrotasks(20);
  assert.equal(ok.agent.request(okRun)?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
  assert.equal(ok.repository.state?.requests[0]?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);

  // Disk stays unavailable: the failure still stands in memory for everyone.
  const darkInner = new FakeClient();
  darkInner.answers.push(answered([message("hi")]));
  const darkGate = gatedClient(darkInner);
  const dark = harness({ client: darkGate.client });
  await dark.agent.ready();
  const darkRun = acceptedRunId(await submit(dark, "hello"));
  await drainMicrotasks(20);
  dark.repository.refuse();
  darkGate.open();
  await drainMicrotasks(20);
  const darkEnd = await dark.agent.waitAsk(darkRun, 1);
  assert.equal(darkEnd?.status, BRAIN_REQUEST_STATUS.FAILED);
  assert.equal(darkEnd?.failure, BRAIN_REQUEST_FAILURE.PERSISTENCE);
});

test("two different markers saved concurrently both survive, in either order, on one run or two", async () => {
  for (const conversationFirst of [true, false]) {
    const h = harness();
    const runId = await completedRun(h);
    const marks = [
      () => h.agent.markConversationRecorded(runId, NOW + 1),
      () => h.agent.markAskRecorded(runId, NOW),
    ];
    const results = await Promise.all(
      conversationFirst ? marks.map((m) => m()) : marks.reverse().map((m) => m()),
    );
    assert.deepEqual(results, [true, true]);
    const live = h.agent.request(runId);
    const stored = h.repository.state?.requests.find((r) => r.runId === runId);
    assert.equal(live?.conversationRecordedAt, NOW + 1);
    assert.equal(live?.askRecordedAt, NOW);
    assert.deepEqual(stored, live);
  }
  // Two runs marked at once: each keeps its own.
  const h = harness();
  const first = await completedRun(h, "one");
  const second = await completedRun(h, "two");
  assert.deepEqual(
    await Promise.all([
      h.agent.markConversationRecorded(first, NOW + 1),
      h.agent.markConversationRecorded(second, NOW + 2),
      h.agent.markAskRecorded(second, NOW),
    ]),
    [true, true, true],
  );
  assert.deepEqual(h.repository.state?.requests, h.agent.requests());
  assert.equal(h.repository.state?.requests[1]?.conversationRecordedAt, NOW + 2);
});

test("an ordinary observation checkpoint composed behind a held mark keeps the mark", async () => {
  const h = harness();
  const runId = await completedRun(h);
  const releaseWrite = h.repository.hold();
  const marking = h.agent.markConversationRecorded(runId, NOW + 1);
  await drainMicrotasks(20);
  // Periodic observation races the publication: its inference and checkpoint
  // queue behind the held mark write.
  h.client.answers.push(answered([message("noted")]));
  h.agent.rosterLook();
  await drainMicrotasks(20);
  releaseWrite(true);
  assert.equal(await marking, true);
  await drainMicrotasks(20);
  assert.equal(h.client.inputs.length, 2);
  assert.equal(h.agent.request(runId)?.conversationRecordedAt, NOW + 1);
  assert.equal(h.repository.state?.requests[0]?.conversationRecordedAt, NOW + 1);
  assert.equal(h.repository.state?.items.length, 4);
});

test("a terminal end and its marks overlapping a new submission and a checkpoint regress nothing", async () => {
  const inner = new FakeClient();
  inner.answers.push(answered([messageAction("call_1")]), answered([message("Sent.")]));
  const gated = gatedClient(inner);
  const h = harness({ client: gated.client });
  const first = acceptedRunId(await submit(h, "send"));
  await drainMicrotasks(20);
  gated.open();
  // While the first run's end and marks are being saved, a second ask is
  // accepted and an observation wakes: every save composes on the last.
  const [second, end, marked, askMarked] = await Promise.all([
    submit(h, "second"),
    h.agent.waitAsk(first, 60_000),
    h.agent.waitAsk(first, 60_000).then(() => h.agent.markConversationRecorded(first, NOW + 9)),
    h.agent.markAskRecorded(first, NOW),
  ]);
  await h.agent.wake([edge(ABC)]);
  await h.clock.advance(h.clock.instant + 3_000);
  assert.equal(second.outcome, BRAIN_SUBMISSION_OUTCOME.ACCEPTED);
  assert.equal(end?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
  assert.deepEqual([marked, askMarked], [true, true]);
  const stored = h.repository.state;
  const kept = stored?.requests.find((r) => r.runId === first);
  assert.equal(kept?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
  assert.equal(kept?.text, "Sent.");
  assert.equal(kept?.performedActions, 1);
  assert.equal(kept?.conversationRecordedAt, NOW + 9);
  assert.equal(kept?.askRecordedAt, NOW);
  assert.equal(stored?.journal[0]?.outputJson?.includes(ACTION_RESULT_STATUS.ACCEPTED), true);
  assert.equal(stored?.requests.length, 2);
  assert.deepEqual(stored?.requests, h.agent.requests());
  assert.equal(
    functionOutputs(stored?.items ?? []).length,
    itemsOfType(stored?.items ?? [], RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL).length,
  );
});

test("a failure among overlapping saves leaves the others kept, and a retry lands beside them", async () => {
  const h = harness();
  const runId = await completedRun(h);
  const landed = h.repository.save;
  let writes = 0;
  h.repository.save = (state, transcript) => {
    writes += 1;
    // The second of the overlapping saves is refused.
    return writes === 2 ? false : landed(state, transcript);
  };
  const results = await Promise.all([
    h.agent.markConversationRecorded(runId, NOW + 1),
    h.agent.markAskRecorded(runId, NOW),
  ]);
  assert.deepEqual(results, [true, false]);
  h.repository.save = landed;
  let live = h.agent.request(runId);
  let stored = h.repository.state?.requests[0];
  assert.equal(live?.conversationRecordedAt, NOW + 1);
  assert.equal(live?.askRecordedAt, undefined);
  assert.deepEqual(stored, live);
  assert.equal(await h.agent.markAskRecorded(runId, NOW), true);
  live = h.agent.request(runId);
  stored = h.repository.state?.requests[0];
  assert.equal(live?.askRecordedAt, NOW);
  assert.equal(live?.conversationRecordedAt, NOW + 1);
  assert.deepEqual(stored, live);
});

test("a refused acceptance is never saved by an unrelated mark, and never comes back at relaunch", async () => {
  const h = harness();
  const a = await completedRun(h, "s");
  const held = holdNextWrite(h.repository);
  const firstMark = h.agent.markConversationRecorded(a, NOW + 1);
  await drainMicrotasks(20);
  const secondMark = h.agent.markAskRecorded(a, NOW);
  // B is provisional while its own acceptance write waits behind the marks.
  const rejectedB = submit(h, "ASK_THAT_WAS_REJECTED", "rejected-b");
  await drainMicrotasks(20);
  // Behind the held write: A's second mark lands, B's own write is refused.
  const landed = h.repository.save;
  let later = 0;
  h.repository.save = (state, transcript) => {
    later += 1;
    return later === 2 ? false : landed(state, transcript);
  };
  held.release(true);
  const [first, second, b] = await Promise.all([firstMark, secondMark, rejectedB]);
  assert.deepEqual([first, second], [true, true]);
  assert.deepEqual(b, {
    outcome: BRAIN_SUBMISSION_OUTCOME.REJECTED,
    reason: BRAIN_SUBMISSION_REJECTION.PERSISTENCE,
  });
  await drainMicrotasks(20);
  assert.equal(h.client.inputs.length, 1, "no effect ran for the refused ask");
  assert.deepEqual(
    h.agent.requests().map((r) => r.runId),
    [a],
  );
  assert.deepEqual(
    h.repository.state?.requests.map((r) => r.runId),
    [a],
  );
  assert.equal(h.repository.state?.requests[0]?.conversationRecordedAt, NOW + 1);
  assert.equal(h.repository.state?.requests[0]?.askRecordedAt, NOW);
  const relaunched = harness({}, fakeBrainStateRepository(h.repository.state));
  await relaunched.agent.ready();
  assert.deepEqual(
    relaunched.agent.requests().map((r) => r.submissionId),
    [`submission-${submissionsIssued() - 3}`].map(
      () => relaunched.agent.requests()[0]?.submissionId,
    ),
  );
  assert.equal(relaunched.agent.requests().length, 1);
  assert.ok(!relaunched.repository.words().includes("rejected-b"));
  // The refused submission retried lands as a fresh acceptance, once.
  relaunched.client.answers.push(answered([message("now")]));
  const retried = await relaunched.agent.submitAsk({
    submissionId: "rejected-b",
    question: "ASK_THAT_WAS_REJECTED",
    origin: BRAIN_REQUEST_ORIGIN.TYPED,
  });
  assert.equal(retried.outcome, BRAIN_SUBMISSION_OUTCOME.ACCEPTED);
  await drainMicrotasks(20);
  assert.equal(relaunched.repository.state?.requests.length, 2);
});

test("two overlapping submissions, one refused, leave no ghost run and execute the accepted one once", async () => {
  const h = harness();
  await h.agent.ready();
  const landed = h.repository.save;
  let writes = 0;
  h.repository.save = (state, transcript) => {
    writes += 1;
    return writes === 2 ? false : landed(state, transcript);
  };
  h.client.answers.push(answered([message("one")]), answered([message("two")]));
  const [first, second] = await Promise.all([submit(h, "first", "a"), submit(h, "second", "b")]);
  assert.equal(first.outcome, BRAIN_SUBMISSION_OUTCOME.ACCEPTED);
  assert.deepEqual(second, {
    outcome: BRAIN_SUBMISSION_OUTCOME.REJECTED,
    reason: BRAIN_SUBMISSION_REJECTION.PERSISTENCE,
  });
  await drainMicrotasks(20);
  assert.equal(h.client.inputs.length, 1);
  assert.deepEqual(
    h.repository.state?.requests.map((r) => r.submissionId),
    ["a"],
  );
  assert.deepEqual(
    h.agent.requests().map((r) => r.submissionId),
    ["a"],
  );
  // The refused one retried is a fresh run, and the accepted one ran once.
  assert.equal((await submit(h, "second", "b")).outcome, BRAIN_SUBMISSION_OUTCOME.ACCEPTED);
  await drainMicrotasks(20);
  assert.equal(h.client.inputs.length, 2);
  assert.deepEqual(
    h.repository.state?.requests.map((r) => r.submissionId),
    ["a", "b"],
  );
});

test("an observation in flight enters no memory through an unrelated mark or acceptance, and its failed turn retries the captured entry", async () => {
  const inner = new FakeClient();
  const gated = gatedClient(inner);
  const h = harness({ client: gated.client });
  // A completed run, answered before the gate closes on the observation.
  gated.open();
  const a = await completedRun(h, "hello");
  const regate = gatedClient(inner);
  // Swap the client for the observation only.
  const observing = harness({ client: regate.client }, h.repository);
  await observing.agent.ready();
  // The pending wake rides in the hold release's turn: one observation that
  // reads a real delta, moves a cursor, and then waits on the model.
  await observing.agent.wake([edge(ABC)]);
  observing.agent.releaseHeld([{ briefing: "UNCOMMITTED_OBSERVATION", decidedAt: NOW }]);
  await drainMicrotasks(20);
  // The delta was captured — an inbox entry and a capture cursor — and read
  // into working memory; the consumed cursor has not moved; the model is held.
  assert.equal(observing.sinceReads.length, 1);
  const before = observing.repository.state;
  assert.ok(!JSON.stringify(before?.items).includes("UNCOMMITTED_OBSERVATION"));
  assert.equal(before?.inbox.length, 1);
  assert.deepEqual(before?.captureCursors, { [claude.id]: { abc: "abc-cursor" } });
  // Unrelated publication and acceptance land while the observation is out.
  assert.equal(await observing.agent.markConversationRecorded(a, NOW + 1), true);
  inner.answers.push(answered([message("later")]));
  const accepted = await submit(observing, "another ask");
  assert.equal(accepted.outcome, BRAIN_SUBMISSION_OUTCOME.ACCEPTED);
  const during = observing.repository.state;
  assert.ok(!JSON.stringify(during?.items).includes("UNCOMMITTED_OBSERVATION"));
  assert.deepEqual(during?.cursors, before?.cursors);
  assert.equal(during?.requests.find((r) => r.runId === a)?.conversationRecordedAt, NOW + 1);
  // A crash copy taken now restores nothing of the observation.
  const crashed = harness({}, fakeBrainStateRepository(observing.repository.state));
  await crashed.agent.ready();
  assert.ok(!crashed.repository.words().includes("UNCOMMITTED_OBSERVATION"));
  assert.deepEqual(crashed.repository.state?.cursors, before?.cursors);
  // The observation fails: memory and the consumed cursor never advanced,
  // and the captured entry stands for the next turn.
  // The ask accepted meanwhile did not ride the hold release's turn — a
  // developer's words never steer into an observation — so it opens its own
  // turn behind it, and that turn is the one that consumes the standing entry.
  inner.answers.unshift(failedAnswer("network"));
  regate.open();
  await drainMicrotasks(20);
  const after = observing.repository.state;
  assert.ok(!JSON.stringify(after?.items).includes("UNCOMMITTED_OBSERVATION"));
  assert.equal(after?.inbox.length, 0);
  assert.equal(after?.cursors["claude-code"]?.abc, "abc-cursor");
  assert.equal((await observing.agent.waitAsk(acceptedRunId(accepted), 1))?.text, "later");
  assert.deepEqual(
    observing.sinceReads.map((read) => read.cursor),
    [undefined],
  );
  assert.equal(observing.traces.at(-1)?.origin, RUN_ORIGIN.USER);
});

test("a run whose start the store refuses opens no work and ends as a persistence failure", async () => {
  const h = harness({
    actions: { perform: async () => ({ status: ACTION_RESULT_STATUS.ACCEPTED }) },
  });
  await h.agent.ready();
  h.client.answers.push(answered([messageAction("call_1")]), answered([message("Sent.")]));
  const landed = h.repository.save;
  h.repository.save = (state, transcript) =>
    CARRIES_A_RUNNING_RUN(state) ? false : landed(state, transcript);
  const runId = acceptedRunId(await submit(h, "send"));
  const record = await h.agent.waitAsk(runId, 60_000);
  assert.equal(record?.status, BRAIN_REQUEST_STATUS.FAILED);
  assert.equal(record?.failure, BRAIN_REQUEST_FAILURE.PERSISTENCE);
  assert.equal(record?.performedActions, 0);
  assert.equal(h.client.inputs.length, 0, "no model call");
  assert.deepEqual(h.performed, []);
  assert.deepEqual(h.repository.state?.requests[0], record);
  assert.equal(h.agent.requests().length, 1);
  const relaunched = harness({}, fakeBrainStateRepository(h.repository.state));
  await relaunched.agent.ready();
  assert.deepEqual(relaunched.agent.requests()[0], record);
});

test("a cancel or stop landing while the start is being written ends the run unopened, and work starts only once the start has landed", async () => {
  // Cancel during the held start write.
  const cancelling = harness();
  await cancelling.agent.ready();
  cancelling.client.answers.push(answered([messageAction("call_1")]));
  const heldStart = holdWriteMatching(cancelling.repository, CARRIES_A_RUNNING_RUN);
  const runId = acceptedRunId(await submit(cancelling, "send"));
  await drainMicrotasks(20);
  assert.equal(heldStart.held(), true);
  const cancelled = cancelling.agent.cancelAsk(runId);
  await drainMicrotasks(20);
  heldStart.release(true);
  await cancelled;
  await drainMicrotasks(20);
  assert.equal(cancelling.agent.request(runId)?.status, BRAIN_REQUEST_STATUS.CANCELLED);
  assert.equal(cancelling.client.inputs.length, 0);
  assert.deepEqual(cancelling.performed, []);
  assert.deepEqual(cancelling.repository.state?.requests[0], cancelling.agent.request(runId));

  // Stop during a start that is then refused.
  const stopping = harness();
  await stopping.agent.ready();
  stopping.client.answers.push(answered([messageAction("call_1")]));
  const refusedStart = holdWriteMatching(stopping.repository, CARRIES_A_RUNNING_RUN);
  const stopRun = acceptedRunId(await submit(stopping, "send"));
  await drainMicrotasks(20);
  assert.equal(refusedStart.held(), true);
  const stopped = stopping.agent.stop();
  refusedStart.release(false);
  await stopped;
  assert.equal(stopping.agent.request(stopRun)?.status, BRAIN_REQUEST_STATUS.INTERRUPTED);
  assert.equal(stopping.client.inputs.length, 0);
  assert.deepEqual(stopping.performed, []);

  // Positive control: the model is called only after the start has landed,
  // and a cancel over a dispatched act still waits to publish the counted end.
  const held = heldPerformer();
  const h = harness({ actions: held.actions });
  await h.agent.ready();
  h.client.answers.push(answered([messageAction("call_1")]));
  const start = holdWriteMatching(h.repository, CARRIES_A_RUNNING_RUN);
  const live = acceptedRunId(await submit(h, "send"));
  await drainMicrotasks(20);
  assert.equal(start.held(), true);
  assert.equal(h.client.inputs.length, 0);
  start.release(true);
  await drainMicrotasks(20);
  assert.equal(h.client.inputs.length, 1);
  assert.equal(held.performed.length, 1);
  const cancelledLate = await h.agent.cancelAsk(live);
  assert.equal(cancelledLate?.status, BRAIN_REQUEST_STATUS.RUNNING);
  const seen: BrainRequestRecord[] = [];
  h.agent.subscribe((records) => {
    const record = records.find((entry) => entry.runId === live);
    if (record && isTerminalBrainRequestStatus(record.status)) seen.push(record);
  });
  held.releases[0]?.();
  await drainMicrotasks(20);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.status, BRAIN_REQUEST_STATUS.CANCELLED);
  assert.equal(seen[0]?.performedActions, 0);
  assert.deepEqual(h.repository.state?.requests[0], h.agent.request(live));
});

test("runs retention lets go of leave the live records and journal too, so the next checkpoint cannot bring them back", async () => {
  const seeded = seededRequests(RECORD_CAP, true);
  const repository = fakeBrainStateRepository({
    ...freshBrainState("gen-bounded", NOW - 1),
    requests: seeded,
  });
  const store = new BrainStateStore({
    automaticReset: true,
    repository,
    createGenerationId: () => "gen-bounded-next",
    now: () => NOW,
  });
  const h = harness({ store }, repository);
  const runIds: string[] = [];
  for (const words of ["a", "b", "c", "d"]) {
    h.client.answers.push(answered([messageAction(`call_${words}`)]), answered([message(words)]));
    const record = await ask(h, words);
    assert.ok(record);
    runIds.push(record.runId);
    assert.equal(await h.agent.markConversationRecorded(record.runId, h.clock.instant), true);
  }
  // Retention ran inside the marks: the four oldest seeded runs went to make
  // room, in the file, in the live records, and in the journal the agent holds.
  const goneIds = seeded.slice(0, 4).map((record) => record.runId);
  const standing = (state: BrainPersistedState | undefined) =>
    new Set(state?.requests.map((record) => record.runId));
  const stored = h.repository.state;
  assert.equal(stored?.requests.length, RECORD_CAP);
  for (const runId of goneIds) assert.ok(!standing(stored).has(runId));
  for (const runId of runIds) assert.ok(standing(stored).has(runId));
  assert.deepEqual(new Set(h.agent.requests().map((record) => record.runId)), standing(stored));
  assert.deepEqual(new Set(stored?.journal.map((entry) => entry.runId)), new Set(runIds));
  assert.equal(h.performed.length, 4);

  // A later working checkpoint — an observation turn's — writes the agent's
  // journal again, and the pruned runs stay gone.
  h.client.answers.push(answered([message("")]));
  await h.agent.wake([edge(ABC)]);
  await h.clock.advance(h.clock.instant + 3_000);
  const after = h.repository.state;
  assert.deepEqual(new Set(after?.journal.map((entry) => entry.runId)), new Set(runIds));
  for (const runId of goneIds) assert.ok(!standing(after).has(runId));
});

test("a generation at its record bound refuses a new ask at the door, and admits one again once an end reaches the thread", async () => {
  const seeded = seededRequests(RECORD_CAP - 1, false);
  const repository = fakeBrainStateRepository({
    ...freshBrainState("gen-bounded", NOW - 1),
    requests: seeded,
  });
  const store = new BrainStateStore({
    automaticReset: true,
    repository,
    createGenerationId: () => "gen-bounded-next",
    now: () => NOW,
  });
  const h = harness({ store }, repository);
  h.client.answers.push(answered([message("a")]));
  const first = await ask(h, "a");
  assert.ok(first);
  assert.deepEqual(await submit(h, "b"), {
    outcome: BRAIN_SUBMISSION_OUTCOME.REJECTED,
    reason: BRAIN_SUBMISSION_REJECTION.FULL,
  });
  assert.equal(h.agent.requests().length, RECORD_CAP);
  const heard: (readonly BrainRequestRecord[])[] = [];
  h.agent.subscribe((records) => heard.push(records));
  // The oldest seeded run's end reaches the thread, and the room it held opens.
  const oldest = seeded[0]?.runId ?? "";
  assert.equal(await h.agent.markConversationRecorded(oldest, NOW), true);
  h.client.answers.push(answered([message("b")]));
  const second = await ask(h, "b");
  assert.equal(second?.text, "b");
  // The subscriber heard the oldest run go when the second was admitted.
  assert.ok(heard.some((records) => !records.some((record) => record.runId === oldest)));
  assert.ok(second);
  const standing = h.agent.requests().map((record) => record.runId);
  assert.equal(standing.length, RECORD_CAP);
  assert.ok(!standing.includes(oldest));
  assert.ok(standing.includes(first.runId) && standing.includes(second.runId));
});

test("a refused result checkpoint under a landed terminal write keeps the confirmed count, and a restart replays nothing", async () => {
  const repository = fakeBrainStateRepository();
  const h = harness({}, repository);
  await h.agent.ready();
  const landed = repository.save;
  let refused = 0;
  // Only the checkpoints carrying an action's recorded result are refused; the
  // record-only writes, including the terminal one, still land.
  repository.save = (state, transcript) => {
    if (state.journal.some((entry) => entry.outputJson !== undefined)) {
      refused += 1;
      return false;
    }
    return landed(state, transcript);
  };
  h.client.answers.push(
    answered([
      call("call_b", "send_session_message", {
        provider_id: ABC.providerId,
        provider_session_id: ABC.providerSessionId,
        text: "run the tests",
      }),
    ]),
    answered([message("Sent.")]),
  );
  const answer = await ask(h, "tell the checkout agent to run the tests");
  assert.ok(refused > 0);
  assert.equal(h.performed.length, 1);
  // The action's acceptance was observed, so its count stands, and the run ends
  // as the persistence failure it is rather than as a success.
  assert.equal(answer?.status, BRAIN_REQUEST_STATUS.FAILED);
  assert.equal(answer?.failure, BRAIN_REQUEST_FAILURE.PERSISTENCE);
  assert.equal(answer?.performedActions, 1);
  assert.equal(answer?.unknownActions, 0);
  assert.equal(answer?.text, "Sent.");
  const stored = repository.state;
  assert.equal(stored?.requests[0]?.status, BRAIN_REQUEST_STATUS.FAILED);
  assert.equal(stored?.requests[0]?.performedActions, 1);
  assert.deepEqual(
    stored?.journal.map((entry) => [entry.callId, entry.outputJson]),
    [["call_b", undefined]],
  );
  assert.deepEqual(
    stored?.items.map((item) => item.type),
    ["message", "function_call"],
  );

  // A restart on the same file keeps the terminal record as written, pairs
  // the dangling call with an unknown result for the model's memory, and
  // performs nothing again.
  repository.save = landed;
  const again = harness({}, repository);
  await again.agent.ready();
  const restored = again.agent.request(answer?.runId ?? "");
  assert.equal(restored?.status, BRAIN_REQUEST_STATUS.FAILED);
  assert.equal(restored?.failure, BRAIN_REQUEST_FAILURE.PERSISTENCE);
  assert.equal(restored?.performedActions, 1);
  assert.equal(restored?.unknownActions, 0);
  const file = repository.state;
  assert.deepEqual(
    file?.items.map((item) => item.type),
    ["message", "function_call", "function_call_output"],
  );
  const paired = file?.items.find((item) => item.type === "function_call_output");
  assert.ok(isWireString(paired?.output) && paired.output.includes('"unknown"'));
  assert.equal(again.performed.length, 0);
  assert.equal(again.client.inputs.length, 0);
});
