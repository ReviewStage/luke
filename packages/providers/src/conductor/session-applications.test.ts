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
import { ConductorSessionApplicationReader } from "./session-applications.js";

const TEST_CONDUCTOR_AGENT_TYPE = {
  CLAUDE: "claude",
  CODEX: "codex",
  CURSOR: "cursor",
  OPENCODE: "opencode",
} as const;

async function temporaryDatabasePath(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luke-conductor-client-"));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return path.join(directory, "conductor.db");
}

function createConductorDatabase(databasePath: string): DatabaseSync {
  const database = new DatabaseSync(databasePath, {});
  database.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      claude_session_id TEXT,
      agent_type TEXT,
      workspace_id TEXT
    );
    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY,
      workspace_name TEXT,
      directory_name TEXT
    );
  `);
  return database;
}

/** The schema from before Conductor stored workspaces, for the fallback read. */
function createLegacyConductorDatabase(databasePath: string): DatabaseSync {
  const database = new DatabaseSync(databasePath, {});
  database.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      claude_session_id TEXT,
      agent_type TEXT
    );
  `);
  return database;
}

function writeSession(
  database: DatabaseSync,
  id: string,
  providerSessionId: string,
  agentType: string,
  workspaceId?: string,
): void {
  database
    .prepare(
      "INSERT INTO sessions (id, claude_session_id, agent_type, workspace_id) VALUES (?, ?, ?, ?)",
    )
    .run(id, providerSessionId, agentType, workspaceId ?? null);
}

function writeWorkspace(
  database: DatabaseSync,
  id: string,
  workspaceName: string | undefined,
  directoryName: string,
): void {
  database
    .prepare("INSERT INTO workspaces (id, workspace_name, directory_name) VALUES (?, ?, ?)")
    .run(id, workspaceName ?? null, directoryName);
}

test("indexes supported provider session ids from Conductor records", async (t) => {
  const databasePath = await temporaryDatabasePath(t);
  const database = createConductorDatabase(databasePath);
  try {
    writeSession(database, "conductor-codex", "codex-local", TEST_CONDUCTOR_AGENT_TYPE.CODEX);
    writeSession(database, "conductor-claude", "claude-local", TEST_CONDUCTOR_AGENT_TYPE.CLAUDE);
    writeSession(database, "conductor-cursor", "cursor-local", TEST_CONDUCTOR_AGENT_TYPE.CURSOR);
    writeSession(
      database,
      "conductor-opencode",
      "opencode-local",
      TEST_CONDUCTOR_AGENT_TYPE.OPENCODE,
    );
  } finally {
    database.close();
  }

  const snapshot = await new ConductorSessionApplicationReader({ databasePath }).read();
  for (const [providerId, providerSessionId] of [
    [PROVIDER_ID.CODEX, "codex-local"],
    [PROVIDER_ID.CLAUDE_CODE, "claude-local"],
    [PROVIDER_ID.CURSOR, "cursor-local"],
    [PROVIDER_ID.OPENCODE, "opencode-local"],
  ] as const) {
    assert.equal(snapshot.has(providerId, providerSessionId), true);
  }

  assert.equal(snapshot.has(PROVIDER_ID.CLAUDE_CODE, "codex-local"), false);
  assert.equal(snapshot.has(PROVIDER_ID.DEVIN, "devin-local"), false);
});

test("a missing Conductor schema leaves provider observations intact", async (t) => {
  const databasePath = await temporaryDatabasePath(t);
  const database = new DatabaseSync(databasePath, {});
  database.exec("CREATE TABLE unrelated (id TEXT PRIMARY KEY)");
  database.close();

  const snapshot = await new ConductorSessionApplicationReader({ databasePath }).read();
  assert.equal(snapshot.has(PROVIDER_ID.CODEX, "codex-local"), false);
});

