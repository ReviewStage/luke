import {
  portForwardingAnswerSchema,
  portForwardSetParamsSchema,
} from "@repo/features/port-forward-acts";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { PORT_FORWARD_ACT_KIND } from "./kinds.js";

export const portForwardActsContract = {
  [PORT_FORWARD_ACT_KIND.PORT_FORWARD_SET]: actProcedure("Could not forward this agent's ports.")
    .input(exactInput(portForwardSetParamsSchema))
    .output(EffectSchema.flip(portForwardingAnswerSchema)),
};
