import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { archiveCodingAgent, createCodingAgent } from "@luke/database/models/coding-agent-store";
import { claimRuntimeSession } from "@luke/database/models/recorded-session";
import { getTestDB, startPlan } from "@luke/database/testing";
import { HOSTED_API_ERROR } from "@luke/features";
import {
  SANDBOX_STATE,
  type SandboxState,
  type TerminalSummary,
} from "@luke/features/terminal-wire";
import { Clock, Effect, Layer, Option, Result } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { openGithubUser } from "../testing/github-app-fake.js";
import { noNetwork } from "../testing/no-network.js";
import { AGENT_TERMINALS_PATH, agentTerminalsApp } from "./agent-terminals-app.js";
import { AgentSandbox, type AgentSandboxService, SHELL_REFUSAL } from "./terminal/agent-sandbox.js";
import { SandboxUnavailable } from "./vercel-sandbox-api.js";

/**
 * A coding agent's terminals as its tab reaches them, over a real dialect and
 * a sandbox that answers from a script: the agent is reached by the one rule
 * every agent route keeps, so another account reads it as none, an archived
 * agent is gone, and a list answers the sandbox's shells and where it
 * stands; a shell is refused in a stopped sandbox, and only the resume path
 * wakes one; and a sandbox that did not answer is the upstream's
 * failure, apart from the service's own. Synthetic accounts, plans, and sessions throughout.
 */

const ORIGIN = "https://luke.test";
const SHELL: TerminalSummary = {
  id: "8b3c7a1e-2f4d-4c6b-9e0a-1d2f3a4b5c6d",
  title: "zsh",
  command: "zsh",
  cwd: "/workspace/repository",
  running: false,
};

/** A sandbox standing as given, keeping what it was asked: lists, starts, and resumes, by session. */
function scriptedSandbox(state: SandboxState) {
  const asked: { readonly what: string; readonly sessionId: string }[] = [];
  const shells = state === SANDBOX_STATE.RUNNING ? [SHELL] : [];
  const service: AgentSandboxService = {
    terminals: (sessionId) =>
      Effect.sync(() => {
        asked.push({ what: "terminals", sessionId });
        return { sandbox: state, terminals: shells };
      }),
    start: (sessionId, terminalId) =>
      Effect.sync(() => {
        asked.push({ what: "start", sessionId });
        return state === SANDBOX_STATE.RUNNING
          ? Result.succeed({ ...SHELL, id: terminalId })
          : Result.fail({ kind: SHELL_REFUSAL.NOT_RUNNING, sandbox: state });
      }),
    rename: () => Effect.succeed(Result.succeed(undefined)),
    kill: () => Effect.succeed(Result.succeed(undefined)),
    resume: (sessionId) =>
      Effect.sync(() => {
        asked.push({ what: "resume", sessionId });
        return SANDBOX_STATE.RUNNING;
      }),
    attach: () => Effect.die("the routes attach nothing"),
    setGitHubToken: () => Effect.die("the routes set no credential"),
  };
  return { layer: Layer.succeed(AgentSandbox, service), service, asked };
}

/** An account with an agent on a plan, its session claimed, as a started agent stands. */
const openAgent = Effect.gen(function* () {
  const userId = yield* openGithubUser();
  const plan = yield* startPlan(userId, { name: "Terminal tab", repository: "acme/relay" });
  const started = yield* createCodingAgent(userId, {
    planId: plan.id,
    idempotencyKey: `start-${randomUUID()}`,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    planSnapshot: "# Terminal tab\n",
    prompt: null,
    repository: "acme/relay",
  });
  assert.ok(Option.isSome(started));
  const { agent } = started.value;
  const sessionId = `wrun_${randomUUID()}`;
  yield* claimRuntimeSession(
    { userId, conversationId: agent.conversationId },
    sessionId,
    new Date(yield* Clock.currentTimeMillis),
  );
  return { userId, agent, sessionId };
});

/** The group over the test's store and the sandbox given, each bearer answering for the account it maps to. */
const standing = (bearers: ReadonlyMap<string, string>, sandbox: Layer.Layer<AgentSandbox>) =>
  Effect.gen(function* () {
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
      noNetwork,
    );
    const app = agentTerminalsApp({
      resolveUserId: (incoming: Request) =>
        Effect.succeed(
          Option.fromNullishOr(bearers.get(incoming.headers.get("authorization") ?? "")),
        ),
      sandbox,
    });
    const { handler, dispose } = HttpRouter.toWebHandler(
      app.pipe(HttpRouter.provideRequest(services)),
      {
        disableLogger: true,
      },
    );
    yield* Effect.addFinalizer(() => Effect.promise(dispose));
    return (path: string, bearer: string, init: { method?: string; body?: object } = {}) =>
      Effect.promise(async () => {
        const response = await handler(
          new Request(new URL(path, ORIGIN), {
            method: init.method ?? "GET",
            headers: { authorization: bearer },
            ...(init.body === undefined ? undefined : { body: JSON.stringify(init.body) }),
          }),
        );
        return { status: response.status, body: await response.json() };
      });
  });

