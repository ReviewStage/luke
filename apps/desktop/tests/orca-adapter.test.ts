import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  isControllableAdapter,
  isMessageCapableAdapter,
  isWorkspaceAgentCapableAdapter,
  isWorkspaceCapableAdapter,
  SESSION_STATUS,
} from "@sidecar/core";
import { ORCA_PROVIDER, OrcaSessionAdapter, orcaDataFilePath } from "../src/orca-adapter";

const TEST_TIME = Date.parse("2026-08-13T21:30:00.000Z");
/** Inside the 15-minute freshness window. */
const FRESH_TIME = TEST_TIME - 60_000;
/** Past the freshness window, so waiting decays and quiet reads as unknown. */
const STALE_TIME = TEST_TIME - 60 * 60 * 1000;

const TEST_REPO = {
  id: "repo-1",
  path: "/Users/dev/Projects/checkout",
  displayName: "checkout",
} as const;

/** Planted in every field observation must never read, and asserted absent. */
const SECRET_TRANSCRIPT_TEXT = "SECRET: the transcript body observation must never read";

interface TestTab {
  id: string;
  title?: string;
  defaultTitle?: string;
  customTitle?: string | null;
  generatedTitle?: string | null;
  aiVaultTitle?: { agent: string; sessionId: string; title: string } | null;
  quickCommandLabel?: string | null;
  launchAgent?: string;
  createdAt?: number;
}

interface TestWorktree {
  repoId?: string;
  directory: string;
  displayName?: string;
  lastActivityAt?: number;
  createdAt?: number;
  isUnread?: boolean;
  isArchived?: boolean;
  linkedWorkItem?: Record<string, unknown> | null;
  tabs?: readonly TestTab[];
  /** Keys tabs by Orca's newer `worktree:`-prefixed workspace key. */
  prefixedTabKey?: boolean;
}

function worktreeId(worktree: TestWorktree): string {
  return `${worktree.repoId ?? TEST_REPO.id}::${worktree.directory}`;
}

async function temporaryDataDirectory(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luke-orca-"));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

/**
 * Writes an `orca-data.json` shaped the way Orca's persistence layer writes
 * it, with synthetic sessions and a transcript-shaped secret planted in the
 * scrollback snapshots observation must never read.
 */
async function writeOrcaState(
  dataDirectory: string,
  worktrees: readonly TestWorktree[],
): Promise<void> {
  const worktreeMeta: Record<string, unknown> = {};
  const tabsByWorktree: Record<string, unknown> = {};
  const terminalLayoutsByTabId: Record<string, unknown> = {};

  for (const worktree of worktrees) {
    const id = worktreeId(worktree);
    worktreeMeta[id] = {
      displayName: worktree.displayName ?? "",
      comment: SECRET_TRANSCRIPT_TEXT,
      linkedIssue: null,
      linkedPR: null,
      linkedLinearIssue: null,
      linkedWorkItem: worktree.linkedWorkItem ?? null,
      isArchived: worktree.isArchived ?? false,
      isUnread: worktree.isUnread ?? false,
      isPinned: false,
      sortOrder: 0,
      lastActivityAt: worktree.lastActivityAt ?? 0,
      ...(worktree.createdAt !== undefined ? { createdAt: worktree.createdAt } : {}),
    };
    const tabKey = worktree.prefixedTabKey ? `worktree:${id}` : id;
    tabsByWorktree[tabKey] = (worktree.tabs ?? []).map((tab, index) => ({
      id: tab.id,
      ptyId: null,
      worktreeId: id,
      title: tab.title ?? tab.defaultTitle ?? `Terminal ${index + 1}`,
      defaultTitle: tab.defaultTitle ?? `Terminal ${index + 1}`,
      generatedTitle: tab.generatedTitle ?? null,
      aiVaultTitle: tab.aiVaultTitle ?? null,
      quickCommandLabel: tab.quickCommandLabel ?? null,
      customTitle: tab.customTitle ?? null,
      color: null,
      sortOrder: index,
      createdAt: tab.createdAt ?? 0,
      ...(tab.launchAgent ? { launchAgent: tab.launchAgent } : {}),
    }));
    for (const tab of worktree.tabs ?? []) {
      terminalLayoutsByTabId[tab.id] = {
        root: { type: "leaf", leafId: "leaf-1" },
        activeLeafId: "leaf-1",
        expandedLeafId: null,
        buffersByLeafId: { "leaf-1": SECRET_TRANSCRIPT_TEXT },
      };
    }
  }

  const state = {
    schemaVersion: 1,
    repos: [
      {
        id: TEST_REPO.id,
        path: TEST_REPO.path,
        displayName: TEST_REPO.displayName,
        badgeColor: "#0ea5e9",
        addedAt: FRESH_TIME,
      },
    ],
    projects: [],
    projectHostSetups: [],
    projectGroups: [],
    folderWorkspaces: [],
    sparsePresetsByRepo: {},
    worktreeMeta,
    worktreeLineageById: {},
    workspaceLineageByChildKey: {},
    settings: {},
    ui: {},
    githubCache: { pr: {}, issue: {} },
    workspaceSession: {
      activeRepoId: null,
      activeWorktreeId: null,
      activeTabId: null,
      tabsByWorktree,
      terminalLayoutsByTabId,
    },
    sshTargets: [],
    deletedSshConfigAliases: [],
    sshRemotePtyLeases: [],
    migrationUnsupportedPtyEntries: [],
    legacyPaneKeyAliasEntries: [],
    automations: [],
    automationRuns: [],
    onboarding: {},
  };
  await fs.mkdir(dataDirectory, { recursive: true });
  await fs.writeFile(orcaDataFilePath(dataDirectory), JSON.stringify(state), "utf8");
}

function adapterFor(dataDirectory: string): OrcaSessionAdapter {
  return new OrcaSessionAdapter({ dataDirectory, now: () => TEST_TIME });
}

test("reports its provider identity and no write capability", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  const adapter = adapterFor(dataDirectory);
  assert.deepEqual(adapter.provider, ORCA_PROVIDER);
  // Read-only by construction: none of the optional write capabilities exist.
  assert.equal(isControllableAdapter(adapter), false);
  assert.equal(isMessageCapableAdapter(adapter), false);
  assert.equal(isWorkspaceCapableAdapter(adapter), false);
  assert.equal(isWorkspaceAgentCapableAdapter(adapter), false);
});

