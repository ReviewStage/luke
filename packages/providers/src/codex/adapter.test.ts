import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import {
  InMemorySessionRegistry,
  SESSION_APPLICATION_ID,
  SESSION_APPLICATION_SCOPE,
  SESSION_COMPLETION_CAUSE,
  SESSION_STATUS,
} from "@sidecar/session";
import type { ParsedJsonObject } from "@sidecar/wire/testing";
import { CODEX_PROVIDER, CodexSessionAdapter, isCodexRealtimeDelegationText } from "./adapter.js";

const TEST_TIME = Date.parse("2026-08-11T23:45:00.000Z");
const CODEX_STATE_DATABASE = "state_5.sqlite";
const TEST_CODEX_SOURCE = {
  CLI: "cli",
} as const;
const TEST_CODEX_MODEL_PROVIDER = {
  OPENAI_SSE: "openai_sse",
} as const;
const TEST_SQLITE_ERROR = {
  UNKNOWN_BUILTIN_MODULE: "ERR_UNKNOWN_BUILTIN_MODULE",
} as const;
const TEST_CODEX_ENVIRONMENT = {
  SQLITE_DIRECTORY: "CODEX_SQLITE_HOME",
} as const;

interface TestThread {
  id: string;
  cwd: string;
  lastActivityAt: number;
  source?: string;
  recencyAt?: number;
  updatedAt?: number;
  archived?: number;
  title?: string;
  preview?: string;
  firstUserMessage?: string;
  rolloutPath?: string;
  gitBranch?: string;
  model?: string;
  reasoningEffort?: string;
}

async function writeRollout(filePath: string, records: readonly ParsedJsonObject[]): Promise<void> {
  await fs.writeFile(filePath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
}

async function temporaryCodexHome(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luke-codex-"));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

function writeThread(database: DatabaseSync, thread: TestThread): void {
  database
    .prepare(`
      INSERT INTO threads (
        id,
        rollout_path,
        created_at,
        updated_at,
        source,
        model_provider,
        cwd,
        title,
        sandbox_policy,
        approval_mode,
        archived,
        first_user_message,
        created_at_ms,
        updated_at_ms,
        preview,
        recency_at_ms,
        git_branch,
        model,
        reasoning_effort
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      thread.id,
      thread.rolloutPath ?? "",
      Math.floor(thread.lastActivityAt / 1000),
      Math.floor((thread.updatedAt ?? thread.lastActivityAt) / 1000),
      thread.source ?? TEST_CODEX_SOURCE.CLI,
      TEST_CODEX_MODEL_PROVIDER.OPENAI_SSE,
      thread.cwd,
      thread.title ?? "",
      "workspace-write",
      "never",
      thread.archived ?? 0,
      thread.firstUserMessage ?? "",
      thread.lastActivityAt,
      thread.updatedAt ?? thread.lastActivityAt,
      thread.preview ?? "",
      thread.recencyAt ?? thread.lastActivityAt,
      thread.gitBranch ?? null,
      thread.model ?? null,
      thread.reasoningEffort ?? null,
    );
}

async function writeCodexState(codexHome: string, threads: readonly TestThread[]): Promise<void> {
  await fs.mkdir(codexHome, { recursive: true });
  const database = new DatabaseSync(path.join(codexHome, CODEX_STATE_DATABASE), {});
  try {
    database.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        rollout_path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        source TEXT NOT NULL,
        model_provider TEXT NOT NULL,
        cwd TEXT NOT NULL,
        title TEXT NOT NULL,
        sandbox_policy TEXT NOT NULL,
        approval_mode TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0,
        first_user_message TEXT NOT NULL DEFAULT '',
        created_at_ms INTEGER,
        updated_at_ms INTEGER,
        preview TEXT NOT NULL DEFAULT '',
        recency_at_ms INTEGER NOT NULL DEFAULT 0,
        git_branch TEXT,
        model TEXT,
        reasoning_effort TEXT
      )
    `);
    for (const thread of threads) writeThread(database, thread);
  } finally {
    database.close();
  }
}

async function writeCodexConfig(codexHome: string, source: string): Promise<void> {
  await fs.mkdir(codexHome, { recursive: true });
  await fs.writeFile(path.join(codexHome, "config.toml"), source);
}

async function writeCodexSessionIndex(
  codexHome: string,
  entries: readonly { id: string; threadName: string }[],
): Promise<void> {
  await fs.writeFile(
    path.join(codexHome, "session_index.jsonl"),
    `${entries.map((entry) => JSON.stringify({ id: entry.id, thread_name: entry.threadName })).join("\n")}\n`,
  );
}

async function writeMalformedCodexState(codexHome: string): Promise<void> {
  await fs.mkdir(codexHome, { recursive: true });
  const database = new DatabaseSync(path.join(codexHome, CODEX_STATE_DATABASE), {});
  try {
    database.exec("CREATE TABLE unrelated (id TEXT PRIMARY KEY)");
  } finally {
    database.close();
  }
}

test("observes a Codex thread under the name Codex gave it", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  await writeCodexState(codexHome, [
    {
      id: "codex-active",
      cwd: "/Users/test/luke",
      lastActivityAt: TEST_TIME - 1_000,
      title: "Release stage-cli to npm",
      gitBranch: "codex/bump-version",
      model: "gpt-5.6-luna",
      reasoningEffort: "medium",
    },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
  });
  const observations = await adapter.observe();

  assert.deepEqual(adapter.provider, CODEX_PROVIDER);
  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.providerSessionId, "codex-active");
  assert.equal(observations[0]?.title, "Release stage-cli to npm");
  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
  assert.equal(observations[0]?.controls, undefined);
  assert.deepEqual(observations[0]?.detail, {
    repository: "luke",
    branch: "codex/bump-version",
    model: "gpt-5.6-luna · medium",
    link: "codex://threads/codex-active",
  });
  assert.deepEqual(observations[0]?.applications, [
    {
      id: SESSION_APPLICATION_ID.CHATGPT,
      displayName: "ChatGPT",
      scope: SESSION_APPLICATION_SCOPE.SESSION,
      link: "codex://threads/codex-active",
    },
  ]);
});

