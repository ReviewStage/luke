import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { writeAccountPreferences } from "@luke/database/models/account-store";
import {
  createCodingAgent,
  recordCodingAgentRunnerToken,
} from "@luke/database/models/coding-agent-store";
import { queueDeviceAgentLine } from "@luke/database/models/device-agent-store";
import { beatDevice, registerDevice } from "@luke/database/models/device-store";
import {
  enrollHost,
  enrollOwnDevice,
  mintHostInstallToken,
} from "@luke/database/models/host-store";
import { type KeyRing, parseKeyRing } from "@luke/database/models/provider-key-seal";
import {
  listProviderKeyRows,
  saveProviderKey,
  setProviderKeyStatus,
} from "@luke/database/models/provider-key-store";
import { user } from "@luke/database/schemas/auth";
import { CONVERSATION_RUNTIME, type ConversationRuntime } from "@luke/database/storage-vocabulary";
import { DEVICE_LAYOUT, getTestDB, startTask } from "@luke/database/testing";
import {
  CODING_AGENT_MACHINE,
  CODING_AGENT_PAYER,
  type CodingAgentPayer,
} from "@luke/features/coding-agent-wire";
import {
  DEVICE_AGENT_LINE_KIND,
  DEVICE_ARCH,
  DEVICE_ISOLATION,
  DEVICE_PLATFORM,
  type DeviceIsolation,
} from "@luke/features/device-agent-wire";
import { HOST_WIRE } from "@luke/features/host-wire";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
} from "@luke/features/provider-key-wire";
import { EXPERIMENT } from "@luke/settings";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { Clock, DateTime, Effect, Layer, Logger, Option, Redacted, Result } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { CHATGPT_OAUTH, sealChatGptCredentials } from "../../accounts/chatgpt-credentials.js";
import { HOST_VERSION, mintHostSecret } from "../../auth/device-secret.js";
import { HostedEnvironment, type HostedEnvironmentValues } from "../../environment.js";
import { GitHubApp } from "../../github/github-app.js";
import { LINK_OUTCOME } from "../../github/github-installations.js";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../../http/http.js";
import {
  connectWorkspaceGitHub,
  GITHUB_FIXTURE_INSTALLATION_TOKEN,
  githubReaching,
  type InstallationFixture,
} from "../../testing/github-app-fake.js";
import { runnerTokenDigest } from "../luke-mcp/bearer.js";
import { RUNNER_TOKEN_BRAKE, RUNNER_TOKEN_PATH, runnerTokenApp } from "./runner-token-app.js";

/**
 * The token route, answered by its group the way a function answers it, over
 * a real store and a fake of OpenAI's token endpoint: a Codex agent on its
 * starter's ChatGPT plan is handed the plan's access token under its runner's
 * bearer, renewed first where less than the margin is left of it; a missing,
 * unknown or retired bearer, or one whose agent is not on Codex on the plan,
 * is handed nothing; one agent asking too often is braked; a sign-in OpenAI
 * signed out is refused by name; and the token is never logged. A host, on
 * its device secret, is handed an installation token for its own member's
 * agent that runs on it, over a fake GitHub, and nothing for any other
 * agent or caller. Synthetic accounts and tokens throughout.
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
  const web = HttpRouter.toWebHandler(
    runnerTokenApp({ resolveUserId: () => Effect.succeedNone }).pipe(
      HttpRouter.provideRequest(Layer.merge(services, GitHubApp.layer(undefined))),
    ),
    {
      disableLogger: true,
    },
  );
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
      yield* registerDevice(userId, {
        id: deviceId,
        name: "Studio",
        ...DEVICE_LAYOUT,
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
      ...(onMac === undefined ? undefined : { machine: CODING_AGENT_MACHINE.DEVICE, deviceId }),
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
          queueDeviceAgentLine(agent.userId, {
            agentId: agent.agentId,
            kind: DEVICE_AGENT_LINE_KIND.LAUNCH,
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
        yield* beatDevice(agent.userId, agent.deviceId, { codex: true });
        assert.deepEqual((yield* ask(agent.bearer)).body, { accessToken: "access-0" });
      }),
  );

  it.effect(
    "hands a runner whose bearer happens to begin like a host's device secret its token",
    () =>
      Effect.gen(function* () {
        const { ask } = yield* standing;
        const agent = yield* codexOnPlan;
        yield* signIn(agent.userId, 60);
        const bearer = `${HOST_WIRE.DEVICE_SECRET_PREFIX}${randomBytes(32).toString("base64url")}`;
        yield* recordCodingAgentRunnerToken(agent.userId, agent.agentId, runnerTokenDigest(bearer));

        assert.deepEqual((yield* ask(bearer)).body, { accessToken: "access-0" });
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

const RELAY = { owner: "acme", name: "relay" } as const;
/** The installation reaching the repository under the id given; each member connects their own, since one installation stands for one workspace. */
const installationOf = (id: number): InstallationFixture => ({
  id,
  login: RELAY.owner,
  repositories: [RELAY],
});
/** The installations the fake GitHub holds, one taken by each member a test opens, since the suite's store links each to one workspace for good. */
const INSTALLATIONS = Array.from({ length: 8 }, (_, index) => installationOf(31 + index));
let installationsTaken = 0;

