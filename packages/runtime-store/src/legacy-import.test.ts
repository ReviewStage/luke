import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  BRAIN_GENERATION_LIFETIME_MS,
  BRAIN_REQUEST_STATUS,
  brainStateRecord,
  freshBrainState,
} from "@sidecar/brain";
import { CONVERSATION_ENTRY_KIND, type ConversationEntry } from "@sidecar/realtime";
import { MAIN_SESSION_KEY, MIGRATION_OUTCOME } from "@sidecar/runtime-contracts";
import type { RuntimeDatabase } from "./database.js";
import { importLegacyState, type LegacySources, RECOVERY_DIRECTORY_NAME } from "./legacy-import.js";
import { line, NOW, openTestDatabase, populatedState, request } from "./testing.js";

function scratch(): { root: string; sources: LegacySources; recovery: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "luke-legacy-"));
  return {
    root,
    sources: {
      brainState: path.join(root, "brain-state.json"),
      conversation: path.join(root, "conversation.json"),
      personalFacts: path.join(root, "memory.json"),
    },
    recovery: path.join(root, "agents", "main", RECOVERY_DIRECTORY_NAME),
  };
}

function conversationFile(entries: readonly ConversationEntry[]): string {
  return `${JSON.stringify({ entries })}\n`;
}

const THREAD = [
  line("what is running", NOW - 3000, {
    kind: CONVERSATION_ENTRY_KIND.TYPED_ASK,
    requestId: "run-1",
  }),
  line("two agents", NOW - 2000, { requestId: "run-1" }),
  line("one more", NOW - 1000),
];
const FACTS = {
  facts: [
    { id: "f1", words: "prefers short replies" },
    { id: "f2", words: "works mornings" },
  ],
};

function run(database: RuntimeDatabase, s: ReturnType<typeof scratch>, now = NOW) {
  return importLegacyState({
    database,
    sessionKey: MAIN_SESSION_KEY,
    sources: s.sources,
    recoveryDirectory: s.recovery,
    now,
  });
}

test("a valid legacy state is imported whole, receipted, and its files retired; a retry imports nothing twice", () => {
  const s = scratch();
  const state = populatedState("gen-legacy", NOW - 1000);
  fs.writeFileSync(s.sources.brainState, brainStateRecord(state));
  fs.writeFileSync(`${s.sources.brainState}.tmp`, "half a write");
  fs.writeFileSync(s.sources.conversation, conversationFile(THREAD));
  fs.writeFileSync(s.sources.personalFacts, JSON.stringify(FACTS));
  const database = openTestDatabase();
  const report = run(database, s);
  assert.deepEqual(report.brainState, {
    outcome: MIGRATION_OUTCOME.IMPORTED,
    alreadyImported: false,
  });
  assert.deepEqual(report.conversation, {
    outcome: MIGRATION_OUTCOME.IMPORTED,
    alreadyImported: false,
  });
  assert.deepEqual(report.personalFacts, {
    outcome: MIGRATION_OUTCOME.IMPORTED,
    alreadyImported: false,
  });
  assert.deepEqual(report.failures, []);
  assert.deepEqual(database.loadBrainState(MAIN_SESSION_KEY), { state });
  const history = database.listHistory(MAIN_SESSION_KEY, NOW);
  assert.deepEqual(
    history.map((entry) => ({ words: entry.words, requestId: entry.requestId })),
    THREAD.map((entry) => ({ words: entry.words, requestId: entry.requestId })),
  );
  assert.ok(history.every((entry) => entry.eventId?.startsWith("legacy:")));
  assert.deepEqual(database.personalFacts(), FACTS.facts);
  // Imported lines are attributed to the imported generation.
  assert.deepEqual(database.historySessionIds(MAIN_SESSION_KEY), ["gen-legacy"]);
  // The files, the half-written temporary beside one, all moved out of the launch's way.
  assert.equal(fs.existsSync(s.sources.brainState), false);
  assert.equal(fs.existsSync(`${s.sources.brainState}.tmp`), false);
  assert.equal(fs.existsSync(s.sources.conversation), false);
  assert.equal(fs.existsSync(s.sources.personalFacts), false);
  const batch = fs.readdirSync(s.recovery);
  assert.deepEqual(batch, [`legacy-${NOW}`]);
  assert.deepEqual(fs.readdirSync(path.join(s.recovery, batch[0] ?? "")).sort(), [
    "brain-state.json",
    "brain-state.json.tmp",
    "conversation.json",
    "memory.json",
  ]);
  // The retry finds the receipts and the empty paths, and changes nothing.
  const again = run(database, s, NOW + 1);
  assert.deepEqual(again.brainState, {
    outcome: MIGRATION_OUTCOME.IMPORTED,
    alreadyImported: true,
  });
  assert.deepEqual(again.retired, []);
  assert.equal(database.countHistory(MAIN_SESSION_KEY), THREAD.length);
  assert.deepEqual(database.loadBrainState(MAIN_SESSION_KEY), { state });
  assert.deepEqual(database.personalFacts(), FACTS.facts);
});

