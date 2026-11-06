/**
 * entity-store-rollout.ts -- whether the signed-in account's lists are kept in the encrypted SQLite store (`entity-store.ts`) or in the sealed file (`sealed-entity-store.ts`), as the deployment's rollout decides, read at each launch before either opens.
 *
 * The service answers it on the account's access (`ENTITY_DATABASE_ROLLOUT`,
 * `packages/service/README.md`'s "The entity database's rollout"), read
 * afresh as the store is about to open, so turning it off reaches a Mac at
 * its next launch, even one whose last launch ended in the store. A read that
 * fails, or does not answer within `ROLLOUT_READ_EVERY`, gives way to what the
 * last answer for the same account was, kept in `entities.rollout` beside the
 * database; none kept, or one kept for another account, reads as off. The
 * file holds an account id and a boolean, and leaves with the store's files
 * at a sign-out (`forgetEntityStore`).
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

/**
 * Whether the SQLite store opens for `accountId` this launch: `read`'s answer
 * where it gives one within `ROLLOUT_READ_EVERY`, kept for the next launch,
 * and otherwise the answer last kept for the same account, or off.
 */
export const entityDatabaseChosen = Effect.fn("host/entityDatabaseChosen")(function* (options: {
  readonly directory: string;
  readonly accountId: string;
  /** The rollout's answer for the account signed in; none where the read failed. */
  readonly read: Effect.Effect<boolean | undefined>;
}): Effect.fn.Return<boolean, never, FileSystem.FileSystem | Path.Path> {
  const { directory, accountId } = options;
  const answered = Option.getOrUndefined(
    yield* Effect.timeoutOption(options.read, ROLLOUT_READ_EVERY),
  );
  if (answered !== undefined) {
    // Note that an answer not kept costs only the next launch's fallback, so a failure to keep it is logged and the answer stands.
    yield* encodeKept({ accountId, on: answered }).pipe(
      Effect.flatMap((text) =>
        writeSettingsFileAtomic(directory, text, undefined, ENTITY_ROLLOUT_FILE_NAME),
      ),
      Effect.catch((failure) =>
        Effect.logWarning(`the entity store's rollout was not kept: ${failure._tag}`),
      ),
    );
    return answered;
  }
  const text = yield* Effect.orElseSucceed(
    readSettingsFileText(directory, ENTITY_ROLLOUT_FILE_NAME),
    () => undefined,
  );
  const kept = text === undefined ? undefined : Result.getOrUndefined(decodeKept(text));
  return kept !== undefined && kept.accountId === accountId && kept.on;
});
