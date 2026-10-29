import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { AGENT_MACHINE } from "@luke/features/agent-wire";
import {
  DEVICE_AGENT_BOUNDS,
  DEVICE_AGENT_LINE_KIND,
  DEVICE_AGENT_REQUEST_KIND,
  DEVICE_CAPABILITY,
  type DeviceAgentAnswer,
} from "@luke/features/device-agent-wire";
import { eq } from "drizzle-orm";
import { Clock, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { Database } from "../../core/query.js";
import { agentTable } from "../../schemas/agent.js";
import { user } from "../../schemas/auth.js";
import { deviceAgentLine, deviceAgentRequest } from "../../schemas/device-agent.js";
import { DEVICE_LAYOUT, getTestDB, startTask } from "../../testing/index.js";
import { createAgent } from "../agent-store.js";
import {
  answerDeviceAgentRequest,
  claimDeviceAgentLine,
  claimDeviceAgentRequest,
  deviceAgentLineSettlement,
  deviceAgentLinesWaiting,
  deviceAgentRequestAnswer,
  deviceAgentRequestsWaiting,
  lapsedDeviceAgentLaunches,
  openDeviceAgentLaunches,
  queueDeviceAgentLine,
  queueDeviceAgentRequest,
  settleDeviceAgentLine,
  settleLapsedDeviceAgentLine,
  withdrawExpiredDeviceAgentRows,
} from "../device-agent-store.js";
import { beatDevice, registerDevice } from "../device-store.js";

/**
 * The work queued for a local agent's Mac, over a real dialect: a line is
 * queued in order to the Mac the agent is pinned to, at a place never
 * handed out before, claimed
 * once with its secrets cleared in the claim, or again under the token its
 * claim carried but never with its secrets twice, and settled once with its
 * runner's exit; a request is claimed once and answered once, its answer
 * read back as the Mac gave it, and one of a kind this build no longer
 * knows is passed over rather than failing the read; nothing is queued for, claimed by, or read
 * by another account; a discard line goes only to a Mac that registered it
 * takes one; the expiry withdraws old work but a runner still at work; and
 * a device whose lease lapsed has its open launches read, bounded, and
 * settled once, a waiting one never handed out after; and a device's open
 * launches, claimed or waiting, are read for its own account alone.
 * Synthetic accounts, agents, and Macs throughout.
 */

const SEALED = "sealed:v1:not-a-real-secret";

const FILE_ANSWER: DeviceAgentAnswer = {
  kind: DEVICE_AGENT_REQUEST_KIND.READ_FILE,
  bytes: new TextEncoder().encode("line one\n"),
};

/** An account holding a Mac and an agent pinned to it, or running in a sandbox where asked. */
const openAccount = (onMac = true) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const userId = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
    const deviceId = randomUUID();
    yield* registerDevice(userId, { id: deviceId, name: "Studio", ...DEVICE_LAYOUT });
    const task = yield* startTask(userId, { name: "Invitations" });
    const started = yield* createAgent(userId, {
      taskId: task.id,
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      planSnapshot: "# Invitations\n",
      prompt: null,
      repository: null,
    });
    const agentId = Option.getOrThrow(started).agent.id;
    if (onMac) {
      yield* db
        .update(agentTable)
        .set({ machine: AGENT_MACHINE.DEVICE, deviceId })
        .where(eq(agentTable.id, agentId));
    }
    return { userId, deviceId, agentId };
  });

const launch = (agentId: string) =>
  ({
    agentId,
    kind: DEVICE_AGENT_LINE_KIND.LAUNCH,
    payload: { config: { model: "anthropic/claude-opus-5.5" } },
    sealedSecrets: SEALED,
  }) as const;

const message = (agentId: string, text: string) =>
  ({ agentId, kind: DEVICE_AGENT_LINE_KIND.MESSAGE, payload: { text } }) as const;

/** Five minutes past the clock's reading now, which the layer's clock carries from test to test. */
const fiveMinutesOn = Effect.map(
  Clock.currentTimeMillis,
  (millis) => new Date(millis + 5 * 60_000),
);

