import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  PROVIDER_ID,
  SESSION_APPLICATION_ID,
  SESSION_APPLICATION_SCOPE,
  SESSION_LOCATION,
  SESSION_STATUS,
} from "@sidecar/session";
import { OrcaWorkspaceReader } from "./workspaces.js";

const TEST_ORCA_AGENT_TYPE = {
  CLAUDE: "claude",
  CODEX: "codex",
  CURSOR: "cursor",
  DEVIN: "devin",
  OPENCODE: "opencode",
} as const;

const TEST_WORKTREE_ID = "repo-1::/Users/test/worktrees/notch-geometry";

async function temporaryOrcaDirectory(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luke-orca-"));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

interface HookStatusEntry {
  sessionId?: string;
  agentType?: string;
  worktreeId?: string;
  receivedAt?: number;
}

/** The slice of Orca's persisted hook-status entry the reader observes. */
interface SyntheticHookStatusEntry {
  paneKey: string;
  connectionId: null;
  worktreeId?: string;
  providerSession?: { key: string; id: string };
  receivedAt?: number;
  stateStartedAt: number;
  payload: { state: string; prompt: string; agentType?: string };
}

function hookStatusEntry(entry: HookStatusEntry): SyntheticHookStatusEntry {
  return {
    paneKey: "tab-1:leaf-1",
    connectionId: null,
    ...(entry.worktreeId ? { worktreeId: entry.worktreeId } : undefined),
    ...(entry.sessionId
      ? { providerSession: { key: "session_id", id: entry.sessionId } }
      : undefined),
    ...(entry.receivedAt !== undefined ? { receivedAt: entry.receivedAt } : undefined),
    stateStartedAt: entry.receivedAt ?? 1,
    payload: {
      state: "done",
      prompt: "",
      ...(entry.agentType ? { agentType: entry.agentType } : undefined),
    },
  };
}

async function writeHookStatus(
  directory: string,
  entries: Record<string, SyntheticHookStatusEntry>,
  version = 2,
): Promise<void> {
  const hookDirectory = path.join(directory, "agent-hooks");
  await fs.mkdir(hookDirectory, { recursive: true });
  await fs.writeFile(
    path.join(hookDirectory, "last-status.json"),
    JSON.stringify({ version, entries }),
  );
}

/** The slice of Orca's persisted worktree metadata the reader observes. */
interface SyntheticWorktreeMeta {
  displayName: string;
  comment?: string;
  isArchived?: boolean;
}

async function writeOrcaState(
  directory: string,
  worktreeMeta: Record<string, SyntheticWorktreeMeta>,
): Promise<void> {
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "orca-data.json"), JSON.stringify({ worktreeMeta }));
}

test("indexes supported provider session ids from Orca's hook status", async (t) => {
  const directory = await temporaryOrcaDirectory(t);
  await writeHookStatus(directory, {
    "tab-1:leaf-1": hookStatusEntry({
      sessionId: "claude-local",
      agentType: TEST_ORCA_AGENT_TYPE.CLAUDE,
      worktreeId: TEST_WORKTREE_ID,
      receivedAt: 1,
    }),
    "tab-2:leaf-1": hookStatusEntry({
      sessionId: "codex-local",
      agentType: TEST_ORCA_AGENT_TYPE.CODEX,
      worktreeId: TEST_WORKTREE_ID,
      receivedAt: 1,
    }),
    "tab-3:leaf-1": hookStatusEntry({
      sessionId: "cursor-local",
      agentType: TEST_ORCA_AGENT_TYPE.CURSOR,
      worktreeId: TEST_WORKTREE_ID,
      receivedAt: 1,
    }),
    "tab-4:leaf-1": hookStatusEntry({
      sessionId: "devin-local",
      agentType: TEST_ORCA_AGENT_TYPE.DEVIN,
      worktreeId: TEST_WORKTREE_ID,
      receivedAt: 1,
    }),
    "tab-5:leaf-1": hookStatusEntry({
      sessionId: "opencode-local",
      agentType: TEST_ORCA_AGENT_TYPE.OPENCODE,
      worktreeId: TEST_WORKTREE_ID,
      receivedAt: 1,
    }),
    "tab-6:leaf-1": hookStatusEntry({
      sessionId: "gemini-local",
      agentType: "gemini",
      worktreeId: TEST_WORKTREE_ID,
      receivedAt: 1,
    }),
    "tab-7:leaf-1": hookStatusEntry({
      agentType: TEST_ORCA_AGENT_TYPE.CLAUDE,
      worktreeId: TEST_WORKTREE_ID,
      receivedAt: 1,
    }),
    "tab-8:leaf-1": hookStatusEntry({
      sessionId: "claude-unhoused",
      agentType: TEST_ORCA_AGENT_TYPE.CLAUDE,
      receivedAt: 1,
    }),
  });

  const snapshot = await new OrcaWorkspaceReader({ dataDirectory: directory }).read();
  for (const [providerId, providerSessionId] of [
    [PROVIDER_ID.CLAUDE_CODE, "claude-local"],
    [PROVIDER_ID.CODEX, "codex-local"],
    [PROVIDER_ID.CURSOR, "cursor-local"],
    [PROVIDER_ID.DEVIN, "devin-local"],
    [PROVIDER_ID.OPENCODE, "opencode-local"],
  ] as const) {
    assert.equal(snapshot.has(providerId, providerSessionId), true);
  }

  assert.equal(snapshot.has(PROVIDER_ID.CLAUDE_CODE, "codex-local"), false);
  assert.equal(snapshot.has(PROVIDER_ID.CLAUDE_CODE, "gemini-local"), false);
  assert.equal(snapshot.has(PROVIDER_ID.CLAUDE_CODE, "claude-unhoused"), false);
});

