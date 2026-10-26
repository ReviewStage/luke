import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import {
  createCodingAgent,
  recordCodingAgentRunnerToken,
} from "@luke/database/models/coding-agent-store";
import { queueMacAgentLine } from "@luke/database/models/mac-agent-store";
import { beatMacDevice, registerMacDevice } from "@luke/database/models/mac-device-store";
import { type KeyRing, parseKeyRing } from "@luke/database/models/provider-key-seal";
import {
  listProviderKeyRows,
  saveProviderKey,
  setProviderKeyStatus,
} from "@luke/database/models/provider-key-store";
import { user } from "@luke/database/schemas/auth";
import { CONVERSATION_RUNTIME, type ConversationRuntime } from "@luke/database/storage-vocabulary";
import { getTestDB, MAC_DEVICE_LAYOUT, startTask } from "@luke/database/testing";
import {
  CODING_AGENT_MACHINE,
  CODING_AGENT_PAYER,
  type CodingAgentPayer,
} from "@luke/features/coding-agent-wire";
import { MAC_AGENT_LINE_KIND } from "@luke/features/mac-agent-wire";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
} from "@luke/features/provider-key-wire";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { Clock, DateTime, Effect, Layer, Logger, Option, Redacted, Result } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { CHATGPT_OAUTH, sealChatGptCredentials } from "../../accounts/chatgpt-credentials.js";
import { HostedEnvironment, type HostedEnvironmentValues } from "../../environment.js";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../../http/http.js";
import { runnerTokenDigest } from "../luke-mcp/bearer.js";
import { RUNNER_TOKEN_BRAKE, RUNNER_TOKEN_PATH, runnerTokenApp } from "./runner-token-app.js";

/**
 * The token route, answered by its group the way a function answers it, over
 * a real store and a fake of OpenAI's token endpoint: a Codex agent on its
 * starter's ChatGPT plan is handed the plan's access token under its runner's
 * bearer, renewed first where less than the margin is left of it; a missing,
 * unknown or retired bearer, or one whose agent is not on Codex on the plan,
 * is handed nothing; one agent asking too often is braked; a sign-in OpenAI
 * signed out is refused by name; and the token is never logged. Synthetic
 * accounts and tokens throughout.
 */

const ORIGIN = "https://luke.test";
const KEK = `1:${Buffer.alloc(32, 7).toString("base64")}`;
const MINUTE = 60 * 1000;

function ring(): KeyRing {
  const parsed = parseKeyRing(Redacted.make(KEK));
  if (Result.isFailure(parsed)) return assert.fail("not a ring");
  return parsed.success;
}

const ENVIRONMENT: HostedEnvironmentValues = {
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  cronSecret: undefined,
  eveDeploymentSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: Redacted.make(KEK),
};

