import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { AGENT_MACHINE } from "@luke/features/agent-wire";
import {
  DEVICE_ARCH,
  DEVICE_PLATFORM,
  type DevicePlatform,
} from "@luke/features/device-agent-wire";
import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { agentTable } from "../../schemas/agent.js";
import { user } from "../../schemas/auth.js";
import { task } from "../../schemas/task.js";
import { DEVICE_LAYOUT, getTestDB, startTask } from "../../testing/index.js";
import { createAgent } from "../agent-store.js";
import { deviceLayout, registerDevice } from "../device-store.js";
import {
  enrollOwnDevice,
  foldMachine,
  hostBySecret,
  hostRemoved,
  hostsOf,
  registerHost,
  removeHost,
} from "../host-store.js";
import { keepRunsOnPick, readRunsOnPick } from "../runs-on-pick.js";

/**
 * An account's hosts, over a real dialect: a member's session creates a
 * machine its account never registered, and enrolls its own registered
 * desktop in place, which is then read, listed, and removed as a host is;
 * a removed host's secret resolves nothing, and no account enrolls, lists,
 * or removes another's. A Mac that joins again folds the account's other
 * Macs on its machine into it, never another account's, a Linux box's, or
 * itself, and a host's later register never folds.
 * Synthetic accounts, hashes, and machines throughout.
 */

const openAccounts = Effect.gen(function* () {
  const db = yield* Database;
  const [owner, other] = [`user-${randomUUID()}`, `user-${randomUUID()}`];
  for (const id of [owner, other]) {
    yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  }
  return { owner, other };
});

/** A host the account's session enrolled under a fresh id, named, on the machine given where its host said one, a Mac unless another platform is given; its id and its secret's hash. */
const enrolledHost = (
  userId: string,
  host: { readonly name: string; readonly machineId?: string; readonly platform?: DevicePlatform },
) =>
  Effect.gen(function* () {
    const id = randomUUID();
    const secretHash = `secret-${randomUUID()}`;
    const platform = host.platform ?? DEVICE_PLATFORM.DARWIN;
    const enrolled = yield* enrollOwnDevice(userId, {
      id,
      version: "0.5.0",
      secretHash,
      ...(host.machineId === undefined ? undefined : { machineId: host.machineId }),
      machine: { name: host.name, platform, arch: DEVICE_ARCH.ARM64 },
    });
    assert.equal(enrolled, true);
    return { id, secretHash };
  });

