import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { CODING_AGENT_MACHINE } from "@luke/features/coding-agent-wire";
import {
  MAC_AGENT_BOUNDS,
  MAC_AGENT_LINE_KIND,
  MAC_AGENT_REQUEST_KIND,
  type MacAgentAnswer,
} from "@luke/features/mac-agent-wire";
import { eq } from "drizzle-orm";
import { Clock, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { codingAgent } from "../../schemas/coding-agent.js";
import { macAgentLine } from "../../schemas/mac-agent.js";
import { getTestDB, MAC_DEVICE_LAYOUT, startTask } from "../../testing/index.js";
import { createCodingAgent } from "../coding-agent-store.js";
import {
  answerMacAgentRequest,
  claimMacAgentLine,
  claimMacAgentRequest,
  macAgentLineSettlement,
  macAgentLinesWaiting,
  macAgentRequestAnswer,
  macAgentRequestsWaiting,
  queueMacAgentLine,
  queueMacAgentRequest,
  settleMacAgentLine,
  withdrawExpiredMacAgentRows,
} from "../mac-agent-store.js";
import { registerMacDevice } from "../mac-device-store.js";

/**
 * The work queued for a local agent's Mac, over a real dialect: a line is
 * queued in order to the Mac the agent is pinned to, at a place never
 * handed out before, claimed
 * once with its secrets cleared in the claim, and settled once with its
 * runner's exit; a request is claimed once and answered once, its answer
 * read back as the Mac gave it; nothing is queued for, claimed by, or read
 * by another account; and the expiry withdraws old work but a runner still
 * at work. Synthetic accounts, agents, and Macs throughout.
 */

const SEALED = "sealed:v1:not-a-real-secret";

const COMMAND_ANSWER: MacAgentAnswer = {
  kind: MAC_AGENT_REQUEST_KIND.RUN_COMMAND,
  exitCode: 0,
  stdout: "line one\n",
  stderr: "",
};

/** An account holding a Mac and an agent pinned to it, or running in a sandbox where asked. */
const openAccount = (onMac = true) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const userId = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
    const deviceId = randomUUID();
    yield* registerMacDevice(userId, { id: deviceId, name: "Studio", ...MAC_DEVICE_LAYOUT });
    const task = yield* startTask(userId, { name: "Invitations" });
    const started = yield* createCodingAgent(userId, {
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
        .update(codingAgent)
        .set({ machine: CODING_AGENT_MACHINE.MAC, deviceId })
        .where(eq(codingAgent.id, agentId));
    }
    return { userId, deviceId, agentId };
  });

const launch = (agentId: string) =>
  ({
    agentId,
    kind: MAC_AGENT_LINE_KIND.LAUNCH,
    payload: { config: { model: "anthropic/claude-opus-5.5" } },
    sealedSecrets: SEALED,
  }) as const;

const message = (agentId: string, text: string) =>
  ({ agentId, kind: MAC_AGENT_LINE_KIND.MESSAGE, payload: { text } }) as const;

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
      .select({ sealedSecrets: macAgentLine.sealedSecrets })
      .from(macAgentLine)
      .where(eq(macAgentLine.id, id));
    return row?.sealedSecrets;
  });

