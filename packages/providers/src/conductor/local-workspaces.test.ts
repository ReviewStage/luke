import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import {
  ACTION_RESULT_STATUS,
  dispatchAction,
  ExternalOpenAnswerLostError,
  WORKSPACE_TASK_SUPPORT,
} from "@sidecar/session";
import { UNKNOWN_ACTION_STATUS } from "@sidecar/wire";
import { admittedForTest } from "@sidecar/wire/testing";
import { conductorCreateWorkspaceLink } from "./applications.js";
import { conductorLocalWorkspacePlugin, conductorRepositories } from "./local-workspaces.js";

/**
 * Conductor's own deep-link parser, faithful to the branch a create link
 * reaches: an unknown host falls through to a raw split on `&`, each token cut
 * at its first `=`, each value percent-decoded. The test owns this so the link
 * builder is pinned to the exact shape Conductor reads, not merely to a shape
 * that looks right.
 */
function parseConductorCreateLink(url: string) {
  const parsed = new URL(url);
  const raw = url.replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\//, "");
  const fields: Record<string, string> = {};
  for (const token of raw.split("&")) {
    const equals = token.indexOf("=");
    if (equals > 0) fields[token.slice(0, equals)] = decodeURIComponent(token.slice(equals + 1));
  }
  return { host: parsed.hostname, path: fields.path, prompt: fields.prompt };
}

async function temporaryDatabasePath(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luke-conductor-repos-"));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return path.join(directory, "conductor.db");
}

function createReposDatabase(databasePath: string): DatabaseSync {
  const database = new DatabaseSync(databasePath, {});
  database.exec(`
    CREATE TABLE repos (
      id TEXT PRIMARY KEY,
      name TEXT,
      remote_url TEXT,
      root_path TEXT,
      hidden INTEGER DEFAULT 0
    );
  `);
  return database;
}

function createReposDatabaseWithoutHidden(databasePath: string): DatabaseSync {
  const database = new DatabaseSync(databasePath, {});
  database.exec(`
    CREATE TABLE repos (
      id TEXT PRIMARY KEY,
      name TEXT,
      remote_url TEXT,
      root_path TEXT
    );
  `);
  return database;
}

function writeRepo(
  database: DatabaseSync,
  repo: {
    id: string;
    name?: string;
    remoteUrl?: string;
    rootPath?: string | null;
    hidden?: number;
  },
): void {
  database
    .prepare("INSERT INTO repos (id, name, remote_url, root_path, hidden) VALUES (?, ?, ?, ?, ?)")
    .all(
      repo.id,
      repo.name ?? null,
      repo.remoteUrl ?? null,
      repo.rootPath === undefined ? null : repo.rootPath,
      repo.hidden ?? 0,
    );
}

/** The pre-hidden schema keeps its own insert: this test's whole point is the flag's absence. */
function writeRepoWithoutHidden(
  database: DatabaseSync,
  repo: { id: string; name?: string; rootPath: string },
): void {
  database
    .prepare("INSERT INTO repos (id, name, root_path) VALUES (?, ?, ?)")
    .all(repo.id, repo.name ?? null, repo.rootPath);
}

test("the create link is the exact shape Conductor's parser reads back", () => {
  const rootPath = "/Users/dev/conductor/repos/luke";
  const prompt = "Add a toggle & fix the a=b bug";
  const parsed = parseConductorCreateLink(conductorCreateWorkspaceLink(rootPath, prompt));
  // A host or a `?` would fold into the first key and drop the path; the parse
  // recovering both values exactly is the guard against that regression.
  assert.notEqual(parsed.host, "workspace");
  assert.notEqual(parsed.host, "session");
  assert.equal(parsed.path, rootPath);
  assert.equal(parsed.prompt, prompt);
});

test("the create link omits the prompt when there is no opening task", () => {
  const link = conductorCreateWorkspaceLink("/Users/dev/repo");
  assert.ok(!link.includes("prompt="));
  const parsed = parseConductorCreateLink(link);
  assert.equal(parsed.path, "/Users/dev/repo");
  assert.equal(parsed.prompt, undefined);
});

test("the repository reader reports open repositories with a root path", async (t) => {
  const databasePath = await temporaryDatabasePath(t);
  const database = createReposDatabase(databasePath);
  writeRepo(database, {
    id: "repo-luke",
    name: "luke",
    remoteUrl: "https://github.com/ReviewStage/luke.git",
    rootPath: "/Users/dev/repos/luke",
  });
  writeRepo(database, {
    id: "repo-hidden",
    name: "hidden",
    rootPath: "/Users/dev/hidden",
    hidden: 1,
  });
  writeRepo(database, { id: "repo-no-path", name: "no-path", rootPath: null });
  writeRepo(database, { id: "repo-empty-path", name: "empty", rootPath: "" });
  database.close();

  const reader = conductorRepositories({ databasePath });
  const repositories = await reader.read();
  assert.deepEqual(
    repositories.map((repository) => repository.id),
    ["repo-luke"],
  );
  assert.equal(repositories[0]?.rootPath, "/Users/dev/repos/luke");
  // The label comes from the remote's last segment, git suffix stripped.
  assert.equal(repositories[0]?.repositoryLabel, "luke");
});

