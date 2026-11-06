import type { QueryError } from "@repo/database/core/query";
import { failureDetail, failureKind } from "@repo/runtime/effect";
import { Effect, Option, type Schema } from "effect";

export type StoreFailure = QueryError | Schema.SchemaError;

export function logStoreFailure(failure: StoreFailure): Effect.Effect<void> {
  const detail = Option.match(failureDetail(failure), {
    onNone: () => "",
    onSome: (said) => ` (${said})`,
  });
  return Effect.logWarning(`Hosted store unavailable: ${failureKind(failure)}${detail}`);
}
