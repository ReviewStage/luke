import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import {
  type CodexConfig,
  INPUT_LINE,
  type InputLine,
  RUNNER_ENV,
  RUNNER_HARNESS,
} from "@repo/agent-runner/protocol";
import { Database } from "@repo/database/core/query";
import {
  type Agent,
  createAgent,
  readAgentRouting,
  recordAgentNativeSession,
  updateAgentChoice,
} from "@repo/database/models/agent-store";
import { registerDevice } from "@repo/database/models/device-store";
import {
  type KeyRing,
  parseKeyRing,
  sealProviderKey,
} from "@repo/database/models/provider-key-seal";
import {
  listProviderKeyRows,
  removeProviderKey,
  saveProviderKey,
  setPlanStatus,
  setProviderKeyStatus,
} from "@repo/database/models/provider-key-store";
import { holdSandbox } from "@repo/database/models/sandbox-terminal-lease";
import { storeWriter } from "@repo/database/models/writer";
import { user } from "@repo/database/schemas/auth";
import { deviceAgentLine } from "@repo/database/schemas/device-agent";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { DEVICE_LAYOUT, getTestDB, startTask } from "@repo/database/testing";
import { AGENT_MACHINE, AGENT_PAYER } from "@repo/features/agent-wire";
import {
  deviceAgentLaunchSecretsSchema,
  deviceAgentLayout,
} from "@repo/features/device-agent-wire";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
} from "@repo/features/provider-key-wire";
import { fakeHttpClientLayer } from "@repo/wire/testing";
import { eq } from "drizzle-orm";
import { DateTime, Effect, Layer, Option, Redacted, Result, Schema } from "effect";
import type { HttpClient } from "effect/http";
import { TestClock } from "effect/testing";
import { afterEach, vi } from "vitest";
import { CHATGPT_OAUTH, sealChatGptCredentials } from "../../accounts/chatgpt-credentials.js";
import { TURN_ORIGIN } from "../../core.js";
import { HostedEnvironment, type HostedEnvironmentValues } from "../../environment.js";
import { sweepCodexPlanSwaps } from "../../maintenance/codex-plan-sweep.js";
import { GITHUB_APP_WITH_TOKENS } from "../../testing/github-app-fake.js";
import {
  fixtureToken,
  launchBearer,
  launchLines,
  linesOf,
  runnerSandboxApi,
  runnerTook,
} from "../../testing/runner-sandbox-fake.js";
import { AgentSandboxImage } from "../agent-sandbox-image.js";
import { claimedDeviceAgentLine } from "../device-agent.js";
import {
  EVE_CANCEL_OUTCOME,
  EVE_RESET_OUTCOME,
  EVE_SEND_OUTCOME,
  PLAN_REFUSAL,
} from "../eve-host/eve-sessions.js";
import { agentMachinesLayer } from "../machine/agent-machines.js";
import { vercelMachineLayer } from "../machine/vercel-machine.js";
import { deploymentOidcToken } from "../vercel-sandbox-api.js";
import { runnerTokenDigest } from "../workspace-mcp/bearer.js";
import { type CodexSessionsOptions, codexSessions } from "./codex-sessions.js";
import { RunnerBundle } from "./runner-bundle.js";
import { RUNNER_ENDED, runnerEnded } from "./runner-sessions.js";
import { CODER_TOOL_SET } from "./tool-set.js";

/**
 * A coding agent's sessions on Codex, against a fake of Vercel Sandbox's
 * REST API and of OpenAI's token endpoint, over a real store: on the plan,
 * the runner launched naming our token route and handed no token, the
 * account's token renewed first where less than forty-five minutes are left;
 * a local agent's launch on its Mac, sealed in its line with no token in it,
 * on the plan's route or on the Mac's own Codex sign-in; a stop and a reset; a
 * relaunch on Codex's thread after the sandbox stopped; and a sign-in OpenAI
 * signed out, or none at all, failing the launch with that refusal and
 * opening nothing. Synthetic accounts, tokens, and snapshot ids throughout.
 */

const SNAPSHOT = "snap_fixture_image";
const EVENTS_URL = "https://app.test/api/agents/runner-events";
const LINES_URL = "https://app.test/api/agents/runner-lines";
const MCP_URL = "https://app.test/api/agents/mcp";
/** The host every address the runner reaches us at names, which the firewall swaps its bearer in on. */
const SERVICE_HOST = "app.test";

