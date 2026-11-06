/**
 * entity-store-rollout.ts -- whether the signed-in account's lists are kept in the encrypted SQLite store (`entity-store.ts`) or in the sealed file (`sealed-entity-store.ts`), as the deployment's rollout decides, read at each launch before either opens.
 *
 * The service answers it on the account's access (`ENTITY_DATABASE_ROLLOUT`,
 * `packages/service/README.md`'s "The entity database's rollout"), and the
 * last answer for each account is kept in `entities.rollout` beside the
 * database. A launch whose kept answer is on waits on a fresh read, up to
 * `ROLLOUT_READ_EVERY`, before the SQLite store opens, so turning the rollout
 * off reaches a Mac at its next launch, even one whose last launch ended in
 * the store; a read that fails or does not answer in time leaves it on. A
 * launch whose kept answer is off, or that keeps none, or one for another
 * account, opens the sealed store at once and reads the rollout behind it,
 * keeping its answer for the next launch, so a Mac outside the rollout never
 * waits on it. The file holds an account id and a boolean, and leaves with
 * the store's files at a sign-out (`forgetEntityStore`).
 */

import { Duration, Effect, Option, type Path, Result, Schema } from "effect";
import type * as FileSystem from "effect/FileSystem";
import { readSettingsFileText, writeSettingsFileAtomic } from "./effect/settings-store-io.js";
import { ENTITY_ROLLOUT_FILE_NAME } from "./entity-store.js";

/** How long a launch waits on the rollout's answer before it takes the last one kept. */
const ROLLOUT_READ_EVERY = Duration.seconds(3);

/** The last answer kept: for whom, and whether it kept the SQLite store on. */
const keptRolloutSchema = Schema.Struct({ accountId: Schema.String, on: Schema.Boolean });

const decodeKept = Schema.decodeUnknownResult(Schema.fromJsonString(keptRolloutSchema));
const encodeKept = Schema.encodeEffect(Schema.fromJsonString(keptRolloutSchema));

/** Whether the SQLite store opens this launch, and the read that keeps the rollout's answer for the next, which the caller runs behind the store's opening. */
export interface EntityDatabaseChoice {
  readonly on: boolean;
  readonly refreshed: Effect.Effect<void, never, FileSystem.FileSystem | Path.Path>;
}

/** Keeps `on` as the rollout's last answer for `accountId`; a failure to keep it is logged, since it costs only the next launch's choice. */
const kept = Effect.fn("host/entityRolloutKept")(function* (
  directory: string,
  accountId: string,
  on: boolean,
) {
  yield* encodeKept({ accountId, on }).pipe(
    Effect.flatMap((text) =>
      writeSettingsFileAtomic(directory, text, undefined, ENTITY_ROLLOUT_FILE_NAME),
    ),
    Effect.catch((failure) =>
      Effect.logWarning(`the entity store's rollout was not kept: ${failure._tag}`),
    ),
  );
});

/**
 * Whether the SQLite store opens for `accountId` this launch. Where the
 * answer kept for it is on, `read`'s answer within `ROLLOUT_READ_EVERY`
 * decides, kept for the next launch, and on stands where it gives none.
 * Otherwise the store does not open, and `refreshed` reads the rollout and
 * keeps its answer for the next launch.
 */
export const entityDatabaseChosen = Effect.fn("host/entityDatabaseChosen")(function* (options: {
  readonly directory: string;
  readonly accountId: string;
  /** The rollout's answer for the account signed in; none where the read failed. */
  readonly read: Effect.Effect<boolean | undefined>;
}): Effect.fn.Return<EntityDatabaseChoice, never, FileSystem.FileSystem | Path.Path> {
  const { directory, accountId, read } = options;
  const text = yield* Effect.orElseSucceed(
    readSettingsFileText(directory, ENTITY_ROLLOUT_FILE_NAME),
    () => undefined,
  );
  const last = text === undefined ? undefined : Result.getOrUndefined(decodeKept(text));
  const keptOn = last !== undefined && last.accountId === accountId && last.on;
  if (!keptOn) {
    return {
      on: false,
      refreshed: Effect.flatMap(read, (answered) =>
        answered === undefined ? Effect.void : kept(directory, accountId, answered),
      ),
    };
  }
  // Note that only a Mac already in the rollout waits on its answer, since only there must turning it off land before the store opens.
  const answered = Option.getOrUndefined(yield* Effect.timeoutOption(read, ROLLOUT_READ_EVERY));
  if (answered !== undefined) yield* kept(directory, accountId, answered);
  return { on: answered ?? true, refreshed: Effect.void };
});
