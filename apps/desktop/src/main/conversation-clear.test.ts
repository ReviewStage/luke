import assert from "node:assert/strict";
import test from "node:test";
import { REALTIME_TOOL } from "@sidecar/acts";
import {
  BRAIN_REQUEST_ORIGIN,
  BRAIN_REQUEST_STATUS,
  type BrainActPerformer,
  BrainAgent,
  type BrainClient,
  type BrainClientAnswer,
  type BrainStateStorage,
  BrainStateStore,
  brainStateFromStored,
} from "@sidecar/brain";
import {
  appendConversationThreadEntry,
  CONVERSATION_ENTRY_KIND,
  type ConversationEntry,
} from "@sidecar/realtime";
import { ACT_RESULT_STATUS, type WireRecord } from "@sidecar/wire";
import { BrainHost } from "./brain-host";
import { clearConversationAndBrain } from "./conversation-clear";
import { followBrainRequests, submitBrainAsk } from "./ipc/brain";
import {
  conversationFromStored,
  conversationRecord,
  mergeConversationHistory,
} from "./memory-flow";

/**
 * The Clear composed as the main process composes it: the real store, agent,
 * host, follower, submission path, and the thread's own cutoff rule, with
 * only the model, the performer, and the disk synthetic. Every marker below
 * is a synthetic word that must be found nowhere after the press.
 */

const NOW = 1_800_000_000_000;
const OLD_ASK = "OLD_ASK_MARKER";
const OLD_REPLY = "OLD_REPLY_MARKER";
const OLD_COMPACTION = "OLD_COMPACTION_MARKER";
const LATE_REPLY = "LATE_REPLY_MARKER";
const SESSION = { provider_id: "claude-code", provider_session_id: "abc" };

class MemoryStorage implements BrainStateStorage {
  file: string | undefined;
  refuse = false;
  read() {
    return this.file;
  }
  write(contents: string) {
    if (this.refuse) return false;
    this.file = contents;
    return true;
  }
  remove() {
    this.file = undefined;
    return true;
  }
}

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

function heldPerformer(): BrainActPerformer & { release: () => void } {
  const waiting: (() => void)[] = [];
  return {
    perform: async () => {
      await new Promise<void>((resolve) => {
        waiting.push(resolve);
      });
      return { status: ACT_RESULT_STATUS.ACCEPTED };
    },
    release: () => {
      for (const resolve of waiting.splice(0)) resolve();
    },
  };
}

function reply(text: string, ...before: WireRecord[]): BrainClientAnswer {
  return {
    outcome: "answered",
    payload: {
      output: [
        ...before,
        { type: "message", role: "assistant", content: [{ type: "output_text", text }] },
      ],
    },
  };
}

function act(callId: string): WireRecord {
  return {
    type: "function_call",
    call_id: callId,
    name: REALTIME_TOOL.SEND_SESSION_MESSAGE,
    arguments: JSON.stringify({ ...SESSION, text: "run it" }),
  };
}

function settle(): Promise<void> {
  return new Promise((resolve) => {
    let ticks = 0;
    const tick = () => {
      ticks += 1;
      if (ticks > 40) resolve();
      else setImmediate(tick);
    };
    tick();
  });
}