test("falls back to the workspace for Codex delegation marker titles", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  await writeCodexState(codexHome, [
    {
      id: "codex-delegated",
      cwd: "/Users/test/delegated-repository",
      lastActivityAt: TEST_TIME - 1_000,
      title:
        "<codex_delegation>\n<source_thread_id>01a01c04-31e2-7be1-a478-0f321abcdef0</source_thread_id>\n</codex_delegation>",
    },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
  });

  const observations = await adapter.observe();

  assert.equal(observations[0]?.title, "delegated-repository");
  assert.equal(observations[0]?.parentProviderSessionId, "01a01c04-31e2-7be1-a478-0f321abcdef0");
});

test("observes the exact parent of a Codex thread-spawn sub-agent", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  const parentThreadId = "01a01c04-31e2-7be1-a478-0f321abcdef0";
  await writeCodexState(codexHome, [
    {
      id: "codex-sub-agent",
      cwd: "/Users/test/luke",
      lastActivityAt: TEST_TIME - 1_000,
      title: "Inspect the Conductor relationship",
      source: JSON.stringify({
        subagent: {
          thread_spawn: {
            parent_thread_id: parentThreadId,
            depth: 1,
            agent_path: "/root/research",
          },
        },
      }),
    },
  ]);

  const [observation] = await new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
  }).observe();

  assert.equal(observation?.parentProviderSessionId, parentThreadId);
  assert.equal(observation?.title, "Inspect the Conductor relationship");
});

test("resolves a Codex delegation marker through the source chat title index", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  await writeCodexSessionIndex(codexHome, [
    { id: "01a01c04-31e2-7be1-a478-0f321abcdef0", threadName: "Fix Luke Voice Announcements" },
  ]);
  await writeCodexState(codexHome, [
    {
      id: "codex-delegated",
      cwd: "/Users/test/luke",
      lastActivityAt: TEST_TIME - 1_000,
      title:
        "<codex_delegation>\n<source_thread_id>01a01c04-31e2-7be1-a478-0f321abcdef0</source_thread_id>\n<input>delegated work</input>\n</codex_delegation>",
    },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
  });

  const observations = await adapter.observe();

  assert.equal(observations[0]?.title, "Fix Luke Voice Announcements");
});

test("prefers a delegated session's own indexed title over its source chat", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  await writeCodexSessionIndex(codexHome, [
    { id: "01a01c04-31e2-7be1-a478-0f321abcdef0", threadName: "Parent chat" },
    { id: "codex-delegated", threadName: "Add Claude Code archive status" },
  ]);
  await writeCodexState(codexHome, [
    {
      id: "codex-delegated",
      cwd: "/Users/test/luke",
      lastActivityAt: TEST_TIME - 1_000,
      title:
        "<codex_delegation> <source_thread_id>01a01c04-31e2-7be1-a478-0f321abcdef0</source_thread_id> <input>delegated work</input> </codex_delegation>",
    },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
  });

  const observations = await adapter.observe();

  assert.equal(observations[0]?.title, "Add Claude Code archive status");
});

test("keeps a legitimate title that resembles a delegation marker", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  await writeCodexState(codexHome, [
    {
      id: "codex-named",
      cwd: "/Users/test/luke",
      lastActivityAt: TEST_TIME - 1_000,
      title: "<codex_delegation> <source_thread_id>not-a-uuid",
    },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
  });

  const observations = await adapter.observe();

  assert.equal(observations[0]?.title, "<codex_delegation> <source_thread_id>not-a-uuid");
});

test("recognizes the realtime delegation marker in Codex text", () => {
  assert.equal(isCodexRealtimeDelegationText("<realtime_delegation> <input>hello</input>"), true);
  assert.equal(isCodexRealtimeDelegationText("a named chat"), false);
});

test("keeps realtime delegation sessions suppressed after Codex names the chat", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  await writeCodexState(codexHome, [
    {
      id: "codex-realtime-delegation",
      cwd: "/Users/test/luke",
      lastActivityAt: TEST_TIME - 1_000,
      title: "What sessions do we have open?",
      firstUserMessage: "<realtime_delegation> <input>What sessions do we have open</input>",
    },
  ]);

  const adapter = new CodexSessionAdapter({ codexHome, now: () => TEST_TIME });
  const [observation] = await adapter.observe();

  assert.equal(observation?.title, "What sessions do we have open?");
  assert.equal(observation?.realtimeVoice, true);
});

const TEST_SOURCE_THREAD_ID = "01a01c04-31e2-7be1-a478-0f321abcdef0";
const TEST_DELEGATION_TITLE =
  `<codex_delegation>\n<source_thread_id>${TEST_SOURCE_THREAD_ID}</source_thread_id>\n` +
  "<input>delegated work</input>\n</codex_delegation>";

test("labels a delegated chat by its source conversation's own title", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  await writeCodexState(codexHome, [
    {
      id: TEST_SOURCE_THREAD_ID,
      cwd: "/Users/test/luke",
      lastActivityAt: TEST_TIME - 2_000,
      title: "Fix Luke voice announcements",
    },
    {
      id: "codex-delegated",
      cwd: "/Users/test/luke",
      lastActivityAt: TEST_TIME - 1_000,
      title: TEST_DELEGATION_TITLE,
    },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
  });
  const observations = await adapter.observe();

  const delegated = observations.find((o) => o.providerSessionId === "codex-delegated");
  assert.equal(delegated?.title, "Fix Luke voice announcements");
});