test("the repository reader falls back for a schema without the hidden flag", async (t) => {
  const databasePath = await temporaryDatabasePath(t);
  const database = createReposDatabaseWithoutHidden(databasePath);
  writeRepoWithoutHidden(database, { id: "repo-a", name: "a", rootPath: "/Users/dev/a" });
  database.close();

  const reader = conductorRepositories({ databasePath });
  const repositories = await reader.read();
  assert.deepEqual(
    repositories.map((repository) => repository.id),
    ["repo-a"],
  );
});

test("an absent Conductor database reports no repositories", async (t) => {
  const databasePath = await temporaryDatabasePath(t);
  const reader = conductorRepositories({ databasePath });
  assert.deepEqual(await reader.read(), []);
});

test("a pass offers each repository as an optional-task project", async (t) => {
  const databasePath = await temporaryDatabasePath(t);
  const database = createReposDatabase(databasePath);
  writeRepo(database, {
    id: "repo-luke",
    name: "luke",
    remoteUrl: "https://github.com/ReviewStage/luke.git",
    rootPath: "/Users/dev/repos/luke",
  });
  database.close();

  const plugin = conductorLocalWorkspacePlugin({
    repositories: conductorRepositories({ databasePath }),
    openExternal: async () => {},
  });
  assert.deepEqual(plugin.projects?.() ?? [], []);
  await plugin.pass();
  assert.deepEqual(plugin.projects?.() ?? [], [
    {
      providerProjectId: "repo-luke",
      repository: "luke",
      taskSupport: WORKSPACE_TASK_SUPPORT.OPTIONAL,
      namesItself: true,
      providerTargetId: "/Users/dev/repos/luke",
    },
  ]);
});

test("creating a workspace fires Conductor's create link for the offered repository", async (t) => {
  const databasePath = await temporaryDatabasePath(t);
  const database = createReposDatabase(databasePath);
  writeRepo(database, { id: "repo-luke", name: "luke", rootPath: "/Users/dev/repos/luke" });
  database.close();

  const opened: string[] = [];
  const plugin = conductorLocalWorkspacePlugin({
    repositories: conductorRepositories({ databasePath }),
    openExternal: async (url) => {
      opened.push(url);
    },
  });
  await plugin.pass();
  const result = await dispatchAction(
    plugin,
    "createWorkspace",
    admittedForTest({
      providerProjectId: "repo-luke",
      providerTargetId: "/Users/dev/repos/luke",
      task: "Start on the parser",
    }),
  );
  assert.equal(result.status, ACTION_RESULT_STATUS.ACCEPTED);
  assert.equal(opened.length, 1);
  const parsed = parseConductorCreateLink(opened[0] ?? "");
  assert.equal(parsed.path, "/Users/dev/repos/luke");
  assert.equal(parsed.prompt, "Start on the parser");
  // Conductor pre-fills the prompt but does not send it, so a create carrying a
  // task warns rather than reading as an agent already at work.
  assert.match(
    "warning" in result ? (result.warning ?? "") : "",
    /ready in its composer.*press Return|press Return.*send/i,
  );
});

test("a failed pass empties the offer rather than keeping a stale one", async (t) => {
  const databasePath = await temporaryDatabasePath(t);
  // The file must exist for the read-only open to be attempted; the mock below
  // stands in for its contents, succeeding once and then failing.
  createReposDatabase(databasePath).close();
  let calls = 0;
  const sqlite = async () => ({
    DatabaseSync: class {
      enableDefensive(): void {}
      close(): void {}
      prepare() {
        return {
          all: () => {
            calls += 1;
            if (calls > 1) throw new Error("disk I/O error");
            return [
              { id: "repo-luke", name: "luke", remote_url: null, root_path: "/Users/dev/luke" },
            ];
          },
        };
      }
    },
  });
  const plugin = conductorLocalWorkspacePlugin({
    repositories: conductorRepositories({ databasePath, sqlite }),
    openExternal: async () => {},
  });
  await plugin.pass();
  assert.equal((plugin.projects?.() ?? []).length, 1);
  // A non-ignorable read failure surfaces, and must leave nothing behind to
  // validate a later create against.
  await assert.rejects(() => plugin.pass());
  assert.deepEqual(plugin.projects?.() ?? [], []);
});

test("creating a workspace with no task lands clean, with no send warning", async (t) => {
  const databasePath = await temporaryDatabasePath(t);
  const database = createReposDatabase(databasePath);
  writeRepo(database, { id: "repo-luke", name: "luke", rootPath: "/Users/dev/repos/luke" });
  database.close();

  const plugin = conductorLocalWorkspacePlugin({
    repositories: conductorRepositories({ databasePath }),
    openExternal: async () => {},
  });
  await plugin.pass();
  const result = await dispatchAction(
    plugin,
    "createWorkspace",
    admittedForTest({ providerProjectId: "repo-luke" }),
  );
  assert.equal(result.status, ACTION_RESULT_STATUS.ACCEPTED);
  // Nothing was pre-filled, so there is nothing to press Return on.
  assert.ok(!("warning" in result && result.warning));
});