test("an expired generation imports nothing, its Clear marker still bounds the thread, and a cleared thread stays cleared", () => {
  const s = scratch();
  const clearedAt = NOW - 5000;
  const expired = {
    ...populatedState("gen-old", NOW - BRAIN_GENERATION_LIFETIME_MS - 1),
    reset: { clearedAt: NOW - BRAIN_GENERATION_LIFETIME_MS - 1, generationId: "gen-older" },
  };
  fs.writeFileSync(s.sources.brainState, brainStateRecord(expired));
  fs.writeFileSync(s.sources.conversation, conversationFile(THREAD));
  const database = openTestDatabase();
  const report = run(database, s);
  assert.equal(report.brainState?.outcome, MIGRATION_OUTCOME.EMPTY);
  assert.deepEqual(database.loadBrainState(MAIN_SESSION_KEY), {});
  assert.equal(database.listHistory(MAIN_SESSION_KEY, NOW).length, THREAD.length);
  assert.deepEqual(database.historySessionIds(MAIN_SESSION_KEY), [undefined]);

  const cleared = scratch();
  const live = {
    ...freshBrainState("gen-live", NOW - 100),
    reset: { clearedAt, generationId: "gen-erased" },
  };
  fs.writeFileSync(cleared.sources.brainState, brainStateRecord(live));
  fs.writeFileSync(
    cleared.sources.conversation,
    conversationFile([
      line("before the clear", clearedAt - 1),
      line("at the clear", clearedAt),
      line("after the clear", clearedAt + 1),
    ]),
  );
  const second = openTestDatabase();
  run(second, cleared);
  assert.deepEqual(
    second.listHistory(MAIN_SESSION_KEY, NOW).map((e) => e.words),
    ["after the clear"],
  );
  assert.deepEqual(second.loadBrainState(MAIN_SESSION_KEY).state?.reset, live.reset);
});

test("a malformed brain file is refused and receipted as such, and a thread with bad lines keeps the good ones", () => {
  const s = scratch();
  fs.writeFileSync(s.sources.brainState, "{not json");
  fs.writeFileSync(
    s.sources.conversation,
    JSON.stringify({
      entries: [
        { kind: "invented", words: "no", recordedAt: NOW },
        { kind: CONVERSATION_ENTRY_KIND.REPLY, words: "", recordedAt: NOW },
        { kind: CONVERSATION_ENTRY_KIND.REPLY, words: "kept", recordedAt: NOW - 1 },
      ],
    }),
  );
  fs.writeFileSync(s.sources.personalFacts, JSON.stringify({ facts: [{ id: "", words: "x" }, 7] }));
  const database = openTestDatabase();
  const report = run(database, s);
  assert.equal(report.brainState?.outcome, MIGRATION_OUTCOME.REFUSED);
  assert.equal(report.conversation?.outcome, MIGRATION_OUTCOME.IMPORTED);
  assert.equal(report.personalFacts?.outcome, MIGRATION_OUTCOME.EMPTY);
  assert.deepEqual(database.loadBrainState(MAIN_SESSION_KEY), {});
  assert.deepEqual(
    database.listHistory(MAIN_SESSION_KEY, NOW).map((e) => e.words),
    ["kept"],
  );
  assert.deepEqual(database.personalFacts(), []);
  assert.equal(database.migrationReceipt(s.sources.brainState)?.outcome, MIGRATION_OUTCOME.REFUSED);
  assert.equal(fs.existsSync(s.sources.brainState), false);
});

