import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { AGENT_MACHINE } from "@luke/features/agent-wire";
import { DEVICE_AGENT_LINE_KIND } from "@luke/features/device-agent-wire";
import { eq } from "drizzle-orm";
import { Effect, Option, Redacted, Result } from "effect";
import { Database } from "../../core/query.js";
import { agentTable } from "../../schemas/agent.js";
import { user } from "../../schemas/auth.js";
import { DEVICE_LAYOUT, getTestDB, startTask } from "../../testing/index.js";
import {
  type AgentStateCommit,
  AgentStateStale,
  AgentStateUngranted,
  AgentStateUnreachable,
  commitAgentState,
  deleteAgentStateUploads,
  ensureAgentStateKey,
  grantAgentStateUpload,
  newestAgentState,
  sweepableAgentStates,
  sweepableAgentStateUploads,
} from "../agent-state-store.js";
import { createAgent, deleteAgent } from "../agent-store.js";
import {
  claimDeviceAgentLine,
  queueDeviceAgentLine,
  settleDeviceAgentLine,
} from "../device-agent-store.js";
import { registerDevice } from "../device-store.js";
import { type KeyRing, openAgentStateKey, parseKeyRing } from "../provider-key-seal.js";
import { purgeClearedConversations } from "../soft-delete.js";

/**
 * A device agent's saved state over a real dialect: a commit is a
 * check-and-set on the agent's newest generation, every read, commit, and
 * key is held to the account that started the agent, a commit names only a
 * path an upload was granted for its agent, a deleted agent's generations
 * stand until its transcript is purged, every generation, the newest
 * included, expires seven days after its commit unless its agent's launch
 * is still open, and a grant no commit named is swept a day on. Synthetic accounts,
 * paths, and digests throughout; the ring is a throwaway of this file's.
 */

const NOW = new Date("2026-10-29T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
/** Larger than every generation the file's tests leave, so a sweep answers them all. */
const EVERY = 1000;
const DIGEST = "a".repeat(64);

const RING: KeyRing = Result.getOrThrow(
  parseKeyRing(Redacted.make(`1:${Buffer.alloc(32, 7).toString("base64")}`)),
);

/** An account holding a Mac and an agent on a task of its own pinned to it. */
const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  const deviceId = randomUUID();
  yield* registerDevice(userId, { id: deviceId, name: "Studio", ...DEVICE_LAYOUT });
  const task = yield* startTask(userId, { name: "Invitations", repository: "acme/relay" });
  const started = yield* createAgent(userId, {
    taskId: task.id,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    planSnapshot: "# Invitations\n",
    prompt: null,
    repository: "acme/relay",
  });
  const agentId = Option.getOrThrow(started).agent.id;
  yield* db
    .update(agentTable)
    .set({ machine: AGENT_MACHINE.DEVICE, deviceId })
    .where(eq(agentTable.id, agentId));
  return { userId, agentId, deviceId };
});

const saved = (
  agentId: string,
  deviceId: string,
  fromGeneration: number | null,
  path: string,
): AgentStateCommit => ({
  agentId,
  fromGeneration,
  path,
  bytes: 749,
  sha256: DIGEST,
  baseCommit: "0123456789abcdef0123456789abcdef01234567",
  deviceId,
});

/** A commit as a device makes one: its path granted first, under the same account and device. */
const committed = (userId: string, commit: AgentStateCommit, now: Date) =>
  Effect.andThen(
    grantAgentStateUpload(
      userId,
      { agentId: commit.agentId, deviceId: commit.deviceId, path: commit.path },
      now,
    ),
    commitAgentState(userId, commit, now),
  );