test("creating a workspace uses the offered root path, never the request's", async (t) => {
  const databasePath = await temporaryDatabasePath(t);
  const database = createReposDatabase(databasePath);
  writeRepo(database, { id: "repo-luke", name: "luke", rootPath: "/Users/dev/repos/luke" });
  database.close();

  const opened: string[] = [];
  const plugin = conductorLocalWorkspacePlugin({
    repositories: conductorRepositories({ databasePath }),
    openExternal: async (url) => {
      opened.push(url);
    },
  });
  await plugin.pass();
  // A request naming a different target than the one offered is not the project
  // this pass reported, so it is refused rather than fired at a path of its own.
  const result = await dispatchAction(
    plugin,
    "createWorkspace",
    admittedForTest({
      providerProjectId: "repo-luke",
      providerTargetId: "/etc/passwd",
      task: "anything",
    }),
  );
  assert.equal(result.status, ACTION_RESULT_STATUS.UNSUPPORTED);
  assert.equal(opened.length, 0);
});

test("creating a workspace in an unoffered project is unsupported", async (t) => {
  const databasePath = await temporaryDatabasePath(t);
  const database = createReposDatabase(databasePath);
  writeRepo(database, { id: "repo-luke", name: "luke", rootPath: "/Users/dev/repos/luke" });
  database.close();

  const opened: string[] = [];
  const plugin = conductorLocalWorkspacePlugin({
    repositories: conductorRepositories({ databasePath }),
    openExternal: async (url) => {
      opened.push(url);
    },
  });
  await plugin.pass();
  const result = await dispatchAction(
    plugin,
    "createWorkspace",
    admittedForTest({ providerProjectId: "repo-unknown" }),
  );
  assert.equal(result.status, ACTION_RESULT_STATUS.UNSUPPORTED);
  assert.equal(opened.length, 0);
});

test("a failed open is reported as a rejection the user can act on", async (t) => {
  const databasePath = await temporaryDatabasePath(t);
  const database = createReposDatabase(databasePath);
  writeRepo(database, { id: "repo-luke", name: "luke", rootPath: "/Users/dev/repos/luke" });
  database.close();

  const plugin = conductorLocalWorkspacePlugin({
    repositories: conductorRepositories({ databasePath }),
    openExternal: async () => {
      throw new Error("no handler for conductor://");
    },
  });
  await plugin.pass();
  const result = await dispatchAction(
    plugin,
    "createWorkspace",
    admittedForTest({ providerProjectId: "repo-luke" }),
  );
  assert.equal(result.status, ACTION_RESULT_STATUS.REJECTED);
  assert.match(
    "reason" in result ? result.reason : "",
    /Couldn't ask Conductor to create the workspace/,
  );
});

test("the local creator observes no sessions of its own", async () => {
  const plugin = conductorLocalWorkspacePlugin({ openExternal: async () => {} });
  assert.deepEqual(await plugin.observe(), []);
  assert.deepEqual(plugin.latest(), []);
});

test("the local creator is named apart from cloud Conductor", () => {
  const plugin = conductorLocalWorkspacePlugin({ openExternal: async () => {} });
  // The name is what tells the two Conductors apart in the picker and out loud;
  // the id keeps them routed apart, and the two must not both read "Conductor".
  assert.equal(plugin.provider.displayName, "Conductor (local)");
  assert.notEqual(plugin.provider.id, "conductor");
});

test("a create whose deep link was handed to the machine and never answered is unknown, not refused", async (t) => {
  const databasePath = await temporaryDatabasePath(t);
  const database = createReposDatabase(databasePath);
  writeRepo(database, { id: "repo-luke", name: "luke", rootPath: "/Users/dev/repos/luke" });
  database.close();
  const plugin = conductorLocalWorkspacePlugin({
    repositories: conductorRepositories({ databasePath }),
    openExternal: async () => {
      throw new ExternalOpenAnswerLostError("the desktop went away before answering");
    },
  });
  await plugin.pass();
  const result = await dispatchAction(
    plugin,
    "createWorkspace",
    admittedForTest({
      providerProjectId: "repo-luke",
      providerTargetId: "/Users/dev/repos/luke",
      task: "Start on the parser",
    }),
  );
  // The link may have created the workspace: neither a refusal to report nor an action to repeat.
  assert.equal(result.status, UNKNOWN_ACTION_STATUS);
  const refused = conductorLocalWorkspacePlugin({
    repositories: conductorRepositories({ databasePath }),
    openExternal: async () => {
      throw new Error("no handler for the scheme");
    },
  });
  await refused.pass();
  const rejected = await dispatchAction(
    refused,
    "createWorkspace",
    admittedForTest({
      providerProjectId: "repo-luke",
      providerTargetId: "/Users/dev/repos/luke",
    }),
  );
  assert.equal(rejected.status, ACTION_RESULT_STATUS.REJECTED);
});
