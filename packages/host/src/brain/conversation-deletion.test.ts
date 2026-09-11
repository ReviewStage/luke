import assert from "node:assert/strict";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MessageChannel } from "node:worker_threads";
import {
  BRAIN_REQUEST_ORIGIN,
  BRAIN_REQUEST_STATUS,
  BrainAgent,
  type BrainPersistedState,
  type BrainStateRepository,
  BrainStateStore,
  LOOK_SUBJECT,
  responsesModelAnswer,
  toolLoopRuntimeOver,
} from "@sidecar/brain";
import { type StoreClient, type StorePort, serveStore, storeClient } from "@sidecar/brain/store";
import {
  type BareResponsesModel,
  bareModelAdapter,
  fakeActionPerformer,
} from "@sidecar/brain/testing";
import { drainMicrotasks } from "@sidecar/runtime/testing";
import {
  DEFAULT_AGENT_ID,
  MAIN_CONVERSATION_NAME,
  MAIN_SESSION_KEY,
  type ModelResponse,
  type TranscriptEvent,
} from "@sidecar/runtime/vocabulary";
import {
  CONVERSATION_ENTRY_KIND,
  type ConversationEntry,
  conversationLinesText,
  recentConversationEntries,
} from "@sidecar/session";
import { ACTION_RESULT_STATUS, type WireRecord } from "@sidecar/wire";
import { temporaryDirectory } from "@sidecar/wire/testing";
import { type TestContext, test } from "vitest";
import { ConversationThread } from "../conversation-thread.js";
import { operatorOverBrain } from "../testing/index.js";
import { CONVERSATION_DELETE_OUTCOME, deleteConversationFlow } from "./conversation-deletion.js";
import { followBrainRequests } from "./publication.js";

/**
 * The Clear composed as the main process composes it: the real database and
 * its envelope repository, the real brain store and agent, the real thread,
 * and the real deletion flow, with only the model synthetic. Every marker
 * below is a synthetic word that must be found in no context, no window, and
 * no row after the press — whatever the disk then does.
 */

const NOW = 1_800_000_000_000;
const OLD_ASK = "OLD_ASK_MARKER";
const OLD_REPLY = "OLD_REPLY_MARKER";
const OLD_COMPACTION = "OLD_COMPACTION_MARKER";
const LATE_REPLY = "LATE_REPLY_MARKER";
const AFTER_WORDS = "AFTER_THE_PRESS";

