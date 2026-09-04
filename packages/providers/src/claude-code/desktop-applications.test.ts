import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  PROVIDER_ID,
  type ProviderSessionObservation,
  SESSION_APPLICATION_ID,
  SESSION_APPLICATION_SCOPE,
  SESSION_LOCATION,
  SESSION_STATUS,
} from "@sidecar/session";
import type { ParsedJsonObject } from "@sidecar/wire/testing";
import {
  ClaudeDesktopSessionApplicationReader,
  claudeDesktopSessionLink,
} from "./desktop-applications.js";

const TEST_ACCOUNT_DIRECTORY = "account-1";
const TEST_ORGANIZATION_DIRECTORY = "organization-1";

async function temporarySessionsDirectory(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luke-claude-desktop-"));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return path.join(directory, "claude-code-sessions");
}

async function writeStoreFile(
  sessionsDirectory: string,
  fileName: string,
  contents: string,
): Promise<string> {
  const directory = path.join(
    sessionsDirectory,
    TEST_ACCOUNT_DIRECTORY,
    TEST_ORGANIZATION_DIRECTORY,
  );
  await fs.mkdir(directory, { recursive: true });
  const filePath = path.join(directory, fileName);
  await fs.writeFile(filePath, contents);
  return filePath;
}

function writeSessionRecord(
  sessionsDirectory: string,
  fileName: string,
  record: ParsedJsonObject,
): Promise<string> {
  return writeStoreFile(sessionsDirectory, fileName, JSON.stringify(record));
}

function observation(
  providerSessionId: string,
  extra: Partial<ProviderSessionObservation> = {},
): ProviderSessionObservation {
  return {
    providerSessionId,
    title: "Transcript title",
    status: SESSION_STATUS.WAITING,
    lastActivityAt: 1,
    detail: { repository: "luke" },
    ...extra,
  };
}

test("composes the app's own continue route for a session it holds", () => {
  assert.equal(
    claudeDesktopSessionLink("local_888927c4-c22c-48b6-9873-e36a04e3a51d"),
    "claude://claude.ai/epitaxy/local_888927c4-c22c-48b6-9873-e36a04e3a51d",
  );
});

test("an absent store annotates nothing", async (t) => {
  const reader = new ClaudeDesktopSessionApplicationReader({
    sessionsDirectory: await temporarySessionsDirectory(t),
  });
  const observations = [observation("cli-1")];
  const snapshot = await reader.read();
  assert.equal(snapshot.enrich(PROVIDER_ID.CLAUDE_CODE, observations), observations);
});

test("annotates a Claude Code session with the app, its address, and its title", async (t) => {
  const sessionsDirectory = await temporarySessionsDirectory(t);
  await writeSessionRecord(sessionsDirectory, "local_desk-1.json", {
    sessionId: "local_desk-1",
    cliSessionId: "cli-1",
    title: "Claude Code app chat detection",
    isArchived: false,
    remoteMcpServersConfig: [{ name: "SECRET_SERVER" }],
  });
  const reader = new ClaudeDesktopSessionApplicationReader({ sessionsDirectory });

  const snapshot = await reader.read();
  const enriched = snapshot.enrich(PROVIDER_ID.CLAUDE_CODE, [
    observation("cli-1"),
    observation("cli-unheld"),
  ]);

  assert.equal(enriched.length, 2);
  assert.equal(enriched[0]?.title, "Claude Code app chat detection");
  assert.deepEqual(enriched[0]?.applications, [
    {
      id: SESSION_APPLICATION_ID.CLAUDE,
      displayName: "Claude",
      scope: SESSION_APPLICATION_SCOPE.SESSION,
      link: "claude://claude.ai/epitaxy/local_desk-1",
    },
  ]);
  assert.deepEqual(enriched[0]?.detail, {
    repository: "luke",
    link: "claude://claude.ai/epitaxy/local_desk-1",
  });
  assert.equal(enriched[1]?.applications, undefined);
  assert.equal(enriched[1]?.title, "Transcript title");
});