test("treats missing, unreadable, and future Orca state as no annotation", async (t) => {
  const missing = await new OrcaWorkspaceReader({
    dataDirectory: path.join(await temporaryOrcaDirectory(t), "never-written"),
  }).read();
  assert.equal(missing.has(PROVIDER_ID.CLAUDE_CODE, "claude-local"), false);

  const unreadableDirectory = await temporaryOrcaDirectory(t);
  await fs.mkdir(path.join(unreadableDirectory, "agent-hooks"), { recursive: true });
  await fs.writeFile(
    path.join(unreadableDirectory, "agent-hooks", "last-status.json"),
    "{ half a file",
  );
  const unreadable = await new OrcaWorkspaceReader({ dataDirectory: unreadableDirectory }).read();
  assert.equal(unreadable.has(PROVIDER_ID.CLAUDE_CODE, "claude-local"), false);

  const futureDirectory = await temporaryOrcaDirectory(t);
  await writeHookStatus(
    futureDirectory,
    {
      "tab-1:leaf-1": hookStatusEntry({
        sessionId: "claude-local",
        agentType: TEST_ORCA_AGENT_TYPE.CLAUDE,
        worktreeId: TEST_WORKTREE_ID,
        receivedAt: 1,
      }),
    },
    3,
  );
  const future = await new OrcaWorkspaceReader({ dataDirectory: futureDirectory }).read();
  assert.equal(future.has(PROVIDER_ID.CLAUDE_CODE, "claude-local"), false);
});

test("annotates matching local observations and their spawned descendants", async (t) => {
  const directory = await temporaryOrcaDirectory(t);
  await writeHookStatus(directory, {
    "tab-1:leaf-1": hookStatusEntry({
      sessionId: "local",
      agentType: TEST_ORCA_AGENT_TYPE.CODEX,
      worktreeId: TEST_WORKTREE_ID,
      receivedAt: 1,
    }),
    "tab-2:leaf-1": hookStatusEntry({
      sessionId: "cloud",
      agentType: TEST_ORCA_AGENT_TYPE.CODEX,
      worktreeId: TEST_WORKTREE_ID,
      receivedAt: 1,
    }),
  });
  await writeOrcaState(directory, {
    [TEST_WORKTREE_ID]: { displayName: "Wire the notch geometry", comment: "", isArchived: false },
  });

  const snapshot = await new OrcaWorkspaceReader({ dataDirectory: directory }).read();
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
      providerSessionId: "cloud",
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

  const orcaWorkspace = {
    providerWorkspaceId: TEST_WORKTREE_ID,
    name: "Wire the notch geometry",
    scopeId: SESSION_APPLICATION_ID.ORCA,
    managerName: "Orca",
  };
  assert.deepEqual(observations[0]?.applications, [
    {
      id: SESSION_APPLICATION_ID.CHATGPT,
      displayName: "ChatGPT",
      scope: SESSION_APPLICATION_SCOPE.SESSION,
      link: "codex://threads/local",
    },
    {
      id: SESSION_APPLICATION_ID.ORCA,
      displayName: "Orca",
      scope: SESSION_APPLICATION_SCOPE.WORKSPACE,
    },
  ]);
  assert.deepEqual(observations[0]?.workspace, orcaWorkspace);
  assert.deepEqual(observations[1]?.applications, [
    {
      id: SESSION_APPLICATION_ID.ORCA,
      displayName: "Orca",
      scope: SESSION_APPLICATION_SCOPE.WORKSPACE,
    },
  ]);
  assert.deepEqual(observations[1]?.workspace, orcaWorkspace);
  assert.equal(observations[2]?.applications, undefined);
  assert.equal(observations[2]?.workspace, undefined);
  assert.equal(observations[3]?.applications, undefined);
});

