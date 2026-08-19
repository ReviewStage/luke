import assert from "node:assert/strict";
import test from "node:test";
import { SESSION_LOCATION, SESSION_STATUS } from "@sidecar/core";
import {
  CLI_ADAPTER_DEFAULTS,
  CLI_FAILURE,
  CliCommandError,
  type CliRun,
} from "../src/cli-session-adapter";
import { CodexCloudSessionAdapter } from "../src/codex-cloud-adapter";
import { CLI_CONNECTION } from "../src/shared/contracts";

const TEST_TIME = Date.parse("2026-08-18T02:45:00.000Z");
const SECRET_PROMPT_TEXT = "SECRET_PROMPT_TEXT";
const LOGIN_PROBE_ARGV = ["login", "status"];
const LIST_TASKS_ARGV = ["cloud", "list", "--json", "--limit", "20"];

/** The CLI's documented task states, verified against the open-source serializer. */
const TEST_STATUS = {
  PENDING: "pending",
  READY: "ready",
  APPLIED: "applied",
  ERROR: "error",
} as const;

interface TestTask {
  id: string;
  status?: string;
  environmentId?: string;
  environmentLabel?: string;
  omitEnvironmentLabel?: boolean;
  updatedAt: number;
  summary?: { files_changed: number; lines_added: number; lines_removed: number };
}

function taskPayload(task: TestTask): Record<string, unknown> {
  return {
    id: task.id,
    url: `https://chatgpt.com/codex/tasks/${task.id}`,
    // The CLI returns a title generated from the prompt the user typed, so it
    // is transcript content that no observation may carry.
    title: `${SECRET_PROMPT_TEXT} title`,
    status: task.status ?? TEST_STATUS.PENDING,
    updated_at: new Date(task.updatedAt).toISOString(),
    // Real accounts routinely carry no environment id — only the label.
    environment_id: task.environmentId ?? null,
    ...(task.omitEnvironmentLabel
      ? {}
      : { environment_label: task.environmentLabel ?? "reviewstage/luke" }),
    summary: task.summary ?? { files_changed: 3, lines_added: 12, lines_removed: 4 },
    is_review: false,
    attempt_total: 1,
  };
}

interface RecordedInvocation {
  binary: string;
  argv: readonly string[];
}

interface TestPage {
  tasks: readonly TestTask[];
  cursor?: string;
}

interface FakeCliBehavior {
  loggedIn?: boolean;
  binaryMissing?: boolean;
  listExitCode?: number;
  listStdout?: string;
  tasks?: readonly TestTask[];
  /** Cursor-addressed pages, for the environment sweep; cursors are "page-N". */
  pages?: readonly TestPage[];
  execExitCode?: number;
  createdTaskId?: string;
}

/** Serves the two invocations the adapter is allowed to make, recording each. */
function fakeCodexCli(behavior: FakeCliBehavior) {
  const invocations: RecordedInvocation[] = [];
  const run: CliRun = async (binary, argv) => {
    invocations.push({ binary, argv });
    if (behavior.binaryMissing) {
      throw new CliCommandError(CLI_FAILURE.UNAVAILABLE, "codex could not be run");
    }
    if (argv.join(" ") === LOGIN_PROBE_ARGV.join(" ")) {
      return { exitCode: (behavior.loggedIn ?? true) ? 0 : 1, stdout: "" };
    }
    if (argv.slice(0, LIST_TASKS_ARGV.length).join(" ") === LIST_TASKS_ARGV.join(" ")) {
      if (behavior.listExitCode !== undefined && behavior.listExitCode !== 0) {
        return { exitCode: behavior.listExitCode, stdout: "" };
      }
      if (behavior.pages) {
        const cursorToken = argv.find((argument) => argument.startsWith("--cursor="));
        const index = cursorToken ? Number(cursorToken.slice("--cursor=page-".length)) : 0;
        const page = behavior.pages[index] ?? { tasks: [] };
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            tasks: page.tasks.map(taskPayload),
            cursor: page.cursor ?? null,
          }),
        };
      }
      return {
        exitCode: 0,
        stdout:
          behavior.listStdout ??
          JSON.stringify({
            tasks: (behavior.tasks ?? []).map(taskPayload),
            cursor: null,
          }),
      };
    }
    if (argv.slice(0, 3).join(" ") === "cloud exec --env") {
      if (behavior.execExitCode !== undefined && behavior.execExitCode !== 0) {
        return { exitCode: behavior.execExitCode, stdout: "" };
      }
      // The CLI's documented creation output: the new task's URL, one line.
      return {
        exitCode: 0,
        stdout: `https://chatgpt.com/codex/tasks/${behavior.createdTaskId ?? "task-created"}\n`,
      };
    }
    throw new Error(`Unexpected invocation: ${binary} ${argv.join(" ")}`);
  };
  return { run, invocations };
}

