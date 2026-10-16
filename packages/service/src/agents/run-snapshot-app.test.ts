import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { createCodingAgent } from "@luke/database/models/coding-agent-store";
import { claimRuntimeSession } from "@luke/database/models/recorded-session";
import { getTestDB, startTask } from "@luke/database/testing";
import { HOSTED_API_ERROR } from "@luke/features";
import { SANDBOX_STATE, type SandboxState } from "@luke/features/terminal-wire";
import { Clock, Effect, Layer, Option, Result } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import {
  connectWorkspaceGitHub,
  type FakeGitHub,
  GITHUB_FIXTURE_INSTALLATION_TOKEN,
  githubReaching,
  openGithubUser,
} from "../testing/github-app-fake.js";
import { RUN_SNAPSHOT_PATH, runSnapshotApp } from "./run-snapshot-app.js";
import {
  AgentSandbox,
  type AgentSandboxService,
  SNAPSHOT_REFUSAL,
  type SnapshotRefusal,
  type WorkingTreeSnapshot,
} from "./terminal/agent-sandbox.js";

/**
 * A coding agent's working tree, taken for the Mac that runs it, over a real
 * dialect, a GitHub that answers from a script, and a sandbox that answers
 * from one too: the agent's member is handed the base, the branch, the
 * patch, and a contents-read token for its repository alone; a sandbox
 * asleep is woken and answered as waking; a patch past the bound is
 * answered by its size; and another account reaches no agent and is minted
 * no token. Synthetic accounts, repositories, tokens, and sessions.
 */

const ORIGIN = "https://luke.test";
const BASE = "0123456789abcdef0123456789abcdef01234567";
const STOPPED: SandboxState = SANDBOX_STATE.STOPPED;
const SNAPSHOT: WorkingTreeSnapshot = { base: BASE, branch: "luke/fix-relay", patch: "H4sIAAAA" };

/** A sandbox that answers snapshots as scripted, keeping what it was asked. */
function scriptedSandbox(answer: Result.Result<WorkingTreeSnapshot, SnapshotRefusal>) {
  const asked: string[] = [];
  const service: AgentSandboxService = {
    terminals: () => Effect.die("the route lists nothing"),
    start: () => Effect.die("the route starts nothing"),
    rename: () => Effect.die("the route renames nothing"),
    kill: () => Effect.die("the route kills nothing"),
    snapshot: (_session, checkout, defaultBranch) =>
      Effect.sync(() => {
        asked.push(`snapshot ${checkout} ${defaultBranch}`);
        return answer;
      }),
    resume: () =>
      Effect.sync(() => {
        asked.push("resume");
        return SANDBOX_STATE.STARTING;
      }),
    attach: () => Effect.die("the route attaches nothing"),
    setGitHubToken: () => Effect.die("the route sets no credential"),
  };
  return { layer: Layer.succeed(AgentSandbox, service), asked };
}

/** The installations the suite has connected, each test its own. */
let installationsOpened = 0;

/** An account with an agent on acme/relay, its workspace connected to an installation reaching it, its session claimed. */
const openAgent = Effect.gen(function* () {
  const userId = yield* openGithubUser();
  const task = yield* startTask(userId, { name: "Run it", repository: "acme/relay" });
  const started = yield* createCodingAgent(userId, {
    taskId: task.id,
    idempotencyKey: `start-${randomUUID()}`,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    planSnapshot: "# Run it\n",
    prompt: null,
    repository: "acme/relay",
  });
  assert.ok(Option.isSome(started));
  const { agent } = started.value;
  installationsOpened += 1;
  const installation = {
    id: 8100 + installationsOpened,
    login: "acme",
    repositories: [{ owner: "acme", name: "relay", private: true }],
  };
  yield* connectWorkspaceGitHub(agent.organizationId, installation);
  yield* claimRuntimeSession(
    { userId, conversationId: agent.conversationId },
    `wrun_${randomUUID()}`,
    new Date(yield* Clock.currentTimeMillis),
  );
  return { userId, agent, github: githubReaching([installation]) };
});

