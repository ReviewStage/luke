import {
  factoryWorldParamsSchema,
  factoryWorldViewSchema,
} from "@luke/features/factory-world-view";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { FACTORY_ACT_KIND } from "./kinds.js";

/**
 * factory.ts -- the Factory page's ask of the host about a workspace's world, as a procedure.
 *
 * The output is its view schema flipped, so oRPC's output check encodes the
 * row's value into what crosses the port, and a world its schema does not
 * admit is refused rather than handed to the page.
 */
export const factoryActsContract = {
  [FACTORY_ACT_KIND.FACTORY_WORLD]: actProcedure(
    "Could not read the workspace's world on this system.",
  )
    .input(exactInput(factoryWorldParamsSchema))
    .output(EffectSchema.flip(factoryWorldViewSchema)),
};