test("annotates matching local observations and their spawned descendants", async (t) => {
  const databasePath = await temporaryDatabasePath(t);
  const database = createConductorDatabase(databasePath);
  try {
    writeSession(database, "local-row", "local", TEST_CONDUCTOR_AGENT_TYPE.CODEX);
    writeSession(database, "cloud-row", "cloud", TEST_CONDUCTOR_AGENT_TYPE.CODEX);
  } finally {
    database.close();
  }
  const snapshot = await new ConductorSessionApplicationReader({ databasePath }).read();
  const observations = snapshot.enrich(PROVIDER_ID.CODEX, [
    {
      providerSessionId: "local",
      title: "Local",
      status: SESSION_STATUS.WORKING,
      observedAt: 1,
      applications: [
        {
          id: SESSION_APPLICATION_ID.CHATGPT,
          displayName: "ChatGPT",
          scope: SESSION_APPLICATION_SCOPE.SESSION,
          link: "codex://threads/local",
        },
      ],
    },
    {
      providerSessionId: "child",
      parentProviderSessionId: "local",
      title: "Child",
      status: SESSION_STATUS.WORKING,
      observedAt: 1,
    },
    {
      providerSessionId: "grandchild",
      parentProviderSessionId: "child",
      title: "Grandchild",
      status: SESSION_STATUS.WORKING,
      observedAt: 1,
    },
    {
      providerSessionId: "cloud",
      parentProviderSessionId: "local",
      title: "Cloud",
      status: SESSION_STATUS.WORKING,
      observedAt: 1,
      location: SESSION_LOCATION.CLOUD,
    },
    {
      providerSessionId: "other",
      title: "Other",
      status: SESSION_STATUS.WORKING,
      observedAt: 1,
    },
  ]);

  assert.deepEqual(observations[0]?.applications, [
    {
      id: SESSION_APPLICATION_ID.CHATGPT,
      displayName: "ChatGPT",
      scope: SESSION_APPLICATION_SCOPE.SESSION,
      link: "codex://threads/local",
    },
    {
      id: SESSION_APPLICATION_ID.CONDUCTOR,
      displayName: "Conductor",
      scope: SESSION_APPLICATION_SCOPE.SESSION,
    },
  ]);
  assert.deepEqual(observations[1]?.applications, [
    {
      id: SESSION_APPLICATION_ID.CONDUCTOR,
      displayName: "Conductor",
      scope: SESSION_APPLICATION_SCOPE.SESSION,
    },
  ]);
  assert.deepEqual(observations[2]?.applications, observations[1]?.applications);
  assert.equal(observations[3]?.applications, undefined);
  assert.equal(observations[4]?.applications, undefined);
});

test("a missing parent row and a cyclic parent graph remain bounded", async (t) => {
  const databasePath = await temporaryDatabasePath(t);
  const database = createConductorDatabase(databasePath);
  try {
    writeSession(database, "local-row", "local", TEST_CONDUCTOR_AGENT_TYPE.CODEX);
  } finally {
    database.close();
  }
  const snapshot = await new ConductorSessionApplicationReader({ databasePath }).read();
  const observations = snapshot.enrich(PROVIDER_ID.CODEX, [
    {
      providerSessionId: "orphaned-child",
      parentProviderSessionId: "local",
      title: "Orphaned child",
      status: SESSION_STATUS.WORKING,
      observedAt: 1,
    },
    {
      providerSessionId: "cycle-a",
      parentProviderSessionId: "cycle-b",
      title: "Cycle A",
      status: SESSION_STATUS.WORKING,
      observedAt: 1,
    },
    {
      providerSessionId: "cycle-b",
      parentProviderSessionId: "cycle-a",
      title: "Cycle B",
      status: SESSION_STATUS.WORKING,
      observedAt: 1,
    },
  ]);

  assert.deepEqual(observations[0]?.applications, [
    {
      id: SESSION_APPLICATION_ID.CONDUCTOR,
      displayName: "Conductor",
      scope: SESSION_APPLICATION_SCOPE.SESSION,
    },
  ]);
  assert.equal(observations[1]?.applications, undefined);
  assert.equal(observations[2]?.applications, undefined);
});

const OBSERVED_CHAT = {
  providerSessionId: "local",
  title: "Local",
  status: SESSION_STATUS.WORKING,
  observedAt: 1,
} as const;

test("groups a matched chat under its Conductor workspace like a manager", async (t) => {
  const databasePath = await temporaryDatabasePath(t);
  const database = createConductorDatabase(databasePath);
  try {
    writeWorkspace(database, "workspace-named", "lisbon-v2", "kingstown");
    writeWorkspace(database, "workspace-plain", undefined, "kingstown");
    writeSession(
      database,
      "chat-named",
      "local",
      TEST_CONDUCTOR_AGENT_TYPE.CLAUDE,
      "workspace-named",
    );
    writeSession(
      database,
      "chat-plain",
      "sibling",
      TEST_CONDUCTOR_AGENT_TYPE.CLAUDE,
      "workspace-plain",
    );
  } finally {
    database.close();
  }
  const snapshot = await new ConductorSessionApplicationReader({ databasePath }).read();
  const observations = snapshot.enrich(PROVIDER_ID.CLAUDE_CODE, [
    OBSERVED_CHAT,
    { ...OBSERVED_CHAT, providerSessionId: "sibling", title: "Sibling" },
  ]);

  // The workspace carries the mark, so the association's scope follows it —
  // and the name falls back to the directory Conductor itself falls back to.
  assert.deepEqual(observations[0]?.workspace, {
    providerWorkspaceId: "workspace-named",
    name: "lisbon-v2",
    scopeId: SESSION_APPLICATION_ID.CONDUCTOR,
    managerName: "Conductor",
  });
  assert.deepEqual(observations[0]?.applications, [
    {
      id: SESSION_APPLICATION_ID.CONDUCTOR,
      displayName: "Conductor",
      scope: SESSION_APPLICATION_SCOPE.WORKSPACE,
      link: "conductor://workspace?id=workspace-named&session=chat-named",
    },
  ]);
  // The composed address is also the row's own press, because the chat's
  // provider — a local one — reported none of its own.
  assert.equal(
    observations[0]?.detail?.link,
    "conductor://workspace?id=workspace-named&session=chat-named",
  );
  assert.equal(observations[1]?.workspace?.name, "kingstown");
  assert.equal(
    observations[1]?.detail?.link,
    "conductor://workspace?id=workspace-plain&session=chat-plain",
  );
});