test("names a worktree by its folder when Orca's state file says nothing", async (t) => {
  const directory = await temporaryOrcaDirectory(t);
  await writeHookStatus(directory, {
    "tab-1:leaf-1": hookStatusEntry({
      sessionId: "local",
      agentType: TEST_ORCA_AGENT_TYPE.CLAUDE,
      worktreeId: TEST_WORKTREE_ID,
      receivedAt: 1,
    }),
  });

  const snapshot = await new OrcaWorkspaceReader({ dataDirectory: directory }).read();
  const observations = snapshot.enrich(PROVIDER_ID.CLAUDE_CODE, [
    {
      providerSessionId: "local",
      title: "Local",
      status: SESSION_STATUS.WORKING,
      observedAt: 1,
    },
  ]);

  assert.equal(observations[0]?.workspace?.name, "notch-geometry");
  assert.equal(observations[0]?.workspace?.providerWorkspaceId, TEST_WORKTREE_ID);
});

test("keeps the newest binding when two panes carried one conversation", async (t) => {
  const directory = await temporaryOrcaDirectory(t);
  const newerWorktreeId = "repo-1::/Users/test/worktrees/notch-geometry-2";
  await writeHookStatus(directory, {
    "tab-1:leaf-1": hookStatusEntry({
      sessionId: "local",
      agentType: TEST_ORCA_AGENT_TYPE.CLAUDE,
      worktreeId: TEST_WORKTREE_ID,
      receivedAt: 1,
    }),
    "tab-2:leaf-1": hookStatusEntry({
      sessionId: "local",
      agentType: TEST_ORCA_AGENT_TYPE.CLAUDE,
      worktreeId: newerWorktreeId,
      receivedAt: 2,
    }),
  });

  const snapshot = await new OrcaWorkspaceReader({ dataDirectory: directory }).read();
  const observations = snapshot.enrich(PROVIDER_ID.CLAUDE_CODE, [
    {
      providerSessionId: "local",
      title: "Local",
      status: SESSION_STATUS.WORKING,
      observedAt: 1,
    },
  ]);

  assert.equal(observations[0]?.workspace?.providerWorkspaceId, newerWorktreeId);
});

test("keeps another manager's workspace and stays on the row instead", async (t) => {
  const directory = await temporaryOrcaDirectory(t);
  await writeHookStatus(directory, {
    "tab-1:leaf-1": hookStatusEntry({
      sessionId: "local",
      agentType: TEST_ORCA_AGENT_TYPE.CLAUDE,
      worktreeId: TEST_WORKTREE_ID,
      receivedAt: 1,
    }),
  });

  const supersetWorkspace = {
    providerWorkspaceId: "workspace-1",
    name: "lisbon-v2",
    scopeId: SESSION_APPLICATION_ID.SUPERSET,
    managerName: "Superset",
  };
  const snapshot = await new OrcaWorkspaceReader({ dataDirectory: directory }).read();
  const observations = snapshot.enrich(PROVIDER_ID.CLAUDE_CODE, [
    {
      providerSessionId: "local",
      title: "Local",
      status: SESSION_STATUS.WORKING,
      observedAt: 1,
      workspace: supersetWorkspace,
    },
  ]);

  assert.deepEqual(observations[0]?.workspace, supersetWorkspace);
  assert.deepEqual(observations[0]?.applications, [
    {
      id: SESSION_APPLICATION_ID.ORCA,
      displayName: "Orca",
      scope: SESSION_APPLICATION_SCOPE.SESSION,
    },
  ]);
});

test("re-reads Orca's files only after they change on disk", async (t) => {
  const directory = await temporaryOrcaDirectory(t);
  await writeHookStatus(directory, {
    "tab-1:leaf-1": hookStatusEntry({
      sessionId: "local",
      agentType: TEST_ORCA_AGENT_TYPE.CLAUDE,
      worktreeId: TEST_WORKTREE_ID,
      receivedAt: 1,
    }),
  });
  await writeOrcaState(directory, {
    [TEST_WORKTREE_ID]: { displayName: "First name" },
  });

  const reader = new OrcaWorkspaceReader({ dataDirectory: directory });
  const observed = { providerSessionId: "local" };
  assert.equal(
    (await reader.read()).has(PROVIDER_ID.CLAUDE_CODE, observed.providerSessionId),
    true,
  );

  await writeOrcaState(directory, {
    [TEST_WORKTREE_ID]: { displayName: "A different, longer name" },
  });
  const enriched = (await reader.read()).enrich(PROVIDER_ID.CLAUDE_CODE, [
    {
      providerSessionId: "local",
      title: "Local",
      status: SESSION_STATUS.WORKING,
      observedAt: 1,
    },
  ]);
  assert.equal(enriched[0]?.workspace?.name, "A different, longer name");
});
