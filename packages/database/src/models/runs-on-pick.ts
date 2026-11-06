import { AGENT_MACHINE } from "@repo/features/agent-wire";
import type { TaskRunsOnRequest } from "@repo/features/task-wire";
import { eq } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { accountPreference } from "../schemas/preferences.js";

const PICK_COLUMNS = {
  machine: accountPreference.runsOnMachine,
  deviceId: accountPreference.runsOnDeviceId,
} as const;

const PickRowSchema = Schema.Struct({
  machine: Schema.NullOr(Schema.String),
  deviceId: Schema.NullOr(Schema.String),
});

const PickWriteSchema = Schema.Struct({
  userId: Schema.String,
  machine: Schema.String,
  deviceId: Schema.NullOr(Schema.String),
});

const findPick = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: PickRowSchema,
  execute: (userId) =>
    Database.use((db) =>
      db
        .select(PICK_COLUMNS)
        .from(accountPreference)
        .where(eq(accountPreference.userId, userId))
        .limit(1),
    ),
});

const upsertPick = SqlSchema.void({
  Request: PickWriteSchema,
  execute: (write) =>
    Database.use((db) =>
      db
        .insert(accountPreference)
        .values({
          userId: write.userId,
          runsOnMachine: write.machine as TaskRunsOnRequest["machine"],
          runsOnDeviceId: write.deviceId,
        })
        .onConflictDoUpdate({
          target: accountPreference.userId,
          set: {
            runsOnMachine: write.machine as TaskRunsOnRequest["machine"],
            runsOnDeviceId: write.deviceId,
          },
        }),
    ),
});

function pickOf(row: typeof PickRowSchema.Type): Option.Option<TaskRunsOnRequest> {
  if (row.machine === AGENT_MACHINE.VERCEL) {
    return Option.some({ machine: AGENT_MACHINE.VERCEL });
  }
  if (row.machine === AGENT_MACHINE.DEVICE && row.deviceId !== null) {
    return Option.some({ machine: AGENT_MACHINE.DEVICE, deviceId: row.deviceId });
  }
  return Option.none();
}

export function readRunsOnPick(
  userId: string,
): Effect.Effect<Option.Option<TaskRunsOnRequest>, StoreFailure, DatabaseServices> {
  return Effect.map(findPick(userId), Option.flatMap(pickOf));
}

export function keepRunsOnPick(
  userId: string,
  pick: TaskRunsOnRequest,
): Effect.Effect<void, StoreFailure, DatabaseServices> {
  return upsertPick({
    userId,
    machine: pick.machine,
    deviceId: pick.machine === AGENT_MACHINE.DEVICE ? pick.deviceId : null,
  });
}
