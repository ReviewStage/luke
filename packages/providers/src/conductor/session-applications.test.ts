import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import {
  HOSTED_AGENT_ID,
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
      workspace_id TEXT,
      title TEXT DEFAULT 'Untitled',
      is_hidden INTEGER DEFAULT 0
    );
    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY,
      workspace_name TEXT,
      pr_title TEXT,
      directory_name TEXT,
      state TEXT DEFAULT 'active'
    );
  `);
  return database;
}

/** The schema from before Conductor titled chats, for the middle fallback read. */
function createConductorDatabaseWithoutTitles(databasePath: string): DatabaseSync {
  const database = new DatabaseSync(databasePath, {});
  database.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      claude_session_id TEXT,
      agent_type TEXT,
      workspace_id TEXT,
      is_hidden INTEGER DEFAULT 0
    );
    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY,
      workspace_name TEXT,
      pr_title TEXT,
      directory_name TEXT,
      state TEXT DEFAULT 'active'
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
  options?: { title?: string; hidden?: boolean },
): void {
  database
    .prepare(
      "INSERT INTO sessions (id, claude_session_id, agent_type, workspace_id, title, is_hidden) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(
      id,
      providerSessionId,
      agentType,
      workspaceId ?? null,
      options?.title ?? "Untitled",
      options?.hidden ? 1 : 0,
    );
}

function writeWorkspace(
  database: DatabaseSync,
  id: string,
  workspaceName: string | undefined,
  directoryName: string,
  options?: { prTitle?: string; state?: string },
): void {
  database
    .prepare(
      "INSERT INTO workspaces (id, workspace_name, pr_title, directory_name, state) VALUES (?, ?, ?, ?, ?)",
    )
    .run(
      id,
      workspaceName ?? null,
      options?.prTitle ?? null,
      directoryName,
      options?.state ?? "active",
    );
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
    [HOSTED_AGENT_ID.CURSOR, "cursor-local"],
    [HOSTED_AGENT_ID.OPENCODE, "opencode-local"],
  ] as const) {
    assert.equal(snapshot.has(providerId, providerSessionId), true);
  }

  assert.equal(snapshot.has(PROVIDER_ID.CLAUDE_CODE, "codex-local"), false);
  assert.equal(snapshot.has(PROVIDER_ID.OMP, "omp-local"), false);
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
      lastActivityAt: 1,
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
      lastActivityAt: 1,
    },
    {
      providerSessionId: "grandchild",
      parentProviderSessionId: "child",
      title: "Grandchild",
      status: SESSION_STATUS.WORKING,
      lastActivityAt: 1,
    },
    {
      providerSessionId: "cloud",
      parentProviderSessionId: "local",
      title: "Cloud",
      status: SESSION_STATUS.WORKING,
      lastActivityAt: 1,
      location: SESSION_LOCATION.CLOUD,
    },
    {
      providerSessionId: "other",
      title: "Other",
      status: SESSION_STATUS.WORKING,
      lastActivityAt: 1,
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
      lastActivityAt: 1,
    },
    {
      providerSessionId: "cycle-a",
      parentProviderSessionId: "cycle-b",
      title: "Cycle A",
      status: SESSION_STATUS.WORKING,
      lastActivityAt: 1,
    },
    {
      providerSessionId: "cycle-b",
      parentProviderSessionId: "cycle-a",
      title: "Cycle B",
      status: SESSION_STATUS.WORKING,
      lastActivityAt: 1,
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
  lastActivityAt: 1,
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

  // The workspace claim carries the manager's mark on the tray header, and
  // the name falls back to the directory Conductor itself falls back to. The
  // association stays the session's own — its address names the exact chat —
  // so its mark rides the row even inside the tray.
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
      scope: SESSION_APPLICATION_SCOPE.SESSION,
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

test("a nameless workspace groups under its PR title before its directory", async (t) => {
  const databasePath = await temporaryDatabasePath(t);
  const database = createConductorDatabase(databasePath);
  try {
    writeWorkspace(database, "workspace-pr", undefined, "kingstown", {
      prTitle: "fix(panel): keep the tray label honest",
    });
    writeWorkspace(database, "workspace-chosen", "lisbon-v2", "kingstown", {
      prTitle: "feat(panel): the PR a chosen name outranks",
    });
    writeSession(database, "chat-pr", "local", TEST_CONDUCTOR_AGENT_TYPE.CLAUDE, "workspace-pr");
    writeSession(
      database,
      "chat-chosen",
      "sibling",
      TEST_CONDUCTOR_AGENT_TYPE.CLAUDE,
      "workspace-chosen",
    );
  } finally {
    database.close();
  }
  const snapshot = await new ConductorSessionApplicationReader({ databasePath }).read();
  const observations = snapshot.enrich(PROVIDER_ID.CLAUDE_CODE, [
    OBSERVED_CHAT,
    { ...OBSERVED_CHAT, providerSessionId: "sibling", title: "Sibling" },
  ]);

  // The ladder is Conductor's own sidebar's: the PR title names work nobody
  // named directly, and a chosen workspace name still outranks it.
  assert.equal(observations[0]?.workspace?.name, "fix(panel): keep the tray label honest");
  assert.equal(observations[1]?.workspace?.name, "lisbon-v2");
});

test("titles a matched chat by the name Conductor gave it", async (t) => {
  const databasePath = await temporaryDatabasePath(t);
  const database = createConductorDatabase(databasePath);
  try {
    writeSession(database, "chat-named", "local", TEST_CONDUCTOR_AGENT_TYPE.CLAUDE, undefined, {
      title: "Fix the transcript parser",
    });
    writeSession(database, "chat-unnamed", "sibling", TEST_CONDUCTOR_AGENT_TYPE.CLAUDE);
  } finally {
    database.close();
  }
  const snapshot = await new ConductorSessionApplicationReader({ databasePath }).read();
  const observations = snapshot.enrich(PROVIDER_ID.CLAUDE_CODE, [
    OBSERVED_CHAT,
    { ...OBSERVED_CHAT, providerSessionId: "sibling", title: "Sibling" },
  ]);

  // The name the user reads in Conductor's own sidebar titles the row, the
  // way it titles a cloud-observed chat's.
  assert.equal(observations[0]?.title, "Fix the transcript parser");
  // The schema's default is the absence of a name rather than one anybody
  // chose, so the provider's own title keeps the row.
  assert.equal(observations[1]?.title, "Sibling");
});

test("the annotation fills only an absent row link; precedence is not its call", async (t) => {
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
    {
      ...OBSERVED_CHAT,
      detail: { link: "codex://threads/local" },
      applications: [
        {
          id: SESSION_APPLICATION_ID.CHATGPT,
          displayName: "ChatGPT",
          scope: SESSION_APPLICATION_SCOPE.SESSION,
          link: "codex://threads/local",
        },
      ],
    },
  ]);

  // The annotation itself never rewrites a press another hand gave the row:
  // Conductor's precedence over the agent's own app is the session
  // normalization's call, made from the grouping — the manager's mark leads
  // and the press follows the first linked mark — so each association here
  // only carries its own exact route.
  assert.equal(observations[0]?.detail?.link, "codex://threads/local");
  assert.equal(observations[0]?.applications?.[0]?.link, "codex://threads/local");
  assert.equal(
    observations[0]?.applications?.[1]?.link,
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
      { title: "Rework the pipeline" },
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
  // The chat's Conductor name is the chat's alone: the sub-agent keeps its
  // own title rather than reading as the same conversation twice.
  assert.equal(observations[0]?.title, "Rework the pipeline");
  assert.equal(observations[1]?.title, "Child");
});

test("a schema from before chat titles still annotates and groups", async (t) => {
  const databasePath = await temporaryDatabasePath(t);
  const database = createConductorDatabaseWithoutTitles(databasePath);
  try {
    writeWorkspace(database, "workspace-named", "lisbon-v2", "kingstown");
    database
      .prepare(
        "INSERT INTO sessions (id, claude_session_id, agent_type, workspace_id) VALUES (?, ?, ?, ?)",
      )
      .run("chat-untitled", "local", TEST_CONDUCTOR_AGENT_TYPE.CLAUDE, "workspace-named");
  } finally {
    database.close();
  }
  const snapshot = await new ConductorSessionApplicationReader({ databasePath }).read();
  const observations = snapshot.enrich(PROVIDER_ID.CLAUDE_CODE, [OBSERVED_CHAT]);

  assert.equal(observations[0]?.title, "Local");
  assert.equal(observations[0]?.workspace?.name, "lisbon-v2");
  assert.equal(
    observations[0]?.applications?.[0]?.link,
    "conductor://workspace?id=workspace-named&session=chat-untitled",
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
    {
      ...OBSERVED_CHAT,
      workspace: supersetWorkspace,
      detail: { link: "superset://workspace/workspace-superset" },
    },
  ]);

  // The first manager to group the chat keeps it — its press included:
  // Conductor outranks only the chat's agent's own app, never another
  // manager. Conductor still identifies itself, on the row, and the mark
  // keeps the chat's own Conductor address either way.
  assert.deepEqual(observations[0]?.workspace, supersetWorkspace);
  assert.equal(observations[0]?.detail?.link, "superset://workspace/workspace-superset");
  assert.deepEqual(observations[0]?.applications, [
    {
      id: SESSION_APPLICATION_ID.CONDUCTOR,
      displayName: "Conductor",
      scope: SESSION_APPLICATION_SCOPE.SESSION,
      link: "conductor://workspace?id=workspace-conductor&session=chat-managed",
    },
  ]);
});

test("drops chats filed away in Conductor: hidden chats and archived workspaces", async (t) => {
  const databasePath = await temporaryDatabasePath(t);
  const database = createConductorDatabase(databasePath);
  try {
    writeWorkspace(database, "workspace-open", "lisbon-v2", "kingstown", { state: "ready" });
    writeWorkspace(database, "workspace-filed", "adana-v1", "kingstown", {
      state: "archived",
    });
    writeSession(database, "chat-open", "open", TEST_CONDUCTOR_AGENT_TYPE.CLAUDE, "workspace-open");
    writeSession(
      database,
      "chat-hidden",
      "hidden",
      TEST_CONDUCTOR_AGENT_TYPE.CLAUDE,
      "workspace-open",
      { hidden: true },
    );
    writeSession(
      database,
      "chat-archived",
      "archived",
      TEST_CONDUCTOR_AGENT_TYPE.CLAUDE,
      "workspace-filed",
    );
  } finally {
    database.close();
  }
  const snapshot = await new ConductorSessionApplicationReader({ databasePath }).read();
  const observations = snapshot.enrich(PROVIDER_ID.CLAUDE_CODE, [
    { ...OBSERVED_CHAT, providerSessionId: "open", title: "Open" },
    { ...OBSERVED_CHAT, providerSessionId: "hidden", title: "Hidden" },
    { ...OBSERVED_CHAT, providerSessionId: "archived", title: "Archived" },
    // A sub-agent of a filed-away chat was filed away with its parent.
    {
      ...OBSERVED_CHAT,
      providerSessionId: "archived-child",
      parentProviderSessionId: "archived",
      title: "Archived child",
    },
    // A cloud row with a coincidentally equal provider id is never Conductor's.
    {
      ...OBSERVED_CHAT,
      providerSessionId: "archived",
      title: "Cloud twin",
      location: SESSION_LOCATION.CLOUD,
    },
  ]);

  assert.deepEqual(
    observations.map((observation) => observation.title),
    ["Open", "Cloud twin"],
  );
  assert.deepEqual(observations[0]?.workspace, {
    providerWorkspaceId: "workspace-open",
    name: "lisbon-v2",
    scopeId: SESSION_APPLICATION_ID.CONDUCTOR,
    managerName: "Conductor",
  });
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
