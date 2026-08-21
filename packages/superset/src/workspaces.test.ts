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
  SESSION_LOCATION,
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
      updated_at INTEGER NOT NULL,
      type TEXT NOT NULL DEFAULT 'worktree',
      archived_at INTEGER,
      worktree_path TEXT
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
    INSERT INTO workspaces (id, project_id, pull_request_id, name, branch, updated_at) VALUES (
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

test("binds Cursor's agents CLI under Superset's own name for it", async (t) => {
  const home = await temporarySupersetHome(t);
  const database = await writeHostDatabase(home, "host-local");
  createSchema(database);
  // Superset records the app's agents as `cursor` and the `agents` CLI as
  // `cursor-agent`; both are Cursor sessions to Luke.
  database.exec(`
    INSERT INTO workspaces (id, project_id, pull_request_id, name, branch, updated_at) VALUES (
      'workspace-1', NULL, NULL, 'square-geometry', 'main', 200
    );
    INSERT INTO terminal_agent_bindings VALUES (
      'terminal-1', 'workspace-1', 'cursor-agent', 'cli-session', 'Start'
    );
  `);
  database.close();

  const snapshot = await new SupersetWorkspaceReader({ homeDirectory: home }).read();
  const context = snapshot.context(PROVIDER_ID.CURSOR, "cli-session");
  assert.equal(context?.workspaceId, "workspace-1");
  assert.equal(
    snapshot.enrich(PROVIDER_ID.CURSOR, [
      {
        providerSessionId: "cli-session",
        title: "square-geometry",
        status: SESSION_STATUS.WORKING,
        observedAt: 100,
      },
    ])[0]?.detail?.link,
    "superset://v2-workspace/workspace-1?terminalId=terminal-1",
  );
});

test("matches a chat Superset recorded no session id for by its worktree", async (t) => {
  const home = await temporarySupersetHome(t);
  const database = await writeHostDatabase(home, "host-local");
  createSchema(database);
  // Superset's own events for OpenCode never carry the agent's session id, so
  // the binding row stands with agent_session_id NULL for the chat's whole
  // life. The worktree path is what both sides recorded independently.
  database.exec(`
    INSERT INTO projects VALUES ('project-1', 'Luke');
    INSERT INTO workspaces (id, project_id, pull_request_id, name, branch, updated_at, worktree_path) VALUES
      ('workspace-1', 'project-1', NULL, 'parallel-hippopotamus', 'feat/grok-bot', 200,
       '/Users/test/.superset/worktrees/repo-1/parallel-hippopotamus');
    INSERT INTO host_agent_configs VALUES ('claude', 0), ('opencode', 1);
    INSERT INTO terminal_agent_bindings VALUES (
      'terminal-1', 'workspace-1', 'opencode', NULL, 'Start'
    );
  `);
  database.close();

  const snapshot = await new SupersetWorkspaceReader({ homeDirectory: home }).read();
  const observation = {
    providerSessionId: "ses_grok",
    title: "Add Grok Bot support",
    status: SESSION_STATUS.WAITING,
    observedAt: 100,
    directory: "/Users/test/.superset/worktrees/repo-1/parallel-hippopotamus",
  };

  const enriched = snapshot.enrich(PROVIDER_ID.OPENCODE, [observation], "host-local")[0];
  assert.deepEqual(enriched?.workspace, {
    providerWorkspaceId: "workspace-1",
    name: "parallel-hippopotamus",
    scopeId: SUPERSET_WORKSPACE_PROVIDER_ID,
    managerName: "Superset",
  });
  assert.deepEqual(enriched?.applications, [
    {
      id: SESSION_APPLICATION_ID.SUPERSET,
      displayName: "Superset",
      scope: SESSION_APPLICATION_SCOPE.WORKSPACE,
      link: "superset://v2-workspace/workspace-1",
    },
  ]);
  assert.equal(enriched?.detail?.link, "superset://v2-workspace/workspace-1");
  assert.equal(enriched?.detail?.repository, "Luke");
  assert.equal(enriched?.detail?.branch, "feat/grok-bot");
  // No observed binding identifies the exact terminal this chat is behind, so
  // a message has nowhere it can be known to land — the workspace-scoped acts
  // still ride, because the workspace's identity is exactly known.
  assert.equal(enriched?.canReceiveMessage, undefined);
  assert.equal(enriched?.renameTarget, "workspace-1");
  assert.deepEqual(enriched?.spawnableAgents, ["claude", "opencode"]);
  assert.equal(enriched?.spawnTarget, "workspace-1");
  assert.deepEqual(enriched?.controls, [
    {
      id: SUPERSET_CONTROL_ID.DELETE_WORKSPACE,
      label: "Delete workspace",
      target: "workspace-1",
    },
  ]);

  // The act router resolves the matched chat against the same snapshot the
  // advertisement rode, terminal-less like a chatless workspace row.
  const context = snapshot.actableContext(PROVIDER_ID.OPENCODE, "ses_grok", "host-local");
  assert.equal(context?.workspaceId, "workspace-1");
  assert.equal(context?.terminalId, undefined);

  // A chat somewhere else, or one a cloud provider holds under a
  // coincidentally equal path, is never Superset's.
  const elsewhere = snapshot.enrich(
    PROVIDER_ID.OPENCODE,
    [{ ...observation, providerSessionId: "ses_other", directory: "/Users/test/luke" }],
    "host-local",
  )[0];
  assert.equal(elsewhere?.workspace, undefined);
  const cloud = snapshot.enrich(
    PROVIDER_ID.OPENCODE,
    [{ ...observation, providerSessionId: "ses_cloud", location: SESSION_LOCATION.CLOUD }],
    "host-local",
  )[0];
  assert.equal(cloud?.workspace, undefined);
  assert.equal(snapshot.actableContext(PROVIDER_ID.OPENCODE, "ses_cloud", "host-local"), undefined);
});

test("carries directory matches into the next snapshot until enrichment re-decides", async (t) => {
  const home = await temporarySupersetHome(t);
  const database = await writeHostDatabase(home, "host-local");
  createSchema(database);
  database.exec(`
    INSERT INTO workspaces (id, project_id, pull_request_id, name, branch, updated_at, worktree_path) VALUES
      ('workspace-1', NULL, NULL, 'parallel-hippopotamus', 'feat/grok-bot', 200,
       '/Users/test/.superset/worktrees/repo-1/parallel-hippopotamus');
    INSERT INTO terminal_agent_bindings VALUES (
      'terminal-1', 'workspace-1', 'opencode', NULL, 'Start'
    );
  `);
  database.close();

  const reader = new SupersetWorkspaceReader({ homeDirectory: home });
  const observation = {
    providerSessionId: "ses_grok",
    title: "Add Grok Bot support",
    status: SESSION_STATUS.WAITING,
    observedAt: 100,
    directory: "/Users/test/.superset/worktrees/repo-1/parallel-hippopotamus",
  };
  const first = await reader.read();
  first.enrich(PROVIDER_ID.OPENCODE, [observation], "host-local");

  // A drawn row keeps advertising its acts until the next enrichment pass
  // commits, so the fresh snapshot must answer them before that pass runs.
  const second = await reader.read();
  assert.equal(second.actableContext(PROVIDER_ID.OPENCODE, "ses_grok", "host-local"), undefined);
  second.adoptDirectoryMatches(first);
  assert.equal(
    second.actableContext(PROVIDER_ID.OPENCODE, "ses_grok", "host-local")?.workspaceId,
    "workspace-1",
  );

  // The observation is the match's whole authority: a chat re-observed
  // somewhere else loses the adopted entry on the same pass.
  second.enrich(
    PROVIDER_ID.OPENCODE,
    [{ ...observation, directory: "/Users/test/elsewhere" }],
    "host-local",
  );
  assert.equal(second.actableContext(PROVIDER_ID.OPENCODE, "ses_grok", "host-local"), undefined);

  // A worktree gone from the latest read anchors nothing, however recently
  // it was matched.
  const archived = await writeHostDatabase(home, "host-local");
  archived.exec("UPDATE workspaces SET archived_at = 300");
  archived.close();
  const third = await reader.read();
  third.adoptDirectoryMatches(first);
  assert.equal(third.actableContext(PROVIDER_ID.OPENCODE, "ses_grok", "host-local"), undefined);
});

test("path matching claims only live worktrees, never the main checkout or an archive", async (t) => {
  const home = await temporarySupersetHome(t);
  const database = await writeHostDatabase(home, "host-local");
  createSchema(database);
  database.exec(`
    INSERT INTO workspaces (id, project_id, pull_request_id, name, branch, updated_at, type, archived_at, worktree_path) VALUES
      ('workspace-main', NULL, NULL, 'main', 'main', 500, 'main', NULL, '/Users/test/luke'),
      ('workspace-archived', NULL, NULL, 'filed-away', 'old', 400, 'worktree', 350,
       '/Users/test/.superset/worktrees/repo-1/filed-away');
  `);
  database.close();

  const snapshot = await new SupersetWorkspaceReader({ homeDirectory: home }).read();
  for (const directory of [
    "/Users/test/luke",
    "/Users/test/.superset/worktrees/repo-1/filed-away",
  ]) {
    const enriched = snapshot.enrich(
      PROVIDER_ID.OPENCODE,
      [
        {
          providerSessionId: `ses_${directory}`,
          title: "By hand",
          status: SESSION_STATUS.WAITING,
          observedAt: 100,
          directory,
        },
      ],
      "host-local",
    )[0];
    assert.equal(enriched?.workspace, undefined);
  }
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
      INSERT INTO workspaces (id, project_id, pull_request_id, name, branch, updated_at) VALUES (
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
    INSERT INTO workspaces (id, project_id, pull_request_id, name, branch, updated_at)
      VALUES ('workspace-1', NULL, NULL, 'power-vacation', 'main', 100);
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
    INSERT INTO workspaces (id, project_id, pull_request_id, name, branch, updated_at)
      VALUES ('workspace-1', NULL, NULL, 'power-vacation', 'main', 100);
    INSERT INTO terminal_agent_bindings VALUES (
      'terminal-1', 'workspace-1', 'mystery-agent', 'session-1', 'Start'
    );
  `);
  database.close();

  const snapshot = await new SupersetWorkspaceReader({ homeDirectory: home }).read();
  assert.equal(snapshot.context(PROVIDER_ID.CODEX, "session-1"), undefined);
});

test("reports a chatless workspace as its own standing, settled row", async (t) => {
  const home = await temporarySupersetHome(t);
  const database = await writeHostDatabase(home, "host-local");
  createSchema(database);
  database.exec(`
    INSERT INTO projects VALUES ('project-1', 'Luke');
    INSERT INTO pull_requests VALUES ('pr-1', 'https://github.com/example/luke/pull/42');
    INSERT INTO workspaces (id, project_id, pull_request_id, name, branch, updated_at) VALUES
      ('workspace-idle', 'project-1', 'pr-1', 'grok-bot-support', 'grok-bot', 300);
    INSERT INTO host_agent_configs VALUES ('claude', 0), ('codex', 1);
  `);
  database.close();

  const snapshot = await new SupersetWorkspaceReader({ homeDirectory: home }).read();
  // Signed out, the row still observes — host state needs no login — but
  // advertises no act, the same posture a bound chat's enrichment keeps.
  assert.deepEqual(snapshot.workspaceRowObservations(undefined), [
    {
      providerSessionId: "workspace-idle",
      title: "grok-bot-support",
      status: SESSION_STATUS.COMPLETE,
      observedAt: 300,
      standing: true,
      detail: {
        link: "superset://v2-workspace/workspace-idle",
        repository: "Luke",
        branch: "grok-bot",
        change: "https://github.com/example/luke/pull/42",
      },
      applications: [
        {
          id: SESSION_APPLICATION_ID.SUPERSET,
          displayName: "Superset",
          scope: SESSION_APPLICATION_SCOPE.WORKSPACE,
          link: "superset://v2-workspace/workspace-idle",
        },
      ],
      workspace: {
        providerWorkspaceId: "workspace-idle",
        name: "grok-bot-support",
        scopeId: SUPERSET_WORKSPACE_PROVIDER_ID,
        managerName: "Superset",
      },
    },
  ]);

  const connected = snapshot.workspaceRowObservations("host-local")[0];
  assert.deepEqual(connected?.controls, [
    {
      id: SUPERSET_CONTROL_ID.DELETE_WORKSPACE,
      label: "Delete workspace",
      target: "workspace-idle",
    },
  ]);
  assert.equal(connected?.renameTarget, "workspace-idle");
  assert.deepEqual(connected?.spawnableAgents, ["claude", "codex"]);
  assert.equal(connected?.spawnTarget, "workspace-idle");
  assert.equal(connected?.canReceiveMessage, undefined);
  assert.equal(snapshot.workspaceRowObservations("org-other")[0]?.controls, undefined);

  // The act router resolves the row like any managed session, terminal-less.
  const context = snapshot.actableContext(
    SUPERSET_WORKSPACE_PROVIDER_ID,
    "workspace-idle",
    "host-local",
  );
  assert.equal(context?.workspaceId, "workspace-idle");
  assert.equal(context?.terminalId, undefined);
  assert.equal(
    snapshot.actableContext(SUPERSET_WORKSPACE_PROVIDER_ID, "workspace-idle", "org-other"),
    undefined,
  );
});

test("keeps the main checkout, archived, and chat-bound workspaces off the workspace rows", async (t) => {
  const home = await temporarySupersetHome(t);
  const database = await writeHostDatabase(home, "host-local");
  createSchema(database);
  database.exec(`
    INSERT INTO workspaces (id, project_id, pull_request_id, name, branch, updated_at, type, archived_at) VALUES
      ('workspace-main', NULL, NULL, 'main', 'main', 500, 'main', NULL),
      ('workspace-archived', NULL, NULL, 'filed-away', 'old-branch', 400, 'worktree', 350),
      ('workspace-bound', NULL, NULL, 'has-a-chat', 'chat-branch', 300, 'worktree', NULL),
      ('workspace-shadowed', NULL, NULL, 'unmapped-agent', 'shadow-branch', 200, 'worktree', NULL),
      ('workspace-idle', NULL, NULL, 'truly-idle', 'idle-branch', 100, 'worktree', NULL);
    INSERT INTO terminal_agent_bindings VALUES
      ('terminal-1', 'workspace-bound', 'claude', 'session-1', 'Stop'),
      ('terminal-2', 'workspace-shadowed', 'mystery-agent', NULL, 'Start');
  `);
  database.close();

  const snapshot = await new SupersetWorkspaceReader({ homeDirectory: home }).read();
  // Only the truly idle worktree earns a row: the main checkout is the user's
  // own working copy, the archived one Superset already filed away, and any
  // agent terminal — even one Luke cannot map, which could be mid-turn
  // invisibly — means the workspace is not settled by construction.
  assert.deepEqual(
    snapshot.workspaceRowObservations("host-local").map((row) => row.providerSessionId),
    ["workspace-idle"],
  );
});

test("a host database without the workspace columns loses only the chatless rows", async (t) => {
  const home = await temporarySupersetHome(t);
  const database = await writeHostDatabase(home, "host-local");
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
    CREATE TABLE host_agent_configs (preset_id TEXT, display_order INTEGER NOT NULL);
    INSERT INTO workspaces VALUES ('workspace-1', NULL, NULL, 'power-vacation', 'main', 100);
    INSERT INTO terminal_agent_bindings VALUES
      ('terminal-1', 'workspace-1', 'codex', 'session-1', 'Start');
  `);
  database.close();

  const snapshot = await new SupersetWorkspaceReader({ homeDirectory: home }).read();
  assert.equal(snapshot.context(PROVIDER_ID.CODEX, "session-1")?.workspaceId, "workspace-1");
  assert.deepEqual(snapshot.workspaceRowObservations("host-local"), []);
});

test("attaches Superset's Gemini terminals to Gemini CLI rows", async (t) => {
  const home = await temporarySupersetHome(t);
  const database = await writeHostDatabase(home, "host-local");
  createSchema(database);
  database.exec(`
    INSERT INTO workspaces (id, project_id, pull_request_id, name, branch, updated_at)
      VALUES ('workspace-1', NULL, NULL, 'power-vacation', 'main', 100);
    INSERT INTO terminal_agent_bindings VALUES (
      'terminal-1', 'workspace-1', 'gemini', 'session-1', 'Start'
    );
  `);
  database.close();

  const snapshot = await new SupersetWorkspaceReader({ homeDirectory: home }).read();
  assert.equal(snapshot.context(PROVIDER_ID.GEMINI_CLI, "session-1")?.workspaceId, "workspace-1");
});