test("reports an agent tab as a working session in its workspace", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  const worktree: TestWorktree = {
    directory: "/Users/dev/orca/workspaces/checkout/fix-login",
    displayName: "Fix login flow",
    lastActivityAt: FRESH_TIME,
    tabs: [
      {
        id: "tab-1",
        launchAgent: "claude",
        generatedTitle: "Repair the login redirect",
        createdAt: STALE_TIME,
      },
    ],
  };
  await writeOrcaState(dataDirectory, [worktree]);

  const observations = await adapterFor(dataDirectory).observe();
  assert.equal(observations.length, 1);
  const observation = observations[0];
  assert.equal(observation?.providerSessionId, "tab-1");
  assert.equal(observation?.title, "Repair the login redirect");
  assert.equal(observation?.status, SESSION_STATUS.WORKING);
  assert.equal(observation?.observedAt, FRESH_TIME);
  assert.deepEqual(observation?.workspace, {
    providerWorkspaceId: worktreeId(worktree),
    name: "Fix login flow",
  });
  assert.deepEqual(observation?.detail, { repository: TEST_REPO.displayName });
  assert.notEqual(observation?.canReceiveMessage, true);
});

test("reports a worktree Orca marked unread as waiting", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  await writeOrcaState(dataDirectory, [
    {
      directory: "/Users/dev/orca/workspaces/checkout/fix-login",
      displayName: "Fix login flow",
      lastActivityAt: FRESH_TIME,
      isUnread: true,
      tabs: [{ id: "tab-1", launchAgent: "claude" }],
    },
  ]);

  const observations = await adapterFor(dataDirectory).observe();
  assert.equal(observations[0]?.status, SESSION_STATUS.WAITING);
});

test("lets a stale unread decay to unknown, like any stale waiting", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  await writeOrcaState(dataDirectory, [
    {
      directory: "/Users/dev/orca/workspaces/checkout/fix-login",
      displayName: "Fix login flow",
      lastActivityAt: STALE_TIME,
      isUnread: true,
      tabs: [{ id: "tab-1", launchAgent: "claude" }],
    },
  ]);

  const observations = await adapterFor(dataDirectory).observe();
  assert.equal(observations[0]?.status, SESSION_STATUS.UNKNOWN);
});