test("a partially populated legacy state — only some files — imports what is there and leaves no receipt for what is not", () => {
  const s = scratch();
  fs.writeFileSync(s.sources.conversation, conversationFile(THREAD));
  const database = openTestDatabase();
  const report = run(database, s);
  assert.equal(report.brainState, undefined);
  assert.equal(report.personalFacts, undefined);
  assert.equal(report.conversation?.outcome, MIGRATION_OUTCOME.IMPORTED);
  assert.equal(database.migrationReceipt(s.sources.brainState), undefined);
  assert.equal(database.countHistory(MAIN_SESSION_KEY), THREAD.length);
  // A launch with nothing to import at all reports nothing and fails nothing.
  const empty = run(openTestDatabase(), scratch());
  assert.deepEqual(empty, { retired: [], expiredRecoveries: [], failures: [] });
});

test("a file that is there but cannot be read is not an empty migration: no receipt, not retired, tried again next launch", (t) => {
  const s = scratch();
  fs.writeFileSync(s.sources.brainState, brainStateRecord(populatedState("gen-1")));
  fs.writeFileSync(s.sources.conversation, conversationFile(THREAD));
  fs.chmodSync(s.sources.conversation, 0o000);
  let enforced = false;
  try {
    fs.readFileSync(s.sources.conversation);
  } catch {
    enforced = true;
  }
  if (!enforced) {
    t.skip("this account reads a mode-000 file; a permission failure cannot be produced here");
    return;
  }
  const database = openTestDatabase();
  const report = run(database, s);
  assert.equal(report.brainState?.outcome, MIGRATION_OUTCOME.IMPORTED);
  assert.equal(report.conversation?.outcome, MIGRATION_OUTCOME.UNREADABLE);
  assert.match(report.conversation?.error ?? "", /EACCES|permission/i);
  assert.equal(report.failures.length, 1);
  assert.equal(database.migrationReceipt(s.sources.conversation), undefined);
  assert.equal(fs.existsSync(s.sources.conversation), true);
  assert.equal(fs.existsSync(s.sources.brainState), false);
  fs.chmodSync(s.sources.conversation, 0o600);
  const retry = run(database, s, NOW + 1);
  assert.equal(retry.conversation?.outcome, MIGRATION_OUTCOME.IMPORTED);
  assert.equal(database.countHistory(MAIN_SESSION_KEY), THREAD.length);
  assert.equal(fs.existsSync(s.sources.conversation), false);
});

