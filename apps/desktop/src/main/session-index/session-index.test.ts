import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import {
  normalizeSession,
  SESSION_LOCATION,
  SESSION_ROSTER_RETENTION_MS,
  SESSION_STATUS,
  type Session,
  type SessionRegistrySnapshot,
} from "@sidecar/session";
import BetterSqlite3 from "better-sqlite3";
import { SESSION_INDEX_FILE_NAME, SessionIndex, type SessionIndexOptions } from "./session-index";

const migrationsDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../drizzle/session-index",
);
const NOW = Date.UTC(2026, 8, 1);

async function temporaryDirectory(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luke-session-index-"));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

function session(
  providerSessionId: string,
  overrides: {
    title?: string;
    status?: Session["status"];
    observedAt?: number;
    recap?: string;
    branch?: string;
    standing?: boolean;
  } = {},
): Session {
  return normalizeSession(
    { id: "cursor", displayName: "Cursor" },
    {
      providerSessionId,
      title: overrides.title ?? "Index local sessions",
      status: overrides.status ?? SESSION_STATUS.WORKING,
      observedAt: overrides.observedAt ?? NOW,
      location: SESSION_LOCATION.LOCAL,
      recap: overrides.recap ?? "Built the roster projection",
      standing: overrides.standing,
      holdingForDeveloper: true,
      detail: {
        branch: overrides.branch ?? "cursor/LUKE-123-index",
        repository: "luke",
      },
      workspace: {
        providerWorkspaceId: "workspace-1",
        name: "Search work",
      },
    },
  );
}

function snapshot(sessions: readonly Session[], revision = 1): SessionRegistrySnapshot {
  return { revision, sessions, attention: [] };
}

function indexIn(
  directory: string,
  options: Partial<Pick<SessionIndexOptions, "enabled" | "onDiagnostic">> = {},
): SessionIndex {
  return new SessionIndex({
    directory: () => directory,
    migrationsDirectory,
    enabled: options.enabled ?? true,
    onDiagnostic: options.onDiagnostic,
  });
}

test("reconciles added, updated, and disappeared sessions into FTS", async (t) => {
  const directory = await temporaryDirectory(t);
  const index = indexIn(directory);

  await index.reconcile(snapshot([session("one")]));
  const initialHits = await index.search("LUKE-123", NOW);
  assert.equal(initialHits.length, 1);
  assert.equal(initialHits[0]?.providerId, "cursor");
  assert.equal(initialHits[0]?.providerSessionId, "one");
  assert.equal(Number.isFinite(initialHits[0]?.rank), true);

  await index.reconcile(
    snapshot(
      [session("one", { branch: "cursor/LUKE-456-search", recap: "Changed the indexed words" })],
      2,
    ),
  );
  assert.deepEqual(await index.search("LUKE-123", NOW), []);
  assert.equal((await index.search("LUKE-456", NOW))[0]?.providerSessionId, "one");

  await index.reconcile(snapshot([], 3));
  assert.deepEqual(await index.search("LUKE-456", NOW), []);
  index.close();
});

test("an unchanged about hash skips the database update", async (t) => {
  const directory = await temporaryDirectory(t);
  const index = indexIn(directory);
  const current = snapshot([session("one")]);
  await index.reconcile(current);

  const observer = new BetterSqlite3(path.join(directory, SESSION_INDEX_FILE_NAME));
  observer.exec(`
    CREATE TABLE update_audit (count INTEGER NOT NULL);
    INSERT INTO update_audit (count) VALUES (0);
    CREATE TRIGGER audit_session_update AFTER UPDATE ON observed_sessions BEGIN
      UPDATE update_audit SET count = count + 1;
    END;
  `);

  await index.reconcile(current);

  assert.equal(
    observer.prepare<[], { count: number }>("SELECT count FROM update_audit").get()?.count,
    0,
  );
  observer.close();
  index.close();
});

test("search applies roster retention while standing sessions remain eligible", async (t) => {
  const directory = await temporaryDirectory(t);
  const index = indexIn(directory);
  const expired = NOW - SESSION_ROSTER_RETENTION_MS.SETTLED_MS - 1;

  await index.reconcile(
    snapshot([
      session("history", {
        title: "Archived parser work",
        status: SESSION_STATUS.COMPLETE,
        observedAt: expired,
      }),
      session("standing", {
        title: "Standing parser workspace",
        status: SESSION_STATUS.COMPLETE,
        observedAt: expired,
        standing: true,
      }),
    ]),
  );

  assert.deepEqual(
    (await index.search("parser", NOW)).map((hit) => hit.providerSessionId),
    ["standing"],
  );
  index.close();
});

test("stores only the approved bounded projection in an owner-only file", async (t) => {
  const directory = await temporaryDirectory(t);
  const index = indexIn(directory);
  await index.reconcile(snapshot([session("one")]));
  index.close();

  const databasePath = path.join(directory, SESSION_INDEX_FILE_NAME);
  const stats = await fs.stat(databasePath);
  assert.equal(stats.mode & 0o777, 0o600);

  const database = new BetterSqlite3(databasePath, { readonly: true });
  const columns = database
    .prepare<[], { name: string; type: string }>("PRAGMA table_info(observed_sessions)")
    .all();
  assert.deepEqual(
    columns.map((column) => column.name),
    [
      "provider_id",
      "provider_session_id",
      "title",
      "branch",
      "recap",
      "status",
      "observed_at",
      "provider_label",
      "location",
      "repository_label",
      "workspace_label",
      "standing",
      "holding_for_developer",
      "about_hash",
    ],
  );
  assert.equal(
    columns.some((column) => column.type.toLowerCase() === "blob"),
    false,
  );
  assert.equal(
    database
      .prepare<[], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%transcript%'",
      )
      .all().length,
    0,
  );
  database.close();
});

test("a disabled index creates no fixture or capture state", async (t) => {
  const directory = await temporaryDirectory(t);
  const index = indexIn(directory, { enabled: false });

  await index.reconcile(snapshot([session("fixture")]));

  assert.deepEqual(await fs.readdir(directory), []);
  assert.deepEqual(await index.search("fixture", NOW), []);
});

test("a corrupt projection is removed and rebuilt from the current snapshot", async (t) => {
  const directory = await temporaryDirectory(t);
  await fs.writeFile(path.join(directory, SESSION_INDEX_FILE_NAME), "not a sqlite database", {
    mode: 0o600,
  });
  const index = indexIn(directory);

  await index.reconcile(snapshot([session("rebuilt", { title: "Recovered index" })]));

  assert.equal((await index.search("Recovered", NOW))[0]?.providerSessionId, "rebuilt");
  index.close();
});

test("a locked projection leaves the previous index readable and retries later", async (t) => {
  const directory = await temporaryDirectory(t);
  const diagnostics: string[] = [];
  const index = indexIn(directory, { onDiagnostic: (message) => diagnostics.push(message) });
  await index.reconcile(snapshot([session("one", { title: "Original title" })]));

  const lock = new BetterSqlite3(path.join(directory, SESSION_INDEX_FILE_NAME));
  lock.exec("BEGIN EXCLUSIVE");
  await index.reconcile(snapshot([session("one", { title: "Updated title" })], 2));
  lock.exec("ROLLBACK");
  lock.close();

  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0] ?? "", /locked/i);
  assert.equal((await index.search("Original", NOW))[0]?.providerSessionId, "one");

  await index.reconcile(snapshot([session("one", { title: "Updated title" })], 2));
  assert.equal((await index.search("Updated", NOW))[0]?.providerSessionId, "one");
  index.close();
});