/** OpenAI's token endpoint: each renewal rotates the refresh token and answers the next access token, good for an hour. */
function openAi() {
  const state = { renewals: 0 };
  const respond = async (url: string, init: RequestInit): Promise<Response> => {
    assert.equal(url, CHATGPT_OAUTH.TOKEN_URL);
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

/** The route's group over the test's store, OpenAI's fake, and a log the test reads, as a fetch. */
const standing = Effect.gen(function* () {
  const openai = openAi();
  const logged: string[] = [];
  const services = Layer.mergeAll(
    Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
    Layer.succeed(Database, yield* Database),
    Layer.succeed(Clock.Clock, yield* Clock.Clock),
    Layer.succeed(HostedEnvironment, ENVIRONMENT),
    fakeHttpClientLayer(openai.respond),
    Logger.layer([Logger.make(({ message }) => logged.push(JSON.stringify(message)))]),
  );
  const web = HttpRouter.toWebHandler(runnerTokenApp().pipe(HttpRouter.provideRequest(services)), {
    disableLogger: true,
  });
  yield* Effect.addFinalizer(() => Effect.promise(() => web.dispose()));
  const ask = (bearer: string | undefined, method = "POST") =>
    Effect.promise(async () => {
      const headers = new Headers();
      if (bearer !== undefined) headers.set("authorization", `Bearer ${bearer}`);
      const response = await web.handler(
        new Request(`${ORIGIN}${RUNNER_TOKEN_PATH}`, { method, headers }),
      );
      return {
        status: response.status,
        cache: response.headers.get("cache-control"),
        body: await response.json(),
      };
    });
  return { ask, openai, logged };
});

/** A coding agent on the runtime and payer given, its runner's bearer recorded. */
const agentOn = (
  runtime: ConversationRuntime,
  payer: CodingAgentPayer,
  model = "openai/gpt-5.5",
  onMac?: { readonly codex: boolean },
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const userId = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
    const task = yield* startTask(userId, { name: "Teammate invitations" });
    const deviceId = randomUUID();
    if (onMac !== undefined) {
      yield* registerMacDevice(userId, {
        id: deviceId,
        name: "Studio",
        ...MAC_DEVICE_LAYOUT,
        signedIn: { codex: onMac.codex },
      });
    }
    const started = yield* createCodingAgent(userId, {
      taskId: task.id,
      idempotencyKey: randomUUID(),
      model,
      effort: "high",
      repository: "acme/relay",
      planSnapshot: "# Teammate invitations\n",
      prompt: null,
      runtime,
      payer,
      ...(onMac === undefined ? undefined : { machine: CODING_AGENT_MACHINE.MAC, deviceId }),
    });
    const agent = Option.getOrThrow(started).agent;
    const bearer = randomBytes(32).toString("base64url");
    yield* recordCodingAgentRunnerToken(userId, agent.id, runnerTokenDigest(bearer));
    return { userId, agentId: agent.id, bearer, deviceId };
  });

const codexOnPlan = agentOn(CONVERSATION_RUNTIME.CODEX, CODING_AGENT_PAYER.CHATGPT_SUBSCRIPTION);

/** The account's ChatGPT sign-in, its access token `access-0` good for the minutes given. */
const signIn = (userId: string, minutesLeft: number) =>
  Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const { sealed, accessExpiresAt, hint } = sealChatGptCredentials(
      ring(),
      userId,
      {
        clientId: "oaiapp_test_client",
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

it.layer(getTestDB())("the runner's token route", (it) => {
  it.effect(
    "hands a Codex agent on the plan its starter's access token, uncached, renewed first once less than forty-five minutes are left, and logs none of it",
    () =>
      Effect.gen(function* () {
        const { ask, openai, logged } = yield* standing;
        const agent = yield* codexOnPlan;
        yield* signIn(agent.userId, 60);

        const fresh = yield* ask(agent.bearer);
        assert.deepEqual(fresh, {
          status: HOSTED_HTTP_STATUS.OK,
          cache: "private, no-store",
          body: { accessToken: "access-0" },
        });
        assert.equal(openai.state.renewals, 0);

        // Sixteen minutes on, forty-four are left: renewed, though a launch margin of fifteen would not have.
        yield* TestClock.adjust("16 minutes");
        const renewed = yield* ask(agent.bearer);
        assert.deepEqual(renewed.body, { accessToken: "access-1" });
        assert.equal(openai.state.renewals, 1);
        const [row] = yield* listProviderKeyRows(agent.userId, PROVIDER_KEY_KIND.CHATGPT_OAUTH);
        const now = (yield* DateTime.nowAsDate).getTime();
        assert.equal(row?.accessExpiresAt?.getTime(), now + 60 * MINUTE);

        // And held until it is due again.
        yield* TestClock.adjust("5 minutes");
        assert.deepEqual((yield* ask(agent.bearer)).body, { accessToken: "access-1" });
        assert.equal(openai.state.renewals, 1);

        const log = logged.join("\n");
        for (const secret of ["access-0", "access-1", "refresh-1", agent.bearer]) {
          assert.equal(log.includes(secret), false, "a secret in the log");
        }
      }),
  );

  it.effect(
    "hands nothing to a missing, unknown or retired bearer, nor to an agent not on Codex on the plan",
    () =>
      Effect.gen(function* () {
        const { ask, openai } = yield* standing;
        const agent = yield* codexOnPlan;
        yield* signIn(agent.userId, 60);
        const invalid = { error: HOSTED_API_ERROR.INVALID_TOKEN };

        assert.deepEqual((yield* ask(undefined)).body, invalid);
        assert.equal((yield* ask(undefined)).status, HOSTED_HTTP_STATUS.UNAUTHORIZED);
        assert.deepEqual((yield* ask("not-a-runner-bearer")).body, invalid);
        assert.equal(
          (yield* ask(agent.bearer, "GET")).status,
          HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
        );

        const others = [
          agentOn(CONVERSATION_RUNTIME.CODEX, CODING_AGENT_PAYER.API_KEY),
          agentOn(
            CONVERSATION_RUNTIME.CLAUDE_CODE,
            CODING_AGENT_PAYER.CLAUDE_SUBSCRIPTION,
            "anthropic/claude-opus-5.5",
          ),
          agentOn(CONVERSATION_RUNTIME.CLAUDE_CODE, CODING_AGENT_PAYER.CHATGPT_SUBSCRIPTION),
        ];
        for (const other of others) {
          const { userId, bearer } = yield* other;
          yield* signIn(userId, 60);
          const refused = yield* ask(bearer);
          assert.equal(refused.status, HOSTED_HTTP_STATUS.FORBIDDEN);
          assert.deepEqual(refused.body, { error: HOSTED_API_ERROR.NOT_PERMITTED });
        }

        yield* recordCodingAgentRunnerToken(agent.userId, agent.agentId, null);
        assert.deepEqual((yield* ask(agent.bearer)).body, invalid);
        assert.equal(openai.state.renewals, 0);
      }),
  );

  it.effect(
    "hands a local agent started on its Mac's own Codex sign-in no token while its running launch runs on that sign-in, and the plan's to a launch that turned to the plan, whatever the Mac says since",
    () =>
      Effect.gen(function* () {
        const { ask } = yield* standing;
        const agent = yield* agentOn(
          CONVERSATION_RUNTIME.CODEX,
          CODING_AGENT_PAYER.MAC_SIGN_IN,
          "openai/gpt-5.5",
          { codex: true },
        );
        yield* signIn(agent.userId, 60);
        /** A launch line of the agent's, as its Mac's machine queues one, on the Mac's sign-in or not. */
        const launched = (ownLogin: boolean) =>
          queueMacAgentLine(agent.userId, {
            agentId: agent.agentId,
            kind: MAC_AGENT_LINE_KIND.LAUNCH,
            payload: {
              checkoutPath: "/Users/fixture/.luke/agents/a/repository",
              repository: null,
              startBranch: null,
              firstSequence: 0,
              ...(ownLogin ? { ownLogin: true } : undefined),
            },
          });

        yield* launched(true);
        const refused = yield* ask(agent.bearer);
        assert.equal(refused.status, HOSTED_HTTP_STATUS.FORBIDDEN);
        assert.deepEqual(refused.body, { error: HOSTED_API_ERROR.NOT_PERMITTED });

        // The Mac signed out and the agent relaunched on the plan; the Mac signing in again mid-turn cuts that launch's turn no short.
        yield* launched(false);
        yield* beatMacDevice(agent.userId, agent.deviceId, { codex: true });
        assert.deepEqual((yield* ask(agent.bearer)).body, { accessToken: "access-0" });
      }),
  );

  it.effect("brakes one agent that asks too often, and lets it ask again after the window", () =>
    Effect.gen(function* () {
      const { ask } = yield* standing;
      const agent = yield* codexOnPlan;
      const other = yield* codexOnPlan;
      yield* signIn(agent.userId, 60);
      yield* signIn(other.userId, 60);

      for (let asked = 0; asked < RUNNER_TOKEN_BRAKE.maxRequestsPerWindow; asked += 1) {
        assert.equal((yield* ask(agent.bearer)).status, HOSTED_HTTP_STATUS.OK);
      }
      const braked = yield* ask(agent.bearer);
      assert.equal(braked.status, HOSTED_HTTP_STATUS.TOO_MANY_REQUESTS);
      assert.deepEqual(braked.body, { error: HOSTED_API_ERROR.QUOTA_EXHAUSTED });
      // Another agent is not braked by the first.
      assert.equal((yield* ask(other.bearer)).status, HOSTED_HTTP_STATUS.OK);

      yield* TestClock.adjust("10 minutes");
      assert.equal((yield* ask(agent.bearer)).status, HOSTED_HTTP_STATUS.OK);
    }),
  );

  it.effect("refuses by name a sign-in OpenAI signed out, or none at all", () =>
    Effect.gen(function* () {
      const { ask } = yield* standing;
      const agent = yield* codexOnPlan;
      const signedOut = { error: HOSTED_API_ERROR.AGENT_PLAN_SIGNED_OUT };
      assert.deepEqual((yield* ask(agent.bearer)).body, signedOut);

      yield* signIn(agent.userId, 60);
      const [row] = yield* listProviderKeyRows(agent.userId, PROVIDER_KEY_KIND.CHATGPT_OAUTH);
      assert.ok(row !== undefined);
      yield* setProviderKeyStatus(
        agent.userId,
        PROVIDER_KEY_PROVIDER.OPENAI,
        row.sealedKey,
        PROVIDER_KEY_STATUS.INVALID,
        yield* DateTime.nowAsDate,
      );
      const refused = yield* ask(agent.bearer);
      assert.equal(refused.status, HOSTED_HTTP_STATUS.CONFLICT);
      assert.deepEqual(refused.body, signedOut);
    }),
  );
});