/** The route's group over the test's store, a GitHub on which the App reaches the repository, and a log the test reads, as a fetch a host or a desktop makes; `desktops` names the member each desktop sign-in's bearer stands for. */
const hostStanding = Effect.gen(function* () {
  const github = githubReaching(INSTALLATIONS);
  const desktops = new Map<string, string>();
  const resolveUserId = (request: Request) =>
    Effect.succeed(
      Option.fromNullishOr(
        desktops.get(request.headers.get("authorization")?.replace(/^Bearer /u, "") ?? ""),
      ),
    );
  const logged: string[] = [];
  const services = Layer.mergeAll(
    Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
    Layer.succeed(Database, yield* Database),
    Layer.succeed(Clock.Clock, yield* Clock.Clock),
    Layer.succeed(HostedEnvironment, ENVIRONMENT),
    github.layer,
    Logger.layer([Logger.make(({ message }) => logged.push(JSON.stringify(message)))]),
  );
  const web = HttpRouter.toWebHandler(
    runnerTokenApp({ resolveUserId }).pipe(HttpRouter.provideRequest(services)),
    { disableLogger: true },
  );
  yield* Effect.addFinalizer(() => Effect.promise(() => web.dispose()));
  const ask = (bearer: string, agentId: string) =>
    Effect.promise(async () => {
      const response = await web.handler(
        new Request(`${ORIGIN}${RUNNER_TOKEN_PATH}`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${bearer}`,
            [HOST_WIRE.VERSION_HEADER]: HOST_VERSION.FLOOR,
          },
          body: JSON.stringify({ agentId }),
        }),
      );
      return {
        status: response.status,
        cache: response.headers.get("cache-control"),
        body: await response.json(),
      };
    });
  return { ask, logged, desktops };
});

/** A member whose task's workspace reaches the repository through an installation of its own. */
const openMember = Effect.gen(function* () {
  const installation = INSTALLATIONS[installationsTaken++];
  assert.ok(installation !== undefined, "more members than installations");
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  const task = yield* startTask(userId, {
    name: "Teammate invitations",
    repository: `${RELAY.owner}/${RELAY.name}`,
  });
  assert.equal(yield* connectWorkspaceGitHub(task.workspaceId, installation), LINK_OUTCOME.LINKED);
  return { userId, taskId: task.id };
});

/** A host enrolled under the member with Local agents on, and registered running its agents in VMs, as a host does once it starts: its device id and its secret. */
const enrolledHost = (userId: string) =>
  Effect.gen(function* () {
    yield* writeAccountPreferences(userId, { experiments: { [EXPERIMENT.LOCAL_AGENTS]: true } });
    const install = mintHostSecret(HOST_WIRE.INSTALL_TOKEN_PREFIX);
    yield* mintHostInstallToken(userId, install.hash);
    const secret = mintHostSecret(HOST_WIRE.DEVICE_SECRET_PREFIX);
    const deviceId = randomUUID();
    const enrolled = yield* enrollHost(install.hash, {
      id: deviceId,
      name: "rack-1",
      platform: DEVICE_PLATFORM.LINUX,
      arch: DEVICE_ARCH.X64,
      version: HOST_VERSION.FLOOR,
      secretHash: secret.hash,
    });
    assert.ok("userId" in enrolled, "the host was not enrolled");
    yield* registerDevice(userId, {
      id: deviceId,
      name: "rack-1",
      ...DEVICE_LAYOUT,
      platform: DEVICE_PLATFORM.LINUX,
      isolation: DEVICE_ISOLATION.SANDBOX,
    });
    return { deviceId, secret: secret.secret };
  });

/** A Mac registered under the member, running its agents as `isolation` says, and enrolled on a secret of its own: its device id and its secret. */
const enrolledMac = (userId: string, isolation: DeviceIsolation) =>
  Effect.gen(function* () {
    const deviceId = randomUUID();
    yield* registerDevice(userId, {
      id: deviceId,
      name: "Studio",
      ...DEVICE_LAYOUT,
      isolation,
      signedIn: {},
    });
    const secret = mintHostSecret(HOST_WIRE.DEVICE_SECRET_PREFIX);
    const enrolled = yield* enrollOwnDevice(userId, {
      id: deviceId,
      version: HOST_VERSION.FLOOR,
      secretHash: secret.hash,
    });
    assert.ok(enrolled, "the Mac was not enrolled");
    return { deviceId, secret: secret.secret };
  });

/** A Claude Code agent of the member's on the repository, run on the device given. */
const agentOnDevice = (
  member: { readonly userId: string; readonly taskId: string },
  deviceId: string,
) =>
  Effect.gen(function* () {
    const started = yield* createCodingAgent(member.userId, {
      taskId: member.taskId,
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      repository: `${RELAY.owner}/${RELAY.name}`,
      planSnapshot: "# Teammate invitations\n",
      prompt: null,
      runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
      payer: CODING_AGENT_PAYER.CLAUDE_SUBSCRIPTION,
      machine: CODING_AGENT_MACHINE.DEVICE,
      deviceId,
    });
    return Option.getOrThrow(started).agent.id;
  });

it.layer(getTestDB())("a host's GitHub token", (it) => {
  it.effect(
    "hands a host an installation token for its own member's agent that runs on it, uncached, and logs neither the token nor the secret",
    () =>
      Effect.gen(function* () {
        const { ask, logged } = yield* hostStanding;
        const member = yield* openMember;
        const host = yield* enrolledHost(member.userId);
        const agentId = yield* agentOnDevice(member, host.deviceId);

        assert.deepEqual(yield* ask(host.secret, agentId), {
          status: HOSTED_HTTP_STATUS.OK,
          cache: "private, no-store",
          body: { githubToken: GITHUB_FIXTURE_INSTALLATION_TOKEN },
        });
        const log = logged.join("\n");
        for (const secret of [GITHUB_FIXTURE_INSTALLATION_TOKEN, host.secret]) {
          assert.equal(log.includes(secret), false, "a secret in the log");
        }
      }),
  );

  it.effect(
    "refuses another device's agent, another member's agent, and a caller that is no host",
    () =>
      Effect.gen(function* () {
        const { ask } = yield* hostStanding;
        const member = yield* openMember;
        const host = yield* enrolledHost(member.userId);
        const own = yield* agentOnDevice(member, host.deviceId);
        const forbidden = {
          status: HOSTED_HTTP_STATUS.FORBIDDEN,
          cache: null,
          body: { error: HOSTED_API_ERROR.NOT_PERMITTED },
        };

        // The member's agent on another of their hosts, and on their desktop.
        const otherHost = yield* enrolledHost(member.userId);
        const onOtherHost = yield* agentOnDevice(member, otherHost.deviceId);
        assert.deepEqual(yield* ask(host.secret, onOtherHost), forbidden);
        const desktopId = randomUUID();
        yield* registerDevice(member.userId, {
          id: desktopId,
          name: "Studio",
          ...DEVICE_LAYOUT,
          signedIn: { codex: false },
        });
        const onDesktop = yield* agentOnDevice(member, desktopId);
        assert.deepEqual(yield* ask(host.secret, onDesktop), forbidden);

        // Another member's agent on that member's own host.
        const other = yield* openMember;
        const theirHost = yield* enrolledHost(other.userId);
        const theirs = yield* agentOnDevice(other, theirHost.deviceId);
        assert.deepEqual(yield* ask(host.secret, theirs), forbidden);

        // A desktop's sign-in, or any bearer that is no device secret, is no host, and no runner either.
        const desktop = yield* ask("desktop-session-token", own);
        assert.equal(desktop.status, HOSTED_HTTP_STATUS.UNAUTHORIZED);
        assert.deepEqual(desktop.body, { error: HOSTED_API_ERROR.INVALID_TOKEN });
      }),
  );
});

it.layer(getTestDB())("a Mac's GitHub token", (it) => {
  it.effect(
    "refuses a desktop's own sign-in as needing an upgrade, even for its member's own agent on a sandboxed Mac",
    () =>
      Effect.gen(function* () {
        const { ask, desktops } = yield* hostStanding;
        const member = yield* openMember;
        yield* writeAccountPreferences(member.userId, {
          experiments: { [EXPERIMENT.LOCAL_AGENTS]: true },
        });
        desktops.set("desktop-sign-in", member.userId);
        const mac = yield* enrolledMac(member.userId, DEVICE_ISOLATION.SANDBOX);
        const agentId = yield* agentOnDevice(member, mac.deviceId);

        assert.deepEqual(yield* ask("desktop-sign-in", agentId), {
          status: HOSTED_HTTP_STATUS.UPGRADE_REQUIRED,
          cache: null,
          body: { error: HOSTED_API_ERROR.HOST_UPGRADE_NEEDED },
        });
        assert.equal((yield* ask(mac.secret, agentId)).status, HOSTED_HTTP_STATUS.OK);
      }),
  );

  it.effect(
    "refuses an agent on a Mac running its agents directly on it, and a member with Local agents off",
    () =>
      Effect.gen(function* () {
        const { ask } = yield* hostStanding;
        const forbidden = {
          status: HOSTED_HTTP_STATUS.FORBIDDEN,
          cache: null,
          body: { error: HOSTED_API_ERROR.NOT_PERMITTED },
        };
        const member = yield* openMember;
        const sandboxed = yield* enrolledMac(member.userId, DEVICE_ISOLATION.SANDBOX);
        const onSandboxed = yield* agentOnDevice(member, sandboxed.deviceId);

        // With Local agents off, even the member's own sandboxed Mac is refused.
        assert.deepEqual(yield* ask(sandboxed.secret, onSandboxed), forbidden);
        yield* writeAccountPreferences(member.userId, {
          experiments: { [EXPERIMENT.LOCAL_AGENTS]: true },
        });

        const bare = yield* enrolledMac(member.userId, DEVICE_ISOLATION.BARE);
        assert.deepEqual(
          yield* ask(bare.secret, yield* agentOnDevice(member, bare.deviceId)),
          forbidden,
        );
      }),
  );
});
