/**
 * A reference filled after construction. Some of the host's concerns depend
 * on each other in both directions — the account's capability gate starts the
 * loops whose owners read that gate — so those edges cannot be constructor
 * arguments. A read before `link()` has filled it throws by name, so a cycle
 * closed in the wrong order is a named failure rather than an `undefined` a
 * caller carries somewhere else.
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