/** One POST to the route, the bearer naming the account. */
const ask = (
  github: FakeGitHub,
  sandbox: Layer.Layer<AgentSandbox>,
  userId: string,
  agentId: string,
) =>
  Effect.gen(function* () {
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
      github.layer,
    );
    const { handler, dispose } = HttpRouter.toWebHandler(
      runSnapshotApp({
        resolveUserId: (incoming) =>
          Effect.succeed(
            Option.fromNullishOr(incoming.headers.get("authorization")?.slice("Bearer ".length)),
          ),
        sandbox,
      }).pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );
    const response = yield* Effect.promise(() =>
      handler(
        new Request(new URL(`${RUN_SNAPSHOT_PATH}?id=${agentId}`, ORIGIN), {
          method: "POST",
          headers: { authorization: `Bearer ${userId}` },
        }),
      ),
    );
    const body: unknown = yield* Effect.promise(() => response.json());
    yield* Effect.promise(() => dispose());
    return { status: response.status, cacheControl: response.headers.get("cache-control"), body };
  });

/** The repository-scoped mints GitHub was asked for, by their permissions. */
function mintedPermissions(github: FakeGitHub) {
  return github.sent
    .filter(
      (sent) => sent.url.endsWith("/access_tokens") && "repositories" in JSON.parse(sent.body),
    )
    .map((sent) => JSON.parse(sent.body).permissions);
}

it.layer(getTestDB())("the run snapshot route", (it) => {
  it.effect(
    "the agent's member is handed its working tree and a contents-read token for its repository, not to be stored",
    () =>
      Effect.gen(function* () {
        const { userId, agent, github } = yield* openAgent;
        const sandbox = scriptedSandbox(Result.succeed(SNAPSHOT));

        const answered = yield* ask(github, sandbox.layer, userId, agent.id);

        assert.equal(answered.cacheControl, "private, no-store");
        assert.deepEqual(answered.body, {
          repository: "acme/relay",
          ...SNAPSHOT,
          token: GITHUB_FIXTURE_INSTALLATION_TOKEN,
          expiresAt: "2026-10-01T01:00:00Z",
        });
        assert.deepEqual(sandbox.asked, ["snapshot /workspace/repository main"]);
        assert.deepEqual(mintedPermissions(github), [{ contents: "read" }]);
      }),
  );

  it.effect(
    "a sandbox asleep is woken and answered as waking; a patch past the bound is answered by its size",
    () =>
      Effect.gen(function* () {
        const { userId, agent, github } = yield* openAgent;
        const asleep = scriptedSandbox(
          Result.fail({ kind: SNAPSHOT_REFUSAL.NOT_RUNNING, sandbox: STOPPED }),
        );
        const tooLarge = scriptedSandbox(
          Result.fail({ kind: SNAPSHOT_REFUSAL.TOO_LARGE, bytes: 9_000_000 }),
        );

        const waking = yield* ask(github, asleep.layer, userId, agent.id);
        const large = yield* ask(github, tooLarge.layer, userId, agent.id);

        assert.deepEqual(waking.body, { waking: true });
        assert.deepEqual(asleep.asked.at(-1), "resume");
        assert.deepEqual(large.body, { tooLarge: 9_000_000 });
      }),
  );

  it.effect("another account reaches no agent, and nothing is minted or read", () =>
    Effect.gen(function* () {
      const { agent, github } = yield* openAgent;
      const other = yield* openGithubUser();
      const sandbox = scriptedSandbox(Result.succeed(SNAPSHOT));

      const answered = yield* ask(github, sandbox.layer, other, agent.id);

      assert.deepEqual(answered.body, { error: HOSTED_API_ERROR.NOT_FOUND });
      assert.deepEqual(sandbox.asked, []);
      assert.deepEqual(mintedPermissions(github), []);
    }),
  );
});
