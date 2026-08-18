import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  OrcaWorkspaceIndex,
  orcaDataFilePath,
  orcaProfileDataDirectory,
  orcaProfileIndexFilePath,
} from "../src/orca-workspaces";

const TEST_TIME = Date.parse("2026-08-18T21:30:00.000Z");

/** Planted in every field the index must never read, and asserted absent. */
const SECRET_TRANSCRIPT_TEXT = "SECRET: the transcript body the index must never read";

interface TestWorktree {
  directory: string;
  displayName?: string;
  orcaCreatedAt?: number;
  createdWithAgent?: string;
  linkedWorkItem?: Record<string, unknown> | null;
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
 * it, with a transcript-shaped secret planted in the scrollback snapshots the
 * index must never read.
 */
async function writeOrcaState(
  dataDirectory: string,
  worktrees: readonly TestWorktree[],
  options: { workspaceDirectory?: string } = {},
): Promise<void> {
  const worktreeMeta: Record<string, unknown> = {};
  for (const worktree of worktrees) {
    worktreeMeta[`repo-1::${worktree.directory}`] = {
      displayName: worktree.displayName ?? "",
      comment: SECRET_TRANSCRIPT_TEXT,
      linkedIssue: null,
      linkedPR: null,
      linkedLinearIssue: null,
      linkedWorkItem: worktree.linkedWorkItem ?? null,
      isArchived: false,
      isUnread: false,
      isPinned: false,
      sortOrder: 0,
      lastActivityAt: TEST_TIME,
      ...(worktree.orcaCreatedAt !== undefined ? { orcaCreatedAt: worktree.orcaCreatedAt } : {}),
      ...(worktree.createdWithAgent ? { createdWithAgent: worktree.createdWithAgent } : {}),
    };
  }
  const state = {
    schemaVersion: 1,
    repos: [],
    worktreeMeta,
    settings: {
      ...(options.workspaceDirectory ? { workspaceDirectory: options.workspaceDirectory } : {}),
    },
    workspaceSession: {
      tabsByWorktree: {},
      terminalLayoutsByTabId: {
        "tab-1": { buffersByLeafId: { "leaf-1": SECRET_TRANSCRIPT_TEXT } },
      },
    },
  };
  await fs.mkdir(dataDirectory, { recursive: true });
  await fs.writeFile(orcaDataFilePath(dataDirectory), JSON.stringify(state), "utf8");
}

/** Writes an `orca-profile-index.json` shaped the way Orca lays it out. */
async function writeOrcaProfileIndex(
  dataDirectory: string,
  activeProfileId: string,
  profileIds: readonly string[],
): Promise<void> {
  await fs.mkdir(dataDirectory, { recursive: true });
  await fs.writeFile(
    orcaProfileIndexFilePath(dataDirectory),
    JSON.stringify({
      schemaVersion: 1,
      activeProfileId,
      profiles: profileIds.map((id) => ({ id, name: id, kind: "local" })),
    }),
    "utf8",
  );
}

test("annotates a session running in a worktree Orca created", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  await writeOrcaState(dataDirectory, [
    {
      directory: "/Users/dev/orca/workspaces/checkout/fix-login",
      displayName: "Fix login flow",
      orcaCreatedAt: TEST_TIME,
      linkedWorkItem: {
        provider: "github",
        type: "pr",
        number: 42,
        title: "Fix login flow",
        url: "https://github.com/example/checkout/pull/42",
      },
    },
  ]);

  const lookup = await new OrcaWorkspaceIndex({ dataDirectory }).annotations();
  const annotation = lookup("/Users/dev/orca/workspaces/checkout/fix-login");
  assert.deepEqual(annotation, {
    workspace: {
      providerWorkspaceId: "/Users/dev/orca/workspaces/checkout/fix-login",
      name: "Fix login flow",
    },
    change: "https://github.com/example/checkout/pull/42",
  });
  assert.ok(!JSON.stringify(annotation).includes(SECRET_TRANSCRIPT_TEXT));
});

test("annotates from inside the worktree, and never above it", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  await writeOrcaState(dataDirectory, [
    {
      directory: "/Users/dev/orca/workspaces/checkout/fix-login",
      displayName: "Fix login flow",
      createdWithAgent: "claude",
    },
  ]);

  const lookup = await new OrcaWorkspaceIndex({ dataDirectory }).annotations();
  const annotation = lookup("/Users/dev/orca/workspaces/checkout/fix-login/packages/web");
  assert.equal(annotation?.workspace?.name, "Fix login flow");
  assert.equal(annotation?.change, undefined);
  assert.equal(lookup("/Users/dev/orca/workspaces/checkout"), undefined);
});

