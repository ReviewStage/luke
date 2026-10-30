/**
 * device-agents-procedures.test.ts -- a local agent's device through its routes, over a real dialect: a desktop's own sign-in is refused as needing an upgrade, a Mac enrolls on that sign-in, created where Luke never saw it and never under another account, and a host calls on its own secret, for itself alone, its live agents' read included, at or past the version floor, until it is removed; a box pairs with a code a member approves, its secret handed over once, or is denied, or lapses, polled no faster than the interval, while an account that guesses too many codes is held.
 *
 * Synthetic accounts, bearers, codes, Macs, hosts, and keys throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { createAgent, latestTurnsOfReached } from "@luke/database/models/agent-store";
import { storeWriter } from "@luke/database/models/writer";
import { user } from "@luke/database/schemas/auth";
import { DEVICE_LAYOUT, getTestDB, startTask } from "@luke/database/testing";
import { AGENT_MACHINE } from "@luke/features/agent-wire";
import {
  DEVICE_ARCH,
  DEVICE_PLATFORM,
  DEVICE_SETUP,
  type DeviceSetup,
} from "@luke/features/device-agent-wire";
import { HOST_WIRE } from "@luke/features/host-wire";
import { RUN_EVENT, RUN_TURN_ORIGIN, TURN_TRIGGER } from "@luke/features/turn-run";
import { sessionKey } from "@luke/runtime/vocabulary";
import { TURN_ORIGIN, TURN_STATUS } from "@luke/wire";
import { Clock, type Context, Effect, Layer, Option, Redacted } from "effect";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { HOST_VERSION } from "../auth/device-secret.js";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import { recordingProductAnalytics, SERVER_EVENT } from "../events/server-events.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import { CODER_TOOL_SET } from "./coder-host/tool-set.js";
import { deviceAgentsProcedures } from "./device-agents-procedures.js";
import { hostsProcedures } from "./hosts-procedures.js";

const ORIGIN = "https://luke.test";
const PATH = {
  DEVICES: "/api/device-agents/devices",
  PRESENCE: "/api/device-agents/presence",
  LINES: "/api/device-agents/lines",
  LINE_CLAIM: "/api/device-agents/lines/claim",
  LIVE_AGENTS: "/api/device-agents/live-agents",
  ENROLL_OWN: "/api/device-agents/devices/enroll",
  HOSTS: "/api/hosts",
  HOST_REMOVE: "/api/hosts/remove",
  PAIRING_START: "/api/device-agents/pairing",
  PAIRING_POLL: "/api/device-agents/pairing/poll",
  PAIRING: "/api/hosts/pairing",
  PAIRING_APPROVE: "/api/hosts/pairing/approve",
  PAIRING_DENY: "/api/hosts/pairing/deny",
} as const;

/** A daemon below the floor. */
const OLD_VERSION = "0.0.9";

/** The deployment's environment, its key ring a throwaway of this file's. */
const ENVIRONMENT: HostedEnvironmentValues = {
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  cronSecret: undefined,
  eveDeploymentSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: Redacted.make(`1:${Buffer.alloc(32, 9).toString("base64")}`),
};

/** What the routes counted, across the file; a case reads its own account's. */
const ANALYTICS = recordingProductAnalytics();

/** The properties of each event of one name the account was counted for, in order. */
const countedProperties = (userId: string, name: string) =>
  ANALYTICS.recorded
    .filter((event) => event.userId === userId && event.name === name)
    .map((event) => event.properties);

