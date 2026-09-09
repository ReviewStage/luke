/**
 * A reference filled after construction. Some compositions have concerns that
 * depend on each other in both directions — the host's account gate starts
 * the loops whose owners read that gate; the desktop's windows carry an act
 * the node performs, and the node broadcasts to those windows — so those
 * edges cannot be constructor arguments. A read before the composition has
 * filled it throws by name, so a cycle closed in the wrong order is a named
 * failure rather than an `undefined` a caller carries somewhere else.
 */
export interface LateRef<T> {
  set: (value: T) => void;
  get: () => T;
}

export function lateRef<T>(name: string): LateRef<T> {
  let held: T | undefined;
  return {
    set: (value) => {
      held = value;
    },
    get: () => {
      if (held === undefined) throw new Error(`${name} is read before link() has run`);
      return held;
    },
  };
}
