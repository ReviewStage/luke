import assert from "node:assert/strict";
import test from "node:test";
import {
  BRAIN_REQUEST_ORIGIN,
  BRAIN_REQUEST_STATUS,
  BrainAgent,
  type BrainClient,
  type BrainClientAnswer,
  type BrainRequestRecord,
  type BrainStateStorage,
  BrainStateStore,
  brainStateFromStored,
} from "@sidecar/brain";
import {
  appendConversationThreadEntry,
  CONVERSATION_ENTRY_KIND,
  type ConversationEntry,
} from "@sidecar/realtime";
import { ACT_RESULT_STATUS } from "@sidecar/wire";
import type { BrainRequestSnapshot } from "#shared/wire/brain";
import { BrainHost } from "./host";
import { followBrainRequests, submitBrainAsk } from "./ipc";

/**
 * The real agent, store, host, follower, and submission path composed as the
 * main process composes them, with only the model and the disk synthetic.
 */

const NOW = 1_800_000_000_000;

class MemoryStorage implements BrainStateStorage {
  file: string | undefined;
  read() {
    return this.file;
  }
  write(contents: string) {
    this.file = contents;
    return true;
  }
  remove() {
    this.file = undefined;
    return true;
  }
}

/** A model that answers nothing until the test says so. */
function heldClient(): BrainClient & { release: (answer: BrainClientAnswer) => void } {
  const waiting: ((answer: BrainClientAnswer) => void)[] = [];
  return {
    respond: () =>
      new Promise((resolve) => {
        waiting.push(resolve);
      }),
    quietUntil: () => undefined,
    release: (answer) => {
      for (const resolve of waiting.splice(0)) resolve(answer);
    },
  };
}

function settle(): Promise<void> {
  return new Promise((resolve) => {
    let ticks = 0;
    const tick = () => {
      ticks += 1;
      if (ticks > 30) resolve();
      else setImmediate(tick);
    };
    tick();
  });
}

function composed() {
  const storage = new MemoryStorage();
  let ids = 0;
  const store = new BrainStateStore({
    storage,
    createGenerationId: () => `gen-${++ids}`,
    now: () => NOW,
  });
  let thread: readonly ConversationEntry[] = [];
  let refuseWrites = false;
  const broadcasts: (readonly BrainRequestSnapshot[])[] = [];
  const record = (entry: ConversationEntry, at: number) => {
    if (refuseWrites) return false;
    thread = appendConversationThreadEntry(thread, entry, NOW + 1000, at);
    return true;
  };
  const host = new BrainHost({
    follow: (agent) =>
      followBrainRequests(agent, {
        recordConversationEntry: record,
        broadcastRequests: (snapshots) => broadcasts.push(snapshots),
      }),
    publishEmpty: () => broadcasts.push([]),
  });
  const build = (client: BrainClient) =>
    new BrainAgent({
      client,
      acts: { perform: async () => ({ status: ACT_RESULT_STATUS.ACCEPTED }) },
      roster: () => ({ text: "", identities: [] }),
      standingContext: () => "",
      readTranscriptSince: async () => ({ status: ACT_RESULT_STATUS.REJECTED, reason: "no" }),
      readTranscript: async () => ({ status: ACT_RESULT_STATUS.REJECTED, reason: "no" }),
      deliver: () => undefined,
      store,
      createRunId: () => `run-${++ids}`,
      report: () => {},
      now: () => NOW,
    });
  return {
    storage,
    store,
    host,
    build,
    record,
    thread: () => thread,
    broadcasts,
    refuse: (value: boolean) => {
      refuseWrites = value;
    },
  };
}

async function submitMany(
  agent: BrainAgent,
  record: ReturnType<typeof composed>["record"],
  count: number,
) {
  const runIds: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const result = await submitBrainAsk(
      agent,
      {
        submissionId: `sub-${index}`,
        question: `ask ${index}`,
        origin: BRAIN_REQUEST_ORIGIN.TYPED,
      },
      record,
    );
    assert.equal(result.outcome, "accepted");
    if (result.outcome === "accepted") runIds.push(result.runId);
  }
  return runIds;
}

