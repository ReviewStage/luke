/**
 * output-schema.ts -- what a hosted procedure declares, read off the contract: the wire schema its answer is decoded with, and the refusals it may answer.
 *
 * The desktop's link (`hosted-link.ts`) and a page's (`browser-client.ts`)
 * both decode a success with the schema its procedure declares, and the
 * desktop's reads a refusal its procedure does not declare as no answer,
 * so the one reading of each declaration stands here.
 */

import {
  type AnyProcedureContract,
  type AnySchema,
  getProcedureContractOrThrow,
} from "@orpc/contract";
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

/** The wire schema a procedure's output is decoded with: the one it declares, flipped back. */
export function procedureOutputWire(
  procedure: AnyProcedureContract,
): Schema.Codec<unknown> | undefined {
  const [declared] = procedure["~orpc"].outputSchemas ?? [];
  return isWireSchema(declared) ? Schema.flip(declared) : undefined;
}

/** The wire schema the procedure at a path decodes its output with (`procedureOutputWire`). */
export function outputWireSchema(path: readonly string[]): Schema.Codec<unknown> | undefined {
  return procedureOutputWire(getProcedureContractOrThrow(hostedContract, path));
}

/** Whether the procedure at a path declares a refusal. */
export function refusalDeclared(path: readonly string[], refusal: string): boolean {
  return Object.hasOwn(
    getProcedureContractOrThrow(hostedContract, path)["~orpc"].errorMap,
    refusal,
  );
}
