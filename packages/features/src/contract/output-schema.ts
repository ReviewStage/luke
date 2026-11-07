/**
 * output-schema.ts -- what a hosted procedure declares, read off the contract: the wire schema its answer is decoded with, and the refusals it may answer.
 *
 * The desktop's link (`hosted-link.ts`) and a page's (`browser-client.ts`)
 * both decode a success with the schema its procedure declares, and the
 * desktop's reads a refusal its procedure does not declare as no answer,
 * so the one reading of each declaration stands here.
 */

import { getProcedureContractOrThrow } from "@orpc/contract";
import type { Schema } from "effect";
import { hostedContract } from "./index.js";
import { procedureOutputWire } from "./output-wire.js";

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
