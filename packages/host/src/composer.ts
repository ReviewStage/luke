import type { GatewayMethod, GatewayMethodTable } from "@sidecar/gateway";
import { Data, type Effect, Either, type Scope } from "effect";

/** One concern of the host: the Gateway methods it answers, and its own lifecycle. */
export interface Composer {
  /** The methods this concern answers. Disjoint from every other composer's. */
  readonly methods: GatewayMethodTable;
  /**
   * What this concern begins — timers, subscriptions, loops, stores — in the
   * scope its lifetime is: running it is the concern started, and the
   * finalizers it registers are the whole of its stop, so closing that scope
   * is the stop and there is no handle to hand back.
   */
  readonly lifetime: Effect.Effect<void, never, Scope.Scope>;
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
