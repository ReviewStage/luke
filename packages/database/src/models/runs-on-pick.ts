import { CODING_AGENT_MACHINE } from "@luke/features/coding-agent-wire";
import type { TaskRunsOnRequest } from "@luke/features/task-wire";
import { eq } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { accountPreference } from "../schemas/preferences.js";

/**
 * runs-on-pick.ts -- where an account last chose to run a task, kept so a task an agent makes for it starts there too.
 *
 * New task's Runs on, and a quick add's, are the window's, but a task an
 * agent makes for the member (`create_task`) is made where no window
 * stands, so the service keeps the last place a start named on the
 * account's preference row: the cloud, or one of its devices by id. Note
 * that it is written alone, never through the preferences snapshot, and
 * moves no `updated_at`, because that instant tells a Mac the preferences
 * part was written and a pick is no part of it.
 */

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

/** Writes the pick over what stood, opening the account's row where it has none. */
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

/** The pick a row holds; none where it holds none, or a device row lost its id. */
function pickOf(row: typeof PickRowSchema.Type): Option.Option<TaskRunsOnRequest> {
  if (row.machine === CODING_AGENT_MACHINE.VERCEL) {
    return Option.some({ machine: CODING_AGENT_MACHINE.VERCEL });
  }
  if (row.machine === CODING_AGENT_MACHINE.DEVICE && row.deviceId !== null) {
    return Option.some({ machine: CODING_AGENT_MACHINE.DEVICE, deviceId: row.deviceId });
  }
  return Option.none();
}

/** Where the account last chose to run a task; none where no start has named one. */
export function readRunsOnPick(
  userId: string,
): Effect.Effect<Option.Option<TaskRunsOnRequest>, StoreFailure, DatabaseServices> {
  return Effect.map(findPick(userId), Option.flatMap(pickOf));
}

/** Keeps where the account chose to run a task as its last pick, over what stood. */
export function keepRunsOnPick(
  userId: string,
  pick: TaskRunsOnRequest,
): Effect.Effect<void, StoreFailure, DatabaseServices> {
  return upsertPick({
    userId,
    machine: pick.machine,
    deviceId: pick.machine === CODING_AGENT_MACHINE.DEVICE ? pick.deviceId : null,
  });
}