test("reports a quiet, already-read worktree as unknown rather than working", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  await writeOrcaState(dataDirectory, [
    {
      directory: "/Users/dev/orca/workspaces/checkout/fix-login",
      displayName: "Fix login flow",
      lastActivityAt: STALE_TIME,
      tabs: [{ id: "tab-1", launchAgent: "claude" }],
    },
  ]);

  const observations = await adapterFor(dataDirectory).observe();
  assert.equal(observations[0]?.status, SESSION_STATUS.UNKNOWN);
});

test("skips archived worktrees, plain terminals, and untimed records", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  await writeOrcaState(dataDirectory, [
    {
      directory: "/Users/dev/orca/workspaces/checkout/archived",
      displayName: "Put away",
      lastActivityAt: FRESH_TIME,
      isArchived: true,
      tabs: [{ id: "tab-archived", launchAgent: "claude" }],
    },
    {
      directory: "/Users/dev/orca/workspaces/checkout/plain-shell",
      displayName: "Just a terminal",
      lastActivityAt: FRESH_TIME,
      tabs: [{ id: "tab-shell" }],
    },
    {
      directory: "/Users/dev/orca/workspaces/checkout/untimed",
      displayName: "No clock at all",
      tabs: [{ id: "tab-untimed", launchAgent: "claude" }],
    },
  ]);

  assert.deepEqual(await adapterFor(dataDirectory).observe(), []);
});

test("groups two nameless agents under one workspace, titled by their agents", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  const worktree: TestWorktree = {
    directory: "/Users/dev/orca/workspaces/checkout/two-agents",
    displayName: "Two agents",
    lastActivityAt: FRESH_TIME,
    tabs: [
      { id: "tab-1", launchAgent: "claude" },
      { id: "tab-2", launchAgent: "mimo-code" },
    ],
  };
  await writeOrcaState(dataDirectory, [worktree]);

  const observations = await adapterFor(dataDirectory).observe();
  assert.equal(observations.length, 2);
  // A tab whose live title is still the stock terminal label has no name of
  // its own; the agent Orca launched in it is the honest label, worded by the
  // table for an agent this build knows and as Orca wrote it otherwise.
  assert.equal(observations[0]?.title, "Claude Code");
  assert.equal(observations[1]?.title, "mimo-code");
  assert.equal(observations[0]?.workspace?.providerWorkspaceId, worktreeId(worktree));
  assert.equal(observations[1]?.workspace?.providerWorkspaceId, worktreeId(worktree));
});

test("prefers the user's own tab title, then the bound conversation's", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  await writeOrcaState(dataDirectory, [
    {
      directory: "/Users/dev/orca/workspaces/checkout/named",
      displayName: "Named workspace",
      lastActivityAt: FRESH_TIME,
      tabs: [
        {
          id: "tab-1",
          launchAgent: "claude",
          customTitle: "My renamed tab",
          aiVaultTitle: { agent: "claude", sessionId: "s-1", title: "Vault name" },
          generatedTitle: "Generated name",
        },
        {
          id: "tab-2",
          launchAgent: "codex",
          aiVaultTitle: { agent: "codex", sessionId: "s-2", title: "Vault name" },
          generatedTitle: "Generated name",
        },
        {
          id: "tab-3",
          launchAgent: "codex",
          title: "◐ Running the checkout tests",
          defaultTitle: "Terminal 3",
        },
      ],
    },
  ]);

  const observations = await adapterFor(dataDirectory).observe();
  assert.equal(observations[0]?.title, "My renamed tab");
  assert.equal(observations[1]?.title, "Vault name");
  assert.equal(observations[2]?.title, "◐ Running the checkout tests");
});

test("observes a conversation-bound tab Orca did not launch itself", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  await writeOrcaState(dataDirectory, [
    {
      directory: "/Users/dev/orca/workspaces/checkout/manual",
      displayName: "Manual agent",
      lastActivityAt: FRESH_TIME,
      tabs: [
        {
          id: "tab-1",
          aiVaultTitle: { agent: "claude", sessionId: "s-1", title: "Started by hand" },
        },
      ],
    },
  ]);

  const observations = await adapterFor(dataDirectory).observe();
  assert.equal(observations[0]?.title, "Started by hand");
});

