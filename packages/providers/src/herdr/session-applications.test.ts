import assert from "node:assert/strict";
import test from "node:test";
import {
  PROVIDER_ID,
  SESSION_APPLICATION_ID,
  SESSION_APPLICATION_SCOPE,
  SESSION_LOCATION,
  SESSION_STATUS,
} from "@sidecar/session";
import { CLI_FAILURE, CliCommandError, type CliRun } from "../shared/cli-session-adapter.js";
import { HerdrSessionApplicationReader } from "./session-applications.js";

const TEST_TIME = Date.parse("2026-08-27T12:00:00Z");

interface TestSession {
  name: string;
  running?: boolean;
}

interface TestAgent {
  kind: string;
  referenceKind?: string;
  value?: string;
}

/** The answers one herdr CLI would give, keyed by the exact argv invoked. */
function herdrCli(
  sessions: readonly TestSession[],
  agentsBySession: Readonly<Record<string, readonly TestAgent[] | "stopped" | "unreadable">>,
  invocations: string[][] = [],
): CliRun {
  return async (binary, argv) => {
    assert.equal(binary, "herdr");
    invocations.push([...argv]);
    if (argv.join(" ") === "session list --json") {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          sessions: sessions.map((session) => ({
            name: session.name,
            running: session.running ?? true,
            default: session.name === "default",
            session_dir: `/tmp/example/${session.name}`,
            socket_path: `/tmp/example/${session.name}/herdr.sock`,
          })),
        }),
      };
    }
    const [flag, name, ...rest] = argv;
    assert.equal(flag, "--session");
    assert.equal(rest.join(" "), "agent list");
    const agents = agentsBySession[name ?? ""];
    if (agents === undefined || agents === "stopped") {
      return {
        exitCode: 1,
        stdout: JSON.stringify({
          id: "cli:agent:list",
          error: { code: "server_not_running", message: "no herdr server is running" },
        }),
      };
    }
    if (agents === "unreadable") return { exitCode: 0, stdout: "not json" };
    return {
      exitCode: 0,
      stdout: JSON.stringify({
        id: "cli:agent:list",
        result: {
          type: "agent_list",
          agents: agents.map((agent, index) => ({
            agent: agent.kind,
            agent_status: "working",
            cwd: "/tmp/example",
            name: `agent-${index}`,
            pane_id: `w1:p${index + 1}`,
            workspace_id: "w1",
            ...(agent.value
              ? {
                  agent_session: {
                    source: `herdr:${agent.kind}`,
                    agent: agent.kind,
                    kind: agent.referenceKind ?? "id",
                    value: agent.value,
                  },
                }
              : undefined),
          })),
        },
      }),
    };
  };
}

test("indexes supported provider session ids across running herdr sessions", async () => {
  const reader = new HerdrSessionApplicationReader({
    now: () => TEST_TIME,
    run: herdrCli([{ name: "default" }, { name: "overnight" }], {
      default: [
        { kind: "claude", value: "claude-local" },
        { kind: "codex", value: "codex-local" },
        { kind: "cursor", value: "cursor-local" },
      ],
      overnight: [
        { kind: "devin", value: "devin-local" },
        { kind: "opencode", value: "opencode-local" },
        // An agent kind Luke has no provider for is not read at all.
        { kind: "kimi", value: "kimi-local" },
        // A transcript-path reference names no row and is not read.
        { kind: "claude", referenceKind: "path", value: "/tmp/example/claude.jsonl" },
        // A pane herdr never heard a session id for contributes nothing.
        { kind: "claude" },
      ],
    }),
  });

  const snapshot = await reader.read();
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
  assert.equal(snapshot.has(PROVIDER_ID.CLAUDE_CODE, "/tmp/example/claude.jsonl"), false);
});

test("an absent binary leaves provider observations intact", async () => {
  const reader = new HerdrSessionApplicationReader({
    now: () => TEST_TIME,
    run: async () => {
      throw new CliCommandError(CLI_FAILURE.UNAVAILABLE, "herdr could not be run");
    },
  });
  const snapshot = await reader.read();
  const observation = {
    providerSessionId: "local",
    title: "Local",
    status: SESSION_STATUS.WORKING,
    observedAt: 1,
  };
  assert.deepEqual(snapshot.enrich(PROVIDER_ID.CLAUDE_CODE, [observation]), [observation]);
});