function adapterFor(
  run: CliRun,
  overrides: { now?: () => number; minimumRefreshIntervalMs?: number } = {},
): CodexCloudSessionAdapter {
  return new CodexCloudSessionAdapter({
    run,
    now: overrides.now ?? (() => TEST_TIME),
    minimumRefreshIntervalMs: overrides.minimumRefreshIntervalMs ?? 0,
  });
}

test("observes cloud tasks as cloud sessions labelled by their environment's repository", async () => {
  const { run, invocations } = fakeCodexCli({
    tasks: [
      { id: "task-old", status: TEST_STATUS.READY, updatedAt: TEST_TIME - 60_000 },
      { id: "task-new", status: TEST_STATUS.PENDING, updatedAt: TEST_TIME - 5_000 },
    ],
  });
  const adapter = adapterFor(run);

  const observations = await adapter.observe();

  assert.equal(observations.length, 2);
  const [newest, oldest] = observations;
  assert.ok(newest && oldest);
  assert.equal(newest.providerSessionId, "task-new");
  assert.equal(newest.title, "luke");
  assert.equal(newest.status, SESSION_STATUS.WORKING);
  assert.equal(newest.location, SESSION_LOCATION.CLOUD);
  assert.equal(newest.observedAt, TEST_TIME - 5_000);
  assert.equal(newest.detail?.repository, "luke");
  assert.equal(newest.detail?.link, "https://chatgpt.com/codex/tasks/task-new");
  assert.equal(newest.canReceiveMessage, undefined);
  assert.equal(oldest.providerSessionId, "task-old");
  assert.equal(oldest.status, SESSION_STATUS.COMPLETE);
  // The pass is exactly the two build-fixed invocations, in order.
  assert.deepEqual(
    invocations.map((invocation) => [invocation.binary, ...invocation.argv]),
    [
      ["codex", ...LOGIN_PROBE_ARGV],
      ["codex", ...LIST_TASKS_ARGV],
    ],
  );
});

test("never surfaces the prompt-derived task title", async () => {
  const { run } = fakeCodexCli({ tasks: [{ id: "task-1", updatedAt: TEST_TIME }] });
  const observations = await adapterFor(run).observe();

  assert.equal(JSON.stringify(observations).includes(SECRET_PROMPT_TEXT), false);
});

test("maps every documented task state and refuses to guess at unknown ones", async () => {
  const { run } = fakeCodexCli({
    tasks: [
      { id: "task-pending", status: TEST_STATUS.PENDING, updatedAt: TEST_TIME },
      { id: "task-ready", status: TEST_STATUS.READY, updatedAt: TEST_TIME - 1 },
      { id: "task-applied", status: TEST_STATUS.APPLIED, updatedAt: TEST_TIME - 2 },
      { id: "task-error", status: TEST_STATUS.ERROR, updatedAt: TEST_TIME - 3 },
      { id: "task-novel", status: "queued-for-review", updatedAt: TEST_TIME - 4 },
    ],
  });

  const observations = await adapterFor(run).observe();

  assert.deepEqual(
    observations.map((observation) => observation.status),
    [
      SESSION_STATUS.WORKING,
      SESSION_STATUS.COMPLETE,
      SESSION_STATUS.COMPLETE,
      SESSION_STATUS.ERROR,
      SESSION_STATUS.UNKNOWN,
    ],
  );
});

