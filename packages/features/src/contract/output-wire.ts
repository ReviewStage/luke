/**
 * output-wire.ts -- the wire schema a hosted procedure's answer is decoded with, read off the procedure itself.
 *
 * It reads one procedure handed to it and names no contract group, so a
 * module the contract index reaches, a window's view among them, reads it
 * without importing the index back (`output-schema.ts` reads it by path).
 */

import type { AnyProcedureContract, AnySchema } from "@orpc/contract";
import { Schema } from "effect";

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

/** The wire schema a procedure's output is decoded with: the one it declares, flipped back. */
export function procedureOutputWire(
  procedure: AnyProcedureContract,
): Schema.Codec<unknown> | undefined {
  const [declared] = procedure["~orpc"].outputSchemas ?? [];
  return isWireSchema(declared) ? Schema.flip(declared) : undefined;
}
