import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { AGENT_MACHINE } from "@repo/features/agent-wire";
import {
  DEVICE_AGENT_LINE_KIND,
  DEVICE_ARCH,
  DEVICE_PLATFORM,
  type DevicePlatform,
} from "@repo/features/device-agent-wire";
import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { agentTable } from "../../schemas/agent.js";
import { user } from "../../schemas/auth.js";
import { CONVERSATION_RUNTIME } from "../../storage-vocabulary.js";
import { DEVICE_LAYOUT, getTestDB, startTask } from "../../testing/index.js";
import {
  createAgent,
  readRunnerTokenConversation,
  recordAgentRunnerToken,
} from "../agent-store.js";
import { latestDeviceAgentLaunch, queueDeviceAgentLine } from "../device-agent-store.js";
import { deviceLayout, registerDevice } from "../device-store.js";
import {
  enrollOwnDevice,
  hostBySecret,
  hostRemoved,
  hostsOf,
  registerHost,
  removeHost,
} from "../host-store.js";
import { keepRunsOnPick, readRunsOnPick } from "../runs-on-pick.js";

const openAccounts = Effect.gen(function* () {
  const db = yield* Database;
  const [owner, other] = [`user-${randomUUID()}`, `user-${randomUUID()}`];
  for (const id of [owner, other]) {
    yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  }
  return { owner, other };
});

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
    return { id, secretHash, folded: Option.getOrThrow(enrolled) };
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

        assert.ok(Option.isNone(unnamed), "an enroll naming no machine creates none");
        assert.deepEqual(created, Option.some([]));
        assert.ok(Option.isNone(byOther), "another account's id is never taken");
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
        const layoutForOther = yield* deviceLayout(other, id);
        const rotated = yield* enrollOwnDevice(owner, {
          id,
          version: "0.1.0",
          secretHash: rotatedHash,
        });
        const firstAfterRotate = yield* hostBySecret(firstHash);
        const removedByOther = yield* removeHost(other, id);
        const removed = yield* removeHost(owner, id);

        assert.ok(Option.isNone(byOther), "another account's session enrolls nothing");
        assert.equal(removedByOther, undefined, "another account removes nothing");
        assert.ok(Option.isNone(layoutForOther), "another account starts nothing on it");
        assert.ok(Option.isNone(yield* hostBySecret(otherHash)));
        assert.deepEqual(yield* hostsOf(other), []);
        assert.deepEqual([first, rotated], [Option.some([]), Option.some([])]);
        assert.deepEqual(
          listed.map((host) => [host.id, host.name, host.platform]),
          [[id, "Studio", DEVICE_PLATFORM.DARWIN]],
          "the desktop is listed under its own id and name",
        );
        assert.ok(Option.isNone(firstAfterRotate), "enrolling again refuses the old secret");
        assert.notEqual(removed, undefined, "the remove answers its transaction");
        assert.ok(
          Option.isNone(yield* hostBySecret(rotatedHash)),
          "a removed Mac's secret is refused",
        );
        assert.deepEqual(yield* hostsOf(owner), []);
        assert.equal(yield* hostRemoved(owner, id), true);
      }),
  );

  it.effect(
    "a Mac's enroll folds the account's other Macs on its machine into it, moving their agents and the Runs on pick, retiring their runners, and removing them, never itself or a Linux box naming the machine",
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
        const started = yield* startTask(owner, { name: "Invitations" });
        const { agent } = Option.getOrThrow(
          yield* createAgent(owner, {
            taskId: started.id,
            idempotencyKey: randomUUID(),
            model: "anthropic/claude-opus-5.5",
            effort: "high",
            descriptionSnapshot: "# Invitations\n",
            prompt: null,
            repository: null,
            runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
            ...runsOn,
          }),
        );
        yield* keepRunsOnPick(owner, runsOn);
        yield* queueDeviceAgentLine(owner, {
          agentId: agent.id,
          kind: DEVICE_AGENT_LINE_KIND.LAUNCH,
          payload: {},
        });
        const bearerDigest = "f".repeat(64);
        yield* recordAgentRunnerToken(owner, agent.id, bearerDigest);

        const fresh = yield* enrolledHost(owner, { name: "Air", machineId });
        const launch = yield* latestDeviceAgentLaunch(owner, agent.id);
        const bearerReaches = yield* readRunnerTokenConversation(bearerDigest);
        const db = yield* Database;
        const [movedAgent] = yield* db
          .select({ deviceId: agentTable.deviceId })
          .from(agentTable)
          .where(eq(agentTable.id, agent.id));

        assert.deepEqual(fresh.folded, [
          { conversationId: agent.conversationId, runningTurnIds: [] },
        ]);
        assert.equal(movedAgent?.deviceId, fresh.id);
        assert.ok(
          Option.isSome(launch) && launch.value.settled,
          "the agent's runner on the folded Mac reads as gone, so it launches again on the new one",
        );
        assert.ok(Option.isNone(bearerReaches), "that runner's bearer reaches none of its tools");
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

      assert.deepEqual(own.folded, []);
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
