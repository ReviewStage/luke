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
  claimCodingAgentRunnerLease,
  releaseCodingAgentRunnerLease,
} from "@luke/database/models/coding-agent-runner-lease";
import {
  type CodingAgent,
  createCodingAgent,
  latestTurnsOfReached,
  readCodingAgentRouting,
  recordCodingAgentNativeSession,
  updateCodingAgentChoice,
} from "@luke/database/models/coding-agent-store";
import { installSkill } from "@luke/database/models/installed-skill-store";
import { parseKeyRing, sealProviderKey } from "@luke/database/models/provider-key-seal";
import {
  removeProviderKey,
  saveProviderKey,
  setPlanStatus,
} from "@luke/database/models/provider-key-store";
import { holdSandbox } from "@luke/database/models/sandbox-terminal-lease";
import { storeWriter } from "@luke/database/models/writer";
import { user } from "@luke/database/schemas/auth";
import { CONVERSATION_RUNTIME } from "@luke/database/storage-vocabulary";
import { getTestDB, startTask } from "@luke/database/testing";
import { CODING_AGENT_FAILURE, CODING_AGENT_PAYER } from "@luke/features/coding-agent-wire";
import { INSTALLED_SKILL_SCOPE, INSTALLED_SKILL_SOURCE } from "@luke/features/installed-skill-wire";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
} from "@luke/features/provider-key-wire";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import {
  Clock,
  DateTime,
  Duration,
  Effect,
  Fiber,
  Layer,
  Logger,
  Option,
  Redacted,
  Result,
} from "effect";
import { TestClock } from "effect/testing";
import { afterEach, vi } from "vitest";
import { TURN_ORIGIN, TURN_STATUS } from "../../core.js";
import { HostedEnvironment, type HostedEnvironmentValues } from "../../environment.js";
import { keptAfterResponse } from "../../http/after-response.js";
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
  KEY_REFUSAL,
  PLAN_REFUSAL,
} from "../brain-host/eve-sessions.js";
import { runnerTokenDigest } from "../luke-mcp/bearer.js";
import { NATIVE_TEMPLATE } from "../native-sandbox-template.js";
import { SESSION_TAG } from "../vercel-sandbox-api.js";
import { CODER } from "./bounds.js";
import {
  type ClaudeCodeSessionsOptions,
  claudeCodeSessions,
  RUNNER_ENDED,
  runnerEnded,
} from "./claude-code-sessions.js";
import { RunnerBundle } from "./runner-bundle.js";
import { RUNNER_CHOICE } from "./runtime-sessions.js";
import { codingAgentFailureOf } from "./status.js";
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

/** The one integration the agent is handed, a server of its own. */
const LINEAR_SERVER = { name: "linear", url: `${MCP_URL}/integrations/linear` };
const INSTRUCTIONS = "You are a Luke coding agent.";
const BUNDLE = new TextEncoder().encode("// the runner, bundled\nconsole.log('runner');\n");
const PLAN_TOKEN = "sk-ant-oat01-fixture-plan-token";
const API_KEY = "sk-ant-api03-fixture-account-key";
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
function services(
  api: ReturnType<typeof runnerSandboxApi>,
  snapshot: string | null = SNAPSHOT,
  http = api.layer,
) {
  return Layer.mergeAll(
    http,
    GITHUB_APP_WITH_TOKENS,
    Layer.succeed(HostedEnvironment, NO_KEYS),
    Layer.succeed(AgentSandboxImage, {
      snapshotId: Effect.succeed(Option.fromNullishOr(snapshot)),
      snapshotGone: () => Effect.void,
    }),
    Layer.succeed(RunnerBundle, { contents: Effect.succeed(BUNDLE) }),
  );
}