function composed() {
  const brainDisk = new MemoryStorage();
  let conversationFile: string | undefined;
  let clock = NOW;
  let ids = 0;
  let generations = 0;
  const store = new BrainStateStore({
    storage: brainDisk,
    createGenerationId: () => `gen-${++generations}`,
    now: () => clock,
  });
  let thread: readonly ConversationEntry[] = [];
  let clearedAt: number | undefined;
  let refuseThreadWrites = false;
  let refuseThreadRemoval = false;
  const cleared: number[] = [];
  const withdrawn: number[] = [];
  const reports: string[] = [];
  const broadcasts: (readonly { runId: string; status: string }[])[] = [];
  // The main process's own record path, cutoff rule included.
  const record = (entry: ConversationEntry, at: number) => {
    if (clearedAt !== undefined && at <= clearedAt) return true;
    if (refuseThreadWrites) return false;
    const merged = appendConversationThreadEntry(thread, entry, clock, at);
    if (merged === thread) return true;
    thread = merged;
    conversationFile = conversationRecord(thread, clock);
    return true;
  };
  const host = new BrainHost({
    follow: (agent) =>
      followBrainRequests(agent, {
        recordConversationEntry: record,
        broadcastRequests: (snapshots) =>
          broadcasts.push(snapshots.map((s) => ({ runId: s.runId, status: s.status }))),
      }),
    publishEmpty: () => broadcasts.push([]),
  });
  const build = (client: BrainClient, acts?: BrainActPerformer) =>
    new BrainAgent({
      client,
      acts: acts ?? { perform: async () => ({ status: ACT_RESULT_STATUS.ACCEPTED }) },
      roster: () => ({
        text: "- abc",
        identities: [{ providerId: "claude-code", providerSessionId: "abc" }],
      }),
      standingContext: () => "",
      readTranscriptSince: async () => ({ status: ACT_RESULT_STATUS.REJECTED, reason: "no" }),
      readTranscript: async () => ({ status: ACT_RESULT_STATUS.REJECTED, reason: "no" }),
      deliver: () => undefined,
      store,
      createRunId: () => `run-${++ids}`,
      report: () => {},
      now: () => clock,
    });
  const clear = () =>
    clearConversationAndBrain({
      store,
      now: () => clock,
      fence: (at) => {
        clearedAt = at;
      },
      withdrawSpeech: () => withdrawn.push(clock),
      removeConversation: () => {
        if (refuseThreadRemoval) return false;
        conversationFile = undefined;
        return true;
      },
      emptyConversation: () => {
        thread = [];
        cleared.push(clock);
      },
      report: (message) => reports.push(message),
    });
  const submit = async (agent: BrainAgent, question: string) => {
    const result = await submitBrainAsk(
      agent,
      { submissionId: `sub-${++ids}`, question, origin: BRAIN_REQUEST_ORIGIN.TYPED },
      record,
    );
    assert.equal(result.outcome, "accepted");
    return result.outcome === "accepted" ? result.runId : "";
  };
  /** Everything an old word could survive in, flattened for a marker search. */
  const surface = () =>
    JSON.stringify({
      brainDisk: brainDisk.file,
      conversationFile,
      thread,
      held: store.current(),
      requests: host.current()?.requests(),
      broadcasts: broadcasts.at(-1),
    });
  return {
    brainDisk,
    store,
    host,
    build,
    clear,
    submit,
    record,
    surface,
    thread: () => thread,
    conversationFile: () => conversationFile,
    clearedAt: () => clearedAt,
    cleared,
    withdrawn,
    reports,
    broadcasts,
    tick: (ms = 1) => {
      clock += ms;
      return clock;
    },
    now: () => clock,
    refuseThread: (writes: boolean, removal = false) => {
      refuseThreadWrites = writes;
      refuseThreadRemoval = removal;
    },
  };
}