test("removing the capability under five outstanding runs leaves every run interrupted, published, and marked", async () => {
  const c = composed();
  const client = heldClient();
  await c.host.replace(() => c.build(client));
  const agent = c.host.current();
  assert.ok(agent);
  const runIds = await submitMany(agent, c.record, 5);
  await settle();
  assert.equal(c.thread().filter((e) => e.kind === CONVERSATION_ENTRY_KIND.TYPED_ASK).length, 5);

  await c.host.replace(() => undefined);
  await settle();
  assert.equal(c.host.current(), undefined);
  const stored = brainStateFromStored(c.storage.file);
  assert.equal(stored?.requests.length, 5);
  for (const runId of runIds) {
    const kept: BrainRequestRecord | undefined = stored?.requests.find(
      (entry) => entry.runId === runId,
    );
    assert.equal(kept?.status, BRAIN_REQUEST_STATUS.INTERRUPTED);
    assert.ok(kept?.historyRecordedAt !== undefined, `${runId} marked`);
    assert.ok(kept?.askRecordedAt !== undefined);
    assert.equal(
      c.thread().filter((e) => e.kind === CONVERSATION_ENTRY_KIND.REPLY && e.requestId === runId)
        .length,
      1,
      `${runId} has one reply line`,
    );
  }
  assert.deepEqual(c.broadcasts.at(-1), []);
  // The old agent's late model answer changes nothing anyone can see.
  client.release({
    outcome: "answered",
    payload: {
      output: [
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "late" }] },
      ],
    },
  });
  await settle();
  assert.equal(c.thread().filter((e) => e.words === "late").length, 0);
  assert.equal(
    brainStateFromStored(c.storage.file)?.requests.every(
      (r) => r.status === BRAIN_REQUEST_STATUS.INTERRUPTED,
    ),
    true,
  );
});

test("a successor replacing the agent under outstanding runs inherits a thread with every end written, and owns the store alone", async () => {
  const c = composed();
  const first = heldClient();
  await c.host.replace(() => c.build(first));
  const agent = c.host.current();
  assert.ok(agent);
  const runIds = await submitMany(agent, c.record, 5);
  // An earlier publication is held: the thread refuses until the handoff.
  c.refuse(true);
  await settle();
  c.refuse(false);
  const second = heldClient();
  await c.host.replace(() => c.build(second));
  await settle();
  const successor = c.host.current();
  assert.ok(successor && successor !== agent);
  for (const runId of runIds) {
    assert.equal(successor.request(runId)?.status, BRAIN_REQUEST_STATUS.INTERRUPTED);
    assert.equal(
      c.thread().filter((e) => e.kind === CONVERSATION_ENTRY_KIND.REPLY && e.requestId === runId)
        .length,
      1,
    );
  }
  // The successor's own run proceeds and is the only writer.
  const result = await submitBrainAsk(
    successor,
    { submissionId: "fresh", question: "new ask", origin: BRAIN_REQUEST_ORIGIN.TYPED },
    c.record,
  );
  assert.equal(result.outcome, "accepted");
  second.release({
    outcome: "answered",
    payload: {
      output: [
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "done" }] },
      ],
    },
  });
  await settle();
  const fresh = brainStateFromStored(c.storage.file)?.requests.find(
    (r) => r.question === "new ask",
  );
  assert.equal(fresh?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
  assert.equal(c.thread().at(-1)?.words, "done");
  // The retired agent takes nothing more and writes nothing more: its store
  // lease passed to the successor with the handoff.
  assert.equal(
    (
      await agent.submitAsk({
        submissionId: "stale",
        question: "old ask",
        origin: BRAIN_REQUEST_ORIGIN.TYPED,
      })
    ).outcome,
    "rejected",
  );
  assert.equal(c.store.holdsLease(agent.lease), false);
  assert.equal(c.store.holdsLease(successor.lease), true);
});

test("a reset under outstanding runs discards them without publishing, and the successor starts clean", async () => {
  const c = composed();
  const client = heldClient();
  await c.host.replace(() => c.build(client));
  const agent = c.host.current();
  assert.ok(agent);
  await submitMany(agent, c.record, 3);
  await settle();
  assert.equal(await c.store.clear(), true);
  await settle();
  assert.deepEqual(agent.requests(), []);
  assert.equal(c.thread().filter((e) => e.kind === CONVERSATION_ENTRY_KIND.REPLY).length, 0);
  // The file holds the empty successor and the marker of the erasure alone.
  const stored = brainStateFromStored(c.storage.file);
  assert.equal(stored?.requests.length, 0);
  assert.equal(stored?.reset?.generationId, "gen-1");
  await c.host.replace(() => undefined);
  await settle();
  assert.equal(c.thread().filter((e) => e.kind === CONVERSATION_ENTRY_KIND.REPLY).length, 0);
});