const terminalsOf = (agentId: string) => `${AGENT_TERMINALS_PATH.TERMINALS}?id=${agentId}`;
const resumeOf = (agentId: string) => `${AGENT_TERMINALS_PATH.SANDBOX_RESUME}?id=${agentId}`;

it.layer(getTestDB())("the agent terminals routes", (it) => {
  it.effect(
    "the agent's member lists its shells, and another account reads the agent as none",
    () =>
      Effect.gen(function* () {
        const { userId, agent, sessionId } = yield* openAgent;
        const stranger = yield* openGithubUser();
        const sandbox = scriptedSandbox(SANDBOX_STATE.RUNNING);
        const call = yield* standing(
          new Map([
            ["Bearer owner", userId],
            ["Bearer stranger", stranger],
          ]),
          sandbox.layer,
        );

        const listed = yield* call(terminalsOf(agent.id), "Bearer owner");
        const strangers = yield* call(terminalsOf(agent.id), "Bearer stranger");

        assert.equal(listed.status, 200);
        assert.deepEqual(listed.body, { sandbox: SANDBOX_STATE.RUNNING, terminals: [SHELL] });
        assert.equal(strangers.status, 404);
        assert.deepEqual(sandbox.asked, [{ what: "terminals", sessionId }]);
      }),
  );

  it.effect(
    "a shell is refused in a stopped sandbox, the list never wakes it, and only the resume path does",
    () =>
      Effect.gen(function* () {
        const { userId, agent, sessionId } = yield* openAgent;
        const sandbox = scriptedSandbox(SANDBOX_STATE.STOPPED);
        const call = yield* standing(new Map([["Bearer owner", userId]]), sandbox.layer);

        const listed = yield* call(terminalsOf(agent.id), "Bearer owner");
        const started = yield* call(terminalsOf(agent.id), "Bearer owner", {
          method: "POST",
          body: {},
        });
        const woken = sandbox.asked.some((asked) => asked.what === "resume");
        const resumed = yield* call(resumeOf(agent.id), "Bearer owner", { method: "POST" });

        assert.deepEqual(listed.body, { sandbox: SANDBOX_STATE.STOPPED, terminals: [] });
        assert.equal(started.status, 409);
        assert.deepEqual(started.body, { error: HOSTED_API_ERROR.SANDBOX_STOPPED });
        assert.equal(woken, false, "nothing but the resume path wakes the sandbox");
        assert.deepEqual(resumed.body, { sandbox: SANDBOX_STATE.RUNNING });
        assert.deepEqual(sandbox.asked.at(-1), { what: "resume", sessionId });
      }),
  );

  it.effect("a shell starts in a running sandbox under an id the service mints", () =>
    Effect.gen(function* () {
      const { userId, agent } = yield* openAgent;
      const call = yield* standing(
        new Map([["Bearer owner", userId]]),
        scriptedSandbox(SANDBOX_STATE.RUNNING).layer,
      );

      const started = yield* call(terminalsOf(agent.id), "Bearer owner", {
        method: "POST",
        body: { title: "dev server" },
      });

      assert.equal(started.status, 201);
      assert.notEqual(started.body.terminal.id, SHELL.id);
    }),
  );

  it.effect(
    "a sandbox that did not answer is refused as the upstream's failure, not the service's own",
    () =>
      Effect.gen(function* () {
        const { userId, agent } = yield* openAgent;
        const unanswered = new SandboxUnavailable({ status: 400 });
        const sandbox = Layer.succeed(AgentSandbox, {
          ...scriptedSandbox(SANDBOX_STATE.RUNNING).service,
          terminals: () => Effect.fail(unanswered),
          start: () => Effect.fail(unanswered),
          resume: () => Effect.fail(unanswered),
        });
        const call = yield* standing(new Map([["Bearer owner", userId]]), sandbox);

        const answers = [
          yield* call(terminalsOf(agent.id), "Bearer owner"),
          yield* call(terminalsOf(agent.id), "Bearer owner", { method: "POST", body: {} }),
          yield* call(resumeOf(agent.id), "Bearer owner", { method: "POST" }),
        ];

        for (const answer of answers) {
          assert.equal(answer.status, 502);
          assert.deepEqual(answer.body, { error: HOSTED_API_ERROR.UPSTREAM_ERROR });
        }
      }),
  );

  it.effect("an archived agent's terminals are gone", () =>
    Effect.gen(function* () {
      const { userId, agent } = yield* openAgent;
      yield* archiveCodingAgent(userId, agent.id, true);
      const sandbox = scriptedSandbox(SANDBOX_STATE.RUNNING);
      const call = yield* standing(new Map([["Bearer owner", userId]]), sandbox.layer);

      const listed = yield* call(terminalsOf(agent.id), "Bearer owner");

      assert.equal(listed.status, 409);
      assert.deepEqual(listed.body, { error: HOSTED_API_ERROR.AGENT_RETIRED });
      assert.deepEqual(sandbox.asked, []);
    }),
  );
});
