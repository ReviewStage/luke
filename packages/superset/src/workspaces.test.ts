import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import {
  PROVIDER_ID,
  SESSION_APPLICATION_ID,
  SESSION_APPLICATION_SCOPE,
  SESSION_STATUS,
} from "@sidecar/session";
import { SUPERSET_WORKSPACE_PROVIDER_ID } from "../../../apps/desktop/src/shared/contracts.js";
import { SUPERSET_CONTROL_ID } from "./cli.js";
import { SupersetWorkspaceReader } from "./workspaces.js";

async function temporarySupersetHome(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luke-superset-"));
  t.after(async () => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function writeHostDatabase(home: string, organizationId: string): Promise<DatabaseSync> {
  const directory = path.join(home, "host", organizationId);
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
    organizationId: "host-local",
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
          link: "superset://v2-workspace/workspace-1?terminalId=terminal-1",
        },
        applications: [
          {
            id: SESSION_APPLICATION_ID.SUPERSET,
            displayName: "Superset",
            scope: SESSION_APPLICATION_SCOPE.WORKSPACE,
            link: "superset://v2-workspace/workspace-1?terminalId=terminal-1",
          },
        ],
        workspace: {
          providerWorkspaceId: "workspace-1",
          name: "power-vacation",
          scopeId: SUPERSET_WORKSPACE_PROVIDER_ID,
          managerName: "Superset",
        },
      },
    ],
  );

  // A session whose provider reported an address of its own keeps it: the
  // workspace address fills an absence, never overrides.
  assert.equal(
    snapshot.enrich(PROVIDER_ID.CODEX, [
      {
        providerSessionId: "session-1",
        title: "Implement integration",
        status: SESSION_STATUS.WORKING,
        observedAt: 100,
        detail: { link: "codex://threads/session-1" },
      },
    ])[0]?.detail?.link,
    "codex://threads/session-1",
  );
});

test("keeps the newest duplicate binding across host databases", async (t) => {
  const home = await temporarySupersetHome(t);
  for (const [organizationId, updatedAt] of [
    ["host-old", 100],
    ["host-new", 200],
  ] as const) {
    const database = await writeHostDatabase(home, organizationId);
    createSchema(database);
    database.exec(`
      INSERT INTO workspaces VALUES (
        'workspace-${organizationId}', NULL, NULL, '${organizationId}', 'main', ${updatedAt}
      );
      INSERT INTO terminal_agent_bindings VALUES (
        'terminal-${organizationId}', 'workspace-${organizationId}', 'claude', 'shared-session', 'Stop'
      );
    `);
    database.close();
  }

  const snapshot = await new SupersetWorkspaceReader({ homeDirectory: home }).read();
  assert.equal(
    snapshot.context(PROVIDER_ID.CLAUDE_CODE, "shared-session")?.workspaceId,
    "workspace-host-new",
  );
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
    status: SESSION_STATUS.WAITING,
    observedAt: 100,
  };

  const observed = snapshot.enrich(PROVIDER_ID.CODEX, [observation])[0];
  assert.equal(observed?.canReceiveMessage, undefined);
  assert.equal(observed?.controls, undefined);
  assert.equal(observed?.renameTarget, undefined);
  // The workspace address is observation's, not the login's: the app that
  // wrote the host state is the scheme's handler, so a signed-out CLI still
  // leaves every managed chat somewhere to open.
  assert.equal(observed?.detail?.link, "superset://v2-workspace/workspace-1?terminalId=terminal-1");
  const connected = snapshot.enrich(PROVIDER_ID.CODEX, [observation], "host-local")[0];
  assert.equal(connected?.canReceiveMessage, true);
  assert.deepEqual(connected?.spawnableAgents, ["claude", "codex"]);
  assert.equal(connected?.spawnTarget, "workspace-1");
  assert.equal(connected?.renameTarget, "workspace-1");
  // The delete carries the workspace it acts on as its target — what the
  // press deletes, and what seats the control on a tray's header.
  assert.deepEqual(connected?.controls, [
    {
      id: SUPERSET_CONTROL_ID.DELETE_WORKSPACE,
      label: "Delete workspace",
      target: "workspace-1",
    },
  ]);

  // Deleting is unrecoverable, so a row still working — or one whose state
  // could not be read — is never offered it.
  for (const status of [SESSION_STATUS.WORKING, SESSION_STATUS.UNKNOWN]) {
    const busy = snapshot.enrich(PROVIDER_ID.CODEX, [{ ...observation, status }], "host-local")[0];
    assert.deepEqual(busy?.controls, []);
  }

  // The CLI's login serves one organization at a time, so a workspace another
  // organization's host service recorded advertises nothing actable — and the
  // act router answers no context for it — while observation itself stays.
  const otherOrg = snapshot.enrich(PROVIDER_ID.CODEX, [observation], "org-other")[0];
  assert.equal(otherOrg?.canReceiveMessage, undefined);
  assert.equal(otherOrg?.controls, undefined);
  assert.equal(otherOrg?.detail?.link, "superset://v2-workspace/workspace-1?terminalId=terminal-1");
  assert.equal(snapshot.actableContext(PROVIDER_ID.CODEX, "session-1", "org-other"), undefined);
  assert.equal(snapshot.actableContext(PROVIDER_ID.CODEX, "session-1", undefined), undefined);
  assert.equal(
    snapshot.actableContext(PROVIDER_ID.CODEX, "session-1", "host-local")?.workspaceId,
    "workspace-1",
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
      'terminal-1', 'workspace-1', 'mystery-agent', 'session-1', 'Start'
    );
  `);
  database.close();

  const snapshot = await new SupersetWorkspaceReader({ homeDirectory: home }).read();
  assert.equal(snapshot.context(PROVIDER_ID.CODEX, "session-1"), undefined);
});

test("attaches Superset's Gemini terminals to Gemini CLI rows", async (t) => {
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
  assert.equal(snapshot.context(PROVIDER_ID.GEMINI_CLI, "session-1")?.workspaceId, "workspace-1");
});