test("keeps an address another app already gave the row", async (t) => {
  const sessionsDirectory = await temporarySessionsDirectory(t);
  await writeSessionRecord(sessionsDirectory, "local_desk-1.json", {
    sessionId: "local_desk-1",
    cliSessionId: "cli-1",
    title: "Held twice",
  });
  const reader = new ClaudeDesktopSessionApplicationReader({ sessionsDirectory });

  const [enriched] = (await reader.read()).enrich(PROVIDER_ID.CLAUDE_CODE, [
    observation("cli-1", {
      detail: { link: "conductor://workspace?id=ws&session=chat" },
      applications: [
        {
          id: SESSION_APPLICATION_ID.CONDUCTOR,
          displayName: "Conductor",
          scope: SESSION_APPLICATION_SCOPE.SESSION,
          link: "conductor://workspace?id=ws&session=chat",
        },
      ],
    }),
  ]);

  assert.equal(enriched?.detail?.link, "conductor://workspace?id=ws&session=chat");
  assert.deepEqual(
    enriched?.applications?.map((application) => application.id),
    [SESSION_APPLICATION_ID.CONDUCTOR, SESSION_APPLICATION_ID.CLAUDE],
  );
});

test("drops a chat the user archived in the app", async (t) => {
  const sessionsDirectory = await temporarySessionsDirectory(t);
  await writeSessionRecord(sessionsDirectory, "local_desk-1.json", {
    sessionId: "local_desk-1",
    cliSessionId: "cli-1",
    title: "Filed away",
    isArchived: true,
  });
  const reader = new ClaudeDesktopSessionApplicationReader({ sessionsDirectory });

  const enriched = (await reader.read()).enrich(PROVIDER_ID.CLAUDE_CODE, [
    observation("cli-1"),
    observation("cli-2"),
  ]);

  assert.deepEqual(
    enriched.map((candidate) => candidate.providerSessionId),
    ["cli-2"],
  );
});

test("an open record outranks an archived twin of the same transcript", async (t) => {
  const sessionsDirectory = await temporarySessionsDirectory(t);
  await writeSessionRecord(sessionsDirectory, "local_desk-1.json", {
    sessionId: "local_desk-1",
    cliSessionId: "cli-1",
    title: "Open",
  });
  await writeSessionRecord(sessionsDirectory, "local_desk-2.json", {
    sessionId: "local_desk-2",
    cliSessionId: "cli-1",
    title: "Archived",
    isArchived: true,
  });
  const reader = new ClaudeDesktopSessionApplicationReader({ sessionsDirectory });

  const enriched = (await reader.read()).enrich(PROVIDER_ID.CLAUDE_CODE, [observation("cli-1")]);

  assert.equal(enriched.length, 1);
  assert.equal(enriched[0]?.title, "Open");
  assert.equal(enriched[0]?.detail?.link, "claude://claude.ai/epitaxy/local_desk-1");
});

test("names the app without an address when its id is not one the handler takes", async (t) => {
  const sessionsDirectory = await temporarySessionsDirectory(t);
  await writeSessionRecord(sessionsDirectory, "odd.json", {
    sessionId: "remote_desk-1?x=1",
    cliSessionId: "cli-1",
    title: "Oddly named",
  });
  const reader = new ClaudeDesktopSessionApplicationReader({ sessionsDirectory });

  const [enriched] = (await reader.read()).enrich(PROVIDER_ID.CLAUDE_CODE, [observation("cli-1")]);

  assert.deepEqual(enriched?.applications, [
    {
      id: SESSION_APPLICATION_ID.CLAUDE,
      displayName: "Claude",
      scope: SESSION_APPLICATION_SCOPE.SESSION,
    },
  ]);
  assert.equal(enriched?.detail?.link, undefined);
});

test("ignores files that are not session records", async (t) => {
  const sessionsDirectory = await temporarySessionsDirectory(t);
  await writeSessionRecord(sessionsDirectory, "scheduled-tasks.json", { tasks: [] });
  await writeStoreFile(sessionsDirectory, "local_broken.json", "{not json");
  await writeStoreFile(sessionsDirectory, "local_list.json", '["cli-1"]');
  await writeSessionRecord(sessionsDirectory, "notes.txt", { cliSessionId: "cli-1" });
  const reader = new ClaudeDesktopSessionApplicationReader({ sessionsDirectory });

  const observations = [observation("cli-1")];
  assert.equal((await reader.read()).enrich(PROVIDER_ID.CLAUDE_CODE, observations), observations);
});