/** An account with one agent on a task with no repository, and no Claude plan. */
const openAgentWithoutPlan = Effect.gen(function* () {
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

/** The account's Claude plan: its setup-token, sealed as Settings saves it. */
const savePlan = (userId: string) =>
  Effect.gen(function* () {
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
  });

/** An account with one agent on a task with no repository, on its Claude plan. */
const openAgent = Effect.tap(openAgentWithoutPlan, ({ userId }) => savePlan(userId));

/** The sessions for the account, the next event number read from the counter given. */
function sessionsFor(userId: string, sequence: { next: number }) {
  const options: ClaudeCodeSessionsOptions = {
    userId,
    eventsUrl: EVENTS_URL,
    mcpUrl: MCP_URL,
    integrations: () => Effect.succeed([LINEAR_SERVER]),
    instructions: () => Effect.succeed(INSTRUCTIONS),
    nextSequence: () => Effect.sync(() => sequence.next),
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

/** A point a fake call stops at until the test opens it: `arrived` settles once a call reached it. */
function gate() {
  let arrive = () => {};
  let open = () => {};
  const arrived = new Promise<void>((settle) => {
    arrive = settle;
  });
  const opened = new Promise<void>((settle) => {
    open = settle;
  });
  return {
    arrived,
    open,
    pass: async () => {
      arrive();
      await opened;
    },
  };
}

/** Every turn of the event loop a call not held behind the lease would need to race the one held, then the held one let through, its waiter woken, until both settle. */
const raceThrough = <A, E>(held: { open: () => void }, fibers: readonly Fiber.Fiber<A, E>[]) =>
  Effect.gen(function* () {
    const turns = () =>
      Effect.promise(async () => {
        for (let turn = 0; turn < 50; turn += 1) {
          await new Promise<void>((settle) => setImmediate(settle));
        }
      });
    yield* turns();
    held.open();
    for (let poll = 0; poll < 20; poll += 1) {
      yield* turns();
      yield* TestClock.adjust(CODER.RUNNER_LEASE.POLL);
    }
    return yield* Effect.forEach(fibers, Fiber.join);
  });

/**
 * The work run, the clock moved on by `step` a time at a time, `times`
 * times, each after the event loop turned enough for a wait the work armed
 * to stand, and the work joined.
 */
const across = <A, E>(work: Effect.Effect<A, E>, step: Duration.Duration, times: number) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(work);
    for (let move = 0; move < times; move += 1) {
      yield* Effect.promise(async () => {
        for (let turn = 0; turn < 50; turn += 1) {
          await new Promise<void>((settle) => setImmediate(settle));
        }
      });
      yield* TestClock.adjust(step);
    }
    return yield* Fiber.join(fiber);
  });

/** The agent's newest turn, as its status reads it, and the word its failure is read as. */
const newestTurn = (agent: CodingAgent) =>
  Effect.map(latestTurnsOfReached([agent.conversationId]), (turns) => {
    const turn = turns.get(agent.conversationId);
    return { status: turn?.status, failure: codingAgentFailureOf(turn) };
  });

afterEach(() => {
  vi.unstubAllEnvs();
});

/** An account on its Claude plan with one agent on a task of the Relay repository, and its sessions over the fake Vercel given. */
const repositoryAgent = (
  api: ReturnType<typeof runnerSandboxApi>,
  installation: InstallationFixture = RELAY_INSTALLATION,
) =>
  Effect.gen(function* () {
    const userId = `user-${randomUUID()}`;
    yield* Effect.flatMap(Database, (db) =>
      db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` }),
    );
    yield* savePlan(userId);
    const task = yield* startTask(userId, { name: "Relay", repository: RELAY_FULL_NAME });
    yield* connectWorkspaceGitHub(task.workspaceId, installation);
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
    const github = githubReaching([installation], undefined, {}, (sent) =>
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
            snapshotGone: () => Effect.void,
          }),
          Layer.succeed(RunnerBundle, { contents: Effect.succeed(BUNDLE) }),
        ),
      ),
    );

    return { userId, agent, sessions };
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
        assert.equal(command.env[RUNNER_ENV.CLAUDE_TOKEN], PLAN_TOKEN);
        const routing = Option.getOrThrow(yield* readCodingAgentRouting(userId, agent.id));
        assert.equal(routing.runnerTokenHash, runnerTokenDigest(bearer));

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
          integrations: [LINEAR_SERVER],
          allowedDomains: config.allowedDomains,
          installedSkills: "/opt/luke/installed-skills",
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
        for (const secret of [PLAN_TOKEN, bearer]) assert.equal(visible.includes(secret), false);
      }),
  );

  it.effect(
    "open writes the member's installed skills as whole folders outside the checkout, which root installs where the config names, and writes none where there are none",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;
        const skillFile =
          "---\nname: sentry-triage\ndescription: Triage a Sentry issue.\nallowed-tools: Bash\n---\nRun `scripts/triage.sh`.\n";
        yield* installSkill(userId, {
          owner: { scope: INSTALLED_SKILL_SCOPE.PERSONAL },
          name: "sentry-triage",
          description: "Triage a Sentry issue.",
          userInvocable: true,
          source: { type: INSTALLED_SKILL_SOURCE.TEXT },
          files: [
            { path: "SKILL.md", bytes: new TextEncoder().encode(skillFile) },
            { path: "scripts/triage.sh", bytes: new TextEncoder().encode("echo triage\n") },
          ],
        });
        // A file that names no skill and describes it in words its stored description has since replaced.
        yield* installSkill(userId, {
          owner: { scope: INSTALLED_SKILL_SCOPE.PERSONAL },
          name: "incident-notes",
          description: "Write incident notes.",
          userInvocable: false,
          source: { type: INSTALLED_SKILL_SOURCE.TEXT },
          files: [
            {
              path: "SKILL.md",
              bytes: new TextEncoder().encode(
                "---\ndescription: >\n  Older words\n  over two lines.\nuser-invocable: false\n---\nWrite them.\n",
              ),
            },
          ],
        });
        const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(
          Effect.provide(services(api)),
        );

        const opened = yield* sessions.open(message(agent, "Triage it."));

        assert.equal(opened.outcome, EVE_SEND_OUTCOME.ACCEPTED);
        const skills = api.uploads.find((upload) =>
          [...upload.keys()].some((path) => path.startsWith("/tmp/luke-installed-skills/")),
        );
        assert.ok(skills !== undefined);
        // A Claude Code local plugin named luke, each skill a whole folder.
        assert.deepEqual([...skills.keys()].sort(), [
          "/tmp/luke-installed-skills/.claude-plugin/plugin.json",
          "/tmp/luke-installed-skills/skills/incident-notes/SKILL.md",
          "/tmp/luke-installed-skills/skills/sentry-triage/SKILL.md",
          "/tmp/luke-installed-skills/skills/sentry-triage/scripts/triage.sh",
        ]);
        assert.equal(
          JSON.parse(skills.get("/tmp/luke-installed-skills/.claude-plugin/plugin.json") ?? "")
            .name,
          "luke",
        );
        // Every other key and the body as installed, under the name and description Luke keeps.
        assert.equal(
          skills.get("/tmp/luke-installed-skills/skills/sentry-triage/SKILL.md"),
          '---\nname: sentry-triage\ndescription: "Triage a Sentry issue."\nallowed-tools: Bash\n---\n\nRun `scripts/triage.sh`.\n',
        );
        assert.equal(
          skills.get("/tmp/luke-installed-skills/skills/incident-notes/SKILL.md"),
          '---\nname: incident-notes\ndescription: "Write incident notes."\nuser-invocable: false\n---\n\nWrite them.\n',
        );
        // Nothing lands in the checkout, so nothing can be committed.
        assert.ok(![...skills.keys()].some((path) => path.startsWith(CODER.CHECKOUT_PATH)));

        const [command] = api.commands;
        assert.ok(command !== undefined);
        const script = command.args[1] ?? "";
        assert.match(
          script,
          /mv \/tmp\/luke-installed-skills \/opt\/luke\/installed-skills && chown -R root:root \/opt\/luke\/installed-skills && chmod -R u=rwX,go=rX/u,
        );
        const [config] = linesOf(command) as [ClaudeCodeConfig];
        assert.equal(config.installedSkills, "/opt/luke/installed-skills");

        // An account with no installed skills uploads none, and the launch installs nothing.
        const bare = runnerSandboxApi();
        const other = yield* openAgent;
        const otherSessions = yield* sessionsFor(other.userId, { next: 0 }).pipe(
          Effect.provide(services(bare)),
        );
        yield* otherSessions.open(message(other.agent, "Triage it."));
        assert.ok(
          !bare.uploads.some((upload) =>
            [...upload.keys()].some((path) => path.startsWith("/tmp/luke-installed-skills/")),
          ),
        );
      }),
  );

  it.effect(
    "a setup-token Anthropic refused refuses the launch as one to reconnect, a limit refuses it with its reset until that passes, and neither starts a runner while refused",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const { userId, agent } = yield* openAgent;
        const owner = {
          userId,
          provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
          kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
        };
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
            const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(
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
        const live = yield* sessionsFor(userId, { next: 0 }).pipe(Effect.provide(services(reset)));
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
    "an agent its starter's API key pays for launches on ANTHROPIC_API_KEY, never the plan, takes messages whatever the plan says, and is refused once the key is gone",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const userId = `user-${randomUUID()}`;
        yield* Effect.flatMap(Database, (db) =>
          db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` }),
        );
        const task = yield* startTask(userId, { name: "Teammate invitations" });
        const started = yield* createCodingAgent(userId, {
          taskId: task.id,
          idempotencyKey: "start-key",
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          planSnapshot: "# Teammate invitations\n",
          prompt: null,
          repository: null,
          runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
          payer: CODING_AGENT_PAYER.API_KEY,
        });
        assert.ok(Option.isSome(started));
        const agent = started.value.agent;
        // The account keeps a plan too, refused: an agent on its key never asks it.
        yield* savePlan(userId);
        const now = yield* DateTime.nowAsDate;
        yield* setPlanStatus(
          userId,
          PROVIDER_KEY_PROVIDER.ANTHROPIC,
          PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
          PROVIDER_KEY_STATUS.INVALID,
          undefined,
          now,
          now,
        );
        const ring = parseKeyRing(Redacted.make(RING));
        assert.ok(Result.isSuccess(ring));
        const owner = {
          userId,
          provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
          kind: PROVIDER_KEY_KIND.API_KEY,
        };
        yield* saveProviderKey(
          userId,
          owner.provider,
          owner.kind,
          sealProviderKey(ring.success, owner, Redacted.make(API_KEY)),
          "sk-ant-api…-key",
          null,
          new Date(0),
        );

        const api = runnerSandboxApi();
        const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(
          Effect.provide(services(api)),
        );
        const opened = yield* sessions.open(message(agent, "Fix the invitations."));
        assert.ok(opened.outcome === EVE_SEND_OUTCOME.ACCEPTED);
        const [command] = api.commands;
        assert.ok(command !== undefined);
        assert.equal(command.env[RUNNER_ENV.API_KEY], API_KEY);
        assert.equal(command.env[RUNNER_ENV.CLAUDE_TOKEN], undefined);
        const visible = JSON.stringify([command.args, command.stdin, api.sandboxes]);
        assert.equal(visible.includes(API_KEY), false);

        const sent = yield* sessions.send(opened.sessionId, message(agent, "Also the emails."));
        assert.equal(sent.outcome, EVE_SEND_OUTCOME.ACCEPTED);

        yield* removeProviderKey(
          userId,
          PROVIDER_KEY_PROVIDER.ANTHROPIC,
          PROVIDER_KEY_KIND.API_KEY,
        );
        const gone = runnerSandboxApi();
        const without = yield* sessionsFor(userId, { next: 0 }).pipe(
          Effect.provide(services(gone)),
        );
        assert.deepEqual(yield* without.open(message(agent, "Go.")), {
          outcome: EVE_SEND_OUTCOME.FAILED,
          status: 422,
          keyRefusal: KEY_REFUSAL.MISSING,
        });
        assert.deepEqual(gone.commands, []);
      }),
  );

  it.effect(
    "an agent its starter's API key pays for, whose saved key does not open under this deployment's ring, is refused as unreadable and starts nothing",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const userId = `user-${randomUUID()}`;
        yield* Effect.flatMap(Database, (db) =>
          db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` }),
        );
        const task = yield* startTask(userId, { name: "Teammate invitations" });
        const started = yield* createCodingAgent(userId, {
          taskId: task.id,
          idempotencyKey: "start-key",
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          planSnapshot: "# Teammate invitations\n",
          prompt: null,
          repository: null,
          runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
          payer: CODING_AGENT_PAYER.API_KEY,
        });
        assert.ok(Option.isSome(started));
        // The key was sealed under another deployment's ring, as a Preview's database holds production's.
        const elsewhere = parseKeyRing(
          Redacted.make(`1:${Buffer.alloc(32, 9).toString("base64")}`),
        );
        assert.ok(Result.isSuccess(elsewhere));
        const owner = {
          userId,
          provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
          kind: PROVIDER_KEY_KIND.API_KEY,
        };
        yield* saveProviderKey(
          userId,
          owner.provider,
          owner.kind,
          sealProviderKey(elsewhere.success, owner, Redacted.make(API_KEY)),
          "sk-ant-api…-key",
          null,
          new Date(0),
        );

        const api = runnerSandboxApi();
        const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(
          Effect.provide(services(api)),
        );
        assert.deepEqual(yield* sessions.open(message(started.value.agent, "Go.")), {
          outcome: EVE_SEND_OUTCOME.FAILED,
          status: 422,
          keyRefusal: KEY_REFUSAL.UNREADABLE,
        });
        assert.deepEqual(api.commands, []);
      }),
  );

  it.effect(
    "open answers failed and opens nothing where no snapshot or no setup-token stands",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const { userId, agent } = yield* openAgentWithoutPlan;
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
        const withoutPlan = yield* sessionsFor(userId, { next: 0 }).pipe(
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

  it.effect(
    "a PDF attached to the first message or a later one is written into the sandbox and named by its path, where an image goes as a block",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;
        const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(
          Effect.provide(services(api)),
        );
        const pdf = "%PDF-1.7 the spec";
        const png = Buffer.from("png bytes").toString("base64");
        const withFiles = (text: string, lineId: string, filename: string) => ({
          ...message(agent, text, lineId),
          message: [
            { type: "text" as const, text },
            {
              type: "file" as const,
              data: `data:application/pdf;base64,${Buffer.from(pdf).toString("base64")}`,
              mediaType: "application/pdf",
              filename,
            },
            { type: "file" as const, data: png, mediaType: "image/png", filename: "shot.png" },
          ],
        });
        const firstId = randomUUID();
        const laterId = randomUUID();

        const opened = yield* sessions.open(withFiles("Read the spec.", firstId, "Spec v2.pdf"));
        assert.ok(opened.outcome === EVE_SEND_OUTCOME.ACCEPTED);
        const sent = yield* sessions.send(
          opened.sessionId,
          withFiles("And this one.", laterId, "../../etc/notes.pdf"),
        );
        assert.equal(sent.outcome, EVE_SEND_OUTCOME.ACCEPTED);

        const firstPath = `/tmp/luke-attachments/${firstId}/2-Spec-v2.pdf`;
        const laterPath = `/tmp/luke-attachments/${laterId}/2-etc-notes.pdf`;
        const written = new Map(api.uploads.flatMap((upload) => [...upload]));
        assert.equal(written.get(firstPath), pdf);
        assert.equal(written.get(laterPath), pdf);
        const messages = (linesOf(api.commands[0]) as InputLine[]).filter(
          (each) => each.type === INPUT_LINE.MESSAGE,
        );
        assert.deepEqual(
          messages.map((each) => ("content" in each ? each.content : undefined)),
          [
            [
              { type: "text", text: "Read the spec." },
              {
                type: "text",
                text: `[Spec v2.pdf (application/pdf) was attached: it is at ${firstPath} in your sandbox, read it from there]`,
              },
              { type: "image", source: { type: "base64", media_type: "image/png", data: png } },
            ],
            [
              { type: "text", text: "And this one." },
              {
                type: "text",
                text: `[../../etc/notes.pdf (application/pdf) was attached: it is at ${laterPath} in your sandbox, read it from there]`,
              },
              { type: "image", source: { type: "base64", media_type: "image/png", data: png } },
            ],
          ],
        );
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
        { type: INPUT_LINE.MODEL, model: "claude-sonnet-5-5", fast: false, effort: "low" },
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
    "a change of model and effort reaches the running runner as a model line alone, a fast version as its base model with fast mode on, and a session with no runner takes nothing",
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
          model: "anthropic/claude-opus-5.5-fast",
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
          { type: INPUT_LINE.MODEL, model: "claude-opus-5-5", fast: true, effort: "low" },
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
        assert.equal(routing.runnerTokenHash, runnerTokenDigest(bearer));

        // The first launch's END, arriving late, stops nothing of the second's.
        const late = yield* runnerEnded({ target, sessionId: opened.sessionId, sequence: 41 }).pipe(
          Effect.provide(api.layer),
        );
        assert.equal(late, RUNNER_ENDED.STALE);
        assert.equal(api.sandboxes[0]?.status, "running");
      }),
  );

  it.effect(
    "a sandbox opens on the short timeout, and one opened before it was shortened has it lowered ahead of the resume a message makes",
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
        const sandbox = api.sandboxes[0];
        assert.ok(sandbox !== undefined);
        const openedWith = sandbox.timeout;
        // As a sandbox opened before the timeout was shortened, which Vercel reopens on its own each resume.
        sandbox.timeout = CODER.SANDBOX_MAX_LIFETIME_MS;
        yield* runnerEnded({
          target: { userId, conversationId: agent.conversationId },
          sessionId: opened.sessionId,
          sequence: 0,
        }).pipe(Effect.provide(api.layer));

        const sent = yield* sessions.send(opened.sessionId, message(agent, "Now the emails."));

        assert.equal(sent.outcome, EVE_SEND_OUTCOME.ACCEPTED);
        assert.equal(openedWith, CODER.SANDBOX_TIMEOUT_MS);
        assert.deepEqual(sandbox.resumedWith, [CODER.SANDBOX_TIMEOUT_MS]);
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
              Layer.succeed(AgentSandboxImage, {
                snapshotId: Effect.fail(new ImagePreparing()),
                snapshotGone: () => Effect.void,
              }),
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
    "a template snapshot Vercel answers gone (410 snapshot_not_found) is handed back to the image, and the open waits for the image made again and launches on its new snapshot",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        api.goneSnapshots.add(SNAPSHOT);
        const { userId, agent } = yield* openAgent;
        const handedBack: string[] = [];
        const current = { snapshot: SNAPSHOT };
        const image = Layer.succeed(AgentSandboxImage, {
          snapshotId: Effect.sync(() => Option.some(current.snapshot)),
          snapshotGone: (snapshotId) =>
            Effect.sync(() => {
              handedBack.push(snapshotId);
              current.snapshot = "snap_fixture_image_again";
            }),
        });
        const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(
          Effect.provide(Layer.merge(services(api), image)),
        );

        const opened = yield* across(
          sessions.open(message(agent, "Fix the invitations.")),
          NATIVE_TEMPLATE.POLL,
          2,
        );

        assert.equal(opened.outcome, EVE_SEND_OUTCOME.ACCEPTED);
        assert.deepEqual(handedBack, [SNAPSHOT]);
        assert.deepEqual(
          api.sandboxes.map((sandbox) => sandbox.snapshotId),
          ["snap_fixture_image_again"],
        );
        assert.equal(api.commands.length, 1);
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
    "an open answers at once while the image is still being prepared, opens nothing until it is ready, then launches with no ask again",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;
        const preparing = { remaining: 2 };
        const kept = keptAfterResponse();
        const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(
          Effect.provide(
            Layer.merge(
              services(api),
              Layer.succeed(AgentSandboxImage, {
                snapshotId: Effect.suspend(() => {
                  if (preparing.remaining === 0) return Effect.succeed(Option.some(SNAPSHOT));
                  preparing.remaining -= 1;
                  return Effect.fail(new ImagePreparing());
                }),
                snapshotGone: () => Effect.void,
              }),
            ),
          ),
        );

        const opened = yield* sessions
          .open(message(agent, "Fix the invitations."))
          .pipe(Effect.provide(kept.layer));

        assert.equal(opened.outcome, EVE_SEND_OUTCOME.ACCEPTED);
        assert.equal(api.sandboxes.length, 0);
        yield* across(kept.run, NATIVE_TEMPLATE.POLL, 3);
        assert.equal(api.sandboxes.length, 1);
        assert.equal(api.commands.length, 1);
        assert.equal((yield* newestTurn(agent)).status, undefined);
      }),
  );

  it.effect(
    "an image still being prepared past the open's wait opens nothing, and the agent's first turn reads failed for its sandbox",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;
        const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(
          Effect.provide(
            Layer.merge(
              services(api),
              Layer.succeed(AgentSandboxImage, {
                snapshotId: Effect.fail(new ImagePreparing()),
                snapshotGone: () => Effect.void,
              }),
            ),
          ),
        );
        const polls =
          Duration.toMillis(NATIVE_TEMPLATE.WAIT) / Duration.toMillis(NATIVE_TEMPLATE.POLL) + 2;

        const opened = yield* across(
          sessions.open(message(agent, "Fix the invitations.")),
          NATIVE_TEMPLATE.POLL,
          polls,
        );

        assert.equal(opened.outcome, EVE_SEND_OUTCOME.ACCEPTED);
        assert.equal(api.sandboxes.length, 0);
        assert.deepEqual(yield* newestTurn(agent), {
          status: TURN_STATUS.FAILED,
          failure: CODING_AGENT_FAILURE.SANDBOX,
        });
      }),
  );

  it.effect(
    "a Start's open answers before any sandbox is made, the launch running once the answer has left, and a plan signed out is refused at once with nothing left to run",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;
        const kept = keptAfterResponse();
        const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(
          Effect.provide(services(api)),
        );

        const opened = yield* sessions
          .open(message(agent, "Fix the invitations."))
          .pipe(Effect.provide(kept.layer));

        assert.equal(opened.outcome, EVE_SEND_OUTCOME.ACCEPTED);
        assert.deepEqual([api.sandboxes.length, api.commands.length], [0, 0]);
        yield* kept.run;
        assert.deepEqual([api.sandboxes.length, api.commands.length], [1, 1]);
        assert.ok(opened.outcome === EVE_SEND_OUTCOME.ACCEPTED);
        assert.equal(api.sandboxes[0]?.tags.sessionId, opened.sessionId);

        const unplanned = yield* openAgentWithoutPlan;
        const refusedApi = runnerSandboxApi();
        const refusedKept = keptAfterResponse();
        const unplannedSessions = yield* sessionsFor(unplanned.userId, { next: 0 }).pipe(
          Effect.provide(services(refusedApi)),
        );
        const refused = yield* unplannedSessions
          .open(message(unplanned.agent, "Go."))
          .pipe(Effect.provide(refusedKept.layer));
        assert.deepEqual(refused, {
          outcome: EVE_SEND_OUTCOME.FAILED,
          status: 422,
          planRefusal: PLAN_REFUSAL.SIGNED_OUT,
        });
        yield* refusedKept.run;
        assert.deepEqual(refusedApi.sandboxes, []);
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

  it.effect(
    "two messages at once to a runner that exited relaunch it once, and both reach that one runner in order",
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
        // The first message's relaunch is held as its command starts, the widest the race stands open.
        const held = gate();
        api.hooks.onStart = () => {
          api.hooks.onStart = undefined;
          return held.pass();
        };

        const one = yield* Effect.forkChild(
          sessions.send(opened.sessionId, message(agent, "One.")),
        );
        yield* Effect.promise(() => held.arrived);
        const two = yield* Effect.forkChild(
          sessions.send(opened.sessionId, message(agent, "Two.")),
        );
        const sent = yield* raceThrough(held, [one, two]);

        assert.deepEqual(
          sent.map((each) => each.outcome),
          [EVE_SEND_OUTCOME.ACCEPTED, EVE_SEND_OUTCOME.ACCEPTED],
        );
        assert.equal(api.commands.length, 2);
        assert.deepEqual(
          (linesOf(api.commands[1]) as InputLine[]).flatMap((each) =>
            each.type === INPUT_LINE.MESSAGE ? each.content : [],
          ),
          [
            { type: "text", text: "One." },
            { type: "text", text: "Two." },
          ],
        );
      }),
  );

  it.effect(
    "two messages at once to a running runner are both written, in order, neither over the other",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        // The first message's write of its bytes is held, after it read where the stdin stands.
        const held = gate();
        let holding = false;
        const http = fakeHttpClientLayer(async (url, init) => {
          if (holding && url.includes("/stdin") && String(init.body).includes('"data"')) {
            holding = false;
            await held.pass();
          }
          return api.respond(url, init);
        });
        const { userId, agent } = yield* openAgent;
        const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(
          Effect.provide(services(api, SNAPSHOT, http)),
        );
        const opened = yield* sessions.open(message(agent, "Fix the invitations."));
        assert.ok(opened.outcome === EVE_SEND_OUTCOME.ACCEPTED);
        holding = true;

        const one = yield* Effect.forkChild(
          sessions.send(opened.sessionId, message(agent, "One.")),
        );
        yield* Effect.promise(() => held.arrived);
        const two = yield* Effect.forkChild(
          sessions.send(opened.sessionId, message(agent, "Two.")),
        );
        const sent = yield* raceThrough(held, [one, two]);

        assert.deepEqual(
          sent.map((each) => each.outcome),
          [EVE_SEND_OUTCOME.ACCEPTED, EVE_SEND_OUTCOME.ACCEPTED],
        );
        assert.equal(api.commands.length, 1);
        assert.deepEqual(
          (linesOf(api.commands[0]) as InputLine[]).flatMap((each) =>
            each.type === INPUT_LINE.MESSAGE ? each.content : [],
          ),
          [
            { type: "text", text: "Fix the invitations." },
            { type: "text", text: "One." },
            { type: "text", text: "Two." },
          ],
        );
      }),
  );

  it.effect(
    "a runner Vercel would not read is neither relaunched beside itself nor stopped in silence",
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
        const turnId = yield* turnUnderWay(userId, agent);
        const before = linesOf(api.commands[0]).length;
        api.failCommandReads.remaining = 3;

        const sent = yield* sessions.send(opened.sessionId, message(agent, "Again."));
        const cancelled = yield* sessions.cancel(opened.sessionId, turnId);
        const retuned = yield* sessions.retune(opened.sessionId, agent.conversationId);

        assert.equal(sent.outcome, EVE_SEND_OUTCOME.FAILED);
        assert.deepEqual(cancelled, { outcome: "failed", status: 503 });
        assert.equal(retuned, RUNNER_CHOICE.FAILED);
        assert.equal(api.commands.length, 1);
        assert.equal(linesOf(api.commands[0]).length, before);
      }),
  );

  it.effect(
    "a message waiting behind another call's lease is interrupted at once, holding nothing and launching nothing",
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
        // Another instance's call holds the lease, as a launch elsewhere does.
        const now = new Date(yield* Clock.currentTimeMillis);
        const elsewhere = randomUUID();
        const until = new Date(now.getTime() + Duration.toMillis(CODER.RUNNER_LEASE.HOLD));
        assert.equal(yield* claimCodingAgentRunnerLease(agent.id, elsewhere, now, until), true);

        const waiting = yield* Effect.forkChild(
          sessions.send(opened.sessionId, message(agent, "Again.")),
        );
        yield* Effect.promise(async () => {
          for (let turn = 0; turn < 50; turn += 1) {
            await new Promise<void>((settle) => setImmediate(settle));
          }
        });
        yield* TestClock.adjust("5 seconds");
        yield* Fiber.interrupt(waiting);

        assert.equal(api.commands.length, 1);
        // The lease is still the other call's alone, and free once it lets go.
        assert.equal(yield* claimCodingAgentRunnerLease(agent.id, randomUUID(), now, until), false);
        yield* releaseCodingAgentRunnerLease(agent.id, elsewhere);
        assert.equal(yield* claimCodingAgentRunnerLease(agent.id, randomUUID(), now, until), true);
      }),
  );

  it.effect(
    "a launch's end whose credential would not come off the firewall leaves the sandbox up for the sweep",
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
        api.failPolicy.remaining = 1;

        const ended = yield* Effect.result(
          runnerEnded({
            target: { userId, conversationId: agent.conversationId },
            sessionId: opened.sessionId,
            sequence: 5,
          }).pipe(Effect.provide(api.layer)),
        );

        assert.ok(Result.isFailure(ended));
        assert.equal(api.sandboxes[0]?.status, "running");
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
        api.failStdin.status = 400;

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

  it.effect("a message whose stdin write Vercel refused in passing is written again", () =>
    Effect.gen(function* () {
      vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
      const api = runnerSandboxApi();
      const { userId, agent } = yield* openAgent;
      const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(Effect.provide(services(api)));
      const opened = yield* sessions.open(message(agent, "Fix the invitations."));
      assert.ok(opened.outcome === EVE_SEND_OUTCOME.ACCEPTED);
      api.failStdin.remaining = 1;
      api.failStdin.status = 503;

      const sending = yield* Effect.forkChild(
        sessions.send(opened.sessionId, message(agent, "Now the emails.")),
      );
      yield* TestClock.adjust(Duration.seconds(5));
      const sent = yield* Fiber.join(sending);

      assert.equal(sent.outcome, EVE_SEND_OUTCOME.ACCEPTED);
      assert.equal(api.commands.length, 1);
      const last = (linesOf(api.commands[0]) as InputLine[]).at(-1);
      assert.ok(last?.type === INPUT_LINE.MESSAGE);
      assert.deepEqual(last.content, [{ type: "text", text: "Now the emails." }]);
    }),
  );

  it.effect(
    "a launch Vercel refused after the open answered logs the call, its status, and Vercel's error, and no secret, deletes its sandbox, and reads as the agent's failed turn",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;
        const logged: string[] = [];
        const logger = Logger.layer([
          Logger.make((options) => {
            logged.push([options.message].flat().map(String).join(" "));
          }),
        ]);
        const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(
          Effect.provide(Layer.merge(services(api), logger)),
        );
        api.failStdin.remaining = 1;
        api.failStdin.status = 400;

        const opened = yield* sessions
          .open(message(agent, "Fix the invitations."))
          .pipe(Effect.provide(logger));

        assert.equal(opened.outcome, EVE_SEND_OUTCOME.ACCEPTED);
        assert.ok(
          logged.includes(
            "A Claude Code launch failed after its Start: Vercel Sandbox stdin answered 400: stdin_refused: the command's stdin was refused",
          ),
          logged.join("\n"),
        );
        const bearer = api.commands[0]?.env[RUNNER_ENV.BEARER];
        assert.ok(bearer !== undefined);
        const written = logged.join("\n");
        for (const secret of [PLAN_TOKEN, bearer, fixtureToken()]) {
          assert.equal(written.includes(secret), false);
        }
        assert.ok(api.sandboxes.every((sandbox) => sandbox.deleted));
        assert.deepEqual(yield* newestTurn(agent), {
          status: TURN_STATUS.FAILED,
          failure: CODING_AGENT_FAILURE.SANDBOX,
        });
      }),
  );

  it.effect(
    "a repository agent's sandbox opens with the write token at its firewall, as eve's first write sets it, and never in a command",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { agent, sessions } = yield* repositoryAgent(api);
        const runsAtStart: number[] = [];
        api.hooks.onStart = async () => {
          runsAtStart.push(api.runs.length);
        };

        const opened = yield* sessions.open(message(agent, "Push a branch."));

        assert.equal(opened.outcome, EVE_SEND_OUTCOME.ACCEPTED);
        // The clone and the rest of its history are both fetched before the runner starts, so no
        // fetch runs beside the agent's own git.
        const ran = (words: string) =>
          api.runs.findIndex((run) => run.args.join(" ").includes(words));
        assert.ok(ran("clone") >= 0);
        assert.ok(ran("--unshallow") > ran("clone"));
        assert.ok(ran("--unshallow") < (runsAtStart[0] ?? -1));
        const writeHeader = `Basic ${Buffer.from(`x-access-token:${GITHUB_FIXTURE_INSTALLATION_TOKEN}`).toString("base64")}`;
        assert.ok(JSON.stringify(api.policies.at(-1)?.policy).includes(writeHeader));
        assert.equal(api.commands.length, 1);
        const visible = JSON.stringify([api.commands, api.runs, api.sandboxes]);
        assert.equal(visible.includes(GITHUB_FIXTURE_INSTALLATION_TOKEN), false);
        assert.equal(visible.includes(writeHeader), false);
      }),
  );

  it.effect(
    "an image that could not be made opens nothing, and the agent's first turn reads failed for its sandbox",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;
        const sessions = yield* sessionsFor(userId, { next: 0 }).pipe(
          Effect.provide(services(api, null)),
        );

        const opened = yield* sessions.open(message(agent, "Go."));

        assert.equal(opened.outcome, EVE_SEND_OUTCOME.ACCEPTED);
        assert.deepEqual(api.sandboxes, []);
        assert.deepEqual(yield* newestTurn(agent), {
          status: TURN_STATUS.FAILED,
          failure: CODING_AGENT_FAILURE.SANDBOX,
        });
      }),
  );
});
