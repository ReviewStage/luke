/**
 * device-agents-procedures.test.ts -- a local agent's device through its routes, over a real dialect: an account with the experiment off is answered nothing, a desktop's own sign-in is refused as needing an upgrade, a Mac enrolls on that sign-in, created where Luke never saw it and never under another account, and a host enrolls on its member's install token and calls on its own secret, for itself alone, at or past the version floor, until it is removed.
 *
 * Synthetic accounts, bearers, tokens, Macs, and hosts throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { writeAccountPreferences } from "@luke/database/models/account-store";
import { createCodingAgent, latestTurnsOfReached } from "@luke/database/models/coding-agent-store";
import { devicesSeenSince } from "@luke/database/models/device-store";
import { mintHostInstallToken, revokeHostInstallToken } from "@luke/database/models/host-store";
import { storeWriter } from "@luke/database/models/writer";
import { user } from "@luke/database/schemas/auth";
import { DEVICE_LAYOUT, getTestDB, startTask } from "@luke/database/testing";
import { BRAIN_RUN_EVENT, BRAIN_TURN_ORIGIN, BRAIN_TURN_TRIGGER } from "@luke/features/brain";
import { CODING_AGENT_MACHINE } from "@luke/features/coding-agent-wire";
import { DEVICE_ARCH, DEVICE_PLATFORM } from "@luke/features/device-agent-wire";
import { HOST_WIRE } from "@luke/features/host-wire";
import { sessionKey } from "@luke/runtime/vocabulary";
import { EXPERIMENT } from "@luke/settings";
import { TURN_ORIGIN, TURN_STATUS } from "@luke/wire";
import { Clock, type Context, Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { HOST_VERSION, hostSecretHash, mintHostSecret } from "../auth/device-secret.js";
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
  ENROLL: "/api/device-agents/enroll",
  ENROLL_OWN: "/api/device-agents/devices/enroll",
  HOSTS: "/api/hosts",
  HOST_REMOVE: "/api/hosts/remove",
} as const;

/** A daemon below the floor. */
const OLD_VERSION = "0.0.9";

