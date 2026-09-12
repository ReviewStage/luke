import { Cause, Effect, Exit } from "effect";

/**
 * The one promise face a `SessionProviderPlugin`'s reads are answered from.
 * Those reads are effects; the read half of the plugin seam the host holds is
 * still a promise — `observe()` and the conversation read behind it — so the
 * run happens here rather than in each adapter. A plugin's writes no longer
 * come through it: `dispatchAction` and every `ActionHandlers` member answer
 * Effects, so a write composes into its caller's own fiber.
 *
 * What it rethrows is the failure itself rather than the fiber's wrapping of
 * it: these reads tolerate everything an absent or unreadable provider
 * directory can answer, so anything left is a defect a caller reads the way
 * it always did.
 *
 * @deprecated Deleted once `observe()` and the conversation read answer
 * Effects their caller runs; no row of the migration schedules that yet, as
 * `docs/adr/0001-effect.md` records.
 */
export async function runAdapterRead<Value, Failure>(
  read: Effect.Effect<Value, Failure>,
): Promise<Value> {
  const exit = await Effect.runPromiseExit(read);
  if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
  return exit.value;
}
