/**
 * A small JSON record under the state root — the arrival record, the
 * calendar onboarding record, and the like — declared once as a
 * `Schema.Struct` and read and written through `FileSystem`, with the file's
 * own path derived from the `StateRoot` seam rather than a closure over it.
 * An absent file, one that is not JSON, one that is not an object, or one
 * the schema refuses is read as `undefined` in every case alike, through
 * `readEither` and no partial record propped up field by field: the same
 * fallback `json-state-file.ts`'s pinned synchronous face still answers with,
 * and the direction its own doc names safe, since withholding a moment never
 * replays one already given. A write that fails is reported through the
 * `Reporter` seam and nothing else — there is no recovery a caller here could
 * take that the next write does not — and `update` still answers the mutated
 * record whether or not the write landed, exactly as the synchronous face
 * does.
 */

import path from "node:path";
import { FileSystem } from "@effect/platform";
import type { UnparsedWireValue } from "@sidecar/wire";
import { Effect, Either, Schema } from "effect";
import { Reporter, StateRoot } from "./seams.js";

export interface JsonStateFileEffectOptions<A, I> {
  /** The file's name within the state root, e.g. `onboarding.json`. */
  readonly fileName: string;
  /** The record's shape, decoding an untrusted JSON value and encoding what persists. */
  readonly schema: Schema.Schema<A, I>;
}

export interface JsonStateFileEffect<A> {
  /** The stored record, or nothing. Reads the file on every call. */
  readonly read: Effect.Effect<A | undefined, never, FileSystem.FileSystem | StateRoot>;
  /**
   * Persists `mutate`'s answer over whatever is on disk at this moment,
   * rather than over a record read earlier, and answers what was persisted.
   */
  readonly update: (
    mutate: (current: A | undefined) => A,
  ) => Effect.Effect<A, never, FileSystem.FileSystem | StateRoot | Reporter>;
}

export function jsonStateFileEffect<A extends object, I>(
  options: JsonStateFileEffectOptions<A, I>,
): JsonStateFileEffect<A> {
  const decode = Schema.decodeUnknownEither(options.schema);
  const encode = Schema.encodeSync(options.schema);
  const filePath = Effect.map(StateRoot, (stateRoot) => path.join(stateRoot, options.fileName));

  const read: JsonStateFileEffect<A>["read"] = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const target = yield* filePath;
    const contents = yield* Effect.option(fs.readFileString(target));
    if (contents._tag === "None") return undefined;
    // SAFETY: JSON.parse answers a runtime value; `decode` below is what validates its shape.
    const parsed = Either.try(() => JSON.parse(contents.value) as UnparsedWireValue);
    if (Either.isLeft(parsed)) return undefined;
    const decoded = decode(parsed.right);
    if (Either.isLeft(decoded)) return undefined;
    return Object.keys(decoded.right).length === 0 ? undefined : decoded.right;
  });

  const update: JsonStateFileEffect<A>["update"] = (mutate) =>
    Effect.gen(function* () {
      const current = yield* read;
      const next = mutate(current);
      const fs = yield* FileSystem.FileSystem;
      const target = yield* filePath;
      yield* fs
        .writeFileString(target, `${JSON.stringify(encode(next))}\n`)
        .pipe(
          Effect.catchAll((error) =>
            Effect.flatMap(Reporter, (reporter) =>
              Effect.sync(() =>
                reporter.report(`Could not persist ${options.fileName}: ${error.message}`),
              ),
            ),
          ),
        );
      return next;
    });

  return { read, update };
}
