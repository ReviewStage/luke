/**
 * device-machine.test.ts -- a local agent's machine over a real dialect: its launch's secrets sealed in the row and handed over open once, a read that waits for its Mac's answer or is unavailable while the Mac is away, and a turn whose runner the Mac settled as gone settled lost.
 *
 * Synthetic accounts, agents, Macs, bearers, and keys throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import {
  createCodingAgent,
  hasRepository,
  latestTurnsOfReached,
} from "@luke/database/models/coding-agent-store";
import {
  answerDeviceAgentRequest,
  claimDeviceAgentRequest,
  deviceAgentRequestsWaiting,
} from "@luke/database/models/device-agent-store";
import { registerDevice } from "@luke/database/models/device-store";
import { enrollOwnDevice, removeHost } from "@luke/database/models/host-store";
import { storeWriter } from "@luke/database/models/writer";
import { user } from "@luke/database/schemas/auth";
import { deviceAgentLine } from "@luke/database/schemas/device-agent";
import { conversations } from "@luke/database/schemas/storage";
import { DEVICE_LAYOUT, getTestDB, startTask } from "@luke/database/testing";
import { BRAIN_REQUEST_FAILURE } from "@luke/features/brain";
import { CODING_AGENT_MACHINE } from "@luke/features/coding-agent-wire";
import {
  DEVICE_AGENT_REQUEST_KIND,
  DEVICE_LAUNCH_REFUSAL,
  deviceAgentLaunchPayloadSchema,
  deviceAgentLayout,
} from "@luke/features/device-agent-wire";
import { TURN_ORIGIN, TURN_STATUS } from "@luke/wire";
import { eq } from "drizzle-orm";
import { Effect, Fiber, Layer, Option, Redacted, Schema } from "effect";
import { TestClock } from "effect/testing";
import { HostedEnvironment, type HostedEnvironmentValues } from "../../environment.js";
import { LINK_OUTCOME } from "../../github/github-installations.js";
import {
  connectWorkspaceGitHub,
  GITHUB_FIXTURE_BOT,
  githubReaching,
  type InstallationFixture,
  NO_GITHUB,
} from "../../testing/github-app-fake.js";
import { sandboxDouble } from "../../testing/repository-sandbox.js";
import { checkOutAgentRepository, deepenAgentCheckout } from "../coder-host/checkout.js";
import { ranDirectlyFolderOf } from "../coder-host/status.js";
import { claimedDeviceAgentLine, settledDeviceAgentLine } from "../device-agent.js";
import { SandboxUnavailable } from "../vercel-sandbox-api.js";
import { LaunchRefused } from "./agent-machine.js";
import { deviceMachine } from "./device-machine.js";

const RING = `1:${Buffer.alloc(32, 7).toString("base64")}`;
const BEARER = "fixture-runner-bearer-0123456789";
const PLAN_TOKEN = "sk-ant-oat01-fixture-plan-token";
const FIRST_LINES = '{"harness":"claude_code"}\n{"type":"message"}\n';
const ENV = { CLAUDE_CODE_OAUTH_TOKEN: PLAN_TOKEN, LUKE_RUNNER_BEARER: BEARER };

const ENVIRONMENT: HostedEnvironmentValues = {
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

/** The repository an agent works in where a test gives it one, and the installation reaching it. */
const RELAY = { owner: "Acme", name: "Relay", defaultBranch: "trunk" } as const;
const RELAY_INSTALLATION: InstallationFixture = {
  id: 31,
  login: RELAY.owner,
  repositories: [RELAY],
};

/**
 * An account with a Mac that just registered, and an agent pinned to it
 * whose conversation runs in a session: in no repository, or in the one the
 * installation given reaches, connected to the task's workspace.
 */
const openLocalAgentIn = (installation?: InstallationFixture) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const userId = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
    const deviceId = randomUUID();
    yield* registerDevice(userId, { id: deviceId, name: "Studio", ...DEVICE_LAYOUT });
    const reached = installation?.repositories[0];
    const repository = reached === undefined ? null : `${reached.owner}/${reached.name}`;
    const task = yield* startTask(userId, { name: "Invitations", repository });
    if (installation !== undefined) {
      assert.equal(
        yield* connectWorkspaceGitHub(task.workspaceId, installation),
        LINK_OUTCOME.LINKED,
      );
    }
    const started = yield* createCodingAgent(userId, {
      taskId: task.id,
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      planSnapshot: "# Invitations\n",
      prompt: null,
      repository,
      machine: CODING_AGENT_MACHINE.DEVICE,
      deviceId,
    });
    const { agent } = Option.getOrThrow(started);
    const session = `cc-${randomUUID()}`;
    yield* db
      .update(conversations)
      .set({ runtimeSessionId: session })
      .where(eq(conversations.id, agent.conversationId));
    return { userId, deviceId, agent, session };
  });

const openLocalAgent = openLocalAgentIn();