test("a name the index has since cleared no longer resolves a delegation", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  await writeCodexSessionIndex(codexHome, [
    { id: TEST_SOURCE_THREAD_ID, threadName: "Fix Luke voice announcements" },
    { id: TEST_SOURCE_THREAD_ID, threadName: "" },
  ]);
  await writeCodexState(codexHome, [
    {
      id: "codex-delegated",
      cwd: "/Users/test/delegated-repository",
      lastActivityAt: TEST_TIME - 1_000,
      title: TEST_DELEGATION_TITLE,
    },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
  });
  const observations = await adapter.observe();

  assert.equal(observations[0]?.title, "delegated-repository");
});

test("a marker that leaked into the name index is still not a name", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  await writeCodexSessionIndex(codexHome, [
    { id: TEST_SOURCE_THREAD_ID, threadName: "Fix Luke voice announcements" },
    // Codex indexed the delegated chat's own synthetic title; preferring it
    // would put the raw marker back on the row the resolution exists to name.
    { id: "codex-delegated", threadName: TEST_DELEGATION_TITLE },
  ]);
  await writeCodexState(codexHome, [
    {
      id: "codex-delegated",
      cwd: "/Users/test/luke",
      lastActivityAt: TEST_TIME - 1_000,
      title: TEST_DELEGATION_TITLE,
    },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
  });
  const observations = await adapter.observe();

  assert.equal(observations[0]?.title, "Fix Luke voice announcements");
});

test("a realtime delegation title with no source resolves to the workspace", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  await writeCodexState(codexHome, [
    {
      id: "codex-voice-born",
      cwd: "/Users/test/delegated-repository",
      lastActivityAt: TEST_TIME - 1_000,
      title: "<realtime_delegation>\n<input>run the tests</input>\n</realtime_delegation>",
    },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
  });
  const observations = await adapter.observe();

  assert.equal(observations[0]?.title, "delegated-repository");
  assert.equal(observations[0]?.realtimeVoice, true);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("observes a live realtime voice conversation over a Codex thread", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  const rolloutPath = path.join(codexHome, "rollout-realtime-open.jsonl");
  await writeCodexState(codexHome, [
    { id: "codex-voice", cwd: "/Users/test/luke", lastActivityAt: TEST_TIME - 1_000, rolloutPath },
  ]);
  await writeRollout(rolloutPath, [
    { type: "world_state", payload: { full: true, state: { realtime: { active: true } } } },
    { type: "event_msg", payload: { type: "task_started" } },
    {
      type: "event_msg",
      payload: { type: "task_complete", last_agent_message: "Ran the tests; all green." },
    },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  // The settled delegated turn still reads as waiting — the conversation is
  // what the notice layer holds its tongue about, not the row.
  assert.equal(observation?.status, SESSION_STATUS.WAITING);
  assert.equal(observation?.realtimeVoiceLive, true);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("observes the realtime voice conversation closing on a later turn", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  const rolloutPath = path.join(codexHome, "rollout-realtime-closed.jsonl");
  await writeCodexState(codexHome, [
    {
      id: "codex-voice-done",
      cwd: "/Users/test/luke",
      lastActivityAt: TEST_TIME - 1_000,
      rolloutPath,
    },
  ]);
  await writeRollout(rolloutPath, [
    { type: "world_state", payload: { full: true, state: { realtime: { active: true } } } },
    { type: "event_msg", payload: { type: "task_started" } },
    { type: "event_msg", payload: { type: "task_complete", last_agent_message: "Done." } },
    // The first turn after the conversation ends patches the section closed.
    { type: "world_state", payload: { full: false, state: { realtime: { active: false } } } },
    { type: "event_msg", payload: { type: "task_started" } },
    { type: "event_msg", payload: { type: "task_complete", last_agent_message: "Follow-up." } },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.realtimeVoiceLive, undefined);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("reads a delegation as the conversation being live when its snapshot left the tail", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  const rolloutPath = path.join(codexHome, "rollout-realtime-delegation.jsonl");
  await writeCodexState(codexHome, [
    {
      id: "codex-delegated",
      cwd: "/Users/test/luke",
      lastActivityAt: TEST_TIME - 1_000,
      rolloutPath,
    },
  ]);
  await writeRollout(rolloutPath, [
    { type: "event_msg", payload: { type: "task_started" } },
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: "<realtime_delegation>\n  <input>run the release script</input>\n</realtime_delegation>",
          },
        ],
      },
    },
    { type: "event_msg", payload: { type: "task_complete", last_agent_message: "Released." } },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.realtimeVoiceLive, true);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("a typed user message never reads as a live voice conversation", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  const rolloutPath = path.join(codexHome, "rollout-typed-turn.jsonl");
  await writeCodexState(codexHome, [
    { id: "codex-typed", cwd: "/Users/test/luke", lastActivityAt: TEST_TIME - 1_000, rolloutPath },
  ]);
  await writeRollout(rolloutPath, [
    { type: "event_msg", payload: { type: "task_started" } },
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "please run the release script" }],
      },
    },
    { type: "event_msg", payload: { type: "task_complete", last_agent_message: "Released." } },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.realtimeVoiceLive, undefined);
});

