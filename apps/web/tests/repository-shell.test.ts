import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { unparsedWire } from "@sidecar/wire";
import { eq } from "drizzle-orm";
import { type Duration, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { user } from "../server/db/auth-schema";
import { planCommand } from "../server/db/plan-schema";
import { db } from "../server/db/query";
import { createPlan } from "../server/hosted/plan-store";
import {
  claimPlanCommand,
  PLAN_COMMAND_WAIT,
  REPOSITORY_SHELL_REFUSAL,
  REPOSITORY_SHELL_STATUS,
  runInRepository,
  settlePlanCommand,
} from "../server/hosted/repository-shell";
import { testSqlClient } from "./support/sql-client";

/**
 * The planning model's shell, run on the developer's Mac: the tool queues
 * its command under the plan, the Mac claims it and settles it, and the tool
 * answers what the Mac answered, or that the Mac never did. The Mac is played
 * by the store's own claim and settle, the calls its two routes make.
 *
 * Synthetic accounts, folders, and output throughout.
 */

const LISTING = { exitCode: 0, stdout: "README.md\nsrc\n", stderr: "" } as const;

/** An account holding one plan, and the binding a planning call runs under. */
const openPlan = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  const started = yield* createPlan(userId, { name: "Teammate invitations" });
  const binding = { userId, planId: started.id };
  return { userId, planId: started.id, binding };
});

/** Another account, which owns none of the plans the test opened. */
const openStranger = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

/** The plan's commands as stored, oldest first. */
const commandsOf = (planId: string) =>
  db
    .select({ id: planCommand.id, command: planCommand.command })
    .from(planCommand)
    .where(eq(planCommand.planId, planId));

/** The plan's first command, once the forked tool's insert has landed. */
const queuedCommand = (planId: string) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
      const [first] = yield* commandsOf(planId);
      if (first !== undefined) return first;
      yield* Effect.yieldNow;
    }
    return assert.fail("the tool never queued its command");
  });

/** A forked effect driven to its end, the clock moved a step at a time so each wait it holds elapses. */
const driven = <A, E>(fiber: Fiber.Fiber<A, E>, step: Duration.Duration) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
      if (fiber.pollUnsafe() !== undefined) return yield* Fiber.join(fiber);
      yield* TestClock.adjust(step);
      yield* Effect.yieldNow;
    }
    return yield* Fiber.join(fiber);
  });

it.layer(testSqlClient)("run_in_repository on the Mac", (it) => {
  it.effect("a command the Mac claims and settles answers what the Mac answered", () =>
    Effect.gen(function* () {
      const { userId, planId, binding } = yield* openPlan;

      const tool = yield* Effect.forkChild(
        runInRepository(binding, unparsedWire({ command: "ls" })),
      );
      const queued = yield* queuedCommand(planId);
      const claimed = yield* claimPlanCommand(userId, planId);
      const settled = yield* settlePlanCommand(userId, planId, queued.id, LISTING);
      const answered = yield* driven(tool, PLAN_COMMAND_WAIT.RESULT_POLL);

      assert.deepEqual(claimed, { id: queued.id, command: "ls" });
      assert.equal(settled, true);
      assert.deepEqual(answered, { status: REPOSITORY_SHELL_STATUS.RAN, ...LISTING });
    }),
  );

  it.effect("a command no Mac answers by the deadline answers not-run", () =>
    Effect.gen(function* () {
      const { planId, binding } = yield* openPlan;

      const tool = yield* Effect.forkChild(
        runInRepository(binding, unparsedWire({ command: "ls" })),
      );
      yield* queuedCommand(planId);
      const answered = yield* driven(tool, PLAN_COMMAND_WAIT.RESULT_DEADLINE);

      assert.deepEqual(answered, {
        status: REPOSITORY_SHELL_STATUS.NOT_RUN,
        reason: REPOSITORY_SHELL_REFUSAL.NO_ANSWER,
      });
    }),
  );

  it.effect("a command is claimed once, and never by another account", () =>
    Effect.gen(function* () {
      const { userId, planId, binding } = yield* openPlan;
      const stranger = yield* openStranger;
      const tool = yield* Effect.forkChild(
        runInRepository(binding, unparsedWire({ command: "ls" })),
      );
      const queued = yield* queuedCommand(planId);

      const strangerClaim = yield* Effect.forkChild(claimPlanCommand(stranger, planId));
      const strangerClaimed = yield* driven(strangerClaim, PLAN_COMMAND_WAIT.CLAIM_HOLD);
      const first = yield* claimPlanCommand(userId, planId);
      const second = yield* Effect.forkChild(claimPlanCommand(userId, planId));
      const secondClaimed = yield* driven(second, PLAN_COMMAND_WAIT.CLAIM_HOLD);
      const strangerSettled = yield* settlePlanCommand(stranger, planId, queued.id, LISTING);
      yield* Fiber.interrupt(tool);

      assert.equal(strangerClaimed, null);
      assert.equal(first?.id, queued.id);
      assert.equal(secondClaimed, null);
      assert.equal(strangerSettled, false);
    }),
  );

  it.effect("arguments other than one command queue nothing", () =>
    Effect.gen(function* () {
      const { planId, binding } = yield* openPlan;

      const answered = yield* runInRepository(
        binding,
        unparsedWire({ command: "ls", cwd: "/etc" }),
      );

      assert.deepEqual(answered, {
        status: REPOSITORY_SHELL_STATUS.NOT_RUN,
        reason: REPOSITORY_SHELL_REFUSAL.UNREADABLE,
      });
      assert.deepEqual(yield* commandsOf(planId), []);
    }),
  );
});