it.layer(getTestDB())("an agent's saved state", (it) => {
  it.effect("a commit from a generation no longer the newest is refused and writes nothing", () =>
    Effect.gen(function* () {
      const { userId, agentId, deviceId } = yield* openAccount;
      const first = yield* committed(userId, saved(agentId, deviceId, null, "state/one"), NOW);
      assert.equal(first.generation, 1);
      const second = yield* committed(userId, saved(agentId, deviceId, 1, "state/two"), NOW);
      assert.equal(second.generation, 2);

      const stale = yield* Effect.flip(
        committed(userId, saved(agentId, deviceId, 1, "state/stale"), NOW),
      );
      assert.deepEqual(stale, new AgentStateStale({ newest: 2 }));
      const fresh = yield* Effect.flip(
        committed(userId, saved(agentId, deviceId, null, "state/fresh"), NOW),
      );
      assert.deepEqual(fresh, new AgentStateStale({ newest: 2 }), "a first save over a save");

      const newest = Option.getOrThrow(yield* newestAgentState(userId, agentId));
      assert.deepEqual([newest.generation, newest.path], [2, "state/two"]);
    }),
  );

  it.effect("one account can neither read, commit, nor key another's agent's state", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const outsider = yield* openAccount;
      yield* committed(owner.userId, saved(owner.agentId, owner.deviceId, null, "state/one"), NOW);
      const key = Option.getOrThrow(yield* ensureAgentStateKey(RING, owner.userId, owner.agentId));

      assert.ok(Option.isNone(yield* newestAgentState(outsider.userId, owner.agentId)));
      assert.ok(Option.isNone(yield* ensureAgentStateKey(RING, outsider.userId, owner.agentId)));
      const refused = yield* Effect.flip(
        committed(outsider.userId, saved(owner.agentId, outsider.deviceId, 1, "state/theirs"), NOW),
      );
      assert.deepEqual(refused, new AgentStateUnreachable());
      assert.ok(
        Result.isFailure(
          openAgentStateKey(RING, { userId: outsider.userId, agentId: owner.agentId }, key),
        ),
        "the seal opens for its own account and agent alone",
      );

      const again = Option.getOrThrow(
        yield* ensureAgentStateKey(RING, owner.userId, owner.agentId),
      );
      assert.deepEqual(again, key, "the key is made once and kept");
      const opened = Result.getOrThrow(
        openAgentStateKey(RING, { userId: owner.userId, agentId: owner.agentId }, key),
      );
      assert.equal(Buffer.from(Redacted.value(opened), "base64").length, 32);
      const newest = Option.getOrThrow(yield* newestAgentState(owner.userId, owner.agentId));
      assert.equal(newest.path, "state/one");
    }),
  );

  it.effect(
    "the sweep takes a superseded generation, and a deleted agent's once its transcript is purged",
    () =>
      Effect.gen(function* () {
        const { userId, agentId, deviceId } = yield* openAccount;
        yield* committed(userId, saved(agentId, deviceId, null, "state/one"), NOW);
        yield* committed(userId, saved(agentId, deviceId, 1, "state/two"), NOW);
        const pathsSwept = (at: Date) =>
          Effect.map(sweepableAgentStates(at, EVERY), (rows) =>
            rows
              .filter((row) => row.agentId === agentId)
              .map((row) => row.path)
              .sort(),
          );
        assert.deepEqual(yield* pathsSwept(NOW), ["state/one"]);

        yield* deleteAgent(userId, agentId, {
          standsStopped: () => Effect.succeed(true),
          beforeDelete: () => Effect.void,
        });
        assert.deepEqual(yield* pathsSwept(NOW), ["state/one"], "the transcript still stands");

        yield* purgeClearedConversations(new Date(NOW.getTime() + 8 * DAY_MS));
        assert.deepEqual(yield* pathsSwept(NOW), ["state/one", "state/two"]);
      }),
  );

  it.effect("a generation, the newest included, is swept seven days after its commit", () =>
    Effect.gen(function* () {
      const { userId, agentId, deviceId } = yield* openAccount;
      yield* committed(userId, saved(agentId, deviceId, null, "state/only"), NOW);
      const pathsSwept = (at: number) =>
        Effect.map(sweepableAgentStates(new Date(at), EVERY), (rows) =>
          rows.filter((row) => row.agentId === agentId).map((row) => row.path),
        );

      const justShort = yield* pathsSwept(NOW.getTime() + 7 * DAY_MS - 1);
      const sevenDaysOn = yield* pathsSwept(NOW.getTime() + 7 * DAY_MS);

      assert.deepEqual(justShort, []);
      assert.deepEqual(sevenDaysOn, ["state/only"]);
    }),
  );

  it.effect(
    "a commit naming a path never granted for its agent, or granted an hour ago or more, is refused and writes nothing, and a grant goes with the commit that names it",
    () =>
      Effect.gen(function* () {
        const { userId, agentId, deviceId } = yield* openAccount;
        const granted = `state/${randomUUID()}`;

        const ungranted = yield* Effect.flip(
          commitAgentState(userId, saved(agentId, deviceId, null, `state/${randomUUID()}`), NOW),
        );
        // A grant an hour old may already be on its way to the sweep, which takes it as abandoned.
        const late = `state/${randomUUID()}`;
        yield* grantAgentStateUpload(userId, { agentId, deviceId, path: late }, NOW);
        const tooLate = yield* Effect.flip(
          commitAgentState(
            userId,
            saved(agentId, deviceId, null, late),
            new Date(NOW.getTime() + 60 * 60 * 1000),
          ),
        );
        const kept = yield* committed(userId, saved(agentId, deviceId, null, granted), NOW);
        const reused = yield* Effect.flip(
          commitAgentState(userId, saved(agentId, deviceId, 1, granted), NOW),
        );

        assert.deepEqual(ungranted, new AgentStateUngranted());
        assert.deepEqual(tooLate, new AgentStateUngranted());
        assert.equal(kept.generation, 1);
        assert.deepEqual(reused, new AgentStateUngranted(), "its grant went with its commit");
        assert.equal(Option.getOrThrow(yield* newestAgentState(userId, agentId)).generation, 1);
      }),
  );

  it.effect("a grant no commit named is swept a day after it was granted", () =>
    Effect.gen(function* () {
      const { userId, agentId, deviceId } = yield* openAccount;
      const abandoned = `state/${randomUUID()}`;
      yield* grantAgentStateUpload(userId, { agentId, deviceId, path: abandoned }, NOW);
      const sweptAt = (at: number) =>
        Effect.map(sweepableAgentStateUploads(new Date(at), EVERY), (grants) =>
          grants.filter((grant) => grant.path === abandoned),
        );

      const justShort = yield* sweptAt(NOW.getTime() + DAY_MS - 1);
      const aDayOn = yield* sweptAt(NOW.getTime() + DAY_MS);
      const deleted = yield* deleteAgentStateUploads([abandoned]);

      assert.deepEqual(justShort, []);
      assert.deepEqual(aDayOn, [{ path: abandoned, committed: false }]);
      assert.equal(deleted, 1);
      assert.deepEqual(yield* sweptAt(NOW.getTime() + DAY_MS), []);
    }),
  );

  it.effect(
    "an open launch keeps its agent's newest generation past seven days, until it settles",
    () =>
      Effect.gen(function* () {
        const { userId, agentId, deviceId } = yield* openAccount;
        yield* committed(userId, saved(agentId, deviceId, null, "state/held"), NOW);
        const launch = Option.getOrThrow(
          yield* queueDeviceAgentLine(userId, {
            agentId,
            kind: DEVICE_AGENT_LINE_KIND.LAUNCH,
            payload: {},
          }),
        );
        const pathsSwept = () =>
          Effect.map(sweepableAgentStates(new Date(NOW.getTime() + 7 * DAY_MS), EVERY), (rows) =>
            rows.filter((row) => row.agentId === agentId).map((row) => row.path),
          );

        const whileOpen = yield* pathsSwept();
        yield* claimDeviceAgentLine(userId, deviceId, launch.id);
        yield* settleDeviceAgentLine(userId, deviceId, launch.id, 0);
        const settled = yield* pathsSwept();

        assert.deepEqual(whileOpen, []);
        assert.deepEqual(settled, ["state/held"]);
      }),
  );
});