test("a stopped server and an unreadable answer both read as empty", async () => {
  const reader = new HerdrSessionApplicationReader({
    now: () => TEST_TIME,
    run: herdrCli([{ name: "default" }, { name: "broken" }], {
      default: "stopped",
      broken: "unreadable",
    }),
  });
  const snapshot = await reader.read();
  assert.equal(snapshot.has(PROVIDER_ID.CLAUDE_CODE, "claude-local"), false);
});

test("asks nothing of stopped sessions or names outside herdr's own charset", async () => {
  const invocations: string[][] = [];
  const reader = new HerdrSessionApplicationReader({
    now: () => TEST_TIME,
    run: herdrCli(
      [
        { name: "default" },
        { name: "stopped", running: false },
        { name: "bad name!" },
        { name: "-flag-shaped" },
      ],
      { default: [{ kind: "claude", value: "claude-local" }] },
      invocations,
    ),
  });

  const snapshot = await reader.read();
  assert.equal(snapshot.has(PROVIDER_ID.CLAUDE_CODE, "claude-local"), true);
  assert.deepEqual(invocations, [
    ["session", "list", "--json"],
    ["--session", "default", "agent", "list"],
  ]);
});

test("bounds how many running sessions one pass asks about", async () => {
  const invocations: string[][] = [];
  const sessions = Array.from({ length: 10 }, (_, index) => ({ name: `session-${index}` }));
  const reader = new HerdrSessionApplicationReader({
    now: () => TEST_TIME,
    run: herdrCli(sessions, {}, invocations),
  });

  await reader.read();
  assert.equal(invocations.length, 1 + 8);
});

test("reuses the snapshot inside the refresh interval and asks again past it", async () => {
  const invocations: string[][] = [];
  let now = TEST_TIME;
  const reader = new HerdrSessionApplicationReader({
    now: () => now,
    run: herdrCli(
      [{ name: "default" }],
      { default: [{ kind: "claude", value: "claude-local" }] },
      invocations,
    ),
  });

  const first = await reader.read();
  now += 1000;
  const second = await reader.read();
  assert.equal(second, first);
  assert.equal(invocations.length, 2);

  now += 60 * 1000;
  await reader.read();
  assert.equal(invocations.length, 4);
});

test("annotates matching local observations and their spawned descendants", async () => {
  const reader = new HerdrSessionApplicationReader({
    now: () => TEST_TIME,
    run: herdrCli([{ name: "default" }], {
      default: [
        { kind: "claude", value: "local" },
        { kind: "claude", value: "cloud" },
      ],
    }),
  });

  const snapshot = await reader.read();
  const observations = snapshot.enrich(PROVIDER_ID.CLAUDE_CODE, [
    {
      providerSessionId: "local",
      title: "Local",
      status: SESSION_STATUS.WORKING,
      observedAt: 1,
      detail: { link: "https://example.invalid/local" },
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

  const herdrApplication = {
    id: SESSION_APPLICATION_ID.HERDR,
    displayName: "Herdr",
    scope: SESSION_APPLICATION_SCOPE.SESSION,
  };
  assert.deepEqual(observations[0]?.applications, [herdrApplication]);
  // Herdr registers no URL scheme, so the association carries no address and
  // the row's own link stands untouched.
  assert.equal(observations[0]?.detail?.link, "https://example.invalid/local");
  assert.deepEqual(observations[1]?.applications, [herdrApplication]);
  assert.equal(observations[2]?.applications, undefined);
  assert.equal(observations[3]?.applications, undefined);
});

test("keeps an association another manager already gave the row", async () => {
  const reader = new HerdrSessionApplicationReader({
    now: () => TEST_TIME,
    run: herdrCli([{ name: "default" }], {
      default: [{ kind: "codex", value: "annotated" }],
    }),
  });

  const snapshot = await reader.read();
  const observations = snapshot.enrich(PROVIDER_ID.CODEX, [
    {
      providerSessionId: "annotated",
      title: "Annotated",
      status: SESSION_STATUS.WORKING,
      observedAt: 1,
      applications: [
        {
          id: SESSION_APPLICATION_ID.HERDR,
          displayName: "Herdr",
          scope: SESSION_APPLICATION_SCOPE.SESSION,
        },
      ],
    },
  ]);

  assert.equal(observations[0]?.applications?.length, 1);
});