/** The line's secrets column as the row holds it now. */
const storedSecrets = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const [row] = yield* db
      .select({ sealedSecrets: deviceAgentLine.sealedSecrets })
      .from(deviceAgentLine)
      .where(eq(deviceAgentLine.id, id));
    return row?.sealedSecrets;
  });

it.layer(getTestDB())("the Mac agent store", (it) => {
  it.effect(
    "a line is claimed once, handing over its secrets and clearing them, and settled once with its exit",
    () =>
      Effect.gen(function* () {
        const { userId, deviceId, agentId } = yield* openAccount();
        const queued = Option.getOrThrow(yield* queueDeviceAgentLine(userId, launch(agentId)));

        const waiting = yield* deviceAgentLinesWaiting(userId, deviceId);
        const claims = yield* Effect.all(
          [
            claimDeviceAgentLine(userId, deviceId, queued.id),
            claimDeviceAgentLine(userId, deviceId, queued.id),
          ],
          { concurrency: "unbounded" },
        );
        const settledBeforeExit = yield* deviceAgentLineSettlement(userId, queued.id);
        const settled = yield* settleDeviceAgentLine(userId, deviceId, queued.id, 137);
        const settledAgain = yield* settleDeviceAgentLine(userId, deviceId, queued.id, 0);

        assert.deepEqual(
          waiting.map((line) => Object.keys(line).includes("sealedSecrets")),
          [false],
          "a listing never reads the secrets",
        );
        assert.deepEqual(
          claims.map((claim) => Option.map(claim, (line) => line.sealedSecrets)),
          [Option.some(SEALED), Option.none()],
        );
        assert.equal(yield* storedSecrets(queued.id), null, "the claim cleared the secrets");
        assert.deepEqual(yield* deviceAgentLinesWaiting(userId, deviceId), []);
        assert.deepEqual(settledBeforeExit, Option.none());
        assert.equal(Option.isSome(settled), true);
        assert.equal(Option.isNone(settledAgain), true, "the first settle stands");
        assert.deepEqual(
          yield* deviceAgentLineSettlement(userId, queued.id),
          Option.some({ exitCode: 137 }),
        );
      }),
  );

  it.effect(
    "a line claimed under a token is claimed again under that token alone, until it is settled",
    () =>
      Effect.gen(function* () {
        const { userId, deviceId, agentId } = yield* openAccount();
        const queued = Option.getOrThrow(
          yield* queueDeviceAgentLine(userId, message(agentId, "hello")),
        );
        const token = randomUUID();

        const first = yield* claimDeviceAgentLine(userId, deviceId, queued.id, token);
        const again = yield* claimDeviceAgentLine(userId, deviceId, queued.id, token);
        const underAnother = yield* claimDeviceAgentLine(userId, deviceId, queued.id, randomUUID());
        const underNone = yield* claimDeviceAgentLine(userId, deviceId, queued.id);
        yield* settleDeviceAgentLine(userId, deviceId, queued.id);
        const afterSettle = yield* claimDeviceAgentLine(userId, deviceId, queued.id, token);

        const expected = {
          id: queued.id,
          agentId,
          seq: queued.seq,
          kind: DEVICE_AGENT_LINE_KIND.MESSAGE,
          payload: { text: "hello" },
          sealedSecrets: null,
          secretsGone: false,
        };
        assert.deepEqual(first, Option.some(expected));
        assert.deepEqual(again, Option.some(expected), "the same claim is answered the same");
        assert.deepEqual(underAnother, Option.none());
        assert.deepEqual(underNone, Option.none());
        assert.deepEqual(afterSettle, Option.none(), "a settled line is never claimed again");
      }),
  );

  it.effect(
    "a launch line claimed twice at once under one token hands its secrets to one claim, and the other says they are gone",
    () =>
      Effect.gen(function* () {
        const { userId, deviceId, agentId } = yield* openAccount();
        const queued = Option.getOrThrow(yield* queueDeviceAgentLine(userId, launch(agentId)));
        const token = randomUUID();

        const claims = yield* Effect.all(
          [
            claimDeviceAgentLine(userId, deviceId, queued.id, token),
            claimDeviceAgentLine(userId, deviceId, queued.id, token),
          ],
          { concurrency: "unbounded" },
        );

        const answered = claims
          .map((claim) => Option.getOrThrow(claim))
          .map((line) => [line.sealedSecrets, line.secretsGone] as const)
          .sort((one, other) => Number(one[1]) - Number(other[1]));
        assert.deepEqual(answered, [
          [SEALED, false],
          [null, true],
        ]);
        assert.equal(yield* storedSecrets(queued.id), null);
      }),
  );

  it.effect("an agent's lines are read in the order they were queued", () =>
    Effect.gen(function* () {
      const { userId, deviceId, agentId } = yield* openAccount();
      yield* queueDeviceAgentLine(userId, launch(agentId));
      yield* queueDeviceAgentLine(userId, message(agentId, "first"));
      yield* queueDeviceAgentLine(userId, message(agentId, "second"));

      const waiting = yield* deviceAgentLinesWaiting(userId, deviceId);

      assert.deepEqual(
        waiting.map((line) => [line.kind, line.payload.text]),
        [
          [DEVICE_AGENT_LINE_KIND.LAUNCH, undefined],
          [DEVICE_AGENT_LINE_KIND.MESSAGE, "first"],
          [DEVICE_AGENT_LINE_KIND.MESSAGE, "second"],
        ],
      );
    }),
  );

  it.effect("an agent's next line follows its last even once expiry withdrew every line", () =>
    Effect.gen(function* () {
      const { userId, deviceId, agentId } = yield* openAccount();
      const first = Option.getOrThrow(yield* queueDeviceAgentLine(userId, launch(agentId)));
      const cutoff = yield* fiveMinutesOn;
      yield* TestClock.adjust("10 minutes");
      yield* withdrawExpiredDeviceAgentRows(userId, cutoff);

      const next = Option.getOrThrow(yield* queueDeviceAgentLine(userId, message(agentId, "back")));

      assert.deepEqual(
        (yield* deviceAgentLinesWaiting(userId, deviceId)).map((line) => line.id),
        [next.id],
      );
      assert.ok(next.seq > first.seq, "a withdrawn line's place is never handed out again");
    }),
  );

  it.effect(
    "another account neither queues for, lists, claims, settles, nor reads an account's work",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount();
        const other = yield* openAccount();
        const line = Option.getOrThrow(
          yield* queueDeviceAgentLine(owner.userId, launch(owner.agentId)),
        );
        const requestId = randomUUID();
        yield* queueDeviceAgentRequest(owner.userId, {
          id: requestId,
          agentId: owner.agentId,
          kind: DEVICE_AGENT_REQUEST_KIND.READ_FILE,
          args: { path: "notes.txt" },
        });

        const queuedByOther = yield* queueDeviceAgentLine(
          other.userId,
          message(owner.agentId, "hi"),
        );
        const requestedByOther = yield* queueDeviceAgentRequest(other.userId, {
          id: randomUUID(),
          agentId: owner.agentId,
          kind: DEVICE_AGENT_REQUEST_KIND.READ_FILE,
          args: { path: "/etc/hosts" },
        });
        const linesOnOwnersMac = yield* deviceAgentLinesWaiting(other.userId, owner.deviceId);
        const requestsOnOwnersMac = yield* deviceAgentRequestsWaiting(other.userId, owner.deviceId);
        const lineClaimedByOther = yield* claimDeviceAgentLine(
          other.userId,
          other.deviceId,
          line.id,
        );
        const lineClaimedOnOwnersMac = yield* claimDeviceAgentLine(
          other.userId,
          owner.deviceId,
          line.id,
        );
        const requestClaimedByOther = yield* claimDeviceAgentRequest(
          other.userId,
          owner.deviceId,
          requestId,
        );
        yield* claimDeviceAgentLine(owner.userId, owner.deviceId, line.id);
        yield* claimDeviceAgentRequest(owner.userId, owner.deviceId, requestId);
        const settledByOther = yield* settleDeviceAgentLine(
          other.userId,
          owner.deviceId,
          line.id,
          0,
        );
        const answeredByOther = yield* answerDeviceAgentRequest(
          other.userId,
          owner.deviceId,
          requestId,
          FILE_ANSWER,
        );
        yield* answerDeviceAgentRequest(owner.userId, owner.deviceId, requestId, FILE_ANSWER);

        assert.deepEqual(queuedByOther, Option.none());
        assert.equal(requestedByOther, false);
        assert.deepEqual(linesOnOwnersMac, []);
        assert.deepEqual(requestsOnOwnersMac, []);
        assert.deepEqual(lineClaimedByOther, Option.none());
        assert.deepEqual(lineClaimedOnOwnersMac, Option.none());
        assert.deepEqual(requestClaimedByOther, Option.none());
        assert.equal(Option.isNone(settledByOther), true);
        assert.equal(answeredByOther, false);
        assert.deepEqual(yield* deviceAgentRequestAnswer(other.userId, requestId), Option.none());
        assert.deepEqual(
          yield* deviceAgentRequestAnswer(owner.userId, requestId),
          Option.some(FILE_ANSWER),
        );
      }),
  );

  it.effect("nothing is queued for an agent that runs in a sandbox", () =>
    Effect.gen(function* () {
      const { userId, agentId } = yield* openAccount(false);

      assert.deepEqual(yield* queueDeviceAgentLine(userId, launch(agentId)), Option.none());
    }),
  );

  it.effect("a discard line is queued only for a Mac that registered it takes one", () =>
    Effect.gen(function* () {
      const { userId, deviceId, agentId } = yield* openAccount();
      const discard = { agentId, kind: DEVICE_AGENT_LINE_KIND.DISCARD, payload: {} } as const;

      const beforeCapability = yield* queueDeviceAgentLine(userId, discard);
      yield* registerDevice(userId, {
        id: deviceId,
        name: "Studio",
        ...DEVICE_LAYOUT,
        capabilities: [DEVICE_CAPABILITY.DISCARD],
      });
      const afterCapability = yield* queueDeviceAgentLine(userId, discard);

      assert.deepEqual(beforeCapability, Option.none(), "a Mac from before discard is queued none");
      assert.equal(Option.isSome(afterCapability), true);
      assert.deepEqual(
        (yield* deviceAgentLinesWaiting(userId, deviceId)).map((line) => line.kind),
        [DEVICE_AGENT_LINE_KIND.DISCARD],
      );
    }),
  );

  it.effect("a request is answered once, after its claim, and read back as given", () =>
    Effect.gen(function* () {
      const { userId, deviceId, agentId } = yield* openAccount();
      const id = randomUUID();
      const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      yield* queueDeviceAgentRequest(userId, {
        id,
        agentId,
        kind: DEVICE_AGENT_REQUEST_KIND.READ_FILE,
        args: { path: "shot.png" },
      });

      const answeredUnclaimed = yield* answerDeviceAgentRequest(userId, deviceId, id, {
        kind: DEVICE_AGENT_REQUEST_KIND.READ_FILE,
        bytes,
      });
      const claimed = yield* claimDeviceAgentRequest(userId, deviceId, id);
      const claimedAgain = yield* claimDeviceAgentRequest(userId, deviceId, id);
      const answered = yield* answerDeviceAgentRequest(userId, deviceId, id, {
        kind: DEVICE_AGENT_REQUEST_KIND.READ_FILE,
        bytes,
      });
      const answeredAgain = yield* answerDeviceAgentRequest(userId, deviceId, id, {
        kind: DEVICE_AGENT_REQUEST_KIND.READ_FILE,
        bytes: null,
      });

      assert.equal(answeredUnclaimed, false, "nothing is answered before a Mac claims it");
      assert.deepEqual(
        Option.map(claimed, (request) => request.args),
        Option.some({ path: "shot.png" }),
      );
      assert.deepEqual(claimedAgain, Option.none());
      assert.equal(answered, true);
      assert.equal(answeredAgain, false, "the first answer stands");
      assert.deepEqual(
        yield* deviceAgentRequestAnswer(userId, id),
        Option.some({ kind: DEVICE_AGENT_REQUEST_KIND.READ_FILE, bytes }),
      );
    }),
  );

  it.effect(
    "a waiting request of a kind this build no longer knows is passed over, so the requests after it still reach the Mac",
    () =>
      Effect.gen(function* () {
        const { userId, deviceId, agentId } = yield* openAccount();
        const retired = randomUUID();
        // A command request an earlier build queued and never withdrew, written as that build wrote it.
        yield* Database.use((db) =>
          db.insert(deviceAgentRequest).values({
            id: retired,
            agentId,
            userId,
            deviceId,
            // SAFETY: the kind is one an earlier build wrote, which this build's type no longer names.
            kind: "run_command" as never,
            args: { command: "git status" },
          }),
        );
        const id = randomUUID();
        yield* queueDeviceAgentRequest(userId, {
          id,
          agentId,
          kind: DEVICE_AGENT_REQUEST_KIND.READ_FILE,
          args: { path: "notes.txt" },
        });

        assert.deepEqual(
          (yield* deviceAgentRequestsWaiting(userId, deviceId)).map((request) => request.id),
          [id],
        );
        assert.deepEqual(yield* claimDeviceAgentRequest(userId, deviceId, retired), Option.none());
      }),
  );

  it.effect("an answer past the bound in bytes is refused and writes nothing", () =>
    Effect.gen(function* () {
      const { userId, deviceId, agentId } = yield* openAccount();
      const oversized: DeviceAgentAnswer = {
        kind: DEVICE_AGENT_REQUEST_KIND.READ_FILE,
        bytes: new Uint8Array(DEVICE_AGENT_BOUNDS.MAX_ANSWER_BYTES + 2),
      };
      const id = randomUUID();
      yield* queueDeviceAgentRequest(userId, { id, agentId, kind: oversized.kind, args: {} });
      yield* claimDeviceAgentRequest(userId, deviceId, id);

      const answered = yield* Effect.exit(
        answerDeviceAgentRequest(userId, deviceId, id, oversized),
      );

      assert.equal(answered._tag, "Failure");
      assert.deepEqual(yield* deviceAgentRequestAnswer(userId, id), Option.none());
    }),
  );

  it.effect("the expiry withdraws old lines and requests but a runner still at work", () =>
    Effect.gen(function* () {
      const { userId, deviceId, agentId } = yield* openAccount();
      const cutoff = yield* fiveMinutesOn;
      const running = Option.getOrThrow(yield* queueDeviceAgentLine(userId, launch(agentId)));
      yield* claimDeviceAgentLine(userId, deviceId, running.id);
      yield* queueDeviceAgentLine(userId, message(agentId, "never taken"));
      yield* queueDeviceAgentRequest(userId, {
        id: randomUUID(),
        agentId,
        kind: DEVICE_AGENT_REQUEST_KIND.READ_FILE,
        args: { path: "notes.txt" },
      });
      yield* TestClock.adjust("10 minutes");
      const fresh = Option.getOrThrow(yield* queueDeviceAgentLine(userId, message(agentId, "new")));

      yield* withdrawExpiredDeviceAgentRows(userId, cutoff);

      assert.deepEqual(
        (yield* deviceAgentLinesWaiting(userId, deviceId)).map((line) => line.id),
        [fresh.id],
      );
      assert.deepEqual(yield* deviceAgentRequestsWaiting(userId, deviceId), []);
      assert.equal(
        Option.isSome(yield* settleDeviceAgentLine(userId, deviceId, running.id, 0)),
        true,
        "the running launch line is still there to settle",
      );
    }),
  );

  it.effect(
    "a lapsed device's open launches are read bounded and settled once, claimed or waiting, while a device that beat since, or settled its own, keeps it",
    () =>
      Effect.gen(function* () {
        const away = yield* openAccount();
        const back = yield* openAccount();
        const claimed = Option.getOrThrow(
          yield* queueDeviceAgentLine(away.userId, launch(away.agentId)),
        );
        yield* claimDeviceAgentLine(away.userId, away.deviceId, claimed.id);
        const waiting = Option.getOrThrow(
          yield* queueDeviceAgentLine(away.userId, launch(away.agentId)),
        );
        const kept = Option.getOrThrow(
          yield* queueDeviceAgentLine(back.userId, launch(back.agentId)),
        );
        const settledByDevice = yield* openAccount();
        const exited = Option.getOrThrow(
          yield* queueDeviceAgentLine(settledByDevice.userId, launch(settledByDevice.agentId)),
        );
        yield* claimDeviceAgentLine(settledByDevice.userId, settledByDevice.deviceId, exited.id);
        yield* TestClock.adjust("10 minutes");
        yield* beatDevice(back.userId, back.deviceId);
        yield* settleDeviceAgentLine(
          settledByDevice.userId,
          settledByDevice.deviceId,
          exited.id,
          0,
        );
        const seenBefore = new Date((yield* Clock.currentTimeMillis) - 5 * 60_000);
        const ours = new Set([away.userId, back.userId, settledByDevice.userId]);

        const read = yield* lapsedDeviceAgentLaunches(seenBefore, 10_000);
        const bounded = yield* lapsedDeviceAgentLaunches(seenBefore, 1);
        const settled = yield* settleLapsedDeviceAgentLine(away.userId, waiting.id, seenBefore);
        const again = yield* settleLapsedDeviceAgentLine(away.userId, waiting.id, seenBefore);
        const beaten = yield* settleLapsedDeviceAgentLine(back.userId, kept.id, seenBefore);
        const theirs = yield* settleLapsedDeviceAgentLine(
          settledByDevice.userId,
          exited.id,
          seenBefore,
        );

        assert.deepEqual(
          read
            .filter((each) => ours.has(each.userId))
            .map(({ id, deviceName }) => [id, deviceName]),
          [
            [claimed.id, "Studio"],
            [waiting.id, "Studio"],
          ],
          "only the lapsed device's open launches, oldest first, with its name",
        );
        assert.equal(bounded.length, 1);
        assert.deepEqual(settled, Option.some({ agentId: away.agentId }));
        assert.ok(Option.isNone(again), "a line settled once is not settled again");
        assert.deepEqual(
          (yield* deviceAgentLinesWaiting(away.userId, away.deviceId)).map((line) => line.id),
          [],
          "a waiting launch taken from its device is no longer listed",
        );
        assert.ok(
          Option.isNone(yield* claimDeviceAgentLine(away.userId, away.deviceId, waiting.id)),
        );
        assert.equal(yield* storedSecrets(waiting.id), null);
        assert.ok(Option.isNone(beaten), "a device that beat since keeps its launch");
        assert.ok(Option.isNone(theirs), "a launch its device settled is not touched");
        assert.deepEqual(
          yield* deviceAgentLineSettlement(settledByDevice.userId, exited.id),
          Option.some({ exitCode: 0 }),
        );
      }),
  );
  it.effect(
    "a device's open launches are its unsettled ones, claimed or waiting, with no stop after, and another account reads none of them",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount();
        const other = yield* openAccount();
        const exited = Option.getOrThrow(
          yield* queueDeviceAgentLine(owner.userId, launch(owner.agentId)),
        );
        yield* claimDeviceAgentLine(owner.userId, owner.deviceId, exited.id);
        yield* settleDeviceAgentLine(owner.userId, owner.deviceId, exited.id, 0);
        const stopped = Option.getOrThrow(
          yield* queueDeviceAgentLine(owner.userId, launch(owner.agentId)),
        );
        yield* claimDeviceAgentLine(owner.userId, owner.deviceId, stopped.id);
        yield* queueDeviceAgentLine(owner.userId, {
          agentId: owner.agentId,
          kind: DEVICE_AGENT_LINE_KIND.STOP,
          payload: {},
        });
        const running = Option.getOrThrow(
          yield* queueDeviceAgentLine(owner.userId, launch(owner.agentId)),
        );
        yield* claimDeviceAgentLine(owner.userId, owner.deviceId, running.id);
        const waiting = Option.getOrThrow(
          yield* queueDeviceAgentLine(owner.userId, launch(owner.agentId)),
        );

        assert.deepEqual(yield* openDeviceAgentLaunches(owner.userId, owner.deviceId), [
          running.id,
          waiting.id,
        ]);
        assert.deepEqual(yield* openDeviceAgentLaunches(other.userId, owner.deviceId), []);
      }),
  );
});
