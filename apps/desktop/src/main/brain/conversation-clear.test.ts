import assert from "node:assert/strict";
import test from "node:test";
import { REALTIME_TOOL, type RealtimeFunctionCall } from "@sidecar/acts";
import {
  BRAIN_REQUEST_ORIGIN,
  BRAIN_REQUEST_STATUS,
  type BrainActExecution,
  type BrainActPerformer,
  BrainAgent,
  type BrainClient,
  type BrainClientAnswer,
  type BrainStateStorage,
  BrainStateStore,
  brainStateFromStored,
  brainStateRecord,
  freshBrainState,
} from "@sidecar/brain";
import {
  appendConversationThreadEntry,
  BRIEFING_SPEECH_KIND,
  CONVERSATION_ENTRY_KIND,
  type ConversationEntry,
  conversationHistoryText,
  recentConversationEntries,
} from "@sidecar/realtime";
import { ACT_RESULT_STATUS, type WireRecord } from "@sidecar/wire";
import { SPEECH_OUTCOME } from "#shared/wire/speech";
import {
  conversationFromStored,
  conversationRecord,
  mergeConversationHistory,
} from "../memory-flow";
import { SpeechArbiter } from "../voice/speech-arbiter";
import { clearConversationAndBrain } from "./conversation-clear";
import { BrainHost } from "./host";
import { followBrainRequests, submitBrainAsk } from "./ipc";

/**
 * The Clear composed as the main process composes it: the real store, agent,
 * host, follower, submission path, speech arbiter, the thread's own cutoff
 * rule, and the standing context the brain is actually handed, with only the
 * model, the performer, and the disk synthetic. Every marker below is a
 * synthetic word that must be found nowhere after the press.
 */

const NOW = 1_800_000_000_000;
const OLD_ASK = "OLD_ASK_MARKER";
const OLD_REPLY = "OLD_REPLY_MARKER";
const OLD_COMPACTION = "OLD_COMPACTION_MARKER";
const OLD_BRIEFING = "OLD_BRIEFING_MARKER";
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
}

function heldClient(): BrainClient & {
  release: (answer: BrainClientAnswer) => void;
  inputs: string[];
} {
  const waiting: ((answer: BrainClientAnswer) => void)[] = [];
  const inputs: string[] = [];
  return {
    inputs,
    respond: (input) => {
      inputs.push(JSON.stringify(input));
      return new Promise((resolve) => {
        waiting.push(resolve);
      });
    },
    quietUntil: () => undefined,
    release: (answer) => {
      for (const resolve of waiting.splice(0)) resolve(answer);
    },
  };
}

function heldPerformer(): BrainActPerformer & { release: () => void; effects: number } {
  const waiting: (() => void)[] = [];
  const performer = {
    effects: 0,
    perform: async (
      _call: RealtimeFunctionCall,
      execution: BrainActExecution,
    ): Promise<WireRecord> => {
      await new Promise<void>((resolve) => {
        waiting.push(resolve);
      });
      if (execution.isRevoked()) return { status: ACT_RESULT_STATUS.REJECTED, reason: "revoked" };
      performer.effects += 1;
      return { status: ACT_RESULT_STATUS.ACCEPTED };
    },
    release: () => {
      for (const resolve of waiting.splice(0)) resolve();
    },
  };
  return performer;
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

function composed(brainDisk = new MemoryStorage()) {
  let conversationFile: string | undefined;
  let clock = NOW;
  let ids = 0;
  let generations = 0;
  const reports: string[] = [];
  const store = new BrainStateStore({
    storage: brainDisk,
    createGenerationId: () => `gen-${++generations}`,
    now: () => clock,
    report: (message) => reports.push(message),
  });
  let thread: readonly ConversationEntry[] = [];
  let clearedAt: number | undefined;
  let refuseThreadWrites = false;
  let refuseThreadRemoval = false;
  const cleared: number[] = [];
  const withdrawn: string[] = [];
  const broadcasts: (readonly { runId: string; status: string }[])[] = [];
  const arbiter = new SpeechArbiter({ now: () => clock, nextId: () => `speech-${++ids}` });
  // What the main process does on the store's announcement: the backlog and
  // the outstanding offer go, and the mouth is told which offer it lost.
  store.onReplaced(() => {
    const offered = arbiter.withdrawBriefings();
    if (offered) withdrawn.push(offered);
  });
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
      // The standing context as the main process renders it: the recent
      // thread, so a line the Clear left in memory would reach the model.
      standingContext: () => conversationHistoryText(recentConversationEntries(thread), []) ?? "",
      readTranscriptSince: async () => ({ status: ACT_RESULT_STATUS.REJECTED, reason: "no" }),
      readTranscript: async () => ({ status: ACT_RESULT_STATUS.REJECTED, reason: "no" }),
      deliver: (delivery) => {
        arbiter.request({ kind: BRIEFING_SPEECH_KIND, delivery });
      },
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
        thread = [];
        cleared.push(at);
      },
      eraseConversation: () => {
        if (refuseThreadRemoval) return false;
        // As the main process erases: to what the thread holds now.
        conversationFile = thread.length === 0 ? undefined : conversationRecord(thread, clock);
        return true;
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
      arbiter: arbiter.next(),
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
    arbiter,
    withdrawn,
    thread: () => thread,
    conversationFile: () => conversationFile,
    clearedAt: () => clearedAt,
    cleared,
    reports,
    broadcasts,
    tick: (ms = 1) => {
      clock += ms;
      return clock;
    },
    now: () => clock,
    setClock: (at: number) => {
      clock = at;
    },
    refuseThread: (writes: boolean, removal = false) => {
      refuseThreadWrites = writes;
      refuseThreadRemoval = removal;
    },
  };
}

