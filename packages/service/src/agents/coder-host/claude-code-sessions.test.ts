import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import {
  type ClaudeCodeConfig,
  INPUT_LINE,
  type InputLine,
  RUNNER_ENV,
  RUNNER_HARNESS,
} from "@luke/agent-runner/protocol";
import { Database } from "@luke/database/core/query";
import {
  type CodingAgent,
  createCodingAgent,
  readCodingAgentRouting,
  recordCodingAgentNativeSession,
  updateCodingAgentChoice,
} from "@luke/database/models/coding-agent-store";
import { parseKeyRing, sealProviderKey } from "@luke/database/models/provider-key-seal";
import { saveProviderKey, setPlanStatus } from "@luke/database/models/provider-key-store";
import { holdSandbox } from "@luke/database/models/sandbox-terminal-lease";
import { storeWriter } from "@luke/database/models/writer";
import { user } from "@luke/database/schemas/auth";
import { getTestDB, startTask } from "@luke/database/testing";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
} from "@luke/features/provider-key-wire";
import { DateTime, Effect, Layer, Option, Redacted, Result } from "effect";
import { TestClock } from "effect/testing";
import { afterEach, vi } from "vitest";
import { TURN_ORIGIN } from "../../core.js";
import { HostedEnvironment, type HostedEnvironmentValues } from "../../environment.js";
import {
  connectWorkspaceGitHub,
  GITHUB_APP_WITH_TOKENS,
  GITHUB_FIXTURE_INSTALLATION_TOKEN,
  githubReaching,
  type InstallationFixture,
} from "../../testing/github-app-fake.js";
import { fixtureToken, linesOf, runnerSandboxApi } from "../../testing/runner-sandbox-fake.js";
import {
  AgentSandboxImage,
  IMAGE_PREPARING_STATUS,
  ImagePreparing,
} from "../agent-sandbox-image.js";
import {
  EVE_CANCEL_OUTCOME,
  EVE_RESET_OUTCOME,
  EVE_SEND_OUTCOME,
  PLAN_REFUSAL,
} from "../brain-host/eve-sessions.js";
import { SESSION_TAG } from "../vercel-sandbox-api.js";
import {
  type ClaudeCodeSessionsOptions,
  claudeCodeSessions,
  RUNNER_ENDED,
  runnerBearerDigest,
  runnerEnded,
} from "./claude-code-sessions.js";
import { RunnerBundle } from "./runner-bundle.js";
import { RUNNER_CHOICE } from "./runtime-sessions.js";
import { CODER_TOOL_SET } from "./tool-set.js";

/**
 * A coding agent's sessions on Claude Code, against a fake of Vercel
 * Sandbox's REST API that keeps every sandbox, command, stdin, and upload
 * it was asked for, over a real store: the runner launched as root and
 * dropped to `agent` with its secrets in its environment alone, its config
 * and messages written to its stdin, a stop, a relaunch on the CLI's session
 * after the sandbox stopped, a launch's end stopping the sandbox unless a
 * Terminal holds it, and a reset deleting the sandbox and retiring the
 * runner's bearer. Synthetic accounts, tokens, and snapshot ids throughout.
 */

const SNAPSHOT = "snap_fixture_image";
const EVENTS_URL = "https://luke.test/api/agents/runner/events";
const MCP_URL = "https://luke.test/api/agents/mcp";
const INSTRUCTIONS = "You are a Luke coding agent.";
const BUNDLE = new TextEncoder().encode("// the runner, bundled\nconsole.log('runner');\n");
const TEST_KEY = "sk-ant-api03-fixture-test-mode-key";
const PLAN_TOKEN = "sk-ant-oat01-fixture-plan-token";
const RING = `1:${Buffer.alloc(32, 3).toString("base64")}`;
const RELAY = { owner: "Acme", name: "Relay", defaultBranch: "trunk" } as const;
const RELAY_FULL_NAME = `${RELAY.owner}/${RELAY.name}`;
const RELAY_INSTALLATION: InstallationFixture = {
  id: 7,
  login: RELAY.owner,
  repositories: [RELAY],
};
const CLI_SESSION = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const NO_KEYS: HostedEnvironmentValues = {
  openAiKey: undefined,
  anthropicKey: undefined,
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  cronSecret: undefined,
  eveDeploymentSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: Redacted.make(RING),
};

/** Everything but the store, around the fake Vercel given. */
function services(api: ReturnType<typeof runnerSandboxApi>, snapshot: string | null = SNAPSHOT) {
  return Layer.mergeAll(
    api.layer,
    GITHUB_APP_WITH_TOKENS,
    Layer.succeed(HostedEnvironment, NO_KEYS),
    Layer.succeed(AgentSandboxImage, {
      snapshotId: Effect.succeed(Option.fromNullishOr(snapshot)),
    }),
    Layer.succeed(RunnerBundle, { contents: Effect.succeed(BUNDLE) }),
  );
}