test("labels a task with no environment label as an unnamed workspace", async () => {
  const { run } = fakeCodexCli({
    tasks: [{ id: "task-1", omitEnvironmentLabel: true, updatedAt: TEST_TIME }],
  });

  const observations = await adapterFor(run).observe();

  assert.equal(observations[0]?.title, "workspace");
});

test("observes nothing while the CLI is signed out, and never asks for the list", async () => {
  const { run, invocations } = fakeCodexCli({ loggedIn: false });

  const observations = await adapterFor(run).observe();

  assert.deepEqual(observations, []);
  assert.deepEqual(
    invocations.map((invocation) => invocation.argv),
    [LOGIN_PROBE_ARGV],
  );
});

test("observes nothing on a machine without the CLI", async () => {
  const { run } = fakeCodexCli({ binaryMissing: true });

  const observations = await adapterFor(run).observe();

  assert.deepEqual(observations, []);
});

test("clears observed state when the login goes away", async () => {
  const behavior: FakeCliBehavior = { tasks: [{ id: "task-1", updatedAt: TEST_TIME }] };
  const { run } = fakeCodexCli(behavior);
  const adapter = adapterFor(run);

  assert.equal((await adapter.observe()).length, 1);
  behavior.loggedIn = false;
  assert.deepEqual(await adapter.observe(), []);
});

test("keeps the last snapshot across a failed or unreadable list", async () => {
  const behavior: FakeCliBehavior = { tasks: [{ id: "task-1", updatedAt: TEST_TIME }] };
  const { run } = fakeCodexCli(behavior);
  const adapter = adapterFor(run);

  const first = await adapter.observe();
  assert.equal(first.length, 1);

  behavior.listExitCode = 2;
  assert.deepEqual(await adapter.observe(), first);

  behavior.listExitCode = 0;
  behavior.listStdout = "not json at all";
  assert.deepEqual(await adapter.observe(), first);
});

test("refreshes on its own cadence rather than on every tick", async () => {
  let now = TEST_TIME;
  const { run, invocations } = fakeCodexCli({ tasks: [] });
  const adapter = adapterFor(run, {
    now: () => now,
    minimumRefreshIntervalMs: CLI_ADAPTER_DEFAULTS.MINIMUM_REFRESH_INTERVAL_MS,
  });

  await adapter.observe();
  await adapter.observe();
  assert.equal(invocations.length, 2);

  now += CLI_ADAPTER_DEFAULTS.MINIMUM_REFRESH_INTERVAL_MS;
  await adapter.observe();
  assert.equal(invocations.length, 4);
});

test("reports what each pass learned about the CLI login, and only that", async () => {
  const behavior: FakeCliBehavior = { tasks: [] };
  const { run } = fakeCodexCli(behavior);
  const adapter = adapterFor(run);

  // Before a pass has asked, the honest answer is that nothing was checked.
  assert.equal(adapter.connection(), CLI_CONNECTION.UNKNOWN);

  await adapter.observe();
  assert.equal(adapter.connection(), CLI_CONNECTION.CONNECTED);

  behavior.loggedIn = false;
  await adapter.observe();
  assert.equal(adapter.connection(), CLI_CONNECTION.SIGNED_OUT);

  behavior.loggedIn = true;
  behavior.binaryMissing = true;
  await adapter.observe();
  assert.equal(adapter.connection(), CLI_CONNECTION.CLI_MISSING);

  behavior.binaryMissing = false;
  await adapter.observe();
  assert.equal(adapter.connection(), CLI_CONNECTION.CONNECTED);

  // A list that ran and failed says nothing about the login behind it.
  behavior.listExitCode = 2;
  await adapter.observe();
  assert.equal(adapter.connection(), CLI_CONNECTION.CONNECTED);
});