it.layer(getTestDB())("the Mac agent store", (it) => {
  it.effect(
    "a line is claimed once, handing over its secrets and clearing them, and settled once with its exit",
    () =>
      Effect.gen(function* () {
        const { userId, deviceId, agentId } = yield* openAccount();
        const queued = Option.getOrThrow(yield* queueMacAgentLine(userId, launch(agentId)));

        const waiting = yield* macAgentLinesWaiting(userId, deviceId);
        const claims = yield* Effect.all(
          [
            claimMacAgentLine(userId, deviceId, queued.id),
            claimMacAgentLine(userId, deviceId, queued.id),
          ],
          { concurrency: "unbounded" },
        );
        const settledBeforeExit = yield* macAgentLineSettlement(userId, queued.id);
        const settled = yield* settleMacAgentLine(userId, deviceId, queued.id, 137);
        const settledAgain = yield* settleMacAgentLine(userId, deviceId, queued.id, 0);

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
        assert.deepEqual(yield* macAgentLinesWaiting(userId, deviceId), []);
        assert.deepEqual(settledBeforeExit, Option.none());
        assert.equal(settled, true);
        assert.equal(settledAgain, false, "the first settle stands");
        assert.deepEqual(
          yield* macAgentLineSettlement(userId, queued.id),
          Option.some({ exitCode: 137 }),
        );
      }),
  );

  it.effect("an agent's lines are read in the order they were queued", () =>
    Effect.gen(function* () {
      const { userId, deviceId, agentId } = yield* openAccount();
      yield* queueMacAgentLine(userId, launch(agentId));
      yield* queueMacAgentLine(userId, message(agentId, "first"));
      yield* queueMacAgentLine(userId, message(agentId, "second"));

      const waiting = yield* macAgentLinesWaiting(userId, deviceId);

      assert.deepEqual(
        waiting.map((line) => [line.kind, line.payload.text]),
        [
          [MAC_AGENT_LINE_KIND.LAUNCH, undefined],
          [MAC_AGENT_LINE_KIND.MESSAGE, "first"],
          [MAC_AGENT_LINE_KIND.MESSAGE, "second"],
        ],
      );
    }),
  );

  it.effect("an agent's next line follows its last even once expiry withdrew every line", () =>
    Effect.gen(function* () {
      const { userId, deviceId, agentId } = yield* openAccount();
      const first = Option.getOrThrow(yield* queueMacAgentLine(userId, launch(agentId)));
      const cutoff = yield* fiveMinutesOn;
      yield* TestClock.adjust("10 minutes");
      yield* withdrawExpiredMacAgentRows(userId, cutoff);

      const next = Option.getOrThrow(yield* queueMacAgentLine(userId, message(agentId, "back")));

      assert.deepEqual(
        (yield* macAgentLinesWaiting(userId, deviceId)).map((line) => line.id),
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
          yield* queueMacAgentLine(owner.userId, launch(owner.agentId)),
        );
        const requestId = randomUUID();
        yield* queueMacAgentRequest(owner.userId, {
          id: requestId,
          agentId: owner.agentId,
          kind: MAC_AGENT_REQUEST_KIND.RUN_COMMAND,
          args: { command: "git status" },
        });

        const queuedByOther = yield* queueMacAgentLine(other.userId, message(owner.agentId, "hi"));
        const requestedByOther = yield* queueMacAgentRequest(other.userId, {
          id: randomUUID(),
          agentId: owner.agentId,
          kind: MAC_AGENT_REQUEST_KIND.READ_FILE,
          args: { path: "/etc/hosts" },
        });
        const linesOnOwnersMac = yield* macAgentLinesWaiting(other.userId, owner.deviceId);
        const requestsOnOwnersMac = yield* macAgentRequestsWaiting(other.userId, owner.deviceId);
        const lineClaimedByOther = yield* claimMacAgentLine(other.userId, other.deviceId, line.id);
        const lineClaimedOnOwnersMac = yield* claimMacAgentLine(
          other.userId,
          owner.deviceId,
          line.id,
        );
        const requestClaimedByOther = yield* claimMacAgentRequest(
          other.userId,
          owner.deviceId,
          requestId,
        );
        yield* claimMacAgentLine(owner.userId, owner.deviceId, line.id);
        yield* claimMacAgentRequest(owner.userId, owner.deviceId, requestId);
        const settledByOther = yield* settleMacAgentLine(other.userId, owner.deviceId, line.id, 0);
        const answeredByOther = yield* answerMacAgentRequest(
          other.userId,
          owner.deviceId,
          requestId,
          COMMAND_ANSWER,
        );
        yield* answerMacAgentRequest(owner.userId, owner.deviceId, requestId, COMMAND_ANSWER);

        assert.deepEqual(queuedByOther, Option.none());
        assert.equal(requestedByOther, false);
        assert.deepEqual(linesOnOwnersMac, []);
        assert.deepEqual(requestsOnOwnersMac, []);
        assert.deepEqual(lineClaimedByOther, Option.none());
        assert.deepEqual(lineClaimedOnOwnersMac, Option.none());
        assert.deepEqual(requestClaimedByOther, Option.none());
        assert.equal(settledByOther, false);
        assert.equal(answeredByOther, false);
        assert.deepEqual(yield* macAgentRequestAnswer(other.userId, requestId), Option.none());
        assert.deepEqual(
          yield* macAgentRequestAnswer(owner.userId, requestId),
          Option.some(COMMAND_ANSWER),
        );
      }),
  );

  it.effect("nothing is queued for an agent that runs in a sandbox", () =>
    Effect.gen(function* () {
      const { userId, agentId } = yield* openAccount(false);

      assert.deepEqual(yield* queueMacAgentLine(userId, launch(agentId)), Option.none());
    }),
  );

  it.effect(
    "a request is answered once, after its claim, by an answer of its own kind, and read back as given",
    () =>
      Effect.gen(function* () {
        const { userId, deviceId, agentId } = yield* openAccount();
        const id = randomUUID();
        const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
        yield* queueMacAgentRequest(userId, {
          id,
          agentId,
          kind: MAC_AGENT_REQUEST_KIND.READ_FILE,
          args: { path: "shot.png" },
        });

        const answeredUnclaimed = yield* answerMacAgentRequest(userId, deviceId, id, {
          kind: MAC_AGENT_REQUEST_KIND.READ_FILE,
          bytes,
        });
        const claimed = yield* claimMacAgentRequest(userId, deviceId, id);
        const claimedAgain = yield* claimMacAgentRequest(userId, deviceId, id);
        const answeredAsCommand = yield* answerMacAgentRequest(
          userId,
          deviceId,
          id,
          COMMAND_ANSWER,
        );
        const answered = yield* answerMacAgentRequest(userId, deviceId, id, {
          kind: MAC_AGENT_REQUEST_KIND.READ_FILE,
          bytes,
        });
        const answeredAgain = yield* answerMacAgentRequest(userId, deviceId, id, {
          kind: MAC_AGENT_REQUEST_KIND.READ_FILE,
          bytes: null,
        });

        assert.equal(answeredUnclaimed, false, "nothing is answered before a Mac claims it");
        assert.deepEqual(
          Option.map(claimed, (request) => request.args),
          Option.some({ path: "shot.png" }),
        );
        assert.deepEqual(claimedAgain, Option.none());
        assert.equal(answeredAsCommand, false, "a command's answer never settles a read");
        assert.equal(answered, true);
        assert.equal(answeredAgain, false, "the first answer stands");
        assert.deepEqual(
          yield* macAgentRequestAnswer(userId, id),
          Option.some({ kind: MAC_AGENT_REQUEST_KIND.READ_FILE, bytes }),
        );
      }),
  );

  it.effect("an answer past the bound in bytes is refused and writes nothing", () =>
    Effect.gen(function* () {
      const { userId, deviceId, agentId } = yield* openAccount();
      // Note that the command's output is under the bound in characters, three bytes each.
      const oversized: readonly MacAgentAnswer[] = [
        {
          kind: MAC_AGENT_REQUEST_KIND.READ_FILE,
          bytes: new Uint8Array(MAC_AGENT_BOUNDS.MAX_ANSWER_BYTES + 2),
        },
        { ...COMMAND_ANSWER, stdout: "€".repeat(MAC_AGENT_BOUNDS.MAX_ANSWER_BYTES / 2) },
      ];

      for (const answer of oversized) {
        const id = randomUUID();
        yield* queueMacAgentRequest(userId, { id, agentId, kind: answer.kind, args: {} });
        yield* claimMacAgentRequest(userId, deviceId, id);

        const answered = yield* Effect.exit(answerMacAgentRequest(userId, deviceId, id, answer));

        assert.equal(answered._tag, "Failure", answer.kind);
        assert.deepEqual(yield* macAgentRequestAnswer(userId, id), Option.none());
      }
    }),
  );

  it.effect("the expiry withdraws old lines and requests but a runner still at work", () =>
    Effect.gen(function* () {
      const { userId, deviceId, agentId } = yield* openAccount();
      const cutoff = yield* fiveMinutesOn;
      const running = Option.getOrThrow(yield* queueMacAgentLine(userId, launch(agentId)));
      yield* claimMacAgentLine(userId, deviceId, running.id);
      yield* queueMacAgentLine(userId, message(agentId, "never taken"));
      yield* queueMacAgentRequest(userId, {
        id: randomUUID(),
        agentId,
        kind: MAC_AGENT_REQUEST_KIND.RUN_COMMAND,
        args: { command: "ls" },
      });
      yield* TestClock.adjust("10 minutes");
      const fresh = Option.getOrThrow(yield* queueMacAgentLine(userId, message(agentId, "new")));

      yield* withdrawExpiredMacAgentRows(userId, cutoff);

      assert.deepEqual(
        (yield* macAgentLinesWaiting(userId, deviceId)).map((line) => line.id),
        [fresh.id],
      );
      assert.deepEqual(yield* macAgentRequestsWaiting(userId, deviceId), []);
      assert.equal(
        yield* settleMacAgentLine(userId, deviceId, running.id, 0),
        true,
        "the running launch line is still there to settle",
      );
    }),
  );
});
