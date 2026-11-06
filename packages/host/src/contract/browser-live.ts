import {
  browserLiveAttachParamsSchema,
  browserLiveDetachParamsSchema,
} from "@repo/features/browser-live-acts";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { BROWSER_LIVE_ACT_KIND } from "./kinds.js";

export const browserLiveActsContract = {
  [BROWSER_LIVE_ACT_KIND.BROWSER_LIVE_ATTACH]: actProcedure("Could not show that tab.")
    .input(exactInput(browserLiveAttachParamsSchema))
    .output(EffectSchema.Void),
  [BROWSER_LIVE_ACT_KIND.BROWSER_LIVE_DETACH]: actProcedure("Could not close that tab's view.")
    .input(exactInput(browserLiveDetachParamsSchema))
    .output(EffectSchema.Void),
};
