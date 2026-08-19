import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { PROVIDER_ID, SESSION_CONTROL_KIND, SESSION_STATUS } from "@sidecar/core";
import { SUPERSET_WORKSPACE_PROVIDER_ID } from "../src/shared/contracts";
import { SUPERSET_CONTROL_ID } from "../src/superset-cli";
import { SupersetWorkspaceReader } from "../src/superset-workspaces";

async function temporarySupersetHome(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luke-superset-"));
  t.after(async () => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function writeHostDatabase(home: string, hostId: string): Promise<DatabaseSync> {
  const directory = path.join(home, "host", hostId);
  await fs.mkdir(directory, { recursive: true });
  return new DatabaseSync(path.join(directory, "host.db"), {});
}

function createSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE pull_requests (id TEXT PRIMARY KEY, url TEXT NOT NULL);
    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      pull_request_id TEXT,
      name TEXT NOT NULL,
      branch TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE terminal_agent_bindings (
      terminal_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      agent_session_id TEXT,
      last_event_type TEXT NOT NULL
    );
    CREATE TABLE host_agent_configs (
      preset_id TEXT,
      display_order INTEGER NOT NULL
    );
  `);
}

test("reads live host databases and enriches an exact provider session", async (t) => {
  const home = await temporarySupersetHome(t);
  const database = await writeHostDatabase(home, "host-local");
  createSchema(database);
  database.exec(`
    INSERT INTO projects VALUES ('project-1', 'Luke');
    INSERT INTO pull_requests VALUES ('pr-1', 'https://github.com/example/luke/pull/42');
    INSERT INTO workspaces VALUES (
      'workspace-1', 'project-1', 'pr-1', 'power-vacation', 'feat/superset', 200
    );
    INSERT INTO terminal_agent_bindings VALUES (
      'terminal-1', 'workspace-1', 'codex', 'session-1', 'Start'
    );
  `);
  database.close();

  const snapshot = await new SupersetWorkspaceReader({ homeDirectory: home }).read();
  assert.deepEqual(snapshot.context(PROVIDER_ID.CODEX, "session-1"), {
    providerId: PROVIDER_ID.CODEX,
    providerSessionId: "session-1",
    hostId: "host-local",
    workspaceId: "workspace-1",
    workspaceName: "power-vacation",
    terminalId: "terminal-1",
    updatedAt: 200,
    spawnableAgents: [],
    projectName: "Luke",
    branch: "feat/superset",
    pullRequestUrl: "https://github.com/example/luke/pull/42",
  });
  assert.deepEqual(
    snapshot.enrich(PROVIDER_ID.CODEX, [
      {
        providerSessionId: "session-1",
        title: "Implement integration",
        status: SESSION_STATUS.WORKING,
        observedAt: 100,
        detail: { model: "gpt-5" },
      },
    ]),
    [
      {
        providerSessionId: "session-1",
        title: "Implement integration",
        status: SESSION_STATUS.WORKING,
        observedAt: 100,
        detail: {
          model: "gpt-5",
          repository: "Luke",
          branch: "feat/superset",
          change: "https://github.com/example/luke/pull/42",
        },
        workspace: {
          providerWorkspaceId: "workspace-1",
          name: "power-vacation",
          scopeId: SUPERSET_WORKSPACE_PROVIDER_ID,
          managerName: "Superset",
        },
      },
    ],
  );
});

test("keeps the newest duplicate binding across host databases", async (t) => {
  const home = await temporarySupersetHome(t);
  for (const [hostId, updatedAt] of [
    ["host-old", 100],
    ["host-new", 200],
  ] as const) {
    const database = await writeHostDatabase(home, hostId);
    createSchema(database);
    database.exec(`
      INSERT INTO workspaces VALUES (
        'workspace-${hostId}', NULL, NULL, '${hostId}', 'main', ${updatedAt}
      );
      INSERT INTO terminal_agent_bindings VALUES (
        'terminal-${hostId}', 'workspace-${hostId}', 'claude', 'shared-session', 'Stop'
      );
    `);
    database.close();
  }

  const snapshot = await new SupersetWorkspaceReader({ homeDirectory: home }).read();
  assert.equal(snapshot.context(PROVIDER_ID.CLAUDE_CODE, "shared-session")?.hostId, "host-new");
});

test("advertises Superset actions only after the CLI is connected", async (t) => {
  const home = await temporarySupersetHome(t);
  const database = await writeHostDatabase(home, "host-local");
  createSchema(database);
  database.exec(`
    INSERT INTO workspaces VALUES ('workspace-1', NULL, NULL, 'power-vacation', 'main', 100);
    INSERT INTO host_agent_configs VALUES ('claude', 0), ('codex', 1);
    INSERT INTO terminal_agent_bindings VALUES (
      'terminal-1', 'workspace-1', 'codex', 'session-1', 'Start'
    );
  `);
  database.close();
  const snapshot = await new SupersetWorkspaceReader({ homeDirectory: home }).read();
  const observation = {
    providerSessionId: "session-1",
    title: "Implement integration",
    status: SESSION_STATUS.WORKING,
    observedAt: 100,
  };

  assert.equal(snapshot.enrich(PROVIDER_ID.CODEX, [observation])[0]?.canReceiveMessage, undefined);
  assert.equal(snapshot.enrich(PROVIDER_ID.CODEX, [observation])[0]?.renameTarget, undefined);
  const connected = snapshot.enrich(PROVIDER_ID.CODEX, [observation], true)[0];
  assert.equal(connected?.canReceiveMessage, true);
  assert.deepEqual(connected?.spawnableAgents, ["claude", "codex"]);
  assert.equal(connected?.spawnTarget, "workspace-1");
  assert.equal(connected?.renameTarget, "workspace-1");
  assert.deepEqual(
    connected?.controls?.map((control) => control.id),
    [SUPERSET_CONTROL_ID.OPEN_WORKSPACE, SUPERSET_CONTROL_ID.CLOSE_TERMINAL],
  );
  // The open kind is what lets an ask to open a Superset-managed local chat —
  // which has no address of its own — run this control instead of refusing.
  assert.equal(
    connected?.controls?.find((control) => control.id === SUPERSET_CONTROL_ID.OPEN_WORKSPACE)?.kind,
    SESSION_CONTROL_KIND.OPEN,
  );
});

test("treats missing and drifted Superset state as no enrichment", async (t) => {
  const home = await temporarySupersetHome(t);
  const empty = await new SupersetWorkspaceReader({ homeDirectory: home }).read();
  assert.equal(empty.context(PROVIDER_ID.CODEX, "session-1"), undefined);

  const database = await writeHostDatabase(home, "host-drifted");
  database.exec("CREATE TABLE future_workspaces (id TEXT PRIMARY KEY)");
  database.close();
  const drifted = await new SupersetWorkspaceReader({ homeDirectory: home }).read();
  assert.equal(drifted.context(PROVIDER_ID.CODEX, "session-1"), undefined);
});

test("does not attach unknown Superset agent kinds to a Luke provider", async (t) => {
  const home = await temporarySupersetHome(t);
  const database = await writeHostDatabase(home, "host-local");
  createSchema(database);
  database.exec(`
    INSERT INTO workspaces VALUES ('workspace-1', NULL, NULL, 'power-vacation', 'main', 100);
    INSERT INTO terminal_agent_bindings VALUES (
      'terminal-1', 'workspace-1', 'gemini', 'session-1', 'Start'
    );
  `);
  database.close();

  const snapshot = await new SupersetWorkspaceReader({ homeDirectory: home }).read();
  assert.equal(snapshot.context(PROVIDER_ID.CODEX, "session-1"), undefined);
});