test("offers no workspace for a worktree Orca never named", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  await writeOrcaState(dataDirectory, [
    // A lone annotated session cedes its row title to the workspace name, and
    // an unnamed worktree has only its folder leaf to offer — less than the
    // row already says. Its linked pull request still rides.
    {
      directory: "/Users/dev/orca/workspaces/checkout/unnamed",
      createdWithAgent: "claude",
      linkedWorkItem: {
        provider: "github",
        type: "pr",
        number: 9,
        title: "Unnamed work",
        url: "https://github.com/example/checkout/pull/9",
      },
    },
    { directory: "/Users/dev/orca/workspaces/checkout/bare", createdWithAgent: "claude" },
  ]);

  const lookup = await new OrcaWorkspaceIndex({ dataDirectory }).annotations();
  const withChange = lookup("/Users/dev/orca/workspaces/checkout/unnamed");
  assert.equal(withChange?.workspace, undefined);
  assert.equal(withChange?.change, "https://github.com/example/checkout/pull/9");
  assert.equal(lookup("/Users/dev/orca/workspaces/checkout/bare"), undefined);
});

test("refuses worktrees Orca merely lists, and takes marker-less ones under its root", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  await writeOrcaState(
    dataDirectory,
    [
      // Orca's sidebar lists worktrees other tools created; no marker, not
      // under Orca's root — not Orca's workspace to annotate with.
      { directory: "/Users/dev/conductor/workspaces/checkout/abuja" },
      // Created before Orca stamped markers, but living under Orca's own
      // configured workspace root.
      { directory: "/Users/dev/agent-trees/checkout/permit", displayName: "Permit flow" },
    ],
    { workspaceDirectory: "/Users/dev/agent-trees" },
  );

  const lookup = await new OrcaWorkspaceIndex({ dataDirectory }).annotations();
  assert.equal(lookup("/Users/dev/conductor/workspaces/checkout/abuja"), undefined);
  assert.equal(lookup("/Users/dev/agent-trees/checkout/permit")?.workspace?.name, "Permit flow");
});

test("ignores a linked issue: context around the work is not published work", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  await writeOrcaState(dataDirectory, [
    {
      directory: "/Users/dev/orca/workspaces/checkout/with-issue",
      displayName: "With an issue",
      orcaCreatedAt: TEST_TIME,
      linkedWorkItem: {
        provider: "github",
        type: "issue",
        number: 7,
        title: "Login is broken",
        url: "https://github.com/example/checkout/issues/7",
      },
    },
  ]);

  const lookup = await new OrcaWorkspaceIndex({ dataDirectory }).annotations();
  const annotation = lookup("/Users/dev/orca/workspaces/checkout/with-issue");
  assert.equal(annotation?.workspace?.name, "With an issue");
  assert.equal(annotation?.change, undefined);
});

test("answers nothing without a data file, and nothing it cannot parse", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  const index = new OrcaWorkspaceIndex({ dataDirectory });
  assert.equal((await index.annotations())("/Users/dev/anywhere"), undefined);

  await fs.mkdir(dataDirectory, { recursive: true });
  await fs.writeFile(orcaDataFilePath(dataDirectory), "not json at all", "utf8");
  assert.equal((await index.annotations())("/Users/dev/anywhere"), undefined);
});

test("re-reads the file Orca rewrote and drops workspaces it no longer holds", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  const worktree: TestWorktree = {
    directory: "/Users/dev/orca/workspaces/checkout/renamed",
    displayName: "Before rename",
    orcaCreatedAt: TEST_TIME,
  };
  await writeOrcaState(dataDirectory, [worktree]);

  const index = new OrcaWorkspaceIndex({ dataDirectory });
  const before = await index.annotations();
  assert.equal(
    before("/Users/dev/orca/workspaces/checkout/renamed")?.workspace?.name,
    "Before rename",
  );

  await writeOrcaState(dataDirectory, [{ ...worktree, displayName: "After rename" }]);
  await fs.utimes(orcaDataFilePath(dataDirectory), new Date(TEST_TIME), new Date(TEST_TIME));
  const after = await index.annotations();
  assert.equal(
    after("/Users/dev/orca/workspaces/checkout/renamed")?.workspace?.name,
    "After rename",
  );

  await fs.rm(orcaDataFilePath(dataDirectory));
  assert.equal(
    (await index.annotations())("/Users/dev/orca/workspaces/checkout/renamed"),
    undefined,
  );
});

