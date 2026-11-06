import type { GatewayMethod, GatewayMethodTable } from "@repo/gateway";
import { Data, type Effect, Result, type Scope } from "effect";
import type { HostMethodTable } from "./gateway-door.js";

export interface Composer {
  readonly methods: HostMethodTable;
  readonly lifetime: Effect.Effect<void, never, Scope.Scope>;
}

export class DuplicateGatewayMethod extends Data.TaggedError("DuplicateGatewayMethod")<{
  readonly method: GatewayMethod;
}> {
  override get message(): string {
    return `two composers answer ${this.method}`;
  }
}

export function foldMethods(
  composers: readonly Composer[],
): Result.Result<GatewayMethodTable, DuplicateGatewayMethod> {
  const merged: GatewayMethodTable = {};
  for (const composer of composers) {
    for (const method of Object.keys(composer.methods) as GatewayMethod[]) {
      const handler = composer.methods[method];
      if (handler === undefined) continue;
      if (merged[method]) return Result.fail(new DuplicateGatewayMethod({ method }));
      merged[method] = handler;
    }
  }
  return Result.succeed(merged);
}