/** The one integration the agent is handed, a server of its own. */
const LINEAR_SERVER = { name: "linear", url: `${MCP_URL}/integrations/linear` };
const INSTRUCTIONS = "You are a Vespin coding agent.";
const BUNDLE = new TextEncoder().encode("// the runner, bundled\nconsole.log('runner');\n");
const KEK = `1:${Buffer.alloc(32, 3).toString("base64")}`;
const ISSUED_CLIENT = "oaiapp_test_client";
const THREAD = "019a0b1c-2d3e-7f40-8a5b-6c7d8e9f0a1b";
const TOKEN_URL = "https://app.test/api/agents/runner-token";
const MINUTE = 60 * 1000;

function ring(): KeyRing {
  const parsed = parseKeyRing(Redacted.make(KEK));
  if (Result.isFailure(parsed)) return assert.fail("not a ring");
  return parsed.success;
}

/**
 * OpenAI's token endpoint as a renewal reaches it: each renewal rotates the
 * refresh token and answers the next access token, good for an hour.
 */
function openAi() {
  const state = { renewals: 0 };
  const respond = async (url: string, init: RequestInit): Promise<Response> => {
    assert.equal(url, CHATGPT_OAUTH.TOKEN_URL, `an unexpected call to OpenAI: ${url}`);
    const form = new URLSearchParams(await new Response(init.body).text());
    assert.equal(form.get("refresh_token"), `refresh-${state.renewals}`);
    state.renewals += 1;
    return Response.json({
      access_token: `access-${state.renewals}`,
      refresh_token: `refresh-${state.renewals}`,
      expires_in: 3600,
      scope: `${CHATGPT_OAUTH.USAGE_SCOPE} offline_access openid`,
    });
  };
  return { state, respond };
}

const NO_KEYS: HostedEnvironmentValues = {
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  cronSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: Redacted.make(KEK),
};

/** The agent's machine over the fake Vercel the client given answers as, its checkout run on this test's own runner. */
function machineOver<E, R>(http: Layer.Layer<HttpClient.HttpClient, E, R>) {
  return vercelMachineLayer({
    readToken: deploymentOidcToken,
    run: (effect) => Effect.runPromise(effect),
  }).pipe(Layer.provide(http));
}

/** Everything but the store: Vercel and OpenAI behind one client, the agent's machine, the image and the bundle. */
function services(
  api: ReturnType<typeof runnerSandboxApi>,
  openai: ReturnType<typeof openAi> = openAi(),
) {
  const http = fakeHttpClientLayer((url, init) =>
    new URL(url).hostname === new URL(CHATGPT_OAUTH.TOKEN_URL).hostname
      ? openai.respond(url, init)
      : api.respond(url, init),
  );
  return Layer.mergeAll(
    http,
    machineOver(http),
    GITHUB_APP_WITH_TOKENS,
    Layer.succeed(HostedEnvironment, NO_KEYS),
    Layer.succeed(AgentSandboxImage, {
      snapshotId: Effect.succeed(Option.some(SNAPSHOT)),
      snapshotGone: () => Effect.void,
      prepared: Effect.succeed(true),
    }),
    Layer.succeed(RunnerBundle, { contents: Effect.succeed(BUNDLE) }),
  );
}

