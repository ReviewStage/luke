/**
 * door.ts -- what each method a client asks of the host does, said once, and the one way a row write's method is served: from its write declaration.
 *
 * A host classifies every method it answers (`ACT`) in one map, and types
 * its handler table by that map (`DoorTable`). A row write's method then
 * takes only a handler `declaredMethod` built from a write declaration, which
 * draws the write over the pool at once; a handler written by hand does not
 * compile. The brand that tells the two apart is a type alone, which only
 * `declaredMethod` gives. A row write not declared yet stands on the host's
 * own list of them beside the map, which takes any handler meanwhile.
 */

import { Effect } from "effect";
import type { EntityPool, WriteDeclaration } from "./entity-pool.js";

/** What a method does, which decides how its handler may be built. */
export const ACT = {
  /** Writes a row a read holds: drawn over the pool at once, so served only from a write declaration. */
  ROW_WRITE: "rowWrite",
  /** Work whose outcome only the service can say, as a start or a message: it draws its intent and waits for the outcome. */
  REMOTE_WORK: "remoteWork",
  /** Text the editor draws itself and the service merges as a patch, never a row of the pool. */
  DOCUMENT: "document",
  /** A write to what the host keeps itself, as a setting of this machine. */
  LOCAL_WRITE: "localWrite",
  /** Reads, follows, or lets go of what the service holds, writing nothing. */
  READ: "read",
} as const;

export type Act = (typeof ACT)[keyof typeof ACT];

/** The methods a classification names row writes. */
export type RowWriteOf<Classes extends Readonly<Record<string, Act>>> = {
  [Method in keyof Classes]: Classes[Method] extends typeof ACT.ROW_WRITE ? Method : never;
}[keyof Classes];

/** The brand of a handler built from a write declaration: a type no value carries, so only `declaredMethod` gives it. */
declare const DECLARED: unique symbol;

/** A method handler `declaredMethod` built from a write declaration, the one a declared row write's method takes. */
export type DeclaredHandler<Handler> = Handler & { readonly [DECLARED]: true };

/**
 * A handler table whose row writes, bar those still `Undeclared`, take only
 * a `DeclaredHandler`, and whose every other method takes any `Handler`.
 */
export type DoorTable<
  Method extends string,
  Classes extends Readonly<Record<Method, Act>>,
  Undeclared extends RowWriteOf<Classes>,
  Handler,
> = {
  [Each in Method]?: Classes[Each] extends typeof ACT.ROW_WRITE
    ? Each extends Undeclared
      ? Handler
      : DeclaredHandler<Handler>
    : Handler;
};

/** A row write's handler: its params read as `declaration`'s input, and that written on `pool`, answering what the write answers. */
export function declaredMethod<Params, Context, Input, Refusal, Row extends object, Change, Answer>(
  pool: EntityPool,
  declaration: WriteDeclaration<Row, Change, Input, Answer>,
  input: (params: Params, context: Context) => Effect.Effect<Input, Refusal>,
): DeclaredHandler<(params: Params, context: Context) => Effect.Effect<Answer, Refusal>> {
  const handler = (params: Params, context: Context) =>
    Effect.flatMap(input(params, context), (read) => pool.write(declaration, read));
  // SAFETY: the brand is a type no value carries, and this is the one place it is given, to a handler built from a write declaration.
  return handler as DeclaredHandler<typeof handler>;
}