test("a delegated chat holds announcements while its source conversation's voice is live", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  const sourceRollout = path.join(codexHome, "rollout-voice-source.jsonl");
  const delegatedRollout = path.join(codexHome, "rollout-voice-delegated.jsonl");
  await writeCodexState(codexHome, [
    {
      id: TEST_SOURCE_THREAD_ID,
      cwd: "/Users/test/luke",
      lastActivityAt: TEST_TIME - 2_000,
      title: "Fix Luke voice announcements",
      rolloutPath: sourceRollout,
    },
    {
      id: "codex-delegated",
      cwd: "/Users/test/luke",
      lastActivityAt: TEST_TIME - 1_000,
      title: TEST_DELEGATION_TITLE,
      rolloutPath: delegatedRollout,
    },
  ]);
  await writeRollout(sourceRollout, [
    { type: "world_state", payload: { full: true, state: { realtime: { active: true } } } },
    { type: "event_msg", payload: { type: "task_started" } },
    { type: "event_msg", payload: { type: "task_complete", last_agent_message: "Delegated." } },
  ]);
  // The delegated chat's own rollout says nothing about the conversation that
  // spawned it; the link through the marker is what must carry the hold.
  await writeRollout(delegatedRollout, [
    { type: "event_msg", payload: { type: "task_started" } },
    { type: "event_msg", payload: { type: "task_complete", last_agent_message: "Done." } },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
  });
  const observations = await adapter.observe();

  const source = observations.find((o) => o.providerSessionId === TEST_SOURCE_THREAD_ID);
  const delegated = observations.find((o) => o.providerSessionId === "codex-delegated");
  assert.equal(source?.realtimeVoiceLive, true);
  assert.equal(delegated?.realtimeVoiceLive, true);
  assert.equal(delegated?.title, "Fix Luke voice announcements");
});

test("the voice hold outlives Codex naming the delegated chat", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  const sourceRollout = path.join(codexHome, "rollout-voice-renamed-source.jsonl");
  await writeCodexState(codexHome, [
    {
      id: TEST_SOURCE_THREAD_ID,
      cwd: "/Users/test/luke",
      lastActivityAt: TEST_TIME - 2_000,
      title: "Fix Luke voice announcements",
      rolloutPath: sourceRollout,
    },
    {
      // Codex has named the chat, so the title no longer carries the marker;
      // the first user message is where the link has to survive.
      id: "codex-delegated-named",
      cwd: "/Users/test/luke",
      lastActivityAt: TEST_TIME - 1_000,
      title: "What sessions are open?",
      firstUserMessage: TEST_DELEGATION_TITLE,
    },
  ]);
  await writeRollout(sourceRollout, [
    { type: "world_state", payload: { full: true, state: { realtime: { active: true } } } },
    { type: "event_msg", payload: { type: "task_started" } },
    { type: "event_msg", payload: { type: "task_complete", last_agent_message: "Delegated." } },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
  });
  const observations = await adapter.observe();

  const delegated = observations.find((o) => o.providerSessionId === "codex-delegated-named");
  assert.equal(delegated?.realtimeVoiceLive, true);
  assert.equal(delegated?.title, "What sessions are open?");
});

