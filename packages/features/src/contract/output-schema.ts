/**
 * output-schema.ts -- the wire schema a hosted procedure's answer is decoded with, read off the contract.
 *
 * The desktop's link (`hosted-link.ts`) and a page's (`browser-client.ts`)
 * both decode a success with the schema its procedure declares, so the one
 * reading of that declaration stands here.
 */

import { type AnySchema, getProcedureContractOrThrow } from "@orpc/contract";
import { Schema } from "effect";
import { hostedContract } from "./index.js";

/**
 * Whether a contract's schema is an Effect Schema, which every hosted
 * procedure's is; a wire schema decodes and encodes with no service, which
 * is what the narrowing states beyond what `Schema.isSchema` checks.
 */
function isWireSchema(
  schema: AnySchema | undefined,
): schema is AnySchema & Schema.Codec<unknown, unknown> {
  return Schema.isSchema(schema);
}

/** The wire schema a procedure's output is decoded with: the one its contract declares, flipped back. */
export function outputWireSchema(path: readonly string[]): Schema.Codec<unknown> | undefined {
  const [declared] = getProcedureContractOrThrow(hostedContract, path)["~orpc"].outputSchemas ?? [];
  return isWireSchema(declared) ? Schema.flip(declared) : undefined;
}