const OLD_WORDS = [OLD_ASK, OLD_REPLY, OLD_COMPACTION, OLD_BRIEFING, LATE_REPLY];

/** Seeds a finished, compacted exchange and a queued briefing, so every store has old content to lose. */
async function seeded(c: ReturnType<typeof composed>) {
  const client = heldClient();
  const performer = heldPerformer();
  await c.host.replace(() => c.build(client, performer));
  const agent = c.host.current();
  assert.ok(agent);
  const first = await c.submit(agent, OLD_ASK);
  await settle();
  client.release(
    reply(OLD_REPLY, { type: "compaction", id: "cmp_1", encrypted_content: OLD_COMPACTION }),
  );
  await settle();
  assert.equal(agent.request(first)?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
  assert.ok(c.thread().some((entry) => entry.words === OLD_REPLY));
  assert.ok(String(c.brainDisk.file).includes(OLD_COMPACTION));
  c.arbiter.request({
    kind: BRIEFING_SPEECH_KIND,
    delivery: { briefing: OLD_BRIEFING, decidedAt: c.now() },
  });
  return { agent, client, performer, first };
}

test("a Clear under a held model answer, a held act, a held publication, and an offered briefing leaves nothing of the old generation anywhere", async () => {
  const c = composed();
  const { agent, client, performer } = await seeded(c);
  const offer = c.arbiter.next();
  assert.ok(offer, "a briefing is in the mouth's hand");

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
  const clearing = c.clear();
  // Fenced before any disk was waited on: thread emptied, generation gone,
  // runs stood down, the offered briefing taken back from the mouth.
  assert.deepEqual(c.thread(), []);
  assert.equal(c.store.holdsGeneration("gen-1"), false);
  assert.deepEqual(agent.requests(), []);
  assert.deepEqual(c.withdrawn, [offer.id]);
  assert.equal(c.arbiter.offeredId, undefined);
  assert.equal(c.arbiter.pendingCount, 0);
  assert.equal(await clearing, true);
  const cutoff = c.clearedAt();
  assert.equal(cutoff, c.now());
  assert.deepEqual(c.cleared, [c.now()]);
  assert.equal(c.conversationFile(), undefined);
  const marker = brainStateFromStored(c.brainDisk.file)?.reset;
  assert.deepEqual(marker, { clearedAt: cutoff, generationId: "gen-1" });
  assert.deepEqual(c.broadcasts.at(-1), []);

  // Everything held is released after the press, and lands nowhere; the
  // mouth's late report on the withdrawn offer is ignored.
  performer.release();
  await settle();
  client.release(reply(LATE_REPLY));
  await settle();
  assert.equal(c.arbiter.settle(offer.id, SPEECH_OUTCOME.SPOKEN), undefined);
  assert.equal(performer.effects, 0);
  assert.equal(agent.request(second), undefined);
  assert.equal(agent.request(third), undefined);
  for (const word of OLD_WORDS) assert.ok(!c.surface().includes(word), `${word} survived`);
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

  // The fresh generation takes a new ask whose model input carries none of
  // the old words, and its lines are the only lines.
  c.tick();
  const fresh = await c.submit(agent, "NEW_ASK");
  await settle();
  const input = client.inputs.at(-1) ?? "";
  assert.ok(input.includes("NEW_ASK"));
  for (const word of OLD_WORDS) assert.ok(!input.includes(word), `${word} reached the model`);
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
  for (const word of OLD_WORDS) assert.ok(!c.surface().includes(word), `${word} came back`);

  // A relaunch on the same disk finds the marker and nothing of the old words.
  const relaunched = new BrainStateStore({
    storage: c.brainDisk,
    createGenerationId: () => "gen-relaunch",
    now: c.now,
  });
  const loaded = await relaunched.load();
  assert.equal(loaded.generationId, "gen-2");
  assert.deepEqual(loaded.reset, marker);
  await c.host.replace(() => undefined);
});

test("a Clear whose thread will not go still empties every context: the next ask, the next look, a later write, and a launch see none of the old words", async () => {
  const c = composed();
  const { agent, client } = await seeded(c);
  const threadFileBefore = c.conversationFile();
  assert.ok(threadFileBefore?.includes(OLD_REPLY));

  c.tick();
  c.refuseThread(false, true);
  assert.equal(await c.clear(), false);
  assert.ok(c.reports.some((message) => message.includes("conversation could not be removed")));
  // The view and the relay were emptied at the fence all the same, the
  // marker is on disk, the brain and its briefing are gone; only the
  // thread's file still stands, which is what "incomplete" reports.
  assert.deepEqual(c.cleared, [c.now()]);
  assert.deepEqual(c.thread(), []);
  assert.equal(c.arbiter.pendingCount, 0);
  const marker = brainStateFromStored(c.brainDisk.file)?.reset;
  assert.deepEqual(marker, { clearedAt: c.now(), generationId: "gen-1" });
  assert.deepEqual(agent.requests(), []);
  assert.equal(c.conversationFile(), threadFileBefore);

  // The next ask's model input carries none of the old words.
  c.tick();
  const fresh = await c.submit(agent, "NEW_ASK");
  await settle();
  const input = client.inputs.at(-1) ?? "";
  assert.ok(input.includes("NEW_ASK"));
  for (const word of OLD_WORDS) assert.ok(!input.includes(word), `${word} reached the model`);
  client.release(reply("NEW_REPLY"));
  await settle();
  assert.equal(agent.request(fresh)?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
  // The later write of the thread carries only the new lines, which is
  // what finishes the erasure the removal could not.
  assert.deepEqual(
    c.thread().map((entry) => entry.words),
    ["NEW_ASK", "NEW_REPLY"],
  );
  assert.ok(!String(c.conversationFile()).includes(OLD_REPLY));
  // The next observation look reads the same emptied context.
  agent.rosterLook();
  await settle();
  const look = client.inputs.at(-1) ?? "";
  for (const word of OLD_WORDS) assert.ok(!look.includes(word), `${word} reached a look`);
  client.release(reply(""));
  await settle();
  await c.host.replace(() => undefined);
});

test("a launch between the marker and the thread's removal refuses the old lines, and a Clear pressed before any state loaded still leaves the marker", async () => {
  const c = composed();
  const { agent } = await seeded(c);
  const threadFile = c.conversationFile();
  c.tick();
  c.refuseThread(false, true);
  assert.equal(await c.clear(), false);
  assert.deepEqual(agent.requests(), []);
  await c.host.replace(() => undefined);
  // The process dies here. The next launch reads the marker first and the
  // thread file second, as the main process does, and the old lines are gone.
  const clearedAt = brainStateFromStored(c.brainDisk.file)?.reset?.clearedAt;
  assert.equal(clearedAt, c.now());
  assert.deepEqual(conversationFromStored(threadFile, c.tick(), clearedAt), []);
  // Without the marker the same file would have stood the lines back up.
  assert.equal(conversationFromStored(threadFile, c.now()).length, 2);

  // A launch with no capability never loads the brain file; the Clear still
  // marks it, learning the erased id from the file and reading nothing else.
  const cold = new MemoryStorage();
  cold.file = brainStateRecord({
    ...freshBrainState("gen-old", NOW),
    items: [{ type: "message", role: "user", content: OLD_COMPACTION }],
  });
  const d = composed(cold);
  d.setClock(NOW + 10);
  d.refuseThread(false, true);
  assert.equal(await d.clear(), false);
  assert.deepEqual(brainStateFromStored(cold.file)?.reset, {
    clearedAt: NOW + 10,
    generationId: "gen-old",
  });
  assert.ok(!String(cold.file).includes(OLD_COMPACTION));
  // And with no brain file at all, the marker still carries the instant.
  const bare = composed(new MemoryStorage());
  bare.setClock(NOW + 20);
  assert.equal(await bare.clear(), true);
  assert.deepEqual(brainStateFromStored(bare.brainDisk.file)?.reset, { clearedAt: NOW + 20 });
});

test("a Clear whose marker will not write stays fenced and answers incomplete, and the next landed write finishes the erasure", async () => {
  const c = composed();
  const { agent, client } = await seeded(c);
  c.tick();
  c.brainDisk.refuse = true;
  assert.equal(await c.clear(), false);
  c.brainDisk.refuse = false;
  assert.ok(c.reports.some((message) => message.includes("marked erased")));
  assert.deepEqual(c.cleared, [c.now()]);
  assert.deepEqual(c.thread(), []);
  // Without a durable cutoff the thread's file is left standing, out of
  // every view and context, for the next thread write to replace.
  assert.ok(String(c.conversationFile()).includes(OLD_REPLY));
  assert.equal(c.arbiter.pendingCount, 0);
  assert.deepEqual(agent.requests(), []);
  assert.equal(c.store.holdsGeneration("gen-1"), false);
  assert.ok(String(c.brainDisk.file).includes(OLD_ASK));
  assert.equal(c.record({ kind: CONVERSATION_ENTRY_KIND.REPLY, words: LATE_REPLY }, c.now()), true);
  assert.deepEqual(c.thread(), []);

  c.tick();
  const fresh = await c.submit(agent, "NEW_ASK");
  await settle();
  for (const word of OLD_WORDS) assert.ok(!(client.inputs.at(-1) ?? "").includes(word));
  client.release(reply("NEW_REPLY"));
  await settle();
  assert.equal(agent.request(fresh)?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
  const stored = brainStateFromStored(c.brainDisk.file);
  assert.equal(stored?.reset?.generationId, "gen-1");
  assert.ok(!String(c.brainDisk.file).includes(OLD_ASK));
  assert.ok(!String(c.conversationFile()).includes(OLD_REPLY));
  c.tick();
  assert.equal(await c.clear(), true);
  assert.equal(brainStateFromStored(c.brainDisk.file)?.reset?.generationId, "gen-2");
  await c.host.replace(() => undefined);
});

test("an expiry takes the held speech backlog with the generation, so the successor is never handed the old briefings", async () => {
  const c = composed();
  const { agent } = await seeded(c);
  // The briefing is held under quiet, waiting for the brain's re-decision.
  c.arbiter.setQuiet(true);
  c.arbiter.request({
    kind: BRIEFING_SPEECH_KIND,
    delivery: { briefing: `${OLD_BRIEFING}_HELD`, decidedAt: c.now() },
  });
  assert.equal(c.arbiter.heldBriefingCount, 2);
  const born = c.store.current();
  assert.ok(born);
  c.setClock(born.expiresAt);
  assert.equal(c.store.expireIfDue(c.now()), true);
  assert.equal(c.arbiter.heldBriefingCount, 0);
  c.arbiter.setQuiet(false);
  assert.deepEqual(c.arbiter.takeHeldBriefings(), []);
  assert.deepEqual(agent.requests(), []);
  await c.store.flush();
  assert.ok(!String(c.brainDisk.file).includes(OLD_COMPACTION));
  await c.host.replace(() => undefined);
});

test("the thread is erased only once the marker is durable, and a line recorded after the fence survives the erasure", async () => {
  const c = composed();
  const { agent, client } = await seeded(c);
  // The marker's write is held on disk.
  let releaseWrite: (() => void) | undefined;
  const write = c.brainDisk.write.bind(c.brainDisk);
  c.brainDisk.write = (contents) =>
    // SAFETY: the store accepts a promise of the write's outcome; this test holds it open.
    new Promise<boolean>((resolve) => {
      releaseWrite = () => resolve(write(contents));
    }) as unknown as boolean;
  c.tick();
  const clearing = c.clear();
  await settle();
  assert.ok(releaseWrite, "the marker is on disk");
  // Fenced, yet the old thread's file is untouched until the marker lands.
  assert.deepEqual(c.thread(), []);
  assert.ok(String(c.conversationFile()).includes(OLD_REPLY));
  // A new-generation ask is recorded meanwhile; its acceptance queues behind
  // the marker on disk, its line stands in the thread at once.
  c.tick();
  const submitting = c.submit(agent, "NEW_ASK");
  await settle();
  c.brainDisk.write = write;
  releaseWrite();
  assert.equal(await clearing, true);
  await submitting;
  await settle();
  // The erasure kept the new line and dropped the old ones.
  assert.deepEqual(
    c.thread().map((entry) => entry.words),
    ["NEW_ASK"],
  );
  assert.ok(!String(c.conversationFile()).includes(OLD_REPLY));
  assert.ok(String(c.conversationFile()).includes("NEW_ASK"));
  client.release(reply("NEW_REPLY"));
  await settle();
  assert.deepEqual(
    c.thread().map((entry) => entry.words),
    ["NEW_ASK", "NEW_REPLY"],
  );
  await c.host.replace(() => undefined);
});