test("reads each profile's own state file and leaves the pre-profile file frozen", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  const worktree = "/Users/dev/orca/workspaces/checkout/fix-login";
  // The migration to profiles leaves the legacy file behind with the names it
  // held at that moment; reading it beside the profiles would resurrect them.
  await writeOrcaState(dataDirectory, [
    { directory: worktree, displayName: "Frozen at migration", orcaCreatedAt: TEST_TIME },
    {
      directory: "/Users/dev/orca/workspaces/checkout/gone",
      displayName: "Removed since migration",
      orcaCreatedAt: TEST_TIME,
    },
  ]);
  await writeOrcaProfileIndex(dataDirectory, "personal", ["personal"]);
  await writeOrcaState(orcaProfileDataDirectory(dataDirectory, "personal"), [
    { directory: worktree, displayName: "Named since migration", orcaCreatedAt: TEST_TIME },
  ]);

  const lookup = await new OrcaWorkspaceIndex({ dataDirectory }).annotations();
  assert.equal(lookup(worktree)?.workspace?.name, "Named since migration");
  assert.equal(lookup("/Users/dev/orca/workspaces/checkout/gone"), undefined);
});

test("merges profiles with the active profile's answer winning", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  const shared = "/Users/dev/orca/workspaces/checkout/shared";
  // The third listed profile has no state file yet and must cost nothing.
  await writeOrcaProfileIndex(dataDirectory, "work", ["personal", "work", "fresh"]);
  await writeOrcaState(orcaProfileDataDirectory(dataDirectory, "personal"), [
    { directory: shared, displayName: "Personal's name", orcaCreatedAt: TEST_TIME },
    {
      directory: "/Users/dev/orca/workspaces/checkout/personal-only",
      displayName: "Personal only",
      orcaCreatedAt: TEST_TIME,
    },
  ]);
  await writeOrcaState(orcaProfileDataDirectory(dataDirectory, "work"), [
    { directory: shared, displayName: "Work's name", orcaCreatedAt: TEST_TIME },
  ]);

  const lookup = await new OrcaWorkspaceIndex({ dataDirectory }).annotations();
  assert.equal(lookup(shared)?.workspace?.name, "Work's name");
  assert.equal(
    lookup("/Users/dev/orca/workspaces/checkout/personal-only")?.workspace?.name,
    "Personal only",
  );
});

test("a profile index it cannot read is no index, not a fall back to the frozen file", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  const worktree = "/Users/dev/orca/workspaces/checkout/fix-login";
  await writeOrcaState(dataDirectory, [
    { directory: worktree, displayName: "Frozen at migration", orcaCreatedAt: TEST_TIME },
  ]);
  await fs.writeFile(orcaProfileIndexFilePath(dataDirectory), "not json at all", "utf8");

  const lookup = await new OrcaWorkspaceIndex({ dataDirectory }).annotations();
  assert.equal(lookup(worktree), undefined);
});

test("follows the profile index Orca rewrote", async (t) => {
  const dataDirectory = await temporaryDataDirectory(t);
  const shared = "/Users/dev/orca/workspaces/checkout/shared";
  await writeOrcaState(orcaProfileDataDirectory(dataDirectory, "personal"), [
    { directory: shared, displayName: "Personal's name", orcaCreatedAt: TEST_TIME },
  ]);
  await writeOrcaState(orcaProfileDataDirectory(dataDirectory, "work"), [
    { directory: shared, displayName: "Work's name", orcaCreatedAt: TEST_TIME },
  ]);

  const index = new OrcaWorkspaceIndex({ dataDirectory });
  await writeOrcaProfileIndex(dataDirectory, "personal", ["personal", "work"]);
  assert.equal((await index.annotations())(shared)?.workspace?.name, "Personal's name");

  await writeOrcaProfileIndex(dataDirectory, "work", ["personal", "work"]);
  await fs.utimes(
    orcaProfileIndexFilePath(dataDirectory),
    new Date(TEST_TIME),
    new Date(TEST_TIME),
  );
  assert.equal((await index.annotations())(shared)?.workspace?.name, "Work's name");
});