/** The runner launched in the agent's place, found by its session as a relaunch finds it. */
const launched = (opened: Effect.Success<typeof openLocalAgent>) =>
  Effect.gen(function* () {
    const machine = yield* deviceMachine;
    const [found] = yield* machine.findPlaces(opened.session);
    assert.ok(found?.running !== undefined, "a local agent's place always stands");
    return yield* machine.launchRunner(found.running, {
      env: ENV,
      agentId: opened.agent.id,
      name: found.name,
      ready: Effect.void,
      firstLines: () => Effect.succeed({ lines: FIRST_LINES, mark: { firstSequence: 4 } }),
      abandon: () => Effect.void,
    });
  });

/** Lets a forked read's statements run until its request waits for the Mac. */
const untilAsked = (userId: string, deviceId: string) =>
  Effect.gen(function* () {
    while ((yield* deviceAgentRequestsWaiting(userId, deviceId)).length === 0)
      yield* Effect.yieldNow;
    const [request] = yield* deviceAgentRequestsWaiting(userId, deviceId);
    return Option.getOrThrow(Option.fromNullishOr(request));
  });

it.layer(Layer.mergeAll(getTestDB(), Layer.succeed(HostedEnvironment, ENVIRONMENT), NO_GITHUB))(
  "a local agent's machine",
  (it) => {
    it.effect(
      "an agent on a host its account removed is refused by name, and one on a Mac with no layout as before",
      () =>
        Effect.gen(function* () {
          const { userId, deviceId, agent } = yield* openLocalAgent;
          // The Mac the agent is pinned to is enrolled and removed, as Settings › Machines removes one.
          yield* enrollOwnDevice(userId, {
            id: deviceId,
            version: "0.1.0",
            secretHash: `secret-${randomUUID()}`,
          });
          const machine = yield* deviceMachine;
          const unregistered = yield* Effect.flip(
            machine.layout({ ...agent, deviceId: randomUUID() }),
          );
          assert.equal(yield* removeHost(userId, deviceId), true);

          const refused = yield* Effect.flip(machine.layout(agent));

          assert.ok(refused instanceof LaunchRefused);
          assert.equal(refused.deviceRemoved, true);
          assert.ok(unregistered instanceof LaunchRefused);
          assert.equal(
            unregistered.deviceRemoved,
            undefined,
            "a device never removed is no removed host",
          );
        }),
    );

    it.effect("a launch's secrets are sealed in its line and handed over open once", () =>
      Effect.gen(function* () {
        const opened = yield* openLocalAgent;
        const { handle } = yield* launched(opened);
        const db = yield* Database;
        const [row] = yield* db
          .select({ sealed: deviceAgentLine.sealedSecrets, payload: deviceAgentLine.payload })
          .from(deviceAgentLine)
          .where(eq(deviceAgentLine.id, handle.command));
        const stored = JSON.stringify(row);

        const first = yield* claimedDeviceAgentLine(opened.userId, opened.deviceId, handle.command);
        const second = yield* claimedDeviceAgentLine(
          opened.userId,
          opened.deviceId,
          handle.command,
        );
        const [after] = yield* db
          .select({ sealed: deviceAgentLine.sealedSecrets })
          .from(deviceAgentLine)
          .where(eq(deviceAgentLine.id, handle.command));

        assert.notEqual(row?.sealed ?? null, null, "the line carries its secrets sealed");
        for (const secret of [BEARER, PLAN_TOKEN, Buffer.from(BEARER).toString("base64")]) {
          assert.ok(!stored.includes(secret), "no secret stands in the row in the clear");
        }
        assert.deepEqual(
          Option.map(first, (claimed) => ("secrets" in claimed ? claimed.secrets : undefined)),
          Option.some({ env: ENV, stdin: FIRST_LINES }),
        );
        assert.ok(Option.isNone(second), "a line is claimed once");
        assert.equal(after?.sealed, null, "the claim clears the row's copy");
      }),
    );

    it.effect(
      "a launch in a repository carries who the agent's commits are by, as the cloud's checkout sets it",
      () =>
        Effect.gen(function* () {
          const opened = yield* openLocalAgentIn(RELAY_INSTALLATION);
          const github = githubReaching([RELAY_INSTALLATION]);
          const { handle } = yield* launched(opened).pipe(Effect.provide(github.layer));
          const db = yield* Database;
          const [row] = yield* db
            .select({ payload: deviceAgentLine.payload })
            .from(deviceAgentLine)
            .where(eq(deviceAgentLine.id, handle.command));
          const payload = Schema.decodeUnknownSync(deviceAgentLaunchPayloadSchema)(row?.payload);
          // The same agent's checkout in a cloud sandbox, deepened as its first write deepens it.
          const { agent } = opened;
          assert.ok(hasRepository(agent));
          const target = { userId: opened.userId, conversationId: agent.conversationId };
          const sandbox = sandboxDouble(() => undefined);
          yield* Effect.andThen(
            checkOutAgentRepository(target, agent, sandbox),
            deepenAgentCheckout(target, agent, sandbox),
          ).pipe(Effect.provide(github.layer));

          // A member with no GitHub sign-in writes as the App's bot, at the noreply address GitHub links to it.
          const bot = {
            name: GITHUB_FIXTURE_BOT.login,
            email: `${GITHUB_FIXTURE_BOT.id}+${GITHUB_FIXTURE_BOT.login}@users.noreply.github.com`,
          };
          assert.deepEqual(payload.identity, bot);
          assert.deepEqual(sandbox.identities, [bot]);
        }),
    );

    it.effect("a read waits for its Mac's answer, and is unavailable while the Mac is away", () =>
      Effect.gen(function* () {
        const { userId, deviceId, session } = yield* openLocalAgent;
        const machine = yield* deviceMachine;
        const bytes = new Uint8Array([137, 80, 78, 71]);

        const reading = yield* Effect.forkChild(machine.readFile(session, "/tmp/shot.png", 1_024));
        const request = yield* untilAsked(userId, deviceId);
        yield* claimDeviceAgentRequest(userId, deviceId, request.id);
        yield* answerDeviceAgentRequest(userId, deviceId, request.id, {
          kind: DEVICE_AGENT_REQUEST_KIND.READ_FILE,
          bytes,
        });
        yield* TestClock.adjust("1 second");
        const answered = yield* Fiber.join(reading);

        yield* TestClock.adjust("1 minute");
        const away = yield* Effect.flip(machine.readFile(session, "/tmp/shot.png", 1_024));

        assert.deepEqual(answered, bytes);
        assert.ok(
          away instanceof SandboxUnavailable,
          "a Mac silent past its presence window is away",
        );
        assert.deepEqual(
          yield* deviceAgentRequestsWaiting(userId, deviceId),
          [],
          "nothing was asked of it",
        );
      }),
    );

    it.effect(
      "a turn under way is settled lost once its Mac settles the newest launch, and only then",
      () =>
        Effect.gen(function* () {
          const opened = yield* openLocalAgent;
          const { userId, deviceId, agent } = opened;
          const older = yield* launched(opened);
          const newer = yield* launched(opened);
          yield* claimedDeviceAgentLine(userId, deviceId, older.handle.command);
          yield* claimedDeviceAgentLine(userId, deviceId, newer.handle.command);
          const writer = yield* storeWriter({ tools: {} });
          const turnId = randomUUID();
          yield* writer.enqueueTurn(
            { userId, conversationId: agent.conversationId },
            { turnId, eveTurnId: turnId, origin: TURN_ORIGIN.TYPED },
          );
          const statusNow = Effect.map(
            latestTurnsOfReached([agent.conversationId]),
            (turns) => turns.get(agent.conversationId)?.status,
          );

          yield* settledDeviceAgentLine(userId, deviceId, older.handle.command);
          const afterOlder = yield* statusNow;
          yield* settledDeviceAgentLine(userId, deviceId, newer.handle.command);
          const askedAgain = yield* settledDeviceAgentLine(userId, deviceId, newer.handle.command);

          assert.equal(askedAgain, true, "a settle the Mac asks again is answered as settled");
          assert.equal(
            afterOlder,
            TURN_STATUS.QUEUED,
            "a launch a newer one replaced settles nothing",
          );
          assert.equal(yield* statusNow, TURN_STATUS.FAILED);
        }),
    );

    it.effect(
      "a launch its Mac settled unstarted because the agent ran directly on it settles the turn as a session that ended, naming the folder its work is still in",
      () =>
        Effect.gen(function* () {
          const opened = yield* openLocalAgent;
          const { userId, deviceId, agent } = opened;
          const launch = yield* launched(opened);
          yield* claimedDeviceAgentLine(userId, deviceId, launch.handle.command);
          const writer = yield* storeWriter({ tools: {} });
          const turnId = randomUUID();
          yield* writer.enqueueTurn(
            { userId, conversationId: agent.conversationId },
            { turnId, eveTurnId: turnId, origin: TURN_ORIGIN.TYPED },
          );

          yield* settledDeviceAgentLine(
            userId,
            deviceId,
            launch.handle.command,
            1,
            DEVICE_LAUNCH_REFUSAL.RAN_DIRECTLY,
          );
          const turn = (yield* latestTurnsOfReached([agent.conversationId])).get(
            agent.conversationId,
          );

          assert.equal(turn?.status, TURN_STATUS.FAILED);
          assert.equal(turn?.failure, BRAIN_REQUEST_FAILURE.SESSION_ENDED);
          assert.equal(
            ranDirectlyFolderOf(turn),
            deviceAgentLayout(DEVICE_LAYOUT.home, agent.id).checkoutPath,
          );
        }),
    );
  },
);