function heldClient() {
  const waiting: ((answer: ModelResponse) => void)[] = [];
  const inputs: string[] = [];
  const client: BareResponsesModel & {
    inputs: string[];
    release: (answer: ModelResponse) => void;
  } = {
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
  return client;
}

function reply(text: string, ...before: WireRecord[]): ModelResponse {
  const answer = responsesModelAnswer({
    output: [
      ...before,
      { type: "message", role: "assistant", content: [{ type: "output_text", text }] },
    ],
  });
  assert.ok(answer);
  return answer;
}

/** The envelope repository as the store client builds it, with a switch that refuses writes. */
function repository(client: StoreClient) {
  const inner = client.brainStateRepository(MAIN_SESSION_KEY);
  const repo: BrainStateRepository & { refuse: boolean } = {
    refuse: false,
    load: () => inner.load(),
    save: (state: BrainPersistedState, transcript?: readonly TranscriptEvent[]) => {
      if (repo.refuse) throw new Error("disk refused");
      return inner.save(state, transcript);
    },
  };
  return repo;
}

async function composed(t: TestContext) {
  const root = await temporaryDirectory(t, "luke-clear-");
  const channel = new MessageChannel();
  // SAFETY: a MessagePort posts and receives structured-clone values on the same events the port contract names.
  serveStore(channel.port2 as unknown as StorePort);
  // SAFETY: as above, for the client's end of the same channel.
  const client = storeClient(channel.port1 as unknown as StorePort);
  let clock = NOW;
  let ids = 0;
  let generations = 0;
  const reports: string[] = [];
  const repo = repository(client);
  const store = new BrainStateStore({
    repository: repo,
    createGenerationId: () => `gen-${++generations}`,
    now: () => clock,
    report: (message) => reports.push(message),
  });
  const relayed: (readonly ConversationEntry[])[] = [];
  const thread = new ConversationThread({
    store: {
      appendConversation: (entries, now) =>
        client.ask("conversation.append", { sessionKey: MAIN_SESSION_KEY, entries, now }),
    },
    now: () => clock,
    onChanged: (entries) => relayed.push(entries),
  });
  const record = (entry: ConversationEntry, at: number) =>
    thread.append([{ ...entry, recordedAt: at, eventId: `line-${++ids}` }]);
  // Every agent built here is followed as the main process follows it — the
  // one Conversation write for a run — and stopped, with its follower drained, by
  // the harness's close whatever the test asserted.
  const followers = new Map<BrainAgent, () => Promise<void>>();
  const build = (client: BareResponsesModel) => {
    const agent = new BrainAgent({
      conversationId: MAIN_SESSION_KEY,
      runtime: toolLoopRuntimeOver(bareModelAdapter(client)),
      observes: { kind: LOOK_SUBJECT.NONE },
      prepareTurn: () => ({ prompt: "instructions", layers: {} }),
      actions: fakeActionPerformer().actions,
      roster: () => ({ text: "- abc", identities: [] }),
      // The standing context as the main process renders it: the recent
      // thread, so a line the Clear left anywhere would reach the model.
      standingContext: () =>
        conversationLinesText(recentConversationEntries(thread.entries()), []) ?? "",
      readTranscriptSince: async () => ({ status: ACTION_RESULT_STATUS.REJECTED, reason: "no" }),
      readTranscript: async () => ({ status: ACTION_RESULT_STATUS.REJECTED, reason: "no" }),
      deliver: () => undefined,
      store,
      createRunId: () => `run-${++ids}`,
      report: () => undefined,
      now: () => clock,
    });
    followers.set(
      agent,
      followBrainRequests(
        agent,
        { recordConversationEntry: record, broadcastRequests: () => undefined },
        MAIN_SESSION_KEY,
      ),
    );
    return agent;
  };
  const stop = async (agent: BrainAgent) => {
    await agent.stop();
    await followers.get(agent)?.();
    followers.delete(agent);
  };
  let refuseErase = false;
  let eraseGate: Promise<void> | undefined;
  const clear = () =>
    deleteConversationFlow({
      now: () => clock,
      fence: (at) => thread.fence(at),
      readCutoffBefore: async () => ({
        value: await client.ask("conversation.cutoff", { sessionKey: MAIN_SESSION_KEY }),
      }),
      fenceBrain: (at) => store.clear(at),
      erase: async (at, cutoffBefore) => {
        await eraseGate;
        if (refuseErase) return undefined;
        const generationId = store.generationId();
        const archiveId = `archive-${++ids}`;
        const outcome = await client.ask(
          "conversations.delete",
          generationId === undefined
            ? {
                sessionKey: MAIN_SESSION_KEY,
                now: at,
                archiveId,
                cutoffBefore: { value: cutoffBefore },
              }
            : {
                sessionKey: MAIN_SESSION_KEY,
                now: at,
                archiveId,
                keepSessionId: generationId,
                cutoffBefore: { value: cutoffBefore },
              },
        );
        return outcome ? { published: outcome.published } : undefined;
      },
      report: (message) => reports.push(message),
    });
  // The operator stands over whichever agent the ask names, as the host's
  // current brain would, so a rebuilt agent is submitted to like the first.
  let asking: BrainAgent | undefined;
  const operator = operatorOverBrain({
    current: () => asking,
    recordConversationEntry: (entry, at) => record(entry, at),
  });
  const submit = async (agent: BrainAgent, question: string) => {
    asking = agent;
    const result = await operator.submit({
      submissionId: `sub-${++ids}`,
      question,
      origin: BRAIN_REQUEST_ORIGIN.TYPED,
    });
    assert.equal(result.outcome, "accepted");
    return result.outcome === "accepted" ? result.runId : "";
  };
  /** Every row the database holds for main, read on a second handle and flattened for a marker search. */
  const rows = () => {
    const raw = new DatabaseSync(path.join(root, "agent.sqlite"), { readOnly: true });
    try {
      return JSON.stringify({
        sessions: raw
          .prepare("SELECT session_id, reset_cleared_at FROM conversation_sessions")
          .all(),
        checkpoints: raw.prepare("SELECT item FROM runtime_checkpoints").all(),
        history: raw
          .prepare("SELECT words, recorded_at FROM conversation_events WHERE session_key = ?")
          .all(MAIN_SESSION_KEY),
        transcript: raw
          .prepare("SELECT payload FROM transcript_events WHERE session_key = ?")
          .all(MAIN_SESSION_KEY),
      });
    } finally {
      raw.close();
    }
  };
  /** The model's checkpoint items on disk, every lifetime's, flattened for a marker search. */
  const checkpoints = () => {
    const raw = new DatabaseSync(path.join(root, "agent.sqlite"), { readOnly: true });
    try {
      return JSON.stringify(raw.prepare("SELECT item FROM runtime_checkpoints").all());
    } finally {
      raw.close();
    }
  };
  /** The standing lifetime's id and marker on disk. */
  const standing = () => {
    const raw = new DatabaseSync(path.join(root, "agent.sqlite"), { readOnly: true });
    try {
      // SAFETY: the two columns selected are the ones the row type names.
      return raw
        .prepare(
          "SELECT session_id, reset_cleared_at FROM conversation_sessions WHERE session_key = ?",
        )
        .get(MAIN_SESSION_KEY) as
        | { session_id: string; reset_cleared_at: number | null }
        | undefined;
    } finally {
      raw.close();
    }
  };
  const open = async () => {
    await client.open({
      agentRoot: root,
      agentId: DEFAULT_AGENT_ID,
      sessionKey: MAIN_SESSION_KEY,
      conversationName: MAIN_CONVERSATION_NAME,
      now: clock,
    });
    thread.restore(
      await client.ask("conversation.list", { sessionKey: MAIN_SESSION_KEY, now: clock }),
      await client.ask("conversation.cutoff", { sessionKey: MAIN_SESSION_KEY }),
    );
  };
  return {
    root,
    client,
    open,
    standing,
    repo,
    store,
    thread,
    relayed,
    reports,
    build,
    stop,
    clear,
    submit,
    record,
    rows,
    checkpoints,
    tick: () => {
      clock += 1;
      return clock;
    },
    now: () => clock,
    refuseErase: (refuse: boolean) => {
      refuseErase = refuse;
    },
    holdErase: () => {
      let release: (() => void) | undefined;
      eraseGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => release?.();
    },
    close: async () => {
      for (const agent of [...followers.keys()]) await stop(agent);
      await client.close();
      channel.port1.close();
      channel.port2.close();
    },
  };
}

/** Seeds a finished, compacted exchange whose words stand in the checkpoint, the transcript, and the thread. */
async function seeded(c: Awaited<ReturnType<typeof composed>>) {
  await c.open();
  const client = heldClient();
  const agent = c.build(client);
  const first = await c.submit(agent, OLD_ASK);
  await drainMicrotasks(40);
  client.release(
    reply(OLD_REPLY, { type: "compaction", id: "cmp_1", encrypted_content: OLD_COMPACTION }),
  );
  await drainMicrotasks(40);
  assert.equal(agent.request(first)?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
  assert.ok(c.thread.entries().some((entry) => entry.words === OLD_REPLY));
  return { agent, client };
}

/** One archive as the registry row holds it, read from the database the worker owns. */
type ArchiveRegistryRow = {
  archiveId: string;
  fileName: string;
  encoding: string;
  conversationLines: number;
  publishedAt: number | null;
};

function archivesOf(root: string): ArchiveRegistryRow[] {
  const raw = new DatabaseSync(path.join(root, "agent.sqlite"), { readOnly: true });
  try {
    // SAFETY: the columns selected are the ones the row type names, typed by the schema.
    return raw
      .prepare(
        `SELECT archive_id AS archiveId, file_name AS fileName, encoding,
                conversation_lines AS conversationLines, published_at AS publishedAt
         FROM conversation_archives ORDER BY deleted_at DESC, archive_id`,
      )
      .all() as ArchiveRegistryRow[];
  } finally {
    raw.close();
  }
}

/** The cutoff the archive's registry row recorded as standing before its deletion. */
function previousCutoffOf(root: string, archiveId: string): number | null | undefined {
  const raw = new DatabaseSync(path.join(root, "agent.sqlite"), { readOnly: true });
  try {
    // SAFETY: the one column selected is the nullable integer the schema names.
    const row = raw
      .prepare("SELECT previous_cutoff FROM conversation_archives WHERE archive_id = ?")
      .get(archiveId) as { previous_cutoff: number | null } | undefined;
    return row?.previous_cutoff;
  } finally {
    raw.close();
  }
}

test("a Clear under a held model answer fences the brain and the thread before any wait, keeps the line accepted after the press, archives what stood, and the next ask sees none of the old words", async (t) => {
  const c = await composed(t);
  t.onTestFinished(() => c.close());
  const { agent, client } = await seeded(c);
  // A second ask whose answer is still out when the press lands.
  c.tick();
  const late = await c.submit(agent, "second ask");
  await drainMicrotasks(40);
  const pressedAt = c.tick();
  const clearing = c.clear();
  // The fences are synchronous: the store already stands on the successor,
  // and the thread is already empty and relayed, before anything is awaited.
  assert.notEqual(c.store.generationId(), undefined);
  assert.equal(c.store.resetMarker()?.clearedAt, pressedAt);
  assert.deepEqual(c.thread.entries(), []);
  assert.deepEqual(c.relayed.at(-1), []);
  // A voice line landing a beat after the press, while the deletion waits, is the conversation's next line.
  const afterAt = c.tick();
  assert.equal(
    await c.record({ kind: CONVERSATION_ENTRY_KIND.SPOKEN_ASK, words: AFTER_WORDS }, afterAt),
    true,
  );
  // The late answer lands on the fenced generation: recorded nowhere.
  client.release(reply(LATE_REPLY));
  await drainMicrotasks(40);
  assert.equal(await clearing, CONVERSATION_DELETE_OUTCOME.COMPLETE);
  // The late run went with its generation: revoked, and standing in no record.
  assert.equal(agent.request(late), undefined);
  // The rows: the successor lifetime stands with nothing in it, the old words are gone, the later line stays.
  const standing = c.standing();
  assert.equal(standing?.session_id, c.store.generationId());
  assert.equal(standing?.reset_cleared_at, pressedAt);
  assert.deepEqual(
    (await c.client.ask("conversation.list", { sessionKey: MAIN_SESSION_KEY, now: c.now() })).map(
      (entry) => entry.words,
    ),
    [AFTER_WORDS],
  );
  assert.deepEqual(
    c.thread.entries().map((entry) => entry.words),
    [AFTER_WORDS],
  );
  assert.equal(
    await c.client.ask("conversation.cutoff", { sessionKey: MAIN_SESSION_KEY }),
    pressedAt,
  );
  // The archive holds exactly what stood at the press, compressed on disk.
  const [archive] = archivesOf(c.root);
  assert.ok(archive);
  assert.notEqual(archive.publishedAt, null);
  // The two seeded lines and the second ask, which stood at the press; its answer never landed.
  assert.equal(archive.conversationLines, 3);
  // The same agent works on from the successor: its next ask carries none of the old words.
  const next = await c.submit(agent, "what now");
  await drainMicrotasks(40);
  client.release(reply("fresh"));
  await drainMicrotasks(40);
  assert.equal(agent.request(next)?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
  await c.stop(agent);
});

test("a Clear whose rows the store will not remove answers refused, yet the old words reach no context, no window, and no later launch of the brain", async (t) => {
  const c = await composed(t);
  t.onTestFinished(() => c.close());
  const { agent, client } = await seeded(c);
  c.refuseErase(true);
  const pressedAt = c.tick();
  assert.equal(await c.clear(), CONVERSATION_DELETE_OUTCOME.REFUSED);
  // The thread is fenced in memory and by the durable cutoff the marker raised.
  assert.deepEqual(c.thread.entries(), []);
  assert.equal(
    await c.client.ask("conversation.cutoff", { sessionKey: MAIN_SESSION_KEY }),
    pressedAt,
  );
  assert.deepEqual(
    await c.client.ask("conversation.list", { sessionKey: MAIN_SESSION_KEY, now: c.now() }),
    [],
  );
  // The old checkpoint is gone from the database: the marker's successor
  // stands, empty. The transcript and lines are the refused erasure's, and
  // stay on disk behind the fences until a deletion takes them.
  assert.equal(c.standing()?.reset_cleared_at, pressedAt);
  // The same agent's next ask, and a rebuilt agent's — a credential change
  // landing now — both see none of the old words.
  await c.submit(agent, "again");
  await drainMicrotasks(40);
  client.release(reply("ok"));
  await drainMicrotasks(40);
  await c.stop(agent);
  const rebuiltClient = heldClient();
  const rebuilt = c.build(rebuiltClient);
  await c.submit(rebuilt, "after a rebuild");
  await drainMicrotasks(40);
  rebuiltClient.release(reply("ok"));
  await drainMicrotasks(40);
  await c.stop(rebuilt);
});

test("a Clear whose marker the disk refuses answers refused without touching the rows, and still fences every context; the next landed write replaces what the disk kept", async (t) => {
  const c = await composed(t);
  t.onTestFinished(() => c.close());
  const { agent, client } = await seeded(c);
  c.repo.refuse = true;
  const pressedAt = c.tick();
  assert.equal(await c.clear(), CONVERSATION_DELETE_OUTCOME.REFUSED);
  assert.deepEqual(archivesOf(c.root), []);
  // In memory the old generation stands nowhere: the store holds the marker
  // successor, the thread is fenced, and the agent's next ask sees no old word.
  assert.equal(c.store.resetMarker()?.clearedAt, pressedAt);
  assert.deepEqual(c.thread.entries(), []);
  c.repo.refuse = false;
  const next = await c.submit(agent, "again");
  await drainMicrotasks(40);
  client.release(reply("ok"));
  await drainMicrotasks(40);
  assert.equal(agent.request(next)?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
  // The acceptance's write replaced the old generation on disk with the marker successor.
  assert.equal(c.standing()?.reset_cleared_at, pressedAt);
  await c.stop(agent);
});

test("a credential rebuild landing while the deletion waits on the disk builds over the successor, never the old checkpoint, and a second Clear during the first is harmless", async (t) => {
  const c = await composed(t);
  t.onTestFinished(() => c.close());
  const { agent, client } = await seeded(c);
  await c.stop(agent);
  const release = c.holdErase();
  c.tick();
  const clearing = c.clear();
  // The rebuild: a new agent over the same store, while the rows are still on disk.
  const rebuiltClient = heldClient();
  const rebuilt = c.build(rebuiltClient);
  await rebuilt.ready();
  await c.submit(rebuilt, "during the wait");
  await drainMicrotasks(40);
  rebuiltClient.release(reply("ok"));
  await drainMicrotasks(40);
  // A second press while the first still waits: another fence, no harm.
  c.tick();
  const second = c.clear();
  release();
  assert.equal(await clearing, CONVERSATION_DELETE_OUTCOME.COMPLETE);
  assert.equal(await second, CONVERSATION_DELETE_OUTCOME.COMPLETE);
  assert.equal(c.standing()?.session_id, c.store.generationId());
  assert.equal(client.inputs.length, 1);
  await c.stop(rebuilt);
});

test("a Clear whose marker the disk refused, followed by a Clear that lands, archives the lines still on disk under the cutoff the disk held before the press, never the refused press's own fence", async (t) => {
  const c = await composed(t);
  t.onTestFinished(() => c.close());
  const { agent } = await seeded(c);
  await c.stop(agent);
  // The first press: fenced in memory, marker refused, the lines still on disk.
  c.repo.refuse = true;
  c.tick();
  assert.equal(await c.clear(), CONVERSATION_DELETE_OUTCOME.REFUSED);
  assert.equal(
    await c.client.ask("conversation.cutoff", { sessionKey: MAIN_SESSION_KEY }),
    undefined,
  );
  c.repo.refuse = false;
  // The second press lands. Its archive must record the cutoff the disk
  // held before it — none — and not the first press's in-memory fence.
  const secondAt = c.tick();
  assert.equal(await c.clear(), CONVERSATION_DELETE_OUTCOME.COMPLETE);
  assert.equal(
    await c.client.ask("conversation.cutoff", { sessionKey: MAIN_SESSION_KEY }),
    secondAt,
  );
  const [archive] = archivesOf(c.root);
  assert.ok(archive);
  assert.equal(archive.conversationLines, 2);
  assert.equal(previousCutoffOf(c.root, archive.archiveId), null);
});