test("answers unsupported for every act but the creation its provider documents", async () => {
  const { run } = fakeCodexCli({ tasks: [{ id: "task-1", updatedAt: TEST_TIME }] });
  const adapter = adapterFor(run);
  await adapter.observe();

  assert.deepEqual(await adapter.sendMessage({ providerSessionId: "task-1", text: "hello" }), {
    status: "unsupported",
  });
  assert.deepEqual(
    await adapter.executeControl({
      providerSessionId: "task-1",
      control: { id: "stop", label: "Stop" },
    }),
    { status: "unsupported" },
  );
  assert.deepEqual(await adapter.spawnWorkspaceAgent({ providerSessionId: "task-1", agent: "x" }), {
    status: "unsupported",
  });
  // A cloud task's conversation lives with its provider and is never fetched.
  assert.equal(await adapter.readTranscript("task-1"), undefined);
});

test("offers one creation target per observed environment, and none signed out", async () => {
  const behavior: FakeCliBehavior = {
    tasks: [
      { id: "task-1", updatedAt: TEST_TIME },
      { id: "task-2", updatedAt: TEST_TIME - 1 },
      {
        id: "task-3",
        updatedAt: TEST_TIME - 2,
        environmentLabel: "reviewstage/site",
        environmentId: "env-2",
      },
    ],
  };
  const { run } = fakeCodexCli(behavior);
  const adapter = adapterFor(run);

  // The label stands in where the list reported no id — which is what real
  // accounts return — and the id is preferred where one exists.
  await adapter.observe();
  assert.deepEqual(adapter.workspaceProjects(), [
    { providerProjectId: "reviewstage/luke", repository: "luke", taskSupport: "required" },
    { providerProjectId: "env-2", repository: "site", taskSupport: "required" },
  ]);

  behavior.loggedIn = false;
  await adapter.observe();
  assert.deepEqual(adapter.workspaceProjects(), []);
});

test("creates a task in an observed environment through the documented command", async () => {
  const { run, invocations } = fakeCodexCli({
    tasks: [{ id: "task-1", updatedAt: TEST_TIME }],
    createdTaskId: "task-created-9",
  });
  const adapter = adapterFor(run);
  await adapter.observe();

  const result = await adapter.createWorkspace({
    providerProjectId: "reviewstage/luke",
    task: "Fix the flaky login test",
  });

  assert.deepEqual(result, { status: "accepted", providerSessionId: "task-created-9" });
  const exec = invocations.at(-1);
  assert.deepEqual(exec?.argv, [
    "cloud",
    "exec",
    "--env",
    "reviewstage/luke",
    "--",
    "Fix the flaky login test",
  ]);
});

test("refuses a creation the latest pass did not offer or cannot honour", async () => {
  const behavior: FakeCliBehavior = { tasks: [{ id: "task-1", updatedAt: TEST_TIME }] };
  const { run, invocations } = fakeCodexCli(behavior);
  const adapter = adapterFor(run);
  await adapter.observe();
  const invocationsAfterObserve = invocations.length;

  // An environment the pass never reported names nowhere a creation could go.
  assert.deepEqual(await adapter.createWorkspace({ providerProjectId: "env-9", task: "Fix it" }), {
    status: "unsupported",
  });
  // Codex names tasks itself, so a chosen name is refused rather than dropped.
  const named = await adapter.createWorkspace({
    providerProjectId: "reviewstage/luke",
    name: "My workspace",
    task: "Fix it",
  });
  assert.equal(named.status, "rejected");
  // The task is the whole creation; without one there is nothing to start.
  const taskless = await adapter.createWorkspace({ providerProjectId: "reviewstage/luke" });
  assert.equal(taskless.status, "rejected");
  // Every refusal above answered without running anything.
  assert.equal(invocations.length, invocationsAfterObserve);

  // A CLI that refuses the request is reported as a rejection, not a success.
  behavior.execExitCode = 2;
  const refused = await adapter.createWorkspace({
    providerProjectId: "reviewstage/luke",
    task: "Fix it",
  });
  assert.equal(refused.status, "rejected");

  // A login gone since the pass refuses at the moment of the act.
  behavior.execExitCode = 0;
  behavior.loggedIn = false;
  const signedOut = await adapter.createWorkspace({
    providerProjectId: "reviewstage/luke",
    task: "Fix it",
  });
  assert.equal(signedOut.status, "rejected");
});