test("addresses a Codex thread by the id Codex files it under", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  await writeCodexState(codexHome, [
    {
      // A real thread id is a UUID, but the id is Codex's to choose and it is
      // carried into an address, so one needing escaping proves it is escaped
      // rather than pasted in.
      id: "codex thread/one?two",
      cwd: "/Users/test/luke",
      lastActivityAt: TEST_TIME - 1_000,
    },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
  });
  const observations = await adapter.observe();

  assert.equal(observations[0]?.detail?.link, "codex://threads/codex%20thread%2Fone%3Ftwo");
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("reports a finished Codex turn as waiting for its developer", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  const rolloutPath = path.join(codexHome, "rollout-complete.jsonl");
  await writeCodexState(codexHome, [
    { id: "codex-done", cwd: "/Users/test/luke", lastActivityAt: TEST_TIME - 1_000, rolloutPath },
  ]);
  await writeRollout(rolloutPath, [
    { type: "event_msg", payload: { type: "task_started" } },
    {
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        arguments: '{"cmd":"pnpm test","workdir":"/Users/test/luke"}',
      },
    },
    {
      type: "event_msg",
      payload: { type: "task_complete", last_agent_message: "Released 0.1.6 and merged the PR." },
    },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WAITING);
  assert.equal(observation?.recap, "Released 0.1.6 and merged the PR.");
  assert.equal(observation?.detail?.activity, undefined);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("reports a running Codex turn as working with the call it is making", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  const rolloutPath = path.join(codexHome, "rollout-running.jsonl");
  await writeCodexState(codexHome, [
    {
      id: "codex-running",
      cwd: "/Users/test/luke",
      lastActivityAt: TEST_TIME - 1_000,
      rolloutPath,
    },
  ]);
  await writeRollout(rolloutPath, [
    { type: "event_msg", payload: { type: "task_complete", last_agent_message: "Earlier turn." } },
    { type: "event_msg", payload: { type: "task_started" } },
    {
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        arguments: '{"cmd":"pnpm test","workdir":"/Users/test/luke"}',
      },
    },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WORKING);
  assert.equal(observation?.recap, undefined);
  assert.equal(observation?.detail?.activity, "exec_command: pnpm test");
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("names a call whose argument Codex passes as a list of tokens", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  const rolloutPath = path.join(codexHome, "rollout-list-argument.jsonl");
  await writeCodexState(codexHome, [
    {
      id: "codex-list-arg",
      cwd: "/Users/test/luke",
      lastActivityAt: TEST_TIME - 1_000,
      rolloutPath,
    },
  ]);
  await writeRollout(rolloutPath, [
    { type: "event_msg", payload: { type: "task_started" } },
    {
      type: "response_item",
      payload: {
        type: "function_call",
        name: "run",
        // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
        // Codex passes a search's terms as a list rather than a string.
        arguments: '{"search_query":["notch","geometry","inset"]}',
      },
    },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.detail?.activity, "run: notch geometry inset");
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("names a call by its tool alone when no argument reads as a phrase", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  const rolloutPath = path.join(codexHome, "rollout-structured-argument.jsonl");
  await writeCodexState(codexHome, [
    {
      id: "codex-structured",
      cwd: "/Users/test/luke",
      lastActivityAt: TEST_TIME - 1_000,
      rolloutPath,
    },
  ]);
  await writeRollout(rolloutPath, [
    { type: "event_msg", payload: { type: "task_started" } },
    {
      type: "response_item",
      payload: {
        type: "function_call",
        name: "update_plan",
        // A plan's steps are objects, and flattening them would be noise.
        arguments: '{"plan":[{"step":"Read the adapter","status":"done"}]}',
      },
    },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.detail?.activity, "update_plan");
});

test("drops the previous turn's call when a new Codex turn starts", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  const rolloutPath = path.join(codexHome, "rollout-new-turn.jsonl");
  await writeCodexState(codexHome, [
    {
      id: "codex-new-turn",
      cwd: "/Users/test/luke",
      lastActivityAt: TEST_TIME - 1_000,
      rolloutPath,
    },
  ]);
  await writeRollout(rolloutPath, [
    { type: "event_msg", payload: { type: "task_started" } },
    {
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        arguments: '{"cmd":"pnpm test","workdir":"/Users/test/luke"}',
      },
    },
    { type: "event_msg", payload: { type: "task_complete", last_agent_message: "Tests pass." } },
    { type: "event_msg", payload: { type: "task_started" } },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WORKING);
  assert.equal(observation?.detail?.activity, undefined);
  assert.equal(observation?.recap, undefined);
});

test("reports a Codex turn that stopped on an error", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  const rolloutPath = path.join(codexHome, "rollout-error-event.jsonl");
  await writeCodexState(codexHome, [
    {
      id: "codex-errored",
      cwd: "/Users/test/luke",
      lastActivityAt: TEST_TIME - 1_000,
      rolloutPath,
    },
  ]);
  await writeRollout(rolloutPath, [
    { type: "event_msg", payload: { type: "task_started" } },
    {
      type: "event_msg",
      payload: { type: "error", message: "stream disconnected before completion" },
    },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.ERROR);
  assert.equal(observation?.detail?.error, "stream disconnected before completion");
});

test("reports a failed turn's error instead of its parting words", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  const rolloutPath = path.join(codexHome, "rollout-failed-complete.jsonl");
  await writeCodexState(codexHome, [
    { id: "codex-failed", cwd: "/Users/test/luke", lastActivityAt: TEST_TIME - 1_000, rolloutPath },
  ]);
  await writeRollout(rolloutPath, [
    { type: "event_msg", payload: { type: "task_started" } },
    {
      type: "event_msg",
      payload: {
        type: "task_complete",
        // Parting words beside a failure predate what went wrong, so the row
        // must carry the error and no recap at all.
        last_agent_message: "I was about to run the tests.",
        error: { message: "exceeded usage quota" },
      },
    },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.ERROR);
  assert.equal(observation?.detail?.error, "exceeded usage quota");
  assert.equal(observation?.recap, undefined);
});

test("keeps a failed Codex turn at error past the freshness decay", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  const rolloutPath = path.join(codexHome, "rollout-stale-error.jsonl");
  // A failed turn is stuck until someone comes back to it, and going stale is
  // exactly what waiting on a rescue looks like.
  await writeCodexState(codexHome, [
    {
      id: "codex-stale-error",
      cwd: "/Users/test/luke",
      lastActivityAt: TEST_TIME - 20 * 60 * 1000,
      rolloutPath,
    },
  ]);
  await writeRollout(rolloutPath, [
    { type: "event_msg", payload: { type: "task_started" } },
    { type: "event_msg", payload: { type: "error", message: "stream disconnected" } },
  ]);

  const adapter = new CodexSessionAdapter({
    activeSessionFreshnessMs: 15 * 60 * 1000,
    codexHome,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.ERROR);
});

test("drops the previous turn's error when a new Codex turn starts", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  const rolloutPath = path.join(codexHome, "rollout-error-retried.jsonl");
  await writeCodexState(codexHome, [
    {
      id: "codex-retried",
      cwd: "/Users/test/luke",
      lastActivityAt: TEST_TIME - 1_000,
      rolloutPath,
    },
  ]);
  await writeRollout(rolloutPath, [
    { type: "event_msg", payload: { type: "task_started" } },
    { type: "event_msg", payload: { type: "error", message: "stream disconnected" } },
    { type: "event_msg", payload: { type: "task_started" } },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WORKING);
  assert.equal(observation?.detail?.error, undefined);
});

test("bounds a Codex error to one row-sized line", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  const rolloutPath = path.join(codexHome, "rollout-long-error.jsonl");
  await writeCodexState(codexHome, [
    {
      id: "codex-long-error",
      cwd: "/Users/test/luke",
      lastActivityAt: TEST_TIME - 1_000,
      rolloutPath,
    },
  ]);
  await writeRollout(rolloutPath, [
    { type: "event_msg", payload: { type: "task_started" } },
    { type: "event_msg", payload: { type: "error", message: "x".repeat(200) } },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.detail?.error, `${"x".repeat(79)}…`);
});

test("holds a long Codex turn at working however stale its row is", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  const rolloutPath = path.join(codexHome, "rollout-long.jsonl");
  await writeCodexState(codexHome, [
    {
      id: "codex-long-turn",
      cwd: "/Users/test/luke",
      lastActivityAt: TEST_TIME - 30 * 60 * 1000,
      rolloutPath,
    },
  ]);
  await writeRollout(rolloutPath, [{ type: "event_msg", payload: { type: "task_started" } }]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
    activeSessionFreshnessMs: 15 * 60 * 1000,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WORKING);
});

test("observes Codex sessions from an explicit SQLite home", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  const sqliteHome = path.join(codexHome, "sqlite-state");
  await writeCodexState(sqliteHome, [
    {
      id: "codex-sqlite-home",
      cwd: "/Users/test/sqlite-home",
      lastActivityAt: TEST_TIME - 1_000,
    },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    sqliteHome,
    now: () => TEST_TIME,
  });
  const observations = await adapter.observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.providerSessionId, "codex-sqlite-home");
  assert.equal(observations[0]?.title, "sqlite-home");
});

test("observes Codex sessions from configured sqlite_home", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  const previousSqliteHome = process.env[TEST_CODEX_ENVIRONMENT.SQLITE_DIRECTORY];
  delete process.env[TEST_CODEX_ENVIRONMENT.SQLITE_DIRECTORY];
  t.after(() => {
    if (previousSqliteHome === undefined)
      delete process.env[TEST_CODEX_ENVIRONMENT.SQLITE_DIRECTORY];
    else process.env[TEST_CODEX_ENVIRONMENT.SQLITE_DIRECTORY] = previousSqliteHome;
  });
  await writeCodexConfig(codexHome, "sqlite_home = 'configured-sqlite'\n");
  await writeCodexState(path.join(codexHome, "configured-sqlite"), [
    {
      id: "codex-configured-home",
      cwd: "/Users/test/configured-home",
      lastActivityAt: TEST_TIME - 1_000,
    },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
  });
  const observations = await adapter.observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.providerSessionId, "codex-configured-home");
  assert.equal(observations[0]?.title, "configured-home");
});