test("a Clear under a held model answer, a held act, and a held publication leaves nothing of the old generation anywhere", async () => {
  const c = composed();
  const client = heldClient();
  const performer = heldPerformer();
  await c.host.replace(() => c.build(client, performer));
  const agent = c.host.current();
  assert.ok(agent);

  // A finished exchange, compacted, so the encrypted memory of it is on disk.
  const first = await c.submit(agent, OLD_ASK);
  await settle();
  client.release(
    reply(OLD_REPLY, { type: "compaction", id: "cmp_1", encrypted_content: OLD_COMPACTION }),
  );
  await settle();
  assert.equal(agent.request(first)?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
  assert.ok(c.surface().includes(OLD_COMPACTION));
  assert.ok(c.thread().some((entry) => entry.words === OLD_REPLY));

  // Three late arrivals armed: an end whose publication the thread refused,
  // a run holding an act open, and a run holding its model answer open.
  c.refuseThread(true);
  const second = await c.submit(agent, "act now");
  await settle();
  client.release(reply("", act("call_1")));
  await settle();
  const third = await c.submit(agent, "think");
  await settle();
  assert.equal(agent.request(second)?.status, BRAIN_REQUEST_STATUS.RUNNING);
  c.refuseThread(false);

  c.tick();
  assert.equal(await c.clear(), true);
  const cutoff = c.clearedAt();
  assert.equal(cutoff, c.now());
  assert.deepEqual(c.withdrawn, [c.now()]);
  assert.deepEqual(c.cleared, [c.now()]);
  assert.deepEqual(c.thread(), []);
  assert.equal(c.conversationFile(), undefined);
  const marker = brainStateFromStored(c.brainDisk.file)?.reset;
  assert.deepEqual(marker, { generationId: "gen-1", clearedAt: cutoff });
  assert.equal(c.store.holdsGeneration("gen-1"), false);
  assert.deepEqual(agent.requests(), []);
  assert.deepEqual(c.broadcasts.at(-1), []);

  // Everything held is released after the press, and lands nowhere.
  performer.release();
  await settle();
  client.release(reply(LATE_REPLY));
  await settle();
  await c.tick(50);
  assert.equal(agent.request(second), undefined);
  assert.equal(agent.request(third), undefined);
  for (const word of [OLD_ASK, OLD_REPLY, OLD_COMPACTION, LATE_REPLY]) {
    assert.ok(!c.surface().includes(word), `${word} survived the Clear`);
  }
  // A window's whole report of the thread as it stood before the press
  // merges to nothing, and the main record path takes nothing dated before it.
  const stale: ConversationEntry[] = [
    { kind: CONVERSATION_ENTRY_KIND.TYPED_ASK, words: OLD_ASK, recordedAt: NOW },
    { kind: CONVERSATION_ENTRY_KIND.REPLY, words: OLD_REPLY, recordedAt: cutoff ?? 0 },
  ];
  assert.deepEqual(mergeConversationHistory(c.thread(), stale, cutoff, c.now()), []);
  assert.equal(
    c.record({ kind: CONVERSATION_ENTRY_KIND.REPLY, words: LATE_REPLY }, cutoff ?? 0),
    true,
  );
  assert.deepEqual(c.thread(), []);

  // The fresh generation takes a new ask, and its lines are the only lines.
  c.tick();
  const fresh = await c.submit(agent, "NEW_ASK");
  await settle();
  client.release(reply("NEW_REPLY"));
  await settle();
  assert.equal(agent.request(fresh)?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
  assert.deepEqual(
    c.thread().map((entry) => entry.words),
    ["NEW_ASK", "NEW_REPLY"],
  );
  const stored = brainStateFromStored(c.brainDisk.file);
  assert.equal(stored?.generationId, "gen-2");
  assert.deepEqual(stored?.reset, marker);
  assert.equal(stored?.requests.length, 1);
  for (const word of [OLD_ASK, OLD_REPLY, OLD_COMPACTION, LATE_REPLY]) {
    assert.ok(!c.surface().includes(word), `${word} came back with the new ask`);
  }

  // A relaunch on the same disk finds the marker and nothing of the old words.
  const relaunched = new BrainStateStore({
    storage: c.brainDisk,
    createGenerationId: () => "gen-relaunch",
    now: c.now,
  });
  const loaded = await relaunched.load();
  assert.equal(loaded.generationId, "gen-2");
  assert.deepEqual(loaded.reset, marker);
  assert.ok(!JSON.stringify(loaded).includes(OLD_COMPACTION));
  await c.host.replace(() => undefined);
});

test("a Clear whose marker will not write stays fenced and answers incomplete, and the next landed write finishes the erasure", async () => {
  const c = composed();
  const client = heldClient();
  await c.host.replace(() => c.build(client));
  const agent = c.host.current();
  assert.ok(agent);
  const first = await c.submit(agent, OLD_ASK);
  await settle();
  client.release(reply(OLD_REPLY));
  await settle();
  assert.equal(agent.request(first)?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);

  c.tick();
  c.brainDisk.refuse = true;
  assert.equal(await c.clear(), false);
  c.brainDisk.refuse = false;
  assert.equal(c.reports.length, 1);
  assert.ok(c.reports[0]?.includes("incomplete"));
  // The thread was removed and the view is not emptied: the developer is
  // told the Clear did not complete, not shown a panel that says it did.
  assert.deepEqual(c.cleared, []);
  assert.equal(c.conversationFile(), undefined);
  assert.equal(c.clearedAt(), c.now());
  // The brain is fenced in memory even though the disk still says otherwise.
  assert.deepEqual(agent.requests(), []);
  assert.equal(c.store.holdsGeneration("gen-1"), false);
  assert.ok(String(c.brainDisk.file).includes(OLD_ASK));
  // A late main-path publication dated before the cutoff is not taken.
  assert.equal(c.record({ kind: CONVERSATION_ENTRY_KIND.REPLY, words: LATE_REPLY }, c.now()), true);
  assert.ok(!c.thread().some((entry) => entry.words === LATE_REPLY));

  // The next write that lands carries the marker and no old content.
  c.tick();
  const fresh = await c.submit(agent, "NEW_ASK");
  await settle();
  client.release(reply("NEW_REPLY"));
  await settle();
  assert.equal(agent.request(fresh)?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
  const stored = brainStateFromStored(c.brainDisk.file);
  assert.equal(stored?.reset?.generationId, "gen-1");
  assert.ok(!String(c.brainDisk.file).includes(OLD_ASK));
  assert.ok(!String(c.brainDisk.file).includes(OLD_REPLY));

  // Pressed again with the disk back, the Clear completes.
  c.tick();
  assert.equal(await c.clear(), true);
  assert.deepEqual(c.thread(), []);
  assert.equal(brainStateFromStored(c.brainDisk.file)?.reset?.generationId, "gen-2");
  await c.host.replace(() => undefined);
});

test("a Clear whose thread will not go keeps the view, and a launch between the marker and the thread's removal refuses the old lines", async () => {
  const c = composed();
  const client = heldClient();
  await c.host.replace(() => c.build(client));
  const agent = c.host.current();
  assert.ok(agent);
  const first = await c.submit(agent, OLD_ASK);
  await settle();
  client.release(reply(OLD_REPLY));
  await settle();
  assert.equal(agent.request(first)?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
  const threadFileBefore = c.conversationFile();
  assert.ok(threadFileBefore?.includes(OLD_REPLY));

  c.tick();
  c.refuseThread(false, true);
  assert.equal(await c.clear(), false);
  assert.deepEqual(c.cleared, []);
  assert.deepEqual(c.withdrawn, [c.now()]);
  // The marker is on disk, the brain fenced, the thread's file still standing.
  const marker = brainStateFromStored(c.brainDisk.file)?.reset;
  assert.deepEqual(marker, { generationId: "gen-1", clearedAt: c.now() });
  assert.deepEqual(agent.requests(), []);
  assert.equal(c.conversationFile(), threadFileBefore);

  // The process dies here. The next launch reads the marker first and the
  // thread file second, as the main process does, and the old lines are gone.
  const clearedAt = brainStateFromStored(c.brainDisk.file)?.reset?.clearedAt;
  assert.equal(clearedAt, marker?.clearedAt);
  const restored = conversationFromStored(c.conversationFile(), c.tick(), clearedAt);
  assert.deepEqual(restored, []);
  // Without the marker the same file would have stood the lines back up.
  assert.equal(conversationFromStored(c.conversationFile(), c.now()).length, 2);

  // Or the developer presses again with the disk back, and the Clear completes.
  c.refuseThread(false, false);
  assert.equal(await c.clear(), true);
  assert.equal(c.conversationFile(), undefined);
  assert.deepEqual(c.thread(), []);
  await c.host.replace(() => undefined);
});