/** An account with one agent on a task with no repository. */
const openAgent = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* Effect.flatMap(Database, (db) =>
    db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` }),
  );
  const task = yield* startTask(userId, { name: "Teammate invitations" });
  const started = yield* createCodingAgent(userId, {
    taskId: task.id,
    idempotencyKey: "start-1",
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    planSnapshot: "# Teammate invitations\n",
    prompt: null,
    repository: null,
  });
  assert.ok(Option.isSome(started));
  return { userId, agent: started.value.agent };
});

/** The sessions for the account, the next event number read from the counter given. */
function sessionsFor(
  userId: string,
  sequence: { next: number },
  testApiKey: string | null = TEST_KEY,
) {
  const options: ClaudeCodeSessionsOptions = {
    userId,
    eventsUrl: EVENTS_URL,
    mcpUrl: MCP_URL,
    instructions: () => Effect.succeed(INSTRUCTIONS),
    nextSequence: () => Effect.sync(() => sequence.next),
    testApiKey: testApiKey === null ? undefined : Redacted.make(testApiKey),
    run: (effect) => Effect.runPromise(effect),
  };
  return claudeCodeSessions(options);
}

const message = (agent: CodingAgent, text: string, lineId?: string) => ({
  conversationId: agent.conversationId,
  turn: "typed" as const,
  message: text,
  ...(lineId === undefined ? undefined : { lineId }),
});

/** A turn of the agent's under way, as the events route queues one, by the id a Stop names it by. */
const turnUnderWay = (userId: string, agent: CodingAgent) =>
  Effect.gen(function* () {
    const turnId = randomUUID();
    const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
    yield* writer.enqueueTurn(
      { userId, conversationId: agent.conversationId },
      { turnId, eveTurnId: turnId, origin: TURN_ORIGIN.TYPED },
    );
    return turnId;
  });

afterEach(() => {
  vi.unstubAllEnvs();
});

it.layer(getTestDB())("a coding agent's sessions on Claude Code", (it) => {
  it.effect(
    "open launches the runner as root dropped to agent, its secrets in its environment alone, and writes its config and first message to its stdin",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;
        const lineId = randomUUID();
        const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(
          Effect.provide(services(api)),
        );

        const opened = yield* sessions.open(message(agent, "Fix the invitations.", lineId));

        assert.equal(opened.outcome, EVE_SEND_OUTCOME.ACCEPTED);
        assert.ok(opened.outcome === EVE_SEND_OUTCOME.ACCEPTED);
        const [sandbox] = api.sandboxes;
        assert.ok(sandbox !== undefined);
        assert.equal(sandbox.snapshotId, SNAPSHOT);
        assert.equal(sandbox.tags.sessionId, opened.sessionId);
        // The working folder an agent with no repository works in.
        assert.ok(
          api.runs.some((run) => run.args.join(" ").includes("mkdir -p /workspace/repository")),
        );

        const [command] = api.commands;
        assert.ok(command !== undefined);
        assert.equal(command.sudo, true);
        assert.equal(command.command, "bash");
        const script = command.args[1] ?? "";
        assert.match(
          script,
          /exec setpriv --reuid=agent --regid=agent --init-groups --inh-caps=-all --ambient-caps=-all --bounding-set=-all -- env HOME=\/home\/agent/u,
        );
        assert.equal(command.args.at(-1), createHash("sha256").update(BUNDLE).digest("hex"));
        // The bundle is uploaded as the default user and installed by root where only root writes.
        assert.equal(
          api.uploads[0]?.get("/tmp/luke-agent-runner.mjs"),
          new TextDecoder().decode(BUNDLE),
        );
        assert.match(script, /install -D -o root -g root -m 0444 \/tmp\/luke-agent-runner\.mjs/u);

        const bearer = command.env[RUNNER_ENV.BEARER];
        assert.ok(bearer !== undefined && bearer.length > 20);
        assert.equal(command.env[RUNNER_ENV.API_KEY], TEST_KEY);
        assert.equal(command.env[RUNNER_ENV.CLAUDE_TOKEN], undefined);
        const routing = Option.getOrThrow(yield* readCodingAgentRouting(userId, agent.id));
        assert.equal(routing.runnerTokenHash, runnerBearerDigest(bearer));

        const [config, first] = linesOf(command) as [ClaudeCodeConfig, InputLine];
        assert.deepEqual(config, {
          harness: RUNNER_HARNESS.CLAUDE_CODE,
          cwd: "/workspace/repository",
          executable:
            "/opt/luke/claude-agent-sdk/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude",
          model: "claude-opus-5-5",
          effort: "high",
          append: INSTRUCTIONS,
          firstSequence: 0,
          eventsUrl: EVENTS_URL,
          mcpUrl: MCP_URL,
          allowedDomains: config.allowedDomains,
        });
        assert.deepEqual(first, {
          type: INPUT_LINE.MESSAGE,
          uuid: lineId,
          content: [{ type: "text", text: "Fix the invitations." }],
        });
        // No secret in argv, the config, a tag, or anything uploaded.
        const visible = JSON.stringify([
          command.args,
          command.stdin,
          api.sandboxes,
          [...(api.uploads[0]?.values() ?? [])],
        ]);
        for (const secret of [TEST_KEY, bearer]) assert.equal(visible.includes(secret), false);
      }),
  );

  it.effect("a plan's launch runs on the account's setup-token, opened from its sealed row", () =>
    Effect.gen(function* () {
      vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
      const api = runnerSandboxApi();
      const { userId, agent } = yield* openAgent;
      const ring = parseKeyRing(Redacted.make(RING));
      assert.ok(Result.isSuccess(ring));
      const owner = {
        userId,
        provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
        kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
      };
      yield* saveProviderKey(
        userId,
        owner.provider,
        owner.kind,
        sealProviderKey(ring.success, owner, Redacted.make(PLAN_TOKEN)),
        "sk-ant-oat…oken",
        null,
        new Date(0),
      );
      const sessions = yield* sessionsFor(userId, { next: 0 }, null).pipe(
        Effect.provide(services(api)),
      );

      const opened = yield* sessions.open(message(agent, "Fix the invitations."));

      assert.equal(opened.outcome, EVE_SEND_OUTCOME.ACCEPTED);
      const [command] = api.commands;
      assert.equal(command?.env[RUNNER_ENV.CLAUDE_TOKEN], PLAN_TOKEN);
      assert.equal(command?.env[RUNNER_ENV.API_KEY], undefined);
      assert.equal(JSON.stringify([command?.args, command?.stdin]).includes(PLAN_TOKEN), false);
    }),
  );

  it.effect(
    "a setup-token Anthropic refused refuses the launch as one to reconnect, a limit refuses it with its reset until that passes, and neither starts a runner while refused",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const { userId, agent } = yield* openAgent;
        const ring = parseKeyRing(Redacted.make(RING));
        assert.ok(Result.isSuccess(ring));
        const owner = {
          userId,
          provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
          kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
        };
        yield* saveProviderKey(
          userId,
          owner.provider,
          owner.kind,
          sealProviderKey(ring.success, owner, Redacted.make(PLAN_TOKEN)),
          "sk-ant-oat…oken",
          null,
          new Date(0),
        );
        const markPlan = (
          status: typeof PROVIDER_KEY_STATUS.LIMIT_REACHED | typeof PROVIDER_KEY_STATUS.INVALID,
          resetsAt?: Date,
        ) =>
          Effect.gen(function* () {
            const now = yield* DateTime.nowAsDate;
            yield* setPlanStatus(userId, owner.provider, owner.kind, status, resetsAt, now, now);
          });
        const openOn = (api: ReturnType<typeof runnerSandboxApi>) =>
          Effect.gen(function* () {
            const sessions = yield* sessionsFor(userId, { next: 0 }, null).pipe(
              Effect.provide(services(api)),
            );
            return yield* sessions.open(message(agent, "Go."));
          });

        const resetsAt = new Date((yield* DateTime.nowAsDate).getTime() + 30 * 60_000);
        yield* markPlan(PROVIDER_KEY_STATUS.LIMIT_REACHED, resetsAt);
        const limited = runnerSandboxApi();
        assert.deepEqual(yield* openOn(limited), {
          outcome: EVE_SEND_OUTCOME.FAILED,
          status: 422,
          planRefusal: PLAN_REFUSAL.LIMIT_REACHED,
          planResetsAt: resetsAt.getTime(),
        });
        assert.deepEqual(limited.commands, []);

        yield* TestClock.adjust("31 minutes");
        const reset = runnerSandboxApi();
        const live = yield* sessionsFor(userId, { next: 0 }, null).pipe(
          Effect.provide(services(reset)),
        );
        const reopened = yield* live.open(message(agent, "Go."));
        assert.ok(reopened.outcome === EVE_SEND_OUTCOME.ACCEPTED);
        assert.equal(reset.commands[0]?.env[RUNNER_ENV.CLAUDE_TOKEN], PLAN_TOKEN);

        // Another agent's turn finds the plan refused: a message to this live runner is refused too, and nothing is written to it.
        yield* markPlan(PROVIDER_KEY_STATUS.INVALID);
        const written = linesOf(reset.commands[0]).length;
        assert.deepEqual(yield* live.send(reopened.sessionId, message(agent, "Also the emails.")), {
          outcome: EVE_SEND_OUTCOME.FAILED,
          status: 422,
          planRefusal: PLAN_REFUSAL.SIGNED_OUT,
        });
        assert.equal(linesOf(reset.commands[0]).length, written);

        const refused = runnerSandboxApi();
        assert.deepEqual(yield* openOn(refused), {
          outcome: EVE_SEND_OUTCOME.FAILED,
          status: 422,
          planRefusal: PLAN_REFUSAL.SIGNED_OUT,
        });
        assert.deepEqual(refused.commands, []);
      }),
  );

  it.effect(
    "open answers failed and opens nothing where no snapshot or no setup-token stands",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const { userId, agent } = yield* openAgent;
        const noSnapshot = runnerSandboxApi();
        const withoutImage = yield* sessionsFor(userId, { next: 0 }).pipe(
          Effect.provide(services(noSnapshot, null)),
        );
        assert.equal(
          (yield* withoutImage.open(message(agent, "Go."))).outcome,
          EVE_SEND_OUTCOME.FAILED,
        );
        assert.deepEqual(noSnapshot.sandboxes, []);

        const noToken = runnerSandboxApi();
        const withoutPlan = yield* sessionsFor(userId, { next: 0 }, null).pipe(
          Effect.provide(services(noToken)),
        );
        assert.equal(
          (yield* withoutPlan.open(message(agent, "Go."))).outcome,
          EVE_SEND_OUTCOME.FAILED,
        );
        // The sandbox the failed launch opened is deleted again, and no runner started.
        assert.ok(noToken.sandboxes.every((sandbox) => sandbox.deleted));
        assert.deepEqual(noToken.commands, []);
      }),
  );

  it.effect("send writes a message line to the running runner, and cancel writes stop", () =>
    Effect.gen(function* () {
      vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
      const api = runnerSandboxApi();
      const { userId, agent } = yield* openAgent;
      const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(Effect.provide(services(api)));
      const opened = yield* sessions.open(message(agent, "Fix the invitations."));
      assert.ok(opened.outcome === EVE_SEND_OUTCOME.ACCEPTED);
      const lineId = randomUUID();
      yield* updateCodingAgentChoice(userId, agent.id, {
        model: "anthropic/claude-sonnet-5.5",
        effort: "low",
      });

      const sent = yield* sessions.send(
        opened.sessionId,
        message(agent, "Also the emails.", lineId),
      );
      const turnId = yield* turnUnderWay(userId, agent);
      const cancelled = yield* sessions.cancel(opened.sessionId, turnId);

      assert.deepEqual(sent, {
        outcome: EVE_SEND_OUTCOME.ACCEPTED,
        sessionId: opened.sessionId,
        deliveryId: lineId,
      });
      assert.equal(cancelled.outcome, EVE_CANCEL_OUTCOME.ACCEPTED);
      assert.equal(api.commands.length, 1);
      assert.deepEqual(linesOf(api.commands[0]).slice(2), [
        // The agent's model and effort as they stand, ahead of the message, so a change since the launch holds.
        { type: INPUT_LINE.MODEL, model: "claude-sonnet-5-5", effort: "low" },
        {
          type: INPUT_LINE.MESSAGE,
          uuid: lineId,
          content: [{ type: "text", text: "Also the emails." }],
        },
        // The stop names the launch running the turn, by its first event number.
        { type: INPUT_LINE.STOP, launch: 0 },
      ]);
    }),
  );

  it.effect(
    "a change of model and effort reaches the running runner as a model line alone, and a session with no runner takes nothing",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;
        const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(
          Effect.provide(services(api)),
        );
        const opened = yield* sessions.open(message(agent, "Fix the invitations."));
        assert.ok(opened.outcome === EVE_SEND_OUTCOME.ACCEPTED);
        yield* updateCodingAgentChoice(userId, agent.id, {
          model: "anthropic/claude-sonnet-5.5",
          effort: "low",
        });

        const retuned = yield* sessions.retune(opened.sessionId, agent.conversationId);
        const elsewhere = yield* sessions.retune(
          `${opened.sessionId.slice(0, -4)}0000`,
          agent.conversationId,
        );

        assert.deepEqual([retuned, elsewhere], [RUNNER_CHOICE.WRITTEN, RUNNER_CHOICE.NOT_LIVE]);
        assert.equal(api.commands.length, 1);
        assert.deepEqual(linesOf(api.commands[0]).slice(2), [
          { type: INPUT_LINE.MODEL, model: "claude-sonnet-5-5", effort: "low" },
        ]);
      }),
  );

  it.effect("a Stop of a turn no longer under way writes nothing to the runner", () =>
    Effect.gen(function* () {
      vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
      const api = runnerSandboxApi();
      const { userId, agent } = yield* openAgent;
      const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(Effect.provide(services(api)));
      const opened = yield* sessions.open(message(agent, "Fix the invitations."));
      assert.ok(opened.outcome === EVE_SEND_OUTCOME.ACCEPTED);
      // The turn a Stop was pressed on, then a newer one the Stop arrives during.
      const stopped = yield* turnUnderWay(userId, agent);
      yield* TestClock.adjust("1 second");
      yield* turnUnderWay(userId, agent);

      const cancelled = yield* sessions.cancel(opened.sessionId, stopped);

      assert.equal(cancelled.outcome, EVE_CANCEL_OUTCOME.NO_ACTIVE_TURN);
      assert.ok(
        (linesOf(api.commands[0]) as InputLine[]).every((line) => line.type !== INPUT_LINE.STOP),
      );
    }),
  );

  it.effect(
    "a launch's end stops the sandbox; the next message resumes it and relaunches on the CLI's session with the next event number, and cancel then finds no turn once it ends",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;
        const sequence = { next: 0 };
        const sessions = yield* sessionsFor(userId, sequence).pipe(Effect.provide(services(api)));
        const opened = yield* sessions.open(message(agent, "Fix the invitations."));
        assert.ok(opened.outcome === EVE_SEND_OUTCOME.ACCEPTED);
        const target = { userId, conversationId: agent.conversationId };
        // The events route records the CLI's session from the runner's init, and the run ends.
        assert.equal(yield* recordCodingAgentNativeSession(userId, agent.id, CLI_SESSION), true);
        const firstBearer = api.commands[0]?.env[RUNNER_ENV.BEARER];
        sequence.next = 42;

        const ended = yield* runnerEnded({
          target,
          sessionId: opened.sessionId,
          sequence: 41,
        }).pipe(Effect.provide(api.layer));
        assert.equal(ended, RUNNER_ENDED.STOPPED);
        assert.equal(api.sandboxes[0]?.status, "stopped");
        assert.equal(
          (yield* sessions.cancel(opened.sessionId, "turn_0")).outcome,
          EVE_CANCEL_OUTCOME.NO_ACTIVE_TURN,
        );

        const sent = yield* sessions.send(opened.sessionId, message(agent, "Now the emails."));

        assert.equal(sent.outcome, EVE_SEND_OUTCOME.ACCEPTED);
        assert.equal(api.sandboxes.length, 1);
        assert.equal(api.sandboxes[0]?.status, "running");
        assert.equal(api.commands.length, 2);
        const relaunch = api.commands[1];
        assert.equal(relaunch?.sandboxSessionId, api.sandboxes[0]?.currentSessionId);
        const [config, line] = linesOf(relaunch) as [ClaudeCodeConfig, InputLine];
        assert.equal(config.resume, CLI_SESSION);
        assert.equal(config.firstSequence, 42);
        assert.ok(line.type === INPUT_LINE.MESSAGE);
        assert.deepEqual(line.content, [{ type: "text", text: "Now the emails." }]);
        // A fresh bearer for the new launch, recorded in place of the last.
        const bearer = relaunch?.env[RUNNER_ENV.BEARER];
        assert.ok(bearer !== undefined && bearer !== firstBearer);
        const routing = Option.getOrThrow(yield* readCodingAgentRouting(userId, agent.id));
        assert.equal(routing.runnerTokenHash, runnerBearerDigest(bearer));

        // The first launch's END, arriving late, stops nothing of the second's.
        const late = yield* runnerEnded({ target, sessionId: opened.sessionId, sequence: 41 }).pipe(
          Effect.provide(api.layer),
        );
        assert.equal(late, RUNNER_ENDED.STALE);
        assert.equal(api.sandboxes[0]?.status, "running");
      }),
  );

  it.effect(
    "a message after the stopped sandbox's snapshot expired deletes it and goes on in a fresh sandbox, a new checkout with no CLI session to resume",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;
        const sequence = { next: 0 };
        const sessions = yield* sessionsFor(userId, sequence).pipe(Effect.provide(services(api)));
        const opened = yield* sessions.open(message(agent, "Fix the invitations."));
        assert.ok(opened.outcome === EVE_SEND_OUTCOME.ACCEPTED);
        assert.equal(yield* recordCodingAgentNativeSession(userId, agent.id, CLI_SESSION), true);
        sequence.next = 42;
        yield* runnerEnded({
          target: { userId, conversationId: agent.conversationId },
          sessionId: opened.sessionId,
          sequence: 41,
        }).pipe(Effect.provide(api.layer));
        const [expired] = api.sandboxes;
        assert.ok(expired !== undefined);
        expired.snapshotExpired = true;

        const sent = yield* sessions.send(opened.sessionId, message(agent, "Now the emails."));

        assert.equal(sent.outcome, EVE_SEND_OUTCOME.ACCEPTED);
        assert.equal(expired.deleted, true);
        const fresh = api.sandboxes[1];
        assert.ok(fresh !== undefined);
        assert.equal(fresh.status, "running");
        assert.equal(fresh.tags[SESSION_TAG], opened.sessionId);
        const relaunch = api.commands[1];
        assert.equal(relaunch?.sandboxSessionId, fresh.currentSessionId);
        const [config, line] = linesOf(relaunch) as [ClaudeCodeConfig, InputLine];
        assert.equal(config.resume, undefined);
        assert.ok(line.type === INPUT_LINE.MESSAGE);
        assert.deepEqual(line.content, [{ type: "text", text: "Now the emails." }]);
        // The session is found again by its tag, in the new sandbox alone.
        const found = yield* sessions.send(opened.sessionId, message(agent, "And the docs."));
        assert.equal(found.outcome, EVE_SEND_OUTCOME.ACCEPTED);
        assert.equal(api.sandboxes.length, 2);
      }),
  );

  it.effect(
    "a replacement for an expired sandbox that could not launch leaves the session standing for the next message",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;
        const sequence = { next: 0 };
        const sessions = yield* sessionsFor(userId, sequence).pipe(Effect.provide(services(api)));
        const opened = yield* sessions.open(message(agent, "Fix the invitations."));
        assert.ok(opened.outcome === EVE_SEND_OUTCOME.ACCEPTED);
        sequence.next = 42;
        yield* runnerEnded({
          target: { userId, conversationId: agent.conversationId },
          sessionId: opened.sessionId,
          sequence: 41,
        }).pipe(Effect.provide(api.layer));
        const [expired] = api.sandboxes;
        assert.ok(expired !== undefined);
        expired.snapshotExpired = true;
        const preparing = yield* sessionsFor(userId, sequence).pipe(
          Effect.provide(
            Layer.merge(
              services(api),
              Layer.succeed(AgentSandboxImage, { snapshotId: Effect.fail(new ImagePreparing()) }),
            ),
          ),
        );

        const refused = yield* preparing.send(opened.sessionId, message(agent, "Now the emails."));

        assert.deepEqual(refused, {
          outcome: EVE_SEND_OUTCOME.FAILED,
          status: IMAGE_PREPARING_STATUS,
        });
        assert.equal(expired.deleted, false);
        const retried = yield* sessions.send(opened.sessionId, message(agent, "Now the emails."));
        assert.equal(retried.outcome, EVE_SEND_OUTCOME.ACCEPTED);
        assert.equal(expired.deleted, true);
        assert.equal(api.sandboxes.at(-1)?.status, "running");
      }),
  );

  it.effect(
    "an expired sandbox whose delete failed stands beside its replacement, which later messages and the launch's END still reach",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;
        const sequence = { next: 0 };
        const sessions = yield* sessionsFor(userId, sequence).pipe(Effect.provide(services(api)));
        const opened = yield* sessions.open(message(agent, "Fix the invitations."));
        assert.ok(opened.outcome === EVE_SEND_OUTCOME.ACCEPTED);
        const target = { userId, conversationId: agent.conversationId };
        sequence.next = 42;
        yield* runnerEnded({ target, sessionId: opened.sessionId, sequence: 41 }).pipe(
          Effect.provide(api.layer),
        );
        const [expired] = api.sandboxes;
        assert.ok(expired !== undefined);
        expired.snapshotExpired = true;
        api.failDelete.remaining = 1;

        const replaced = yield* sessions.send(opened.sessionId, message(agent, "Now the emails."));
        const later = yield* sessions.send(opened.sessionId, message(agent, "And the docs."));

        assert.deepEqual(
          [replaced.outcome, later.outcome],
          [EVE_SEND_OUTCOME.ACCEPTED, EVE_SEND_OUTCOME.ACCEPTED],
        );
        assert.equal(expired.deleted, false);
        assert.equal(api.sandboxes.length, 2);
        const fresh = api.sandboxes[1];
        assert.ok(fresh !== undefined);
        // The later message went to the running replacement's runner, not to a third sandbox.
        assert.equal(api.commands.length, 2);
        const [, relaunch] = api.commands;
        assert.ok(linesOf(relaunch).length >= 3);
        const ended = yield* runnerEnded({
          target,
          sessionId: opened.sessionId,
          sequence: 42,
        }).pipe(Effect.provide(api.layer));
        assert.equal(ended, RUNNER_ENDED.STOPPED);
        assert.equal(fresh.status, "stopped");
      }),
  );

  it.effect(
    "an END the replaced launch posts while its replacement's command is starting stops nothing",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;
        const sequence = { next: 0 };
        const sessions = yield* sessionsFor(userId, sequence).pipe(Effect.provide(services(api)));
        const opened = yield* sessions.open(message(agent, "Fix the invitations."));
        assert.ok(opened.outcome === EVE_SEND_OUTCOME.ACCEPTED);
        const target = { userId, conversationId: agent.conversationId };
        const first = api.commands[0];
        assert.ok(first !== undefined);
        first.exitCode = 0;
        sequence.next = 42;
        const lateEnds: string[] = [];
        // The first launch's END lands just as the relaunch's command has started, before its answer.
        api.hooks.onStart = async () => {
          lateEnds.push(
            await Effect.runPromise(
              runnerEnded({ target, sessionId: opened.sessionId, sequence: 41 }).pipe(
                Effect.provide(Layer.mergeAll(api.layer, getTestDB())),
              ),
            ),
          );
        };

        const sent = yield* sessions.send(opened.sessionId, message(agent, "Again."));

        assert.equal(sent.outcome, EVE_SEND_OUTCOME.ACCEPTED);
        assert.deepEqual(lateEnds, [RUNNER_ENDED.STALE]);
        assert.equal(api.sandboxes[0]?.status, "running");
      }),
  );

  it.effect(
    "a launch while the image is still being prepared fails as preparing and opens nothing",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;
        const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(
          Effect.provide(
            Layer.merge(
              services(api),
              Layer.succeed(AgentSandboxImage, { snapshotId: Effect.fail(new ImagePreparing()) }),
            ),
          ),
        );

        const opened = yield* sessions.open(message(agent, "Fix the invitations."));

        assert.deepEqual(opened, {
          outcome: EVE_SEND_OUTCOME.FAILED,
          status: IMAGE_PREPARING_STATUS,
        });
        assert.equal(api.sandboxes.length, 0);
      }),
  );

  it.effect(
    "a runner that exited is relaunched on the next message though its sandbox is still up",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;
        const sessions = yield* sessionsFor(userId, { next: 3 }).pipe(
          Effect.provide(services(api)),
        );
        const opened = yield* sessions.open(message(agent, "Fix the invitations."));
        assert.ok(opened.outcome === EVE_SEND_OUTCOME.ACCEPTED);
        const first = api.commands[0];
        assert.ok(first !== undefined);
        first.exitCode = 0;

        const sent = yield* sessions.send(opened.sessionId, message(agent, "Again."));

        assert.equal(sent.outcome, EVE_SEND_OUTCOME.ACCEPTED);
        assert.equal(api.commands.length, 2);
        assert.equal(api.commands[1]?.sandboxSessionId, first.sandboxSessionId);
        assert.equal(linesOf(first).length, 2);
      }),
  );

  it.effect("a launch's end leaves the sandbox up while a developer's Terminal holds it", () =>
    Effect.gen(function* () {
      vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
      const api = runnerSandboxApi();
      const { userId, agent } = yield* openAgent;
      const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(Effect.provide(services(api)));
      const opened = yield* sessions.open(message(agent, "Fix the invitations."));
      assert.ok(opened.outcome === EVE_SEND_OUTCOME.ACCEPTED);
      yield* holdSandbox(agent.conversationId, new Date(Date.UTC(2030, 0, 1)));

      const ended = yield* runnerEnded({
        target: { userId, conversationId: agent.conversationId },
        sessionId: opened.sessionId,
        sequence: 5,
      }).pipe(Effect.provide(api.layer));

      assert.equal(ended, RUNNER_ENDED.HELD);
      assert.equal(api.sandboxes[0]?.status, "running");
    }),
  );

  it.effect(
    "reset deletes the sandbox and retires the runner's bearer; a session gone answers retired",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;
        const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(
          Effect.provide(services(api)),
        );
        const opened = yield* sessions.open(message(agent, "Fix the invitations."));
        assert.ok(opened.outcome === EVE_SEND_OUTCOME.ACCEPTED);

        const reset = yield* sessions.reset(opened.sessionId);

        assert.equal(reset.outcome, EVE_RESET_OUTCOME.RESET);
        assert.equal(api.sandboxes[0]?.deleted, true);
        const routing = Option.getOrThrow(yield* readCodingAgentRouting(userId, agent.id));
        assert.equal(routing.runnerTokenHash, null);
        assert.equal(
          (yield* sessions.reset(opened.sessionId)).outcome,
          EVE_RESET_OUTCOME.NO_ACTIVE_SESSION,
        );
        assert.deepEqual(yield* sessions.send(opened.sessionId, message(agent, "Hello?")), {
          outcome: EVE_SEND_OUTCOME.RETIRED,
        });
      }),
  );

  it.effect("a session of another agent takes nothing from this conversation's messages", () =>
    Effect.gen(function* () {
      vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
      const api = runnerSandboxApi();
      const mine = yield* openAgent;
      const theirs = yield* openAgent;
      const theirSessions = yield* sessionsFor(theirs.userId, { next: 0 }).pipe(
        Effect.provide(services(api)),
      );
      const opened = yield* theirSessions.open(message(theirs.agent, "Their work."));
      assert.ok(opened.outcome === EVE_SEND_OUTCOME.ACCEPTED);
      const mySessions = yield* sessionsFor(mine.userId, { next: 0 }).pipe(
        Effect.provide(services(api)),
      );

      const sent = yield* mySessions.send(opened.sessionId, message(mine.agent, "Not yours."));
      const cancelled = yield* mySessions.cancel(opened.sessionId, "turn_0");
      const reset = yield* mySessions.reset(opened.sessionId);

      assert.deepEqual(sent, { outcome: EVE_SEND_OUTCOME.RETIRED });
      assert.equal(cancelled.outcome, EVE_CANCEL_OUTCOME.NO_ACTIVE_TURN);
      assert.equal(reset.outcome, EVE_RESET_OUTCOME.NO_ACTIVE_SESSION);
      assert.equal(api.sandboxes[0]?.deleted, false);
      assert.equal(linesOf(api.commands[0]).length, 2);
    }),
  );

  it.effect(
    "a relaunch whose config never reached the runner ends that runner, and the next message relaunches whole",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;
        const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(
          Effect.provide(services(api)),
        );
        const opened = yield* sessions.open(message(agent, "Fix the invitations."));
        assert.ok(opened.outcome === EVE_SEND_OUTCOME.ACCEPTED);
        const first = api.commands[0];
        assert.ok(first !== undefined);
        first.exitCode = 0;
        api.failStdin.remaining = 1;

        const failed = yield* sessions.send(opened.sessionId, message(agent, "Again."));
        const retried = yield* sessions.send(opened.sessionId, message(agent, "Again."));

        assert.equal(failed.outcome, EVE_SEND_OUTCOME.FAILED);
        assert.equal(retried.outcome, EVE_SEND_OUTCOME.ACCEPTED);
        assert.equal(api.commands.length, 3);
        assert.notEqual(api.commands[1]?.exitCode, null);
        const [config, line] = linesOf(api.commands[2]) as [ClaudeCodeConfig, InputLine];
        assert.equal(config.harness, RUNNER_HARNESS.CLAUDE_CODE);
        assert.equal(line.type, INPUT_LINE.MESSAGE);
      }),
  );

  it.effect(
    "a repository agent's sandbox opens with the write token at its firewall, as eve's first write sets it, and never in a command",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const userId = `user-${randomUUID()}`;
        yield* Effect.flatMap(Database, (db) =>
          db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` }),
        );
        const task = yield* startTask(userId, { name: "Relay", repository: RELAY_FULL_NAME });
        yield* connectWorkspaceGitHub(task.workspaceId, RELAY_INSTALLATION);
        const started = yield* createCodingAgent(userId, {
          taskId: task.id,
          idempotencyKey: "start-1",
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          planSnapshot: "# Relay\n",
          prompt: null,
          repository: RELAY_FULL_NAME,
        });
        const agent = Option.getOrThrow(started).agent;
        const github = githubReaching([RELAY_INSTALLATION], undefined, {}, (sent) =>
          new URL(sent.url).hostname === "vercel.com"
            ? api.respond(sent.url, { method: sent.method, headers: sent.headers, body: sent.body })
            : undefined,
        );
        const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(
          Effect.provide(
            Layer.mergeAll(
              github.layer,
              Layer.succeed(HostedEnvironment, NO_KEYS),
              Layer.succeed(AgentSandboxImage, {
                snapshotId: Effect.succeed(Option.some(SNAPSHOT)),
              }),
              Layer.succeed(RunnerBundle, { contents: Effect.succeed(BUNDLE) }),
            ),
          ),
        );

        const opened = yield* sessions.open(message(agent, "Push a branch."));

        assert.equal(opened.outcome, EVE_SEND_OUTCOME.ACCEPTED);
        const writeHeader = `Basic ${Buffer.from(`x-access-token:${GITHUB_FIXTURE_INSTALLATION_TOKEN}`).toString("base64")}`;
        assert.ok(JSON.stringify(api.policies.at(-1)?.policy).includes(writeHeader));
        assert.equal(api.commands.length, 1);
        const visible = JSON.stringify([api.commands, api.runs, api.sandboxes]);
        assert.equal(visible.includes(GITHUB_FIXTURE_INSTALLATION_TOKEN), false);
        assert.equal(visible.includes(writeHeader), false);
      }),
  );
});