/** An account with one GPT agent on a task with no repository. */
const openAgent = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* Effect.flatMap(Database, (db) =>
    db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` }),
  );
  const task = yield* startTask(userId, { name: "Teammate invitations" });
  const started = yield* createAgent(userId, {
    taskId: task.id,
    idempotencyKey: "start-1",
    model: "openai/gpt-6.1-sol",
    effort: "xhigh",
    planSnapshot: "# Teammate invitations\n",
    prompt: null,
    repository: null,
    runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
  });
  assert.ok(Option.isSome(started));
  return { userId, agent: started.value.agent };
});

/** The account's ChatGPT sign-in, its access token `access-0` good for the minutes given. */
const signIn = (userId: string, minutesLeft: number) =>
  Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const { sealed, accessExpiresAt, hint } = sealChatGptCredentials(
      ring(),
      userId,
      {
        clientId: ISSUED_CLIENT,
        accountId: "chatgpt-subject",
        accessToken: "access-0",
        refreshToken: "refresh-0",
        idToken: "id-token-0",
        expiresInSeconds: minutesLeft * 60,
        scopes: [CHATGPT_OAUTH.USAGE_SCOPE, "offline_access", "openid"],
      },
      now,
    );
    yield* saveProviderKey(
      userId,
      PROVIDER_KEY_PROVIDER.OPENAI,
      PROVIDER_KEY_KIND.CHATGPT_OAUTH,
      sealed,
      hint,
      null,
      now,
      accessExpiresAt,
    );
  });

function sessionsFor(userId: string, sequence: { next: number } = { next: 0 }) {
  const options: CodexSessionsOptions = {
    userId,
    eventsUrl: EVENTS_URL,
    linesUrl: LINES_URL,
    mcpUrl: MCP_URL,
    integrations: () => Effect.succeed([LINEAR_SERVER]),
    instructions: () => Effect.succeed(INSTRUCTIONS),
    nextSequence: () => Effect.sync(() => sequence.next),
    tokenUrl: TOKEN_URL,
  };
  return codexSessions(options);
}

/** What the newest policy the sandbox's firewall was sent sets on OpenAI's API. */
const openAiRules = (api: ReturnType<typeof runnerSandboxApi>) => {
  const policy = api.policies.at(-1)?.policy as
    | { readonly allow?: Readonly<Record<string, unknown>> }
    | undefined;
  return policy?.allow?.["api.openai.com"];
};

/** The swap the firewall carries for a credential: its bearer set where a request carries the placeholder's. */
const swapRule = (placeholder: string, credential: string) => ({
  match: {
    headers: [{ key: { exact: "authorization" }, value: { exact: `Bearer ${placeholder}` } }],
  },
  transform: [{ headers: { authorization: `Bearer ${credential}` } }],
});

/** The developer's words of a message line: what follows the turn's own words, which lead every message (`turn-message.ts`). */
const developerContent = (line: InputLine | undefined) =>
  line?.type === INPUT_LINE.MESSAGE ? line.content.slice(1) : [];

const message = (agent: Agent, text: string, lineId?: string) => ({
  conversationId: agent.conversationId,
  turn: "typed" as const,
  message: text,
  ...(lineId === undefined ? undefined : { lineId }),
});

/** A turn of the agent's under way, as the events route queues one, by the id a Stop names it by. */
const turnUnderWay = (userId: string, agent: Agent) =>
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

it.layer(getTestDB())("a coding agent's sessions on Codex", (it) => {
  it.effect(
    "a local agent's launch on its Mac runs the Codex the Mac checked in its folder, sealed in its line with no token in it, on the plan naming the token route",
    () =>
      Effect.gen(function* () {
        const userId = `user-${randomUUID()}`;
        yield* Effect.flatMap(Database, (db) =>
          db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` }),
        );
        yield* signIn(userId, 60);
        const deviceId = randomUUID();
        const codexExecutable = "/Users/fixture/Library/Application Support/Vespin/codex/bin/codex";
        yield* registerDevice(userId, {
          id: deviceId,
          name: "Studio",
          ...DEVICE_LAYOUT,
          codexExecutable,
        });
        const task = yield* startTask(userId, { name: "Teammate invitations" });
        const localAgent = (payer: (typeof AGENT_PAYER)[keyof typeof AGENT_PAYER]) =>
          Effect.map(
            createAgent(userId, {
              taskId: task.id,
              idempotencyKey: randomUUID(),
              model: "openai/gpt-6.1-sol",
              effort: "xhigh",
              planSnapshot: "# Teammate invitations\n",
              prompt: null,
              repository: null,
              runtime: CONVERSATION_RUNTIME.CODEX,
              payer,
              machine: AGENT_MACHINE.DEVICE,
              deviceId,
            }),
            (started) => Option.getOrThrow(started).agent,
          );
        const http = fakeHttpClientLayer(() => assert.fail("a local launch reaches no network"));
        const machines = agentMachinesLayer({
          readToken: deploymentOidcToken,
          run: (effect) => Effect.runPromise(effect),
        }).pipe(Layer.provide(http));
        /** The agent's launch, its line's row as stored and its secrets as the Mac's claim opens them. */
        const launched = (agent: Agent) =>
          Effect.gen(function* () {
            // Note that the machines are provided innermost, so the Mac's machine answers rather than the fake sandbox's.
            const sessions = yield* sessionsFor(userId).pipe(
              Effect.provide(machines),
              Effect.provide(services(runnerSandboxApi())),
            );
            const opened = yield* sessions.open(message(agent, "Fix the invitations."));
            assert.equal(opened.outcome, EVE_SEND_OUTCOME.ACCEPTED);
            const db = yield* Database;
            const [row] = yield* db
              .select()
              .from(deviceAgentLine)
              .where(eq(deviceAgentLine.agentId, agent.id));
            assert.ok(row !== undefined);
            const claimed = Option.getOrThrow(
              yield* claimedDeviceAgentLine(userId, deviceId, row.id).pipe(
                Effect.provide(Layer.succeed(HostedEnvironment, NO_KEYS)),
              ),
            );
            assert.ok("secrets" in claimed);
            const secrets = Schema.decodeUnknownSync(deviceAgentLaunchSecretsSchema)(
              claimed.secrets,
            );
            const [config] = secrets.stdin
              .trimEnd()
              .split("\n")
              .map((line: string): CodexConfig => JSON.parse(line));
            assert.ok(config !== undefined);
            return { stored: JSON.stringify(row), secrets, config };
          });
        const folder = deviceAgentLayout(DEVICE_LAYOUT.home, "").folder;

        const onPlan = yield* localAgent(AGENT_PAYER.CHATGPT_SUBSCRIPTION);
        const plan = yield* launched(onPlan);
        assert.deepEqual(Object.keys(plan.secrets.env), [RUNNER_ENV.BEARER]);
        assert.equal(plan.config.executable, codexExecutable);
        assert.equal(plan.config.tokenUrl, TOKEN_URL);
        assert.deepEqual(plan.config.writableRoots, [`${folder}${onPlan.id}`]);
        const bearer = plan.secrets.env[RUNNER_ENV.BEARER] ?? "";
        // A Mac has no firewall of ours, so its runner is handed the bearer itself.
        const routing = Option.getOrThrow(yield* readAgentRouting(userId, onPlan.id));
        assert.equal(routing.runnerTokenHash, runnerTokenDigest(bearer));
        // The bearer is sealed in the row, and no token of the plan's is in the row or the launch at all.
        for (const secret of ["access-0", "refresh-0", "id-token-0", bearer]) {
          assert.equal(plan.stored.includes(secret), false, "a secret in the row in the clear");
        }
        assert.equal(JSON.stringify(plan.secrets).includes("access-0"), false);
      }),
  );

  it.effect(
    "open launches the runner in its Codex mode on the account's plan, its token held at the firewall behind the placeholder its token command answers, with the bearer's placeholder in its environment alone",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const openai = openAi();
        const { userId, agent } = yield* openAgent;
        yield* signIn(userId, 60);
        const lineId = randomUUID();
        const sessions = yield* sessionsFor(userId).pipe(Effect.provide(services(api, openai)));

        const opened = yield* sessions.open(message(agent, "Fix the invitations.", lineId));

        assert.ok(opened.outcome === EVE_SEND_OUTCOME.ACCEPTED);
        assert.match(opened.sessionId, /^codex-[0-9a-f]{12}-[0-9a-f-]{36}$/u);
        const [sandbox] = api.sandboxes;
        assert.equal(sandbox?.tags.sessionId, opened.sessionId);
        // A token with an hour left is launched on as it stands.
        assert.equal(openai.state.renewals, 0);

        const [command] = api.commands;
        assert.ok(command !== undefined);
        assert.equal(command.sudo, true);
        assert.match(command.args[1] ?? "", /exec setpriv --reuid=agent --regid=agent/u);
        assert.equal(command.env.CODEX_HOME, "/home/agent/.codex");
        assert.equal(command.env[RUNNER_ENV.CLAUDE_TOKEN], undefined);
        // App-server and its token command hold the placeholder, which the firewall standing as the
        // runner started swaps on our host for the bearer whose digest the agent's row records.
        const placeholder = command.env[RUNNER_ENV.BEARER];
        const bearer = launchBearer(api, command, SERVICE_HOST);
        assert.ok(placeholder !== undefined && bearer !== undefined && bearer.length > 20);
        const routing = Option.getOrThrow(yield* readAgentRouting(userId, agent.id));
        assert.equal(routing.runnerTokenHash, runnerTokenDigest(bearer));
        // The token is set at the firewall before the runner starts, behind the placeholder its command answers.
        const tokenPlaceholder = command.env[RUNNER_ENV.CODEX_TOKEN];
        assert.ok(tokenPlaceholder !== undefined && tokenPlaceholder.length > 20);
        assert.notEqual(tokenPlaceholder, placeholder);
        assert.deepEqual(openAiRules(api), [swapRule(tokenPlaceholder, "access-0")]);

        const [config, first] = (yield* launchLines(command)) as [CodexConfig, InputLine];
        assert.deepEqual(config, {
          harness: RUNNER_HARNESS.CODEX,
          cwd: "/workspace/repository",
          executable: "/usr/local/bin/codex",
          model: "gpt-6.1-sol",
          effort: "xhigh",
          developerInstructions: INSTRUCTIONS,
          firstSequence: 0,
          eventsUrl: EVENTS_URL,
          linesUrl: LINES_URL,
          mcpUrl: MCP_URL,
          integrations: [LINEAR_SERVER],
          tokenUrl: TOKEN_URL,
          installedSkills: "/opt/agent/installed-skills",
          warm: true,
        });
        assert.ok(first.type === INPUT_LINE.MESSAGE);
        assert.equal(first.uuid, lineId);
        assert.deepEqual(developerContent(first), [{ type: "text", text: "Fix the invitations." }]);
        // No token anywhere in the command, the placeholder only in its environment, and the bearer nowhere in the sandbox.
        assert.equal(JSON.stringify(command).includes("access-0"), false);
        const visible = JSON.stringify([
          command.args,
          yield* launchLines(command),
          api.sandboxes,
          [...(api.uploads[0]?.values() ?? [])],
        ]);
        for (const secret of [
          "access-0",
          "refresh-0",
          "id-token-0",
          placeholder,
          tokenPlaceholder,
          bearer,
        ]) {
          assert.equal(visible.includes(secret), false, "a secret outside the environment");
        }
        assert.equal(JSON.stringify(command.env).includes(bearer), false);
      }),
  );

  it.effect(
    "an agent its starter's OpenAI API key pays for launches with a placeholder as OPENAI_API_KEY, the key held at the firewall, an Ultrafast version on the ultrafast tier, never asks the plan, and is refused once the key is gone",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const apiKey = "sk-proj-fixture-account-key";
        const userId = `user-${randomUUID()}`;
        yield* Effect.flatMap(Database, (db) =>
          db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` }),
        );
        const task = yield* startTask(userId, { name: "Teammate invitations" });
        const started = yield* createAgent(userId, {
          taskId: task.id,
          idempotencyKey: "start-key",
          model: "openai/gpt-6.1-sol-ultrafast",
          effort: "xhigh",
          planSnapshot: "# Teammate invitations\n",
          prompt: null,
          repository: null,
          runtime: CONVERSATION_RUNTIME.CODEX,
          payer: AGENT_PAYER.API_KEY,
        });
        assert.ok(Option.isSome(started));
        const agent = started.value.agent;
        const owner = {
          userId,
          provider: PROVIDER_KEY_PROVIDER.OPENAI,
          kind: PROVIDER_KEY_KIND.API_KEY,
        };
        yield* saveProviderKey(
          userId,
          owner.provider,
          owner.kind,
          sealProviderKey(ring(), owner, Redacted.make(apiKey)),
          "sk-proj…-key",
          null,
          new Date(0),
        );

        // No ChatGPT sign-in at all: an agent on its key never asks one, so OpenAI's token endpoint is never called.
        const api = runnerSandboxApi();
        const openai = openAi();
        const sessions = yield* sessionsFor(userId).pipe(Effect.provide(services(api, openai)));
        const opened = yield* sessions.open(message(agent, "Fix the invitations."));
        assert.ok(opened.outcome === EVE_SEND_OUTCOME.ACCEPTED);
        const [command] = api.commands;
        assert.ok(command !== undefined);
        const placeholder = command.env[RUNNER_ENV.OPENAI_API_KEY];
        assert.ok(placeholder !== undefined && placeholder.length > 20);
        assert.deepEqual(openAiRules(api), [swapRule(placeholder, apiKey)]);
        assert.equal(command.env.CODEX_HOME, "/home/agent/.codex");
        // An Ultrafast version runs its base model on Codex's ultrafast tier, and on its fast one where the runner predates it.
        const [config] = linesOf(command) as [CodexConfig];
        assert.equal(config.model, "gpt-6.1-sol");
        assert.deepEqual([config.fast, config.ultrafast], [true, true]);
        const visible = JSON.stringify([command, api.sandboxes]);
        assert.equal(visible.includes(apiKey), false);
        assert.equal(
          (yield* sessions.send(opened.sessionId, message(agent, "Also the emails."))).outcome,
          EVE_SEND_OUTCOME.ACCEPTED,
        );
        assert.equal(openai.state.renewals, 0);

        yield* removeProviderKey(userId, owner.provider, owner.kind);
        const gone = runnerSandboxApi();
        const without = yield* sessionsFor(userId).pipe(Effect.provide(services(gone)));
        assert.equal((yield* without.open(message(agent, "Go."))).outcome, EVE_SEND_OUTCOME.FAILED);
        assert.deepEqual(gone.commands, []);
      }),
  );

  it.effect(
    "a token with less than forty-five minutes left is renewed before the launch, and handed to the runner nowhere",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const openai = openAi();
        const { userId, agent } = yield* openAgent;
        // Past the store's own ten-minute margin, and past the old launch margin of fifteen, but short of forty-five.
        yield* signIn(userId, 40);
        const sessions = yield* sessionsFor(userId).pipe(Effect.provide(services(api, openai)));

        const opened = yield* sessions.open(message(agent, "Fix the invitations."));

        assert.equal(opened.outcome, EVE_SEND_OUTCOME.ACCEPTED);
        assert.equal(openai.state.renewals, 1);
        assert.equal(JSON.stringify([api.commands, api.sandboxes]).includes("access-1"), false);
        const [row] = yield* listProviderKeyRows(userId, PROVIDER_KEY_KIND.CHATGPT_OAUTH);
        const now = (yield* DateTime.nowAsDate).getTime();
        assert.equal(row?.accessExpiresAt?.getTime(), now + 60 * MINUTE);
      }),
  );

  it.effect(
    "send writes the agent's model and effort as they stand and the message; cancel writes stop; reset deletes the sandbox and retires the bearer",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;
        yield* signIn(userId, 60);
        const sessions = yield* sessionsFor(userId).pipe(Effect.provide(services(api)));
        const opened = yield* sessions.open(message(agent, "Fix the invitations."));
        assert.ok(opened.outcome === EVE_SEND_OUTCOME.ACCEPTED);
        yield* updateAgentChoice(userId, agent.id, {
          model: "openai/gpt-4.1",
          effort: "low",
        });

        const sent = yield* sessions.send(opened.sessionId, message(agent, "Also the emails."));
        const canceled = yield* sessions.cancel(
          opened.sessionId,
          yield* turnUnderWay(userId, agent),
        );

        assert.equal(sent.outcome, EVE_SEND_OUTCOME.ACCEPTED);
        assert.equal(canceled.outcome, EVE_CANCEL_OUTCOME.ACCEPTED);
        const lines = (yield* launchLines(api.commands[0])).slice(2) as InputLine[];
        assert.deepEqual(lines[0], {
          type: INPUT_LINE.MODEL,
          model: "gpt-4.1",
          fast: false,
          effort: "low",
        });
        assert.equal(lines[1]?.type, INPUT_LINE.MESSAGE);
        assert.deepEqual(lines[2], { type: INPUT_LINE.STOP, launch: 0 });

        const reset = yield* sessions.reset(opened.sessionId);

        assert.equal(reset.outcome, EVE_RESET_OUTCOME.RESET);
        assert.equal(api.sandboxes[0]?.deleted, true);
        const routing = Option.getOrThrow(yield* readAgentRouting(userId, agent.id));
        assert.equal(routing.runnerTokenHash, null);
        assert.deepEqual(yield* sessions.send(opened.sessionId, message(agent, "Hello?")), {
          outcome: EVE_SEND_OUTCOME.RETIRED,
        });
      }),
  );

  it.effect(
    "after the sandbox stopped, the next message resumes it and relaunches the runner on Codex's thread, the next event number, a fresh bearer, and a token renewed where it is due",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const openai = openAi();
        const { userId, agent } = yield* openAgent;
        yield* signIn(userId, 60);
        const sequence = { next: 0 };
        const sessions = yield* sessionsFor(userId, sequence).pipe(
          Effect.provide(services(api, openai)),
        );
        const opened = yield* sessions.open(message(agent, "Fix the invitations."));
        assert.ok(opened.outcome === EVE_SEND_OUTCOME.ACCEPTED);
        // The events route records Codex's thread as the runner reports it, and the run ends.
        assert.equal(yield* recordAgentNativeSession(userId, agent.id, THREAD), true);
        yield* runnerTook(agent.id);
        const [first] = api.commands;
        const firstBearer = launchBearer(api, first, SERVICE_HOST);
        sequence.next = 17;
        const ended = yield* runnerEnded({
          target: { userId, conversationId: agent.conversationId },
          sessionId: opened.sessionId,
          sequence: 16,
        }).pipe(Effect.provide(services(api, openai)));
        assert.equal(ended, RUNNER_ENDED.STOPPED);
        assert.equal(api.sandboxes[0]?.status, "stopped");
        yield* TestClock.adjust("55 minutes");

        const sent = yield* sessions.send(opened.sessionId, message(agent, "Now the emails."));

        assert.equal(sent.outcome, EVE_SEND_OUTCOME.ACCEPTED);
        assert.equal(api.sandboxes.length, 1);
        assert.equal(api.sandboxes[0]?.status, "running");
        assert.equal(api.commands.length, 2);
        const relaunch = api.commands[1];
        assert.equal(relaunch?.sandboxSessionId, api.sandboxes[0]?.currentSessionId);
        assert.equal(openai.state.renewals, 1);
        const [config, line] = (yield* launchLines(relaunch)) as [CodexConfig, InputLine];
        assert.equal(config.harness, RUNNER_HARNESS.CODEX);
        assert.equal(config.threadId, THREAD);
        assert.equal(config.firstSequence, 17);
        assert.ok(line.type === INPUT_LINE.MESSAGE);
        assert.deepEqual(developerContent(line), [{ type: "text", text: "Now the emails." }]);
        // A fresh bearer for the new launch at the resumed session's firewall, recorded in place of the last.
        const bearer = launchBearer(api, relaunch, SERVICE_HOST);
        assert.ok(bearer !== undefined && bearer !== firstBearer);
        const routing = Option.getOrThrow(yield* readAgentRouting(userId, agent.id));
        assert.equal(routing.runnerTokenHash, runnerTokenDigest(bearer));
      }),
  );

  it.effect(
    "a launch's end while a developer's Terminal holds the sandbox takes the token off its firewall and leaves it up",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;
        yield* signIn(userId, 60);
        const sessions = yield* sessionsFor(userId).pipe(Effect.provide(services(api)));
        const opened = yield* sessions.open(message(agent, "Fix the invitations."));
        assert.ok(opened.outcome === EVE_SEND_OUTCOME.ACCEPTED);
        const placeholder = api.commands[0]?.env[RUNNER_ENV.CODEX_TOKEN] ?? "";
        assert.deepEqual(openAiRules(api), [swapRule(placeholder, "access-0")]);
        yield* holdSandbox(agent.conversationId, new Date(Date.UTC(2030, 0, 1)));

        yield* runnerTook(agent.id);
        const ended = yield* runnerEnded({
          target: { userId, conversationId: agent.conversationId },
          sessionId: opened.sessionId,
          sequence: 5,
        }).pipe(Effect.provide(services(api)));

        assert.equal(ended, RUNNER_ENDED.HELD);
        assert.equal(api.sandboxes[0]?.status, "running");
        assert.deepEqual(api.policies.at(-1)?.policy, { mode: "allow-all" });
      }),
  );

  it.effect(
    "a sign-in OpenAI signed out, or none, fails the launch with that refusal, deletes its sandbox and starts no runner",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const { userId, agent } = yield* openAgent;
        const none = runnerSandboxApi();
        const withoutSignIn = yield* sessionsFor(userId).pipe(Effect.provide(services(none)));
        assert.deepEqual(yield* withoutSignIn.open(message(agent, "Go.")), {
          outcome: EVE_SEND_OUTCOME.FAILED,
          status: 422,
          planRefusal: PLAN_REFUSAL.NONE,
        });
        assert.ok(none.sandboxes.every((sandbox) => sandbox.deleted));
        assert.deepEqual(none.commands, []);

        yield* signIn(userId, 60);
        const [row] = yield* listProviderKeyRows(userId, PROVIDER_KEY_KIND.CHATGPT_OAUTH);
        assert.ok(row !== undefined);
        yield* setProviderKeyStatus(
          userId,
          PROVIDER_KEY_PROVIDER.OPENAI,
          row.sealedKey,
          PROVIDER_KEY_STATUS.INVALID,
          yield* DateTime.nowAsDate,
        );
        const invalid = runnerSandboxApi();
        const openai = openAi();
        const signedOut = yield* sessionsFor(userId).pipe(
          Effect.provide(services(invalid, openai)),
        );

        assert.deepEqual(yield* signedOut.open(message(agent, "Go.")), {
          outcome: EVE_SEND_OUTCOME.FAILED,
          status: 422,
          planRefusal: PLAN_REFUSAL.SIGNED_OUT,
        });
        assert.ok(invalid.sandboxes.every((sandbox) => sandbox.deleted));
        assert.deepEqual(invalid.commands, []);
        assert.equal(openai.state.renewals, 0);
      }),
  );

  it.effect(
    "a plan whose limit a turn reached refuses the launch by name until the reset it named, then launches; an account OpenAI said is not eligible refuses by name; neither starts a runner while refused",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const { userId, agent } = yield* openAgent;
        yield* signIn(userId, 60);
        const now = yield* DateTime.nowAsDate;
        const resetsAt = new Date(now.getTime() + 30 * 60_000);
        yield* setPlanStatus(
          userId,
          PROVIDER_KEY_PROVIDER.OPENAI,
          PROVIDER_KEY_KIND.CHATGPT_OAUTH,
          PROVIDER_KEY_STATUS.LIMIT_REACHED,
          resetsAt,
          now,
          now,
        );
        const limited = runnerSandboxApi();
        const limitedSessions = yield* sessionsFor(userId).pipe(Effect.provide(services(limited)));
        assert.deepEqual(yield* limitedSessions.open(message(agent, "Go.")), {
          outcome: EVE_SEND_OUTCOME.FAILED,
          status: 422,
          planRefusal: PLAN_REFUSAL.LIMIT_REACHED,
          planResetsAt: resetsAt.getTime(),
        });
        assert.deepEqual(limited.commands, []);

        yield* TestClock.adjust("31 minutes");
        const reset = runnerSandboxApi();
        const resetSessions = yield* sessionsFor(userId).pipe(
          Effect.provide(services(reset, openAi())),
        );
        const reopened = yield* resetSessions.open(message(agent, "Go."));
        assert.equal(reopened.outcome, EVE_SEND_OUTCOME.ACCEPTED);
        assert.notDeepEqual(reset.commands, []);

        yield* setPlanStatus(
          userId,
          PROVIDER_KEY_PROVIDER.OPENAI,
          PROVIDER_KEY_KIND.CHATGPT_OAUTH,
          PROVIDER_KEY_STATUS.INELIGIBLE,
          undefined,
          yield* DateTime.nowAsDate,
          yield* DateTime.nowAsDate,
        );
        const ineligible = runnerSandboxApi();
        const ineligibleSessions = yield* sessionsFor(userId).pipe(
          Effect.provide(services(ineligible)),
        );
        assert.deepEqual(yield* ineligibleSessions.open(message(agent, "Go on.")), {
          outcome: EVE_SEND_OUTCOME.FAILED,
          status: 422,
          planRefusal: PLAN_REFUSAL.INELIGIBLE,
        });
        assert.deepEqual(ineligible.commands, []);
      }),
  );

  it.effect(
    "on the plan, the launch names the token route and hands the runner no token, a token with fifty minutes left goes as it stands, and a message renews it where it is due",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const openai = openAi();
        const { userId, agent } = yield* openAgent;
        yield* signIn(userId, 50);
        const sessions = yield* sessionsFor(userId).pipe(Effect.provide(services(api, openai)));

        const opened = yield* sessions.open(message(agent, "Fix the invitations."));
        assert.ok(opened.outcome === EVE_SEND_OUTCOME.ACCEPTED);
        assert.equal(openai.state.renewals, 0);
        // Ten minutes on, forty are left: renewed ahead of the message, and handed on nowhere.
        yield* TestClock.adjust("10 minutes");
        yield* sessions.send(opened.sessionId, message(agent, "Also the emails."));
        assert.equal(openai.state.renewals, 1);

        const [command] = api.commands;
        assert.equal(command?.env.CODEX_HOME, "/home/agent/.codex");
        const lines = linesOf(command) as [CodexConfig, ...InputLine[]];
        assert.equal(lines[0].tokenUrl, TOKEN_URL);
        const visible = JSON.stringify([command, api.sandboxes]);
        for (const secret of ["access-0", "access-1", "refresh-1"]) {
          assert.equal(visible.includes(secret), false, "a token handed to the runner");
        }
      }),
  );
});

// A database of its own, so the sweep reads this launch's firewall record alone.
it.layer(getTestDB())("the scheduled renewal of a Codex plan's token", (it) => {
  it.effect(
    "the sweep sets the account's renewed token behind the launch's placeholder before it lapses, and writes nothing while the swap carries it",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const openai = openAi();
        const { userId, agent } = yield* openAgent;
        yield* signIn(userId, 60);
        const sessions = yield* sessionsFor(userId).pipe(Effect.provide(services(api, openai)));
        const opened = yield* sessions.open(message(agent, "Fix the invitations."));
        assert.ok(opened.outcome === EVE_SEND_OUTCOME.ACCEPTED);
        const placeholder = api.commands[0]?.env[RUNNER_ENV.CODEX_TOKEN] ?? "";
        const swept = Effect.flatMap(DateTime.nowAsDate, (now) =>
          sweepCodexPlanSwaps(NO_KEYS.providerKeyEncryptionKeys, now).pipe(
            Effect.provide(services(api, openai)),
          ),
        );

        // An hour is left: nothing is due, and nothing is written.
        const sent = api.policies.length;
        assert.deepEqual(yield* swept, { renewed: 0, failed: 0 });
        assert.equal(api.policies.length, sent);
        // Twenty minutes on, forty are left: the token is renewed and set behind the same placeholder.
        yield* TestClock.adjust("20 minutes");
        assert.deepEqual(yield* swept, { renewed: 1, failed: 0 });
        assert.equal(openai.state.renewals, 1);
        assert.deepEqual(openAiRules(api), [swapRule(placeholder, "access-1")]);
        // A minute on, the swap carries the token as it stands, and is left.
        yield* TestClock.adjust("1 minute");
        assert.deepEqual(yield* swept, { renewed: 0, failed: 0 });
        assert.equal(openai.state.renewals, 1);
      }),
  );
});