test("falls back to the worktree folder when Orca has not named the workspace", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  await writeOrcaState(dataDirectory, [
    {
      directory: "/Users/dev/orca/workspaces/checkout/fix-login",
      lastActivityAt: FRESH_TIME,
      tabs: [{ id: "tab-1", launchAgent: "claude" }],
    },
  ]);

  const observations = await adapterFor(dataDirectory).observe();
  assert.equal(observations[0]?.workspace?.name, "fix-login");
});

test("reads tabs keyed by the newer workspace key as well as the raw id", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  await writeOrcaState(dataDirectory, [
    {
      directory: "/Users/dev/orca/workspaces/checkout/prefixed",
      displayName: "Prefixed key",
      lastActivityAt: FRESH_TIME,
      prefixedTabKey: true,
      tabs: [{ id: "tab-1", launchAgent: "claude" }],
    },
  ]);

  const observations = await adapterFor(dataDirectory).observe();
  assert.equal(observations.length, 1);
});

test("reports a linked pull request as the session's change, and no other link", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  await writeOrcaState(dataDirectory, [
    {
      directory: "/Users/dev/orca/workspaces/checkout/with-pr",
      displayName: "With a PR",
      lastActivityAt: FRESH_TIME,
      linkedWorkItem: {
        provider: "github",
        type: "pr",
        number: 42,
        title: "Fix login flow",
        url: "https://github.com/example/checkout/pull/42",
      },
      tabs: [{ id: "tab-pr", launchAgent: "claude" }],
    },
    {
      directory: "/Users/dev/orca/workspaces/checkout/with-issue",
      displayName: "With an issue",
      lastActivityAt: FRESH_TIME,
      linkedWorkItem: {
        provider: "github",
        type: "issue",
        number: 7,
        title: "Login is broken",
        url: "https://github.com/example/checkout/issues/7",
      },
      tabs: [{ id: "tab-issue", launchAgent: "claude" }],
    },
  ]);

  const observations = await adapterFor(dataDirectory).observe();
  const withPr = observations.find((observation) => observation.providerSessionId === "tab-pr");
  const withIssue = observations.find(
    (observation) => observation.providerSessionId === "tab-issue",
  );
  assert.equal(withPr?.detail?.change, "https://github.com/example/checkout/pull/42");
  assert.equal(withIssue?.detail?.change, undefined);
  // An issue is context around the work, not an address the session lives at.
  assert.equal(withIssue?.detail?.link, undefined);
});

test("never reports the transcript-shaped content stored beside its fields", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  await writeOrcaState(dataDirectory, [
    {
      directory: "/Users/dev/orca/workspaces/checkout/secret",
      displayName: "Holds a secret",
      lastActivityAt: FRESH_TIME,
      isUnread: true,
      tabs: [{ id: "tab-1", launchAgent: "claude", generatedTitle: "Visible title" }],
    },
  ]);

  const observations = await adapterFor(dataDirectory).observe();
  assert.equal(observations.length, 1);
  assert.ok(!JSON.stringify(observations).includes(SECRET_TRANSCRIPT_TEXT));
});

test("observes nothing without a data file, and nothing it cannot parse", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  const adapter = adapterFor(dataDirectory);
  assert.deepEqual(await adapter.observe(), []);

  await fs.writeFile(orcaDataFilePath(dataDirectory), "not json at all", "utf8");
  assert.deepEqual(await adapter.observe(), []);
});

test("re-reads the file Orca rewrote and drops sessions it no longer holds", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  const worktree: TestWorktree = {
    directory: "/Users/dev/orca/workspaces/checkout/renamed",
    displayName: "Before rename",
    lastActivityAt: FRESH_TIME,
    tabs: [{ id: "tab-1", launchAgent: "claude" }],
  };
  await writeOrcaState(dataDirectory, [worktree]);

  const adapter = adapterFor(dataDirectory);
  assert.equal((await adapter.observe())[0]?.workspace?.name, "Before rename");

  await writeOrcaState(dataDirectory, [{ ...worktree, displayName: "After rename" }]);
  // Orca rewrites the file whole, so its clock moves with every change.
  await fs.utimes(orcaDataFilePath(dataDirectory), new Date(TEST_TIME), new Date(TEST_TIME));
  assert.equal((await adapter.observe())[0]?.workspace?.name, "After rename");

  await fs.rm(orcaDataFilePath(dataDirectory));
  assert.deepEqual(await adapter.observe(), []);
});
