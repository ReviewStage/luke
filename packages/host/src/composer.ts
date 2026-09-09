import type { GatewayMethod, GatewayMethodTable } from "@sidecar/gateway";

/** One concern of the host: the Gateway methods it answers, and its own lifecycle. */
export interface Composer {
  /** The methods this concern answers. Disjoint from every other composer's. */
  readonly methods: GatewayMethodTable;
  /** What this concern begins: timers, subscriptions, loops, stores. */
  start: () => Promise<void>;
  /** Stops exactly what `start` began; safe to call when `start` never ran, and safe to call twice. */
  stop: () => Promise<void>;
}

/**
 * The one method table, folded from the composers' own. A method two
 * composers claim is a construction failure rather than a silent
 * last-writer-wins: which concern answers a method is a fact about the split,
 * never about the order the merge happened to fold it in.
 */
export function mergeMethods(composers: readonly Composer[]): GatewayMethodTable {
  const merged: GatewayMethodTable = {};
  for (const composer of composers) {
    // SAFETY: a method table's keys are the method names it was built from.
    for (const method of Object.keys(composer.methods) as GatewayMethod[]) {
      if (merged[method]) throw new Error(`two composers answer ${method}`);
      merged[method] = composer.methods[method];
    }
  }
  return merged;
}