test("a provider-reported address keeps the row press; the mark keeps its own", async (t) => {
  const databasePath = await temporaryDatabasePath(t);
  const database = createConductorDatabase(databasePath);
  try {
    writeWorkspace(database, "workspace-named", "lisbon-v2", "kingstown");
    writeSession(
      database,
      "chat-named",
      "local",
      TEST_CONDUCTOR_AGENT_TYPE.CLAUDE,
      "workspace-named",
    );
  } finally {
    database.close();
  }
  const snapshot = await new ConductorSessionApplicationReader({ databasePath }).read();
  const observations = snapshot.enrich(PROVIDER_ID.CLAUDE_CODE, [
    { ...OBSERVED_CHAT, detail: { link: "https://example.com/session/local" } },
  ]);

  assert.equal(observations[0]?.detail?.link, "https://example.com/session/local");
  assert.equal(
    observations[0]?.applications?.[0]?.link,
    "conductor://workspace?id=workspace-named&session=chat-named",
  );
});

test("a spawned descendant inherits its ancestor's Conductor workspace", async (t) => {
  const databasePath = await temporaryDatabasePath(t);
  const database = createConductorDatabase(databasePath);
  try {
    writeWorkspace(database, "workspace-parent", "lisbon-v2", "kingstown");
    writeSession(
      database,
      "chat-parent",
      "local",
      TEST_CONDUCTOR_AGENT_TYPE.CODEX,
      "workspace-parent",
    );
  } finally {
    database.close();
  }
  const snapshot = await new ConductorSessionApplicationReader({ databasePath }).read();
  const observations = snapshot.enrich(PROVIDER_ID.CODEX, [
    OBSERVED_CHAT,
    {
      ...OBSERVED_CHAT,
      providerSessionId: "child",
      parentProviderSessionId: "local",
      title: "Child",
    },
  ]);

  assert.deepEqual(observations[1]?.workspace, observations[0]?.workspace);
  assert.deepEqual(observations[1]?.applications, observations[0]?.applications);
  // The inherited address is the ancestor chat's, where the sub-agent's
  // conversation actually lives in Conductor's own window.
  assert.equal(
    observations[1]?.detail?.link,
    "conductor://workspace?id=workspace-parent&session=chat-parent",
  );
});

test("keeps another manager's workspace and stays on the row instead", async (t) => {
  const databasePath = await temporaryDatabasePath(t);
  const database = createConductorDatabase(databasePath);
  try {
    writeWorkspace(database, "workspace-conductor", "lisbon-v2", "kingstown");
    writeSession(
      database,
      "chat-managed",
      "local",
      TEST_CONDUCTOR_AGENT_TYPE.CLAUDE,
      "workspace-conductor",
    );
  } finally {
    database.close();
  }
  const supersetWorkspace = {
    providerWorkspaceId: "workspace-superset",
    name: "power-vacation",
    scopeId: "superset",
    managerName: "Superset",
  };
  const snapshot = await new ConductorSessionApplicationReader({ databasePath }).read();
  const observations = snapshot.enrich(PROVIDER_ID.CLAUDE_CODE, [
    { ...OBSERVED_CHAT, workspace: supersetWorkspace },
  ]);

  // The first manager to group the chat keeps it; Conductor still identifies
  // itself, on the row, where no tray header would carry its mark — and the
  // mark keeps the chat's own Conductor address either way.
  assert.deepEqual(observations[0]?.workspace, supersetWorkspace);
  assert.deepEqual(observations[0]?.applications, [
    {
      id: SESSION_APPLICATION_ID.CONDUCTOR,
      displayName: "Conductor",
      scope: SESSION_APPLICATION_SCOPE.SESSION,
      link: "conductor://workspace?id=workspace-conductor&session=chat-managed",
    },
  ]);
});

test("a schema from before workspaces still annotates, without grouping", async (t) => {
  const databasePath = await temporaryDatabasePath(t);
  const database = createLegacyConductorDatabase(databasePath);
  try {
    database
      .prepare("INSERT INTO sessions (id, claude_session_id, agent_type) VALUES (?, ?, ?)")
      .run("chat-legacy", "local", TEST_CONDUCTOR_AGENT_TYPE.CLAUDE);
  } finally {
    database.close();
  }
  const snapshot = await new ConductorSessionApplicationReader({ databasePath }).read();
  const observations = snapshot.enrich(PROVIDER_ID.CLAUDE_CODE, [OBSERVED_CHAT]);

  assert.equal(observations[0]?.workspace, undefined);
  assert.deepEqual(observations[0]?.applications, [
    {
      id: SESSION_APPLICATION_ID.CONDUCTOR,
      displayName: "Conductor",
      scope: SESSION_APPLICATION_SCOPE.SESSION,
    },
  ]);
});
