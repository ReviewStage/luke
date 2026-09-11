import { Cause, Effect, Exit } from "effect";

/**
 * The one promise face the on-disk adapters answer a `SessionProviderPlugin`
 * from. Their reads are effects; the plugin seam the host holds is still a
 * promise, so the run happens here rather than in each adapter.
 *
 * What it rethrows is the failure itself rather than the fiber's wrapping of
 * it: these reads tolerate everything an absent or unreadable provider
 * directory can answer, so anything left is a defect a caller reads the way
 * it always did.
 *
 * @deprecated P7-05 composes observation as effects and deletes this face.
 */
export async function runAdapterRead<Value>(read: Effect.Effect<Value>): Promise<Value> {
  const exit = await Effect.runPromiseExit(read);
  if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
  return exit.value;
}