test("a login lost at the moment of an act clears observed state immediately", async () => {
  const behavior: FakeCliBehavior = { tasks: [{ id: "task-1", updatedAt: TEST_TIME }] };
  const { run } = fakeCodexCli(behavior);
  const adapter = adapterFor(run);
  await adapter.observe();
  assert.equal(adapter.workspaceProjects().length, 1);

  behavior.loggedIn = false;
  const rejected = await adapter.createWorkspace({
    providerProjectId: "reviewstage/luke",
    task: "Fix it",
  });

  assert.equal(rejected.status, "rejected");
  assert.equal(adapter.connection(), CLI_CONNECTION.SIGNED_OUT);
  // The write's probe already said the login is gone; the projects offered
  // under it must not outlive it by even a pass.
  assert.deepEqual(adapter.workspaceProjects(), []);
});

test("sweeps a bounded few pages for environments, on its own slower cadence", async () => {
  const { run, invocations } = fakeCodexCli({
    pages: [
      { tasks: [{ id: "t1", updatedAt: TEST_TIME }], cursor: "page-1" },
      {
        tasks: [{ id: "t2", updatedAt: TEST_TIME - 1, environmentLabel: "reviewstage/site" }],
        cursor: "page-2",
      },
      { tasks: [{ id: "t3", updatedAt: TEST_TIME - 2, environmentLabel: "reviewstage/docs" }] },
    ],
  });
  const adapter = adapterFor(run);

  await adapter.observe();

  // Environments from every swept page are offered, newest first, and the
  // sweep followed exactly the cursors the CLI handed back — each one token.
  assert.deepEqual(
    adapter.workspaceProjects().map((project) => project.providerProjectId),
    ["reviewstage/luke", "reviewstage/site", "reviewstage/docs"],
  );
  const listArgv = invocations.filter((invocation) => invocation.argv[1] === "list");
  assert.deepEqual(
    listArgv.map((invocation) => invocation.argv.at(-1)),
    ["20", "--cursor=page-1", "--cursor=page-2"],
  );

  // A pass inside the sweep interval reads the newest page alone and keeps
  // the sweep's offer standing.
  await adapter.observe();
  assert.equal(
    invocations.filter((invocation) => invocation.argv[1] === "list").length,
    listArgv.length + 1,
  );
  assert.equal(adapter.workspaceProjects().length, 3);
});

test("a sweep stops at its page bound however deep the history goes", async () => {
  const endlessPages = Array.from({ length: 9 }, (_, index) => ({
    tasks: [
      {
        id: `task-${index}`,
        updatedAt: TEST_TIME - index,
        environmentLabel: `reviewstage/repo-${index}`,
      },
    ],
    cursor: `page-${index + 1}`,
  }));
  const { run, invocations } = fakeCodexCli({ pages: endlessPages });

  await adapterFor(run).observe();

  assert.equal(invocations.filter((invocation) => invocation.argv[1] === "list").length, 5);
});

test("carries the CLI's diff counts and leaves a zero summary unreported", async () => {
  const { run } = fakeCodexCli({
    tasks: [
      { id: "task-ready", status: TEST_STATUS.READY, updatedAt: TEST_TIME },
      {
        id: "task-pending",
        status: TEST_STATUS.PENDING,
        updatedAt: TEST_TIME - 1,
        summary: { files_changed: 0, lines_added: 0, lines_removed: 0 },
      },
    ],
  });

  const observations = await adapterFor(run).observe();

  assert.deepEqual(observations[0]?.detail?.diff, {
    filesChanged: 3,
    linesAdded: 12,
    linesRemoved: 4,
  });
  // The zero summary of a task still working rides to the normalizer, which
  // drops it — the adapter reports the provider's counts, nothing more.
  assert.deepEqual(observations[1]?.detail?.diff, {
    filesChanged: 0,
    linesAdded: 0,
    linesRemoved: 0,
  });
});
