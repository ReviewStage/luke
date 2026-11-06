import { type AnySchema, getProcedureContractOrThrow } from "@orpc/contract";
import { Schema } from "effect";
import { hostedContract } from "./index.js";

function isWireSchema(
  schema: AnySchema | undefined,
): schema is AnySchema & Schema.Codec<unknown, unknown> {
  return Schema.isSchema(schema);
}

export function outputWireSchema(path: readonly string[]): Schema.Codec<unknown> | undefined {
  const [declared] = getProcedureContractOrThrow(hostedContract, path)["~orpc"].outputSchemas ?? [];
  return isWireSchema(declared) ? Schema.flip(declared) : undefined;
}