/** One request of the device's, on the bearer given (an account's, or a host's secret), its body as JSON or its device in the query, a daemon's version where one is given, and the address the platform names where one is given; a POST with no body where asked. */
function request(
  bearer: string | undefined,
  path: string,
  init: {
    readonly body?: object;
    readonly deviceId?: string;
    readonly version?: string;
    readonly ip?: string;
    readonly post?: true;
  } = {},
): Request {
  const url = new URL(path, ORIGIN);
  if (init.deviceId !== undefined) url.searchParams.set("deviceId", init.deviceId);
  return new Request(url, {
    method: init.body === undefined && init.post === undefined ? "GET" : "POST",
    headers: {
      ...(bearer === undefined ? {} : { authorization: `Bearer ${bearer}` }),
      ...(init.version === undefined ? {} : { [HOST_WIRE.VERSION_HEADER]: init.version }),
      ...(init.ip === undefined ? {} : { "x-real-ip": init.ip }),
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

/** What the route answered one request with, over the test's database and clock. */
const answerOf = (incoming: Request) =>
  Effect.gen(function* () {
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
      Layer.succeed(HostedEnvironment, yield* HostedEnvironment),
      ANALYTICS.layer,
    );
    const context = yield* Effect.context<SqlClient.SqlClient>().pipe(Effect.provide(services));
    const seams = {
      resolveUserId: (asked: Request) =>
        Effect.succeed(
          Option.fromNullishOr(
            asked.headers.get("authorization")?.match(/^Bearer (user-.+)$/u)?.[1],
          ),
        ),
    };
    const handle = hostedFetch({
      deviceAgents: deviceAgentsProcedures(seams),
      hosts: hostsProcedures(seams),
    });
    // SAFETY: the procedures yield the database, the clock, the environment, and the analytics alone, which is all a test provides of the web runtime's services.
    const response = yield* Effect.promise(() =>
      handle(incoming, context as Context.Context<WebServices>),
    );
    const text = yield* Effect.promise(() => response.text());
    return { status: response.status, body: text.length === 0 ? undefined : JSON.parse(text) };
  });

/** The status the route answered one request with. */
const statusOf = (incoming: Request) => Effect.map(answerOf(incoming), (answer) => answer.status);

/** An account. */
const account = () =>
  Effect.gen(function* () {
    const db = yield* Database;
    const userId = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
    return userId;
  });

/** A register of a Mac under the id given. */
function registered(deviceId: string) {
  return { deviceId, name: "Studio", ...DEVICE_LAYOUT };
}

/** A Mac's enroll on its desktop's sign-in under the id given, naming the Mac. */
function enrollOwn(bearer: string, deviceId: string) {
  return request(bearer, PATH.ENROLL_OWN, {
    version: HOST_VERSION.FLOOR,
    body: { deviceId, name: "Studio", platform: DEVICE_PLATFORM.DARWIN, arch: DEVICE_ARCH.ARM64 },
  });
}

/** A Mac's register on its own secret, as its host program's first call is, with where its setup stands where it is not ready. */
function macRegister(
  secret: string,
  deviceId: string,
  setup: { readonly setup?: DeviceSetup; readonly setupFailure?: string } = {},
) {
  return request(secret, PATH.DEVICES, {
    version: HOST_VERSION.FLOOR,
    body: { ...registered(deviceId), ...setup },
  });
}

/** An agent of the account's pinned to the device given, or to none, whose turn is running; its conversation's id. */
const agentRunningOn = (userId: string, deviceId: string | null) =>
  Effect.gen(function* () {
    const task = yield* startTask(userId, { name: "Invitations" });
    const started = yield* createAgent(userId, {
      taskId: task.id,
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      planSnapshot: "# Invitations\n",
      prompt: null,
      repository: null,
      ...(deviceId === null ? {} : { machine: AGENT_MACHINE.DEVICE, deviceId }),
    });
    const { conversationId } = Option.getOrThrow(started).agent;
    const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
    const target = { userId, conversationId };
    const turnId = randomUUID();
    yield* writer.enqueueTurn(target, { turnId, origin: TURN_ORIGIN.TYPED, eveTurnId: "turn_0" });
    yield* writer.consume(target, {
      conversationId: sessionKey(conversationId),
      turnId,
      kind: RUN_EVENT.TURN_STARTED,
      sequence: 1,
      origin: RUN_TURN_ORIGIN.TYPED,
      trigger: TURN_TRIGGER.ASK,
      at: yield* Clock.currentTimeMillis,
    });
    return conversationId;
  });

/** A host's beat on its secret, naming the device given, at the version given or the floor's. */
function hostBeat(secret: string, deviceId: string, version: string = HOST_VERSION.FLOOR) {
  return request(secret, PATH.PRESENCE, { version, body: { deviceId } });
}

/** A box's pairing start with no credential, from the address given where one is, at the version given or the floor's. */
function startPairing(init: { readonly version?: string; readonly ip?: string } = {}) {
  return request(undefined, PATH.PAIRING_START, {
    version: init.version ?? HOST_VERSION.FLOOR,
    ...(init.ip === undefined ? {} : { ip: init.ip }),
    body: { name: "fra-01", platform: DEVICE_PLATFORM.LINUX, arch: DEVICE_ARCH.X64 },
  });
}

/** A pairing box's poll on its poll secret, at the floor's version. */
function pollPairing(pollSecret: string) {
  return answerOf(
    request(pollSecret, PATH.PAIRING_POLL, { version: HOST_VERSION.FLOOR, post: true }),
  );
}

/** A member's read, approve, or deny of a pairing by its code, on their bearer. */
function byCode(bearer: string, path: string, code: string) {
  return answerOf(request(bearer, path, { body: { code } }));
}

/** A pairing started: its poll secret and the code it shows. */
const startedPairing = Effect.gen(function* () {
  const started = yield* answerOf(startPairing());
  assert.equal(started.status, HOSTED_HTTP_STATUS.OK);
  const { pollSecret, userCode }: { pollSecret: string; userCode: string } = started.body;
  return { pollSecret, userCode };
});

/** A host paired under the account with a code it approved, registered on its own secret: its id and its secret. */
const pairedHost = (userId: string) =>
  Effect.gen(function* () {
    const { pollSecret, userCode } = yield* startedPairing;
    const approved = yield* byCode(userId, PATH.PAIRING_APPROVE, userCode);
    assert.equal(approved.status, HOSTED_HTTP_STATUS.OK);
    const handed = yield* pollPairing(pollSecret);
    const deviceId: string = handed.body.deviceId;
    const secret: string = handed.body.deviceSecret;
    const register = yield* statusOf(
      request(secret, PATH.DEVICES, {
        version: HOST_VERSION.FLOOR,
        body: {
          ...registered(deviceId),
          platform: DEVICE_PLATFORM.LINUX,
          home: "/var/lib/luke-host",
        },
      }),
    );
    assert.equal(register, HOSTED_HTTP_STATUS.OK);
    return { deviceId, secret };
  });

/** A code no pending pairing has: seven Bs and the letter given. */
function unusedCode(last: string) {
  return `BBBB-BBB${last}`;
}

const NOT_FOUND = { status: HOSTED_HTTP_STATUS.NOT_FOUND, body: { error: "not-found" } };

/** What every case runs over: its database, and the deployment's environment. */
const SERVICES = Layer.mergeAll(getTestDB(), Layer.succeed(HostedEnvironment, ENVIRONMENT));

it.layer(SERVICES)("a local agent's Mac", (it) => {
  it.effect(
    "a desktop's own sign-in is refused as needing an upgrade on the register, the beat, the follow reads and a claim, while its Mac registers on its secret",
    () =>
      Effect.gen(function* () {
        const owner = yield* account();
        const deviceId = randomUUID();
        const secret: string = (yield* answerOf(enrollOwn(owner, deviceId))).body.deviceSecret;
        const upgrade = {
          status: HOSTED_HTTP_STATUS.UPGRADE_REQUIRED,
          body: { error: "host-upgrade-needed" },
        };

        const answers = [
          yield* answerOf(request(owner, PATH.DEVICES, { body: registered(deviceId) })),
          yield* answerOf(request(owner, PATH.PRESENCE, { body: { deviceId } })),
          yield* answerOf(request(owner, PATH.LINES, { deviceId })),
          yield* answerOf(
            request(owner, PATH.LINE_CLAIM, { body: { deviceId, id: randomUUID() } }),
          ),
        ];
        const unknown = yield* statusOf(request("nobody", PATH.LINES, { deviceId }));

        assert.deepEqual(answers, [upgrade, upgrade, upgrade, upgrade]);
        assert.equal(
          unknown,
          HOSTED_HTTP_STATUS.UNAUTHORIZED,
          "a bearer naming no one is unauthenticated",
        );
        assert.equal(yield* statusOf(macRegister(secret, deviceId)), HOSTED_HTTP_STATUS.OK);

        // A Mac keyed again on a new sign-in is the same install.
        assert.equal((yield* answerOf(enrollOwn(owner, deviceId))).status, HOSTED_HTTP_STATUS.OK);
        assert.deepEqual(countedProperties(owner, SERVER_EVENT.HOST_INSTALL), [
          { kind: "this_mac" },
        ]);
      }),
  );

  it.effect("a host reads the live agents of its own device alone", () =>
    Effect.gen(function* () {
      const owner = yield* account();
      const other = yield* account();
      const host = yield* pairedHost(owner);
      const otherHost = yield* pairedHost(other);
      const task = yield* startTask(owner, { name: "Invitations" });
      const started = yield* createAgent(owner, {
        taskId: task.id,
        idempotencyKey: randomUUID(),
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        planSnapshot: "# Invitations\n",
        prompt: null,
        repository: null,
        machine: AGENT_MACHINE.DEVICE,
        deviceId: host.deviceId,
      });
      const live = (secret: string, deviceId: string) =>
        answerOf(request(secret, PATH.LIVE_AGENTS, { deviceId, version: HOST_VERSION.FLOOR }));

      const own = yield* live(host.secret, host.deviceId);
      const othersDevice = yield* live(otherHost.secret, host.deviceId);

      assert.deepEqual(own, {
        status: HOSTED_HTTP_STATUS.OK,
        body: { agentIds: [Option.getOrThrow(started).agent.id] },
      });
      assert.equal(othersDevice.status, HOSTED_HTTP_STATUS.NOT_FOUND);
    }),
  );

  it.effect(
    "a host calls on its own secret for itself alone, and is listed under its own member alone",
    () =>
      Effect.gen(function* () {
        const owner = yield* account();
        const other = yield* account();
        const host = yield* pairedHost(owner);
        const otherHost = yield* pairedHost(other);

        const ownBeat = yield* answerOf(hostBeat(host.secret, host.deviceId));
        const otherDeviceBeat = yield* statusOf(hostBeat(host.secret, otherHost.deviceId));
        const followedByOther = yield* statusOf(
          request(otherHost.secret, PATH.LINES, {
            deviceId: host.deviceId,
            version: HOST_VERSION.FLOOR,
          }),
        );
        const ownerList = yield* answerOf(request(owner, PATH.HOSTS));
        const otherList = yield* answerOf(request(other, PATH.HOSTS));

        // Note that a beat answers the launches the service holds the device to, none for a host with no agent.
        assert.deepEqual(ownBeat, {
          status: HOSTED_HTTP_STATUS.OK,
          body: { done: true, openLaunches: [] },
        });
        assert.deepEqual(
          [otherDeviceBeat, followedByOther],
          [HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_HTTP_STATUS.NOT_FOUND],
        );
        assert.deepEqual(
          ownerList.body.hosts.map((each: { readonly id: string }) => each.id),
          [host.deviceId],
        );
        assert.equal(ownerList.body.installScriptUrl, `${ORIGIN}/install.sh`);
        assert.deepEqual(
          otherList.body.hosts.map((each: { readonly id: string }) => each.id),
          [otherHost.deviceId],
        );
      }),
  );

  it.effect("a removed host's secret is refused at once, and no other account removes it", () =>
    Effect.gen(function* () {
      const owner = yield* account();
      const host = yield* pairedHost(owner);
      const other = yield* account();

      const removedByOther = yield* statusOf(
        request(other, PATH.HOST_REMOVE, { body: { id: host.deviceId } }),
      );
      const removed = yield* statusOf(
        request(owner, PATH.HOST_REMOVE, { body: { id: host.deviceId } }),
      );
      const beat = yield* statusOf(hostBeat(host.secret, host.deviceId));
      const listed = yield* answerOf(request(owner, PATH.HOSTS));

      assert.equal(removedByOther, HOSTED_HTTP_STATUS.NOT_FOUND);
      assert.equal(removed, HOSTED_HTTP_STATUS.OK);
      assert.equal(beat, HOSTED_HTTP_STATUS.UNAUTHORIZED);
      assert.deepEqual(listed.body.hosts, []);
    }),
  );

  it.effect("removing a host settles its agents' running turns as failed, and no one else's", () =>
    Effect.gen(function* () {
      const owner = yield* account();
      const host = yield* pairedHost(owner);
      const onHost = yield* agentRunningOn(owner, host.deviceId);
      const elsewhere = yield* agentRunningOn(owner, null);

      const removed = yield* statusOf(
        request(owner, PATH.HOST_REMOVE, { body: { id: host.deviceId } }),
      );
      const turns = yield* latestTurnsOfReached([onHost, elsewhere]);

      assert.equal(removed, HOSTED_HTTP_STATUS.OK);
      assert.equal(
        turns.get(onHost)?.status,
        TURN_STATUS.FAILED,
        "the host's agent no longer runs",
      );
      assert.equal(
        turns.get(elsewhere)?.status,
        TURN_STATUS.RUNNING,
        "an agent on no host runs on",
      );
    }),
  );

  it.effect(
    "a daemon below the version floor, or naming none, is refused as needing an upgrade, and its Hosts row says so",
    () =>
      Effect.gen(function* () {
        const owner = yield* account();
        const host = yield* pairedHost(owner);

        const oldBeat = yield* answerOf(hostBeat(host.secret, host.deviceId, OLD_VERSION));
        const unnamed = yield* statusOf(
          request(host.secret, PATH.PRESENCE, { body: { deviceId: host.deviceId } }),
        );
        const listed = yield* answerOf(request(owner, PATH.HOSTS));

        assert.equal(oldBeat.status, HOSTED_HTTP_STATUS.UPGRADE_REQUIRED);
        assert.deepEqual(oldBeat.body, {
          error: "host-upgrade-needed",
          minimumVersion: HOST_VERSION.FLOOR,
        });
        assert.equal(unnamed, HOSTED_HTTP_STATUS.UPGRADE_REQUIRED);
        assert.deepEqual(
          listed.body.hosts.map(
            (each: { readonly version: string; readonly upgradeNeeded: boolean }) => [
              each.version,
              each.upgradeNeeded,
            ],
          ),
          [[OLD_VERSION, true]],
          "one host, which says the version it last called with",
        );
      }),
  );

  it.effect(
    "a desktop enrolls its own Mac on its sign-in, created where Luke never saw it, which then calls on its secret, is listed as a Mac with its user and why its setup failed, and is removed as any machine; no other account enrolls it",
    () =>
      Effect.gen(function* () {
        const owner = yield* account();
        const other = yield* account();
        const deviceId = randomUUID();

        const unnamed = yield* statusOf(
          request(owner, PATH.ENROLL_OWN, { version: HOST_VERSION.FLOOR, body: { deviceId } }),
        );
        const enrolled = yield* answerOf(enrollOwn(owner, deviceId));
        const byOther = yield* statusOf(enrollOwn(other, deviceId));
        const secret: string = enrolled.body.deviceSecret;
        const register = yield* statusOf(
          macRegister(secret, deviceId, {
            setup: DEVICE_SETUP.FAILED,
            setupFailure: "Claude Code could not be installed",
          }),
        );
        const listed = yield* answerOf(request(owner, PATH.HOSTS));
        const removed = yield* statusOf(
          request(owner, PATH.HOST_REMOVE, { body: { id: deviceId } }),
        );
        const beatAfterRemove = yield* statusOf(hostBeat(secret, deviceId));

        assert.equal(
          unnamed,
          HOSTED_HTTP_STATUS.NOT_FOUND,
          "an enroll naming no machine creates none",
        );
        assert.equal(enrolled.status, HOSTED_HTTP_STATUS.OK);
        assert.equal(byOther, HOSTED_HTTP_STATUS.NOT_FOUND, "another account's id is never taken");
        assert.ok(secret.startsWith(HOST_WIRE.DEVICE_SECRET_PREFIX));
        assert.equal(register, HOSTED_HTTP_STATUS.OK, "the Mac registers on its new secret");
        assert.deepEqual(
          listed.body.hosts.map(
            (each: {
              readonly id: string;
              readonly name: string;
              readonly platform: string;
              readonly loginName: string;
              readonly setup: string;
              readonly setupFailure: string;
            }) => [
              each.id,
              each.name,
              each.platform,
              each.loginName,
              each.setup,
              each.setupFailure,
            ],
          ),
          // Note that the fixture's home is /Users/fixture, so the Mac runs as fixture.
          [
            [
              deviceId,
              "Studio",
              DEVICE_PLATFORM.DARWIN,
              "fixture",
              DEVICE_SETUP.FAILED,
              "Claude Code could not be installed",
            ],
          ],
        );
        assert.equal(removed, HOSTED_HTTP_STATUS.OK);
        assert.equal(beatAfterRemove, HOSTED_HTTP_STATUS.UNAUTHORIZED, "Remove refuses its secret");
      }),
  );

  it.effect(
    "a box pairs with a code: a start below the floor is refused, a member reads and approves the code, the host is listed at once, the box's next poll alone is handed its secret, counted as an install, and the host is listed as called in only once its program registers",
    () =>
      Effect.gen(function* () {
        const owner = yield* account();
        const startedAt = yield* Clock.currentTimeMillis;
        const old = yield* statusOf(startPairing({ version: OLD_VERSION }));
        const started = yield* answerOf(startPairing({ ip: "203.0.113.7" }));
        const { pollSecret, userCode }: { pollSecret: string; userCode: string } = started.body;

        const waiting = yield* pollPairing(pollSecret);
        // Note that a code is matched whatever its case and dash.
        const read = yield* byCode(owner, PATH.PAIRING, userCode.replace("-", "").toLowerCase());
        const approved = yield* byCode(owner, PATH.PAIRING_APPROVE, userCode);
        const deviceId: string = approved.body.deviceId;
        const listed = yield* answerOf(request(owner, PATH.HOSTS));
        yield* TestClock.adjust("5 seconds");
        const handed = yield* pollPairing(pollSecret);
        yield* TestClock.adjust("5 seconds");
        const again = yield* pollPairing(pollSecret);
        const secret: string = handed.body.deviceSecret;
        const collected = yield* answerOf(request(owner, PATH.HOSTS));
        const register = yield* statusOf(
          request(secret, PATH.DEVICES, {
            version: HOST_VERSION.FLOOR,
            body: { ...registered(deviceId), platform: DEVICE_PLATFORM.LINUX, home: "/srv/luke" },
          }),
        );
        const joined = yield* answerOf(request(owner, PATH.HOSTS));

        assert.equal(old, HOSTED_HTTP_STATUS.UPGRADE_REQUIRED);
        assert.match(userCode, /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/u);
        assert.ok(pollSecret.startsWith("lkp_"));
        assert.deepEqual(
          { url: started.body.url, ms: [started.body.expiresInMs, started.body.intervalMs] },
          { url: `${ORIGIN}/connect/${userCode}`, ms: [10 * 60 * 1_000, 5_000] },
        );
        assert.deepEqual(waiting.body, { status: "pending" });
        assert.deepEqual(read, {
          status: HOSTED_HTTP_STATUS.OK,
          body: {
            name: "fra-01",
            platform: DEVICE_PLATFORM.LINUX,
            arch: DEVICE_ARCH.X64,
            ip: "203.0.113.7",
            expiresAt: startedAt + 10 * 60 * 1_000,
          },
        });
        assert.deepEqual(
          listed.body.hosts.map((host: { readonly id: string }) => host.id),
          [deviceId],
        );
        assert.equal(handed.body.status, "approved");
        assert.equal(handed.body.deviceId, deviceId);
        assert.ok(secret.startsWith("lkd_"));
        assert.deepEqual(again.body, { status: "expired" }, "the secret is handed over once");
        assert.equal(register, HOSTED_HTTP_STATUS.OK);
        assert.deepEqual(
          [listed, collected, joined].map((each) => each.body.hosts[0]?.calledIn),
          [false, false, true],
          "collecting its secret is not calling in; its program's register is",
        );
        assert.deepEqual(countedProperties(owner, SERVER_EVENT.HOST_INSTALL), [
          { kind: "luke_host" },
        ]);
      }),
  );

  it.effect("a member denies a code, and the box's poll is answered denied", () =>
    Effect.gen(function* () {
      const owner = yield* account();
      const { pollSecret, userCode } = yield* startedPairing;

      const denied = yield* byCode(owner, PATH.PAIRING_DENY, userCode);
      const polled = yield* pollPairing(pollSecret);

      assert.deepEqual(denied, { status: HOSTED_HTTP_STATUS.OK, body: { done: true } });
      assert.deepEqual(polled.body, { status: "denied" });
      assert.deepEqual((yield* answerOf(request(owner, PATH.HOSTS))).body.hosts, []);
    }),
  );

  it.effect(
    "a code lapses ten minutes after its start: a member's read and approve find nothing, and the box's poll is answered expired",
    () =>
      Effect.gen(function* () {
        const owner = yield* account();
        const { pollSecret, userCode } = yield* startedPairing;

        yield* TestClock.adjust("10 minutes");

        assert.deepEqual(yield* byCode(owner, PATH.PAIRING, userCode), NOT_FOUND);
        assert.deepEqual(yield* byCode(owner, PATH.PAIRING_APPROVE, userCode), NOT_FOUND);
        assert.deepEqual((yield* pollPairing(pollSecret)).body, { status: "expired" });
      }),
  );

  it.effect(
    "an account that named ten codes no pending pairing has is held, a pending code's read included, until its window ends fifteen minutes on, while another account is not",
    () =>
      Effect.gen(function* () {
        const owner = yield* account();
        const other = yield* account();
        const { userCode } = yield* startedPairing;
        const firstGuessAt = yield* Clock.currentTimeMillis;

        const misses = [];
        for (const last of "BCDFGHJKLM") {
          misses.push(
            yield* statusOf(request(owner, PATH.PAIRING, { body: { code: unusedCode(last) } })),
          );
        }
        const held = yield* byCode(owner, PATH.PAIRING, userCode);
        const othersRead = yield* statusOf(
          request(other, PATH.PAIRING, { body: { code: userCode } }),
        );
        yield* TestClock.adjust("15 minutes");
        const fresh = yield* startedPairing;
        const after = yield* statusOf(
          request(owner, PATH.PAIRING, { body: { code: fresh.userCode } }),
        );

        assert.deepEqual(
          misses,
          Array.from({ length: 10 }, () => HOSTED_HTTP_STATUS.NOT_FOUND),
        );
        assert.deepEqual(held, {
          status: HOSTED_HTTP_STATUS.TOO_MANY_REQUESTS,
          body: { error: "host-pairing-held", heldUntil: firstGuessAt + 15 * 60 * 1_000 },
        });
        assert.equal(othersRead, HOSTED_HTTP_STATUS.OK);
        assert.equal(after, HOSTED_HTTP_STATUS.OK);
      }),
  );

  it.effect(
    "a poll sooner than the interval after the last is answered slow down, and one after it pending",
    () =>
      Effect.gen(function* () {
        const { pollSecret } = yield* startedPairing;

        const first = yield* pollPairing(pollSecret);
        const soon = yield* pollPairing(pollSecret);
        yield* TestClock.adjust("5 seconds");
        const later = yield* pollPairing(pollSecret);

        assert.deepEqual(
          [first.body, soon.body, later.body],
          [{ status: "pending" }, { status: "slow-down" }, { status: "pending" }],
        );
      }),
  );
});