test("observes Codex sessions from CODEX_SQLITE_HOME", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  const sqliteHome = path.join(codexHome, "env-sqlite");
  const previousSqliteHome = process.env[TEST_CODEX_ENVIRONMENT.SQLITE_DIRECTORY];
  process.env[TEST_CODEX_ENVIRONMENT.SQLITE_DIRECTORY] = sqliteHome;
  t.after(() => {
    if (previousSqliteHome === undefined)
      delete process.env[TEST_CODEX_ENVIRONMENT.SQLITE_DIRECTORY];
    else process.env[TEST_CODEX_ENVIRONMENT.SQLITE_DIRECTORY] = previousSqliteHome;
  });
  await writeCodexState(sqliteHome, [
    {
      id: "codex-env-home",
      cwd: "/Users/test/env-home",
      lastActivityAt: TEST_TIME - 1_000,
    },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
  });
  const observations = await adapter.observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.providerSessionId, "codex-env-home");
  assert.equal(observations[0]?.title, "env-home");
});

test("prefers configured sqlite_home over CODEX_SQLITE_HOME", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  const envSqliteHome = path.join(codexHome, "env-sqlite");
  const previousSqliteHome = process.env[TEST_CODEX_ENVIRONMENT.SQLITE_DIRECTORY];
  process.env[TEST_CODEX_ENVIRONMENT.SQLITE_DIRECTORY] = envSqliteHome;
  t.after(() => {
    if (previousSqliteHome === undefined)
      delete process.env[TEST_CODEX_ENVIRONMENT.SQLITE_DIRECTORY];
    else process.env[TEST_CODEX_ENVIRONMENT.SQLITE_DIRECTORY] = previousSqliteHome;
  });
  await writeCodexConfig(codexHome, "sqlite_home = 'configured-sqlite'\n");
  await writeCodexState(envSqliteHome, [
    {
      id: "codex-env-home",
      cwd: "/Users/test/env-home",
      lastActivityAt: TEST_TIME - 1_000,
    },
  ]);
  await writeCodexState(path.join(codexHome, "configured-sqlite"), [
    {
      id: "codex-configured-home",
      cwd: "/Users/test/configured-home",
      lastActivityAt: TEST_TIME - 1_000,
    },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
  });
  const observations = await adapter.observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.providerSessionId, "codex-configured-home");
  assert.equal(observations[0]?.title, "configured-home");
});

test("observes Codex sessions from the default sqlite subdirectory", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  await writeCodexState(path.join(codexHome, "sqlite"), [
    {
      id: "codex-default-sqlite",
      cwd: "/Users/test/default-sqlite",
      lastActivityAt: TEST_TIME - 1_000,
    },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
  });
  const observations = await adapter.observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.providerSessionId, "codex-default-sqlite");
  assert.equal(observations[0]?.title, "default-sqlite");
});

test("falls back when a higher-priority Codex database has an unusable schema", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  await writeMalformedCodexState(path.join(codexHome, "sqlite"));
  await writeCodexState(codexHome, [
    {
      id: "codex-legacy-valid",
      cwd: "/Users/test/legacy-valid",
      lastActivityAt: TEST_TIME - 1_000,
    },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
  });
  const observations = await adapter.observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.providerSessionId, "codex-legacy-valid");
  assert.equal(observations[0]?.title, "legacy-valid");
});

test("keeps stale unarchived Codex sessions unknown instead of inventing activity", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  await writeCodexState(codexHome, [
    {
      id: "codex-stale",
      cwd: "/Users/test/stale",
      lastActivityAt: TEST_TIME - 20 * 60 * 1000,
    },
  ]);

  const adapter = new CodexSessionAdapter({
    activeSessionFreshnessMs: 15 * 60 * 1000,
    codexHome,
    now: () => TEST_TIME,
  });
  const observations = await adapter.observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.status, SESSION_STATUS.UNKNOWN);
});

