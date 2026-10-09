import { AsyncLocalStorage } from "node:async_hooks";
import type { StateHandle } from "eve/context";

/**
 * A state handle held to the async context it was pinned in. eve keeps a
 * session's durable state in an `AsyncLocalStorage` container and reads the
 * container again on every `get` and `update`, from whatever async context
 * the call is made in. A hook or a resolver is entered in its own session's
 * container, but the first statement it runs can leave it in another's: a
 * statement is a wait for the pool's one connection, and Effect resumes a
 * waiter inside the stack of whoever released it (`server/db/drizzle.ts`,
 * `tests/drizzle-bridge.test.ts`). With two sessions running turns in one
 * process, the releaser is the other session's step, so a relay reading its
 * turns after that statement reads the other session's state, finds no turn
 * of its own, and drops every later event of the turn; an update lands in
 * state the wrong session serializes. So the handle is pinned where the
 * authored file is entered, synchronously and before anything awaits, and
 * every access re-enters that frame: `AsyncLocalStorage.snapshot()` is the
 * one way to enter an async context a callback did not itself create.
 */
export function pinnedState<T>(handle: StateHandle<T>): StateHandle<T> {
  const here = AsyncLocalStorage.snapshot();
  return {
    get: () => here(() => handle.get()),
    update: (next) => here(() => handle.update(next)),
  };
}
