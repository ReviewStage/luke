import type { GatewayMethod, GatewayMethodHandler, GatewayMethodTable } from "@repo/gateway";
import { Data, type Effect, Result, type Scope } from "effect";
import type { HOST_ACTS } from "./contract/index.js";
import type { HostMethodTable } from "./gateway-door.js";

/** One concern of the host: the Gateway methods it answers, and its own lifecycle. */
export interface Composer {
  /** The methods this concern answers, a row write's only from its write declaration. Disjoint from every other composer's. */
  readonly methods: HostMethodTable;
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

/** An act two composers claim, refused for the reason a method two claim is. */
export class DuplicateHostAct extends Data.TaggedError("DuplicateHostAct")<{
  readonly act: keyof typeof HOST_ACTS;
}> {
  override get message(): string {
    return `two composers answer ${this.act}`;
  }
}

/** A composer's act table, as the fold reads it: handlers by act name. */
export type ActClaims = Partial<Record<keyof typeof HOST_ACTS, unknown>>;

/** The tables merged into one, as the intersection their keys are disjoint for. */
export type Folded<Tables extends readonly object[]> = Tables extends readonly [
  infer First,
  ...infer Rest extends readonly object[],
]
  ? First & Folded<Rest>
  : unknown;

/**
 * The tables folded into one, or `refused` for the first key two of them
 * claim. A key a table leaves undefined is no claim, so a partial table folds.
 */
function foldClaims<Key extends string, Handler, E>(
  tables: readonly Partial<Record<Key, Handler>>[],
  refused: (key: Key) => E,
): Result.Result<Partial<Record<Key, Handler>>, E> {
  const merged: Partial<Record<Key, Handler>> = {};
  for (const table of tables) {
    // SAFETY: a handler table's keys are the names it was built from.
    for (const key of Object.keys(table) as Key[]) {
      const handler = table[key];
      if (handler === undefined) continue;
      if (Object.hasOwn(merged, key)) return Result.fail(refused(key));
      merged[key] = handler;
    }
  }
  return Result.succeed(merged);
}

/** The one method table, folded from the composers' own and the host's, or the first method two of them claim. */
export function foldMethods(
  tables: readonly GatewayMethodTable[],
): Result.Result<GatewayMethodTable, DuplicateGatewayMethod> {
  return foldClaims<GatewayMethod, GatewayMethodHandler, DuplicateGatewayMethod>(
    tables,
    (method) => new DuplicateGatewayMethod({ method }),
  );
}

/** The one act table, folded from the composers' own, or the first act two of them claim. */
export function foldActs<const Tables extends readonly ActClaims[]>(
  tables: Tables,
): Result.Result<Folded<Tables>, DuplicateHostAct> {
  // SAFETY: the fold holds each table's handlers under the names it gave them, the intersection's every key.
  return foldClaims<keyof typeof HOST_ACTS, unknown, DuplicateHostAct>(
    tables,
    (act) => new DuplicateHostAct({ act }),
  ) as Result.Result<Folded<Tables>, DuplicateHostAct>;
}
