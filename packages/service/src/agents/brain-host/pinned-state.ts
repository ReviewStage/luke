import { AsyncLocalStorage } from "node:async_hooks";
import type { StateHandle } from "eve/context";

/**
 * A state handle held to the async context it was pinned in. eve keeps a
 * session's durable state in an `AsyncLocalStorage` container and reads the
 * container again on every `get` and `update`, from whatever async context
 * the call is made in. A hook or a resolver is entered in its own session's
 * container, and on `effect 4.0.0-rc.115` the first statement it ran could
 * leave it in another's: a statement is a wait for the pool's one connection,
 * and Effect resumed a waiter inside the stack of whoever released it. With two sessions running turns
 * in one process, the releaser was the other session's step, so a relay
 * reading its turns after that statement read the other session's state,
 * found no turn of its own, and dropped every later event of the turn; an
 * update landed in state the wrong session serializes. Note that `effect
 * 4.0.4` captures a fiber's async context when it suspends and resumes it
 * there, so a statement no longer moves its caller and the pin holds a
 * context the caller already stands in. The handle is still pinned where the
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