test("a crash before the commit leaves nothing imported and nothing retired, and the next launch imports everything once", () => {
  const s = scratch();
  const state = populatedState("gen-1");
  fs.writeFileSync(s.sources.brainState, brainStateRecord(state));
  fs.writeFileSync(s.sources.conversation, conversationFile(THREAD));
  fs.writeFileSync(s.sources.personalFacts, JSON.stringify(FACTS));
  const database = openTestDatabase();
  // The facts are the last thing the import writes: failing there proves the
  // generation and the thread written before it rolled back with it.
  const crashing = new Proxy(database, {
    get(target, property, receiver) {
      if (property === "importPersonalFacts") {
        return () => {
          throw new Error("disk went away");
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  assert.throws(() => run(crashing, s), /disk went away/);
  assert.deepEqual(database.loadBrainState(MAIN_SESSION_KEY), {});
  assert.equal(database.countHistory(MAIN_SESSION_KEY), 0);
  assert.equal(database.migrationReceipt(s.sources.brainState), undefined);
  assert.equal(fs.existsSync(s.sources.brainState), true);
  const report = run(database, s);
  assert.equal(report.brainState?.outcome, MIGRATION_OUTCOME.IMPORTED);
  assert.deepEqual(database.loadBrainState(MAIN_SESSION_KEY), { state });
  assert.equal(database.countHistory(MAIN_SESSION_KEY), THREAD.length);
});

test("a crash after the commit but before the files moved is finished by the next launch without a second import", () => {
  const s = scratch();
  const state = populatedState("gen-1");
  fs.writeFileSync(s.sources.brainState, brainStateRecord(state));
  fs.writeFileSync(s.sources.conversation, conversationFile(THREAD));
  const database = openTestDatabase();
  // The recovery directory's parent is a file, so the move cannot happen.
  fs.mkdirSync(path.dirname(path.dirname(s.recovery)), { recursive: true });
  fs.writeFileSync(path.dirname(s.recovery), "in the way");
  const first = run(database, s);
  assert.equal(first.brainState?.outcome, MIGRATION_OUTCOME.IMPORTED);
  assert.equal(first.failures.length, 1);
  assert.equal(fs.existsSync(s.sources.brainState), true);
  // An older writer touches the file meanwhile: it is still not re-read.
  fs.writeFileSync(
    s.sources.brainState,
    brainStateRecord({ ...state, requests: [...state.requests, request("run-3")] }),
  );
  fs.rmSync(path.dirname(s.recovery));
  const second = run(database, s, NOW + 1);
  assert.deepEqual(second.brainState, {
    outcome: MIGRATION_OUTCOME.IMPORTED,
    alreadyImported: true,
  });
  assert.deepEqual(second.retired.map((p) => path.basename(p)).sort(), [
    "brain-state.json",
    "conversation.json",
  ]);
  assert.deepEqual(second.failures, []);
  assert.deepEqual(database.loadBrainState(MAIN_SESSION_KEY), { state });
  assert.equal(database.countHistory(MAIN_SESSION_KEY), THREAD.length);
});

test("a legacy file does not replace a generation the database already holds", () => {
  const s = scratch();
  fs.writeFileSync(s.sources.brainState, brainStateRecord(populatedState("gen-file")));
  const database = openTestDatabase();
  const standing = freshBrainState("gen-db", NOW - 10);
  database.saveBrainState(MAIN_SESSION_KEY, { expectGeneration: undefined, full: standing });
  const report = run(database, s);
  assert.equal(report.brainState?.outcome, MIGRATION_OUTCOME.EMPTY);
  assert.deepEqual(database.loadBrainState(MAIN_SESSION_KEY), { state: standing });
});

test("recovery copies live one generation lifetime and no longer", () => {
  const s = scratch();
  fs.mkdirSync(s.recovery, { recursive: true });
  fs.mkdirSync(path.join(s.recovery, `legacy-${NOW - BRAIN_GENERATION_LIFETIME_MS}`));
  fs.mkdirSync(path.join(s.recovery, `legacy-${NOW - BRAIN_GENERATION_LIFETIME_MS + 1}`));
  fs.mkdirSync(path.join(s.recovery, "legacy-not-a-number"));
  const report = run(openTestDatabase(), s);
  assert.deepEqual([...report.expiredRecoveries].sort(), [
    `legacy-${NOW - BRAIN_GENERATION_LIFETIME_MS}`,
    "legacy-not-a-number",
  ]);
  assert.deepEqual(fs.readdirSync(s.recovery), [
    `legacy-${NOW - BRAIN_GENERATION_LIFETIME_MS + 1}`,
  ]);
});

test("a terminal request whose end History took is retained like the file did, with its receipts", () => {
  const s = scratch();
  const state = {
    ...populatedState("gen-1"),
    requests: [
      request("run-1", {
        status: BRAIN_REQUEST_STATUS.SUCCEEDED,
        settledAt: NOW,
        historyRecordedAt: NOW,
      }),
    ],
    journal: [],
  };
  fs.writeFileSync(s.sources.brainState, brainStateRecord(state));
  const database = openTestDatabase();
  run(database, s);
  assert.deepEqual(database.loadBrainState(MAIN_SESSION_KEY).state?.requests, state.requests);
});