test("annotates only local Claude Code observations", async (t) => {
  const sessionsDirectory = await temporarySessionsDirectory(t);
  await writeSessionRecord(sessionsDirectory, "local_desk-1.json", {
    sessionId: "local_desk-1",
    cliSessionId: "cli-1",
  });
  const reader = new ClaudeDesktopSessionApplicationReader({ sessionsDirectory });
  const snapshot = await reader.read();

  const codex = [observation("cli-1")];
  assert.equal(snapshot.enrich(PROVIDER_ID.CODEX, codex), codex);
  const [cloud] = snapshot.enrich(PROVIDER_ID.CLAUDE_CODE, [
    observation("cli-1", { location: SESSION_LOCATION.CLOUD }),
  ]);
  assert.equal(cloud?.applications, undefined);
});

test("a sub-agent inherits the app but not its parent's title", async (t) => {
  const sessionsDirectory = await temporarySessionsDirectory(t);
  await writeSessionRecord(sessionsDirectory, "local_desk-1.json", {
    sessionId: "local_desk-1",
    cliSessionId: "cli-parent",
    title: "Parent chat",
  });
  const reader = new ClaudeDesktopSessionApplicationReader({ sessionsDirectory });

  const enriched = (await reader.read()).enrich(PROVIDER_ID.CLAUDE_CODE, [
    observation("cli-parent"),
    observation("cli-child", { parentProviderSessionId: "cli-parent", title: "Child work" }),
  ]);

  assert.equal(enriched[1]?.title, "Child work");
  assert.equal(enriched[1]?.detail?.link, "claude://claude.ai/epitaxy/local_desk-1");
});

test("never follows a link out of the store", async (t) => {
  const sessionsDirectory = await temporarySessionsDirectory(t);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "luke-claude-desktop-outside-"));
  t.after(async () => {
    await fs.rm(outside, { recursive: true, force: true });
  });
  await fs.mkdir(path.join(outside, "organization-x"), { recursive: true });
  await fs.writeFile(
    path.join(outside, "organization-x", "local_desk-1.json"),
    JSON.stringify({ sessionId: "local_desk-1", cliSessionId: "cli-1" }),
  );
  await fs.mkdir(sessionsDirectory, { recursive: true });
  await fs.symlink(outside, path.join(sessionsDirectory, "linked-account"));
  const reader = new ClaudeDesktopSessionApplicationReader({ sessionsDirectory });

  const observations = [observation("cli-1")];
  assert.equal((await reader.read()).enrich(PROVIDER_ID.CLAUDE_CODE, observations), observations);
});

test("re-reads a record only when its file changes", async (t) => {
  const sessionsDirectory = await temporarySessionsDirectory(t);
  const filePath = await writeSessionRecord(sessionsDirectory, "local_desk-1.json", {
    sessionId: "local_desk-1",
    cliSessionId: "cli-1",
    title: "First title",
  });
  // A whole second, so the stamp survives the round trip through `utimes`.
  const writtenAt = new Date("2026-08-11T23:44:00.000Z");
  await fs.utimes(filePath, writtenAt, writtenAt);
  const reader = new ClaudeDesktopSessionApplicationReader({ sessionsDirectory });
  await reader.read();

  // Same size and mtime: the cached parse stands, so the new title is unseen.
  await fs.writeFile(
    filePath,
    JSON.stringify({ sessionId: "local_desk-1", cliSessionId: "cli-1", title: "Later title" }),
  );
  await fs.utimes(filePath, writtenAt, writtenAt);
  let [enriched] = (await reader.read()).enrich(PROVIDER_ID.CLAUDE_CODE, [observation("cli-1")]);
  assert.equal(enriched?.title, "First title");

  await fs.utimes(filePath, writtenAt, new Date(writtenAt.getTime() + 5_000));
  [enriched] = (await reader.read()).enrich(PROVIDER_ID.CLAUDE_CODE, [observation("cli-1")]);
  assert.equal(enriched?.title, "Later title");

  await fs.rm(filePath);
  const observations = [observation("cli-1")];
  assert.equal((await reader.read()).enrich(PROVIDER_ID.CLAUDE_CODE, observations), observations);
});