/** One request of the device's, on the bearer given (an account's, or a host's secret), its body as JSON or its device in the query, and a daemon's version where one is given. */
function request(
  bearer: string | undefined,
  path: string,
  init: { readonly body?: object; readonly deviceId?: string; readonly version?: string } = {},
): Request {
  const url = new URL(path, ORIGIN);
  if (init.deviceId !== undefined) url.searchParams.set("deviceId", init.deviceId);
  return new Request(url, {
    method: init.body === undefined ? "GET" : "POST",
    headers: {
      ...(bearer === undefined ? {} : { authorization: `Bearer ${bearer}` }),
      ...(init.version === undefined ? {} : { [HOST_WIRE.VERSION_HEADER]: init.version }),
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
    // SAFETY: the procedures yield the database and the clock alone, which is all a test provides of the web runtime's services.
    const response = yield* Effect.promise(() =>
      handle(incoming, context as Context.Context<WebServices>),
    );
    const text = yield* Effect.promise(() => response.text());
    return { status: response.status, body: text.length === 0 ? undefined : JSON.parse(text) };
  });

/** The status the route answered one request with. */
const statusOf = (incoming: Request) => Effect.map(answerOf(incoming), (answer) => answer.status);

/** An account, with the `local-agents` experiment on where asked. */
const account = (on: boolean) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const userId = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
    if (on)
      yield* writeAccountPreferences(userId, { experiments: { [EXPERIMENT.LOCAL_AGENTS]: true } });
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

/** A Mac's register on its own secret, as its host program's first call is. */
function macRegister(secret: string, deviceId: string) {
  return request(secret, PATH.DEVICES, {
    version: HOST_VERSION.FLOOR,
    body: registered(deviceId),
  });
}

/** An install token of the account's, kept by its hash as Settings keeps one, and its id. */
const installToken = (userId: string) =>
  Effect.gen(function* () {
    const minted = mintHostSecret(HOST_WIRE.INSTALL_TOKEN_PREFIX);
    const kept = yield* mintHostInstallToken(userId, hostSecretHash(minted.secret));
    return { token: minted.secret, id: kept.id };
  });

/** A box's enroll on the token given, under a fresh id unless one is given, at the floor's version unless another is given. */
function enroll(
  token: string,
  init: { readonly deviceId?: string; readonly version?: string } = {},
) {
  return request(token, PATH.ENROLL, {
    version: init.version ?? HOST_VERSION.FLOOR,
    body: {
      deviceId: init.deviceId ?? randomUUID(),
      name: "fra-01",
      platform: DEVICE_PLATFORM.LINUX,
      arch: DEVICE_ARCH.X64,
    },
  });
}

/** A host enrolled under the account on a fresh token, registered on its own secret: its id, its secret, and its token. */
const enrolledHost = (userId: string) =>
  Effect.gen(function* () {
    const token = yield* installToken(userId);
    const deviceId = randomUUID();
    const answer = yield* answerOf(enroll(token.token, { deviceId }));
    assert.equal(answer.status, HOSTED_HTTP_STATUS.OK);
    const secret: string = answer.body.deviceSecret;
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
    return { deviceId, secret, token };
  });

/** An agent of the account's pinned to the device given, or to none, whose turn is running; its conversation's id. */
const agentRunningOn = (userId: string, deviceId: string | null) =>
  Effect.gen(function* () {
    const task = yield* startTask(userId, { name: "Invitations" });
    const started = yield* createCodingAgent(userId, {
      taskId: task.id,
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      planSnapshot: "# Invitations\n",
      prompt: null,
      repository: null,
      ...(deviceId === null ? {} : { machine: CODING_AGENT_MACHINE.DEVICE, deviceId }),
    });
    const { conversationId } = Option.getOrThrow(started).agent;
    const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
    const target = { userId, conversationId };
    const turnId = randomUUID();
    yield* writer.enqueueTurn(target, { turnId, origin: TURN_ORIGIN.TYPED, eveTurnId: "turn_0" });
    yield* writer.consume(target, {
      conversationId: sessionKey(conversationId),
      turnId,
      kind: BRAIN_RUN_EVENT.TURN_STARTED,
      sequence: 1,
      origin: BRAIN_TURN_ORIGIN.TYPED,
      trigger: BRAIN_TURN_TRIGGER.ASK,
      at: yield* Clock.currentTimeMillis,
    });
    return conversationId;
  });

/** A host's beat on its secret, naming the device given, at the version given or the floor's. */
function hostBeat(secret: string, deviceId: string, version: string = HOST_VERSION.FLOOR) {
  return request(secret, PATH.PRESENCE, { version, body: { deviceId } });
}

it.layer(getTestDB())("a local agent's Mac", (it) => {
  it.effect("an account with the experiment off is answered nothing, and nothing is written", () =>
    Effect.gen(function* () {
      const off = yield* account(false);

      const enrolled = yield* statusOf(enrollOwn(off, randomUUID()));

      assert.equal(enrolled, HOSTED_HTTP_STATUS.NOT_FOUND);
      assert.deepEqual(yield* devicesSeenSince(off, new Date(0)), []);
    }),
  );

  it.effect(
    "a desktop's own sign-in is refused as needing an upgrade on the register, the beat, the follow reads and a claim, while its Mac registers on its secret",
    () =>
      Effect.gen(function* () {
        const owner = yield* account(true);
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
      }),
  );

  it.effect(
    "a host calls on its own secret for itself alone, and one member's install token enrolls nothing under another",
    () =>
      Effect.gen(function* () {
        const owner = yield* account(true);
        const other = yield* account(true);
        const host = yield* enrolledHost(owner);
        const otherHost = yield* enrolledHost(other);

        const ownBeat = yield* answerOf(hostBeat(host.secret, host.deviceId));
        const otherDeviceBeat = yield* statusOf(hostBeat(host.secret, otherHost.deviceId));
        const followedByOther = yield* statusOf(
          request(otherHost.secret, PATH.LINES, {
            deviceId: host.deviceId,
            version: HOST_VERSION.FLOOR,
          }),
        );
        // Note that the other member's token naming the owner's host's id takes nothing over.
        const otherToken = yield* installToken(other);
        const takenOver = yield* statusOf(enroll(otherToken.token, { deviceId: host.deviceId }));
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
        assert.equal(takenOver, HOSTED_HTTP_STATUS.UNAUTHORIZED);
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

  it.effect(
    "a standing host's id enrolls again only once removed, and a removed host's secret is refused at once",
    () =>
      Effect.gen(function* () {
        const owner = yield* account(true);
        const host = yield* enrolledHost(owner);
        const other = yield* account(true);

        const rerun = yield* answerOf(enroll(host.token.token, { deviceId: host.deviceId }));
        const beatAfterRerun = yield* statusOf(hostBeat(host.secret, host.deviceId));
        const removedByOther = yield* statusOf(
          request(other, PATH.HOST_REMOVE, { body: { id: host.deviceId } }),
        );
        const removed = yield* statusOf(
          request(owner, PATH.HOST_REMOVE, { body: { id: host.deviceId } }),
        );
        const beat = yield* statusOf(hostBeat(host.secret, host.deviceId));
        const listed = yield* answerOf(request(owner, PATH.HOSTS));
        const back = yield* statusOf(enroll(host.token.token, { deviceId: host.deviceId }));

        assert.deepEqual(rerun, {
          status: HOSTED_HTTP_STATUS.CONFLICT,
          body: { error: "host-still-enrolled" },
        });
        assert.equal(beatAfterRerun, HOSTED_HTTP_STATUS.OK, "the standing host keeps its secret");
        assert.equal(removedByOther, HOSTED_HTTP_STATUS.NOT_FOUND);
        assert.equal(removed, HOSTED_HTTP_STATUS.OK);
        assert.equal(beat, HOSTED_HTTP_STATUS.UNAUTHORIZED);
        assert.deepEqual(listed.body.hosts, []);
        assert.equal(back, HOSTED_HTTP_STATUS.OK, "a removed host enrolls again");
      }),
  );

  it.effect("removing a host settles its agents' running turns as failed, and no one else's", () =>
    Effect.gen(function* () {
      const owner = yield* account(true);
      const host = yield* enrolledHost(owner);
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
    "a revoked or expired install token refuses new boxes, and the hosts it enrolled keep calling",
    () =>
      Effect.gen(function* () {
        const owner = yield* account(true);
        const revoked = yield* enrolledHost(owner);
        const expiring = yield* enrolledHost(owner);

        yield* revokeHostInstallToken(owner, revoked.token.id);
        const afterRevoke = yield* statusOf(enroll(revoked.token.token));
        yield* TestClock.adjust("25 hours");
        const afterExpiry = yield* statusOf(enroll(expiring.token.token));

        assert.deepEqual(
          [afterRevoke, afterExpiry],
          [HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_HTTP_STATUS.UNAUTHORIZED],
        );
        assert.deepEqual(
          [
            yield* statusOf(hostBeat(revoked.secret, revoked.deviceId)),
            yield* statusOf(hostBeat(expiring.secret, expiring.deviceId)),
          ],
          [HOSTED_HTTP_STATUS.OK, HOSTED_HTTP_STATUS.OK],
        );
      }),
  );

  it.effect(
    "a daemon below the version floor, or naming none, is refused as needing an upgrade, and its Hosts row says so",
    () =>
      Effect.gen(function* () {
        const owner = yield* account(true);
        const host = yield* enrolledHost(owner);
        const token = yield* installToken(owner);

        const oldBeat = yield* answerOf(hostBeat(host.secret, host.deviceId, OLD_VERSION));
        const unnamed = yield* statusOf(
          request(host.secret, PATH.PRESENCE, { body: { deviceId: host.deviceId } }),
        );
        const oldEnroll = yield* statusOf(enroll(token.token, { version: OLD_VERSION }));
        const listed = yield* answerOf(request(owner, PATH.HOSTS));

        assert.equal(oldBeat.status, HOSTED_HTTP_STATUS.UPGRADE_REQUIRED);
        assert.deepEqual(oldBeat.body, {
          error: "host-upgrade-needed",
          minimumVersion: HOST_VERSION.FLOOR,
        });
        assert.equal(unnamed, HOSTED_HTTP_STATUS.UPGRADE_REQUIRED);
        assert.equal(oldEnroll, HOSTED_HTTP_STATUS.UPGRADE_REQUIRED);
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
    "a desktop enrolls its own Mac on its sign-in, created where Luke never saw it, which then calls on its secret, is listed as a Mac, and is removed as any machine; no other account enrolls it",
    () =>
      Effect.gen(function* () {
        const owner = yield* account(true);
        const other = yield* account(true);
        const deviceId = randomUUID();

        const unnamed = yield* statusOf(
          request(owner, PATH.ENROLL_OWN, { version: HOST_VERSION.FLOOR, body: { deviceId } }),
        );
        const enrolled = yield* answerOf(enrollOwn(owner, deviceId));
        const byOther = yield* statusOf(enrollOwn(other, deviceId));
        const secret: string = enrolled.body.deviceSecret;
        const register = yield* statusOf(macRegister(secret, deviceId));
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
            (each: { readonly id: string; readonly name: string; readonly platform: string }) => [
              each.id,
              each.name,
              each.platform,
            ],
          ),
          [[deviceId, "Studio", DEVICE_PLATFORM.DARWIN]],
        );
        assert.equal(removed, HOSTED_HTTP_STATUS.OK);
        assert.equal(beatAfterRemove, HOSTED_HTTP_STATUS.UNAUTHORIZED, "Remove refuses its secret");
      }),
  );
});
