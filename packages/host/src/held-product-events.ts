import type * as FileSystem from "@effect/platform/FileSystem";
import {
  type HeldProductEvents,
  type HeldProductEventsRecord,
  HeldProductEventsRecordSchema,
} from "@sidecar/analytics";
import { type Context, Effect } from "effect";
import { jsonStateFileEffect } from "./effect/json-state-file.js";
import { Reporter, StateRoot } from "./effect/seams.js";

/**
 * The counted events no credential could carry, in the app's own state
 * directory beside the onboarding record. Read by the sender once per run and
 * written by it alone; nothing else draws or reads it.
 */
export const HELD_PRODUCT_EVENTS_FILE = "held-product-events.json";

const heldProductEventsFile = jsonStateFileEffect({
  fileName: HELD_PRODUCT_EVENTS_FILE,
  schema: HeldProductEventsRecordSchema,
});

/**
 * The sender's hold over that file, with every seam it needs already
 * provided, so the sender runs it on a runtime that knows none of them. An
 * empty hold is still written: the file then says in as many words that
 * nothing waits, rather than an earlier batch standing on disk after it was
 * posted.
 */
export function heldProductEvents(
  stateRoot: string,
  report: (message: string) => void,
  fileSystem: Context.Context<FileSystem.FileSystem>,
): HeldProductEvents {
  const provided = <A>(
    effect: Effect.Effect<A, never, FileSystem.FileSystem | StateRoot | Reporter>,
  ): Effect.Effect<A> =>
    effect.pipe(
      Effect.provideService(StateRoot, stateRoot),
      Effect.provideService(Reporter, { report }),
      Effect.provide(fileSystem),
    );
  return {
    read: provided(heldProductEventsFile.read),
    write: (record: HeldProductEventsRecord) =>
      Effect.asVoid(provided(heldProductEventsFile.update(() => record))),
  };
}
