import { Effect } from "effect";
import type { EntityPool, WriteDeclaration } from "./entity-pool.js";

export const ACT = {
  ROW_WRITE: "rowWrite",
  REMOTE_WORK: "remoteWork",
  DOCUMENT: "document",
  LOCAL_WRITE: "localWrite",
  READ: "read",
} as const;

export type Act = (typeof ACT)[keyof typeof ACT];

declare const DECLARED: unique symbol;

export type DeclaredHandler<Handler> = Handler & { readonly [DECLARED]: true };

export type DoorTable<
  Method extends string,
  Classes extends Readonly<Record<Method, Act>>,
  Handler,
> = {
  [Each in Method]?: Classes[Each] extends typeof ACT.ROW_WRITE
    ? DeclaredHandler<Handler>
    : Handler;
};

export function declaredMethod<Params, Context, Input, Refusal, Row extends object, Change, Answer>(
  pool: EntityPool,
  declaration: WriteDeclaration<Row, Change, Input, Answer>,
  input: (params: Params, context: Context) => Effect.Effect<Input, Refusal>,
): DeclaredHandler<(params: Params, context: Context) => Effect.Effect<Answer, Refusal>> {
  const handler = (params: Params, context: Context) =>
    Effect.flatMap(input(params, context), (read) => pool.write(declaration, read));
  return handler as DeclaredHandler<typeof handler>;
}