it.layer(getTestDB())("the host store", (it) => {
  it.effect(
    "a member's session creates a machine its account never registered, under that account alone, and never takes another account's id",
    () =>
      Effect.gen(function* () {
        const { owner, other } = yield* openAccounts;
        const id = randomUUID();
        const ownerHash = `secret-${randomUUID()}`;
        const machine = { name: "Mini", platform: DEVICE_PLATFORM.DARWIN, arch: DEVICE_ARCH.ARM64 };

        const unnamed = yield* enrollOwnDevice(owner, {
          id: randomUUID(),
          version: "0.1.0",
          secretHash: `secret-${randomUUID()}`,
        });
        const created = yield* enrollOwnDevice(owner, {
          id,
          version: "0.1.0",
          secretHash: ownerHash,
          machine,
        });
        const byOther = yield* enrollOwnDevice(other, {
          id,
          version: "0.1.0",
          secretHash: `secret-${randomUUID()}`,
          machine,
        });

        assert.equal(unnamed, false, "an enroll naming no machine creates none");
        assert.equal(created, true);
        assert.equal(byOther, false, "another account's id is never taken");
        assert.deepEqual(
          (yield* hostsOf(owner)).map((host) => [host.id, host.name, host.platform]),
          [[id, "Mini", DEVICE_PLATFORM.DARWIN]],
        );
        assert.deepEqual(yield* hostsOf(other), []);
        assert.deepEqual(
          Option.map(yield* hostBySecret(ownerHash), (host) => host.userId),
          Option.some(owner),
          "the owner's secret still stands",
        );
      }),
  );

  it.effect(
    "a member enrolls its own desktop in place, which is then listed and removed as any machine, and no other account enrolls it",
    () =>
      Effect.gen(function* () {
        const { owner, other } = yield* openAccounts;
        const id = randomUUID();
        yield* registerDevice(owner, { id, name: "Studio", ...DEVICE_LAYOUT });
        const otherHash = `secret-${randomUUID()}`;
        const firstHash = `secret-${randomUUID()}`;
        const rotatedHash = `secret-${randomUUID()}`;

        const byOther = yield* enrollOwnDevice(other, {
          id,
          version: "0.1.0",
          secretHash: otherHash,
        });
        const first = yield* enrollOwnDevice(owner, {
          id,
          version: "0.1.0",
          secretHash: firstHash,
        });
        const listed = yield* hostsOf(owner);
        // Start offers and launches only on what this read answers the starter.
        const layoutForOther = yield* deviceLayout(other, id);
        const rotated = yield* enrollOwnDevice(owner, {
          id,
          version: "0.1.0",
          secretHash: rotatedHash,
        });
        const firstAfterRotate = yield* hostBySecret(firstHash);
        const removedByOther = yield* removeHost(other, id);
        const removed = yield* removeHost(owner, id);

        assert.equal(byOther, false, "another account's session enrolls nothing");
        assert.equal(removedByOther, false, "another account removes nothing");
        assert.ok(Option.isNone(layoutForOther), "another account starts nothing on it");
        assert.ok(Option.isNone(yield* hostBySecret(otherHash)));
        assert.deepEqual(yield* hostsOf(other), []);
        assert.deepEqual([first, rotated], [true, true]);
        assert.deepEqual(
          listed.map((host) => [host.id, host.name, host.platform]),
          [[id, "Studio", DEVICE_PLATFORM.DARWIN]],
          "the desktop is listed under its own id and name",
        );
        assert.ok(Option.isNone(firstAfterRotate), "enrolling again refuses the old secret");
        assert.equal(removed, true);
        assert.ok(
          Option.isNone(yield* hostBySecret(rotatedHash)),
          "a removed Mac's secret is refused",
        );
        assert.deepEqual(yield* hostsOf(owner), []);
        assert.equal(yield* hostRemoved(owner, id), true);
      }),
  );

  it.effect(
    "a fold moves the account's other Macs on the machine into the device, with their agents, the tasks that run on them, and the Runs on pick, and removes them, never the device itself or a Linux box naming the machine",
    () =>
      Effect.gen(function* () {
        const { owner } = yield* openAccounts;
        const machineId = "a".repeat(64);
        const old = yield* enrolledHost(owner, { name: "Air", machineId });
        const box = yield* enrolledHost(owner, {
          name: "Box",
          machineId,
          platform: DEVICE_PLATFORM.LINUX,
        });
        const runsOn = { machine: AGENT_MACHINE.DEVICE, deviceId: old.id } as const;
        const started = yield* startTask(owner, { name: "Invitations", runsOn });
        const { agent } = Option.getOrThrow(
          yield* createAgent(owner, {
            taskId: started.id,
            idempotencyKey: randomUUID(),
            model: "anthropic/claude-opus-5.5",
            effort: "high",
            planSnapshot: "# Invitations\n",
            prompt: null,
            repository: null,
            ...runsOn,
          }),
        );
        yield* keepRunsOnPick(owner, runsOn);
        const fresh = yield* enrolledHost(owner, { name: "Air", machineId });

        const folded = yield* foldMachine(owner, fresh.id);
        const db = yield* Database;
        const [movedAgent] = yield* db
          .select({ deviceId: agentTable.deviceId })
          .from(agentTable)
          .where(eq(agentTable.id, agent.id));
        const [movedTask] = yield* db
          .select({ deviceId: task.deviceId })
          .from(task)
          .where(eq(task.id, started.id));

        assert.deepEqual(folded, [{ conversationId: agent.conversationId, runningTurnIds: [] }]);
        assert.deepEqual([movedAgent?.deviceId, movedTask?.deviceId], [fresh.id, fresh.id]);
        assert.deepEqual(
          yield* readRunsOnPick(owner),
          Option.some({ machine: AGENT_MACHINE.DEVICE, deviceId: fresh.id }),
        );
        assert.deepEqual(
          (yield* hostsOf(owner)).map((host) => host.id),
          [fresh.id, box.id],
          "the Mac folded into stands, and so does the Linux box",
        );
        assert.ok(Option.isNone(yield* hostBySecret(old.secretHash)), "the folded Mac is refused");
        assert.equal(yield* hostRemoved(owner, old.id), true);
      }),
  );

  it.effect("a fold never reaches another account's Mac on the same machine", () =>
    Effect.gen(function* () {
      const { owner, other } = yield* openAccounts;
      const machineId = "b".repeat(64);
      const others = yield* enrolledHost(other, { name: "Air", machineId });
      const own = yield* enrolledHost(owner, { name: "Air", machineId });

      const folded = yield* foldMachine(owner, own.id);

      assert.deepEqual(folded, []);
      assert.deepEqual(
        (yield* hostsOf(other)).map((host) => host.id),
        [others.id],
      );
      assert.ok(Option.isSome(yield* hostBySecret(others.secretHash)));
    }),
  );

  it.effect(
    "a host's later register never folds, even once it names the machine, so two hosts already running never remove each other",
    () =>
      Effect.gen(function* () {
        const { owner } = yield* openAccounts;
        const machineId = "c".repeat(64);
        const running = yield* enrolledHost(owner, { name: "Air", machineId });
        yield* registerHost(owner, { id: running.id, name: "Air", ...DEVICE_LAYOUT });
        // Note that a host older than the field names no machine at its first register.
        const older = yield* enrolledHost(owner, { name: "Studio" });
        const first = yield* registerHost(owner, {
          id: older.id,
          name: "Studio",
          ...DEVICE_LAYOUT,
        });
        const later = yield* registerHost(owner, {
          id: older.id,
          name: "Studio",
          ...DEVICE_LAYOUT,
          machineId,
        });

        assert.deepEqual([first, later], [Option.some([]), Option.some([])]);
        assert.deepEqual(
          (yield* hostsOf(owner)).map((host) => [host.id, host.machineId]),
          [
            [running.id, machineId],
            [older.id, machineId],
          ],
        );
      }),
  );
});