test("hides archived Codex threads however recently they were touched", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  // Archiving touches the row's clock, so the freshly-touched archived thread
  // is the one that would resurface if anything short of the archive flag
  // itself decided the roster.
  await writeCodexState(codexHome, [
    {
      id: "old-session",
      cwd: "/Users/test/old",
      lastActivityAt: TEST_TIME - 90_000,
    },
    {
      id: "just-archived-session",
      cwd: "/Users/test/archived",
      lastActivityAt: TEST_TIME - 3 * 24 * 60 * 60 * 1000,
      recencyAt: TEST_TIME - 3 * 24 * 60 * 60 * 1000,
      updatedAt: TEST_TIME - 1_000,
      archived: 1,
    },
    {
      id: "long-archived-session",
      cwd: "/Users/test/long-archived",
      lastActivityAt: TEST_TIME - 3 * 24 * 60 * 60 * 1000,
      archived: 1,
    },
    {
      id: "new-session",
      cwd: "/Users/test/new",
      lastActivityAt: TEST_TIME - 10_000,
    },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
  });
  const observations = await adapter.observe();

  assert.deepEqual(
    observations.map((observation) => ({
      providerSessionId: observation.providerSessionId,
      status: observation.status,
      title: observation.title,
    })),
    [
      {
        providerSessionId: "new-session",
        status: SESSION_STATUS.WORKING,
        title: "new",
      },
      {
        providerSessionId: "old-session",
        status: SESSION_STATUS.WORKING,
        title: "old",
      },
    ],
  );
});

test("a thread archived between passes leaves the roster and stays gone", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  await writeCodexState(codexHome, [
    {
      id: "codex-live",
      cwd: "/Users/test/luke",
      lastActivityAt: TEST_TIME - 10_000,
    },
  ]);
  const adapter = new CodexSessionAdapter({ codexHome, now: () => TEST_TIME });
  const registry = new InMemorySessionRegistry();

  await registry.refresh(adapter);
  assert.deepEqual(
    registry.list().map((session) => session.providerSessionId),
    ["codex-live"],
  );

  const database = new DatabaseSync(path.join(codexHome, CODEX_STATE_DATABASE), {});
  try {
    // Codex touches the row's clock as it archives — exactly the touch that
    // must not read as fresh news.
    database
      .prepare("UPDATE threads SET archived = 1, updated_at_ms = ?, recency_at_ms = ? WHERE id = ?")
      .run(TEST_TIME, TEST_TIME, "codex-live");
  } finally {
    database.close();
  }

  await registry.refresh(adapter);
  assert.deepEqual(registry.list(), []);
});

test("returns an empty snapshot when Codex has no local state database", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
  });

  assert.deepEqual(await adapter.observe(), []);
});

test("returns an empty snapshot when node sqlite is unavailable", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  await writeCodexState(codexHome, [
    {
      id: "codex-active",
      cwd: "/Users/test/luke",
      lastActivityAt: TEST_TIME - 1_000,
    },
  ]);
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  const error = new Error("No such built-in module: node:sqlite") as NodeJS.ErrnoException;
  error.code = TEST_SQLITE_ERROR.UNKNOWN_BUILTIN_MODULE;

  const adapter = new CodexSessionAdapter({
    codexHome,
    now: () => TEST_TIME,
    sqlite: async () => {
      throw error;
    },
  });

  assert.deepEqual(await adapter.observe(), []);
});

// ---------------------------------------------------------------------------
// Hook-event refinement. Every test here layers a spool the observation hook
// would have written over the state database, because that is the arrangement
// in production: the rows and rollouts are always read, and the event only
// sharpens them.
// ---------------------------------------------------------------------------

