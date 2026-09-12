import type { SqlClient } from "@effect/sql";
import { type Effect, Schema } from "effect";
import { openPayload, type PayloadKeyRing, sealPayload } from "../encryption.js";

/**
 * The runner of whichever edge composed a hosted-store caller that still
 * answers a promise — `runWeb` in a web function, the test harness's runtime
 * over the same connection — handed to that caller so it builds no runtime of
 * its own. The store itself answers effects now; what still takes this are
 * the store writer, the voice writer, the speech module, the ask record, the
 * device seams, and the brain host's own seams, each of which a route
 * composes apart from the store and each of which still hands a promise up.
 *
 * @deprecated A strangler shim. P10-16 deletes it, with `BrainHostSeams.run`
 * beside it, once the web's route handlers and the modules they call hold
 * effects end to end and nothing above these callers awaits one here.
 */
export type HostedStoreRun = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) => Promise<A>;

export interface HostedStoreContext {
  readonly keys: PayloadKeyRing;
}

/**
 * The seal and open for one user's rows, each envelope bound to that user's
 * id, so a sealed column copied under another user does not open there.
 */
export interface UserSeal {
  readonly seal: (plaintext: string) => string;
  readonly open: (sealed: string) => string;
}

export function userSeal(keys: PayloadKeyRing, userId: string): UserSeal {
  return {
    seal: (plaintext) => sealPayload(plaintext, keys, userId),
    open: (sealed) => openPayload(sealed, keys, userId),
  };
}

/** An optional field as its nullable column takes it. */
export function nullable<Value>(value: Value | undefined): Value | null {
  return value === undefined ? null : value;
}

/** A nullable column as an optional field: present with its value, or absent. */
export function optionalField<Value>(name: string, value: Value | null): Record<string, Value> {
  return value === null ? {} : { [name]: value };
}

/**
 * A `bigint` epoch-millis column as the two drivers hand it back: `pg` reads
 * `int8` as a string, because a 64-bit value need not fit a JS number, while
 * PGlite parses it to one. Every instant in these columns is a millisecond
 * since the epoch, well inside the safe integer range, so both readings
 * decode to the same number and neither dialect's rows read differently.
 */
export const EpochMillisColumnSchema = Schema.Union(Schema.Number, Schema.NumberFromString);
