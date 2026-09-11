import type { GatewayMethod, GatewayMethodTable } from "@sidecar/gateway";
import { Data, Either } from "effect";

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
 * A method two composers claim. Which concern answers a method is a fact
 * about the split, never about the order the merge happened to fold it in,
 * so the fold refuses rather than letting the last writer win.
 */
export class DuplicateGatewayMethod extends Data.TaggedError("DuplicateGatewayMethod")<{
  readonly method: GatewayMethod;
}> {
  override get message(): string {
    return `two composers answer ${this.method}`;
  }
}

/** The one method table, folded from the composers' own, or the first method two of them claim. */
export function foldMethods(
  composers: readonly Composer[],
): Either.Either<GatewayMethodTable, DuplicateGatewayMethod> {
  const merged: GatewayMethodTable = {};
  for (const composer of composers) {
    // SAFETY: a method table's keys are the method names it was built from.
    for (const method of Object.keys(composer.methods) as GatewayMethod[]) {
      const handler = composer.methods[method];
      if (handler === undefined) continue;
      if (merged[method]) return Either.left(new DuplicateGatewayMethod({ method }));
      merged[method] = handler;
    }
  }
  return Either.right(merged);
}

/**
 * The fold as the throwing call its remaining callers hold.
 *
 * @deprecated The host folds its method tables inside its own `Layer`
 * (`mergedMethods` in `./effect/composer.js`), where a collision fails the
 * build; P12-05 deletes this with `composeHost`'s adaptor.
 */
export function mergeMethods(composers: readonly Composer[]): GatewayMethodTable {
  return Either.getOrThrowWith(foldMethods(composers), (refusal) => refusal);
}