async function temporaryHookSpool(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luke-codex-spool-"));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

async function writeHookEvent(
  spoolDirectory: string,
  providerSessionId: string,
  event: string,
  mtimeMs: number,
): Promise<void> {
  const filePath = path.join(spoolDirectory, `${providerSessionId}.json`);
  await fs.writeFile(filePath, JSON.stringify({ event }));
  await fs.utimes(filePath, mtimeMs / 1000, mtimeMs / 1000);
}

test("a permission request the database cannot show turns the row to waiting", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  const spool = await temporaryHookSpool(t);
  // Mid-turn by every record: a call holding for approval writes nothing
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // further, so without the event this thread reads as working.
  const rolloutPath = path.join(codexHome, "rollout-held.jsonl");
  await writeCodexState(codexHome, [
    {
      id: "codex-held",
      cwd: "/Users/test/luke",
      lastActivityAt: TEST_TIME - 5 * 60 * 1000,
      rolloutPath,
    },
  ]);
  await writeRollout(rolloutPath, [{ type: "event_msg", payload: { type: "task_started" } }]);
  await writeHookEvent(spool, "codex-held", "notification", TEST_TIME - 60_000);

  const adapter = new CodexSessionAdapter({
    codexHome,
    hookEventsDirectory: () => spool,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WAITING);
  assert.equal(observation?.holdingForDeveloper, true);
  // The event also dates the session: the spool is written only by Luke's own
  // script, so its clock is the moment the session actually moved.
  assert.equal(observation?.lastActivityAt, TEST_TIME - 60_000);
});

test("a session-end event settles a row the rollout would leave waiting", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  const spool = await temporaryHookSpool(t);
  const rolloutPath = path.join(codexHome, "rollout-ended.jsonl");
  await writeCodexState(codexHome, [
    {
      id: "codex-ended",
      cwd: "/Users/test/luke",
      lastActivityAt: TEST_TIME - 5 * 60 * 1000,
      rolloutPath,
    },
  ]);
  await writeRollout(rolloutPath, [
    { type: "event_msg", payload: { type: "task_complete", last_agent_message: "Done." } },
  ]);
  await writeHookEvent(spool, "codex-ended", "session-end", TEST_TIME - 60_000);

  const adapter = new CodexSessionAdapter({
    codexHome,
    hookEventsDirectory: () => spool,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.COMPLETE);
  assert.equal(observation?.completionCause, SESSION_COMPLETION_CAUSE.SESSION_CLOSED);
});

test("a stop event keeps a finished turn waiting past the freshness decay", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  const spool = await temporaryHookSpool(t);
  const rolloutPath = path.join(codexHome, "rollout-still-waiting.jsonl");
  // Twenty minutes past the row's clock, the database alone decays to unknown.
  await writeCodexState(codexHome, [
    {
      id: "codex-still-waiting",
      cwd: "/Users/test/luke",
      lastActivityAt: TEST_TIME - 20 * 60 * 1000,
      rolloutPath,
    },
  ]);
  await writeRollout(rolloutPath, [
    { type: "event_msg", payload: { type: "task_complete", last_agent_message: "Done." } },
  ]);
  await writeHookEvent(spool, "codex-still-waiting", "stop", TEST_TIME - 60_000);

  const adapter = new CodexSessionAdapter({
    activeSessionFreshnessMs: 15 * 60 * 1000,
    codexHome,
    hookEventsDirectory: () => spool,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WAITING);
});

test("a stop event does not talk a failed turn out of its error", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  const spool = await temporaryHookSpool(t);
  const rolloutPath = path.join(codexHome, "rollout-stopped-error.jsonl");
  await writeCodexState(codexHome, [
    {
      id: "codex-stopped-error",
      cwd: "/Users/test/luke",
      lastActivityAt: TEST_TIME - 60_000,
      rolloutPath,
    },
  ]);
  await writeRollout(rolloutPath, [
    { type: "event_msg", payload: { type: "task_started" } },
    {
      type: "event_msg",
      payload: { type: "task_complete", error: { message: "exceeded usage quota" } },
    },
  ]);
  // Codex fires no failure hook, so `stop` fires for the failed turn too: an
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // event standing for the same turn must not read the failure as waiting.
  await writeHookEvent(spool, "codex-stopped-error", "stop", TEST_TIME - 30_000);

  const adapter = new CodexSessionAdapter({
    codexHome,
    hookEventsDirectory: () => spool,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.ERROR);
  assert.equal(observation?.detail?.error, "exceeded usage quota");
});

test("an event the thread has moved past refines nothing", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  const spool = await temporaryHookSpool(t);
  const rolloutPath = path.join(codexHome, "rollout-moved-on.jsonl");
  await writeCodexState(codexHome, [
    {
      id: "codex-moved-on",
      cwd: "/Users/test/luke",
      lastActivityAt: TEST_TIME - 60_000,
      rolloutPath,
    },
  ]);
  await writeRollout(rolloutPath, [{ type: "event_msg", payload: { type: "task_started" } }]);
  // A stop from a minute before the row's clock: hooks were off, or the write
  // raced. The thread is demonstrably mid-turn again.
  await writeHookEvent(spool, "codex-moved-on", "stop", TEST_TIME - 2 * 60 * 1000);

  const adapter = new CodexSessionAdapter({
    codexHome,
    hookEventsDirectory: () => spool,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WORKING);
  assert.equal(observation?.lastActivityAt, TEST_TIME - 60_000);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("a prompt event reads a fresh turn as working before the rollout shows it", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  const spool = await temporaryHookSpool(t);
  const rolloutPath = path.join(codexHome, "rollout-prompted.jsonl");
  await writeCodexState(codexHome, [
    {
      id: "codex-prompted",
      cwd: "/Users/test/luke",
      lastActivityAt: TEST_TIME - 60_000,
      rolloutPath,
    },
  ]);
  await writeRollout(rolloutPath, [
    { type: "event_msg", payload: { type: "task_complete", last_agent_message: "Earlier." } },
  ]);
  await writeHookEvent(spool, "codex-prompted", "prompt", TEST_TIME - 5_000);

  const adapter = new CodexSessionAdapter({
    codexHome,
    hookEventsDirectory: () => spool,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WORKING);
});

test("a notification the thread has answered stands down at once", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  const spool = await temporaryHookSpool(t);
  const rolloutPath = path.join(codexHome, "rollout-approved.jsonl");
  // The approval was granted and the call ran: a row touched after the
  // notification, though within the tolerance the other events enjoy.
  await writeCodexState(codexHome, [
    {
      id: "codex-approved",
      cwd: "/Users/test/luke",
      lastActivityAt: TEST_TIME - 1_000,
      rolloutPath,
    },
  ]);
  await writeRollout(rolloutPath, [{ type: "event_msg", payload: { type: "task_started" } }]);
  await writeHookEvent(spool, "codex-approved", "notification", TEST_TIME - 3_000);

  const adapter = new CodexSessionAdapter({
    codexHome,
    hookEventsDirectory: () => spool,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WORKING);
});

test("a spool that cannot be read costs only the refinement", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  await writeCodexState(codexHome, [
    { id: "codex-unrefined", cwd: "/Users/test/luke", lastActivityAt: TEST_TIME - 1_000 },
  ]);

  const adapter = new CodexSessionAdapter({
    codexHome,
    hookEventsDirectory: () => path.join(codexHome, "no-such-spool"),
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WORKING);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("a permission hold that outlives the freshness window is still an ask", async (t) => {
  const codexHome = await temporaryCodexHome(t);
  const spool = await temporaryHookSpool(t);
  const rolloutPath = path.join(codexHome, "rollout-long-hold.jsonl");
  // A standing notification is proof the approval dialog is still up — the
  // hold writes no records, so any record at or past it would have discarded
  // it — and an ask still asking must neither flip back to active work nor
  // melt into an idle row however long it has stood.
  await writeCodexState(codexHome, [
    {
      id: "codex-long-hold",
      cwd: "/Users/test/luke",
      lastActivityAt: TEST_TIME - 30 * 60 * 1000,
      rolloutPath,
    },
  ]);
  await writeRollout(rolloutPath, [{ type: "event_msg", payload: { type: "task_started" } }]);
  await writeHookEvent(spool, "codex-long-hold", "notification", TEST_TIME - 20 * 60 * 1000);

  const adapter = new CodexSessionAdapter({
    activeSessionFreshnessMs: 15 * 60 * 1000,
    codexHome,
    hookEventsDirectory: () => spool,
    now: () => TEST_TIME,
  });
  const [observation] = await adapter.observe();

  assert.equal(observation?.status, SESSION_STATUS.WAITING);
});
