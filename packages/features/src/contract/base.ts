/**
 * base.ts -- the builder every hosted procedure contract starts from.
 *
 * The import above is oRPC's Effect input-output extension, loaded here
 * because every contract module builds from this one, so `.input` and
 * `.output` take an Effect Schema before any contract is declared. Every
 * procedure declares the whole refusal map: which refusals a route answers
 * is its handler's to say, and a refusal it answers is then always a
 * declared error rather than an unknown one.
 */

import "@orpc/experimental-effect/extensions/input-output";
import { oc } from "@orpc/contract";
import { HOSTED_ERRORS } from "./errors.js";

export const hostedProcedure = oc.errors(HOSTED_ERRORS);
