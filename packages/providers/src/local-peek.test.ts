import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { PROVIDER_ID } from "@sidecar/session";
import type { ParsedJsonObject } from "@sidecar/wire/testing";
import { type LocalPeekOptions, peekLocalSessions } from "./local-peek.js";

const CLAUDE_PROJECTS_DIRECTORY = "projects";
const TEST_CLAUDE_EVENT_TYPE = {
  ASSISTANT: "assistant",
  USER: "user",
} as const;

async function temporaryDirectory(t: TestContext, prefix: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

/**
 * Every location the peek's adapters read, pinned under one temporary root,
 * so a test observes only its own fixtures and never this machine's real
 * provider homes — which on a developer's Mac hold real sessions.
 */
function pinnedPeekOptions(root: string): LocalPeekOptions {
  return {
    claudeHome: path.join(root, "claude"),
    codexHome: path.join(root, "codex"),
    ompHome: path.join(root, "omp"),
  };
}

async function writeClaudeSessionFile(
  claudeHome: string,
  projectDirectoryName: string,
  sessionFileName: string,
  records: readonly ParsedJsonObject[],
  mtimeMs: number,
): Promise<void> {
  const projectDirectory = path.join(claudeHome, CLAUDE_PROJECTS_DIRECTORY, projectDirectoryName);
  await fs.mkdir(projectDirectory, { recursive: true });
  const filePath = path.join(projectDirectory, `${sessionFileName}.jsonl`);
  await fs.writeFile(filePath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
  await fs.utimes(filePath, mtimeMs / 1000, mtimeMs / 1000);
}

function claudeExchange(cwd: string, endedAtMs: number): readonly ParsedJsonObject[] {
  return [
    {
      type: TEST_CLAUDE_EVENT_TYPE.USER,
      cwd,
      timestamp: new Date(endedAtMs - 5_000).toISOString(),
      message: { content: "Synthetic prompt." },
    },
    {
      type: TEST_CLAUDE_EVENT_TYPE.ASSISTANT,
      cwd,
      timestamp: new Date(endedAtMs).toISOString(),
      message: { content: "Synthetic reply." },
    },
  ];
}

test("peeks nothing from empty or nonexistent provider homes", async (t) => {
  const root = await temporaryDirectory(t, "luke-local-peek-empty-");

  const sessions = await peekLocalSessions(pinnedPeekOptions(root));

  assert.deepEqual(sessions, []);
});

test("finds and normalizes local sessions, newest first", async (t) => {
  const root = await temporaryDirectory(t, "luke-local-peek-fixture-");
  const options = pinnedPeekOptions(root);
  const claudeHome = options.claudeHome;
  assert.ok(claudeHome);
  const now = Date.now();
  await writeClaudeSessionFile(
    claudeHome,
    "-Users-test-luke",
    "session-newer",
    claudeExchange("/Users/test/luke", now - 10_000),
    now - 10_000,
  );
  await writeClaudeSessionFile(
    claudeHome,
    "-Users-test-older",
    "session-older",
    claudeExchange("/Users/test/older", now - 60_000),
    now - 60_000,
  );

  const sessions = await peekLocalSessions(options);

  assert.equal(sessions.length, 2);
  assert.equal(sessions[0]?.providerSessionId, "session-newer");
  assert.equal(sessions[1]?.providerSessionId, "session-older");
  assert.ok((sessions[0]?.lastActivityAt ?? 0) >= (sessions[1]?.lastActivityAt ?? 0));
  const session = sessions[0];
  assert.equal(session?.providerId, PROVIDER_ID.CLAUDE_CODE);
  assert.equal(session?.provider.displayName, "Claude Code");
  assert.equal(session?.title, "luke");
});

test("a provider whose read throws does not sink the others", async (t) => {
  const root = await temporaryDirectory(t, "luke-local-peek-broken-");
  const options = pinnedPeekOptions(root);
  const claudeHome = options.claudeHome;
  assert.ok(claudeHome);
  const now = Date.now();
  await writeClaudeSessionFile(
    claudeHome,
    "-Users-test-luke",
    "session-survives",
    claudeExchange("/Users/test/luke", now - 10_000),
    now - 10_000,
  );

  const sessions = await peekLocalSessions({
    ...options,
    // A NUL byte is a path no filesystem read accepts, and the failure is not
    // one of the absent-or-unreadable codes the adapters absorb themselves,
    // so this exercises the peek's own per-provider absorption.
    ompHome: "\u0000omp-unreadable",
  });

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.providerId, PROVIDER_ID.CLAUDE_CODE);
  assert.equal(sessions[0]?.providerSessionId, "session-survives");
});
