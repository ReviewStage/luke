/**
 * browser-live.ts -- a cloud Browser tab's live view as the panel reaches main for it: attached and detached, as procedures.
 *
 * Main answers them itself (`apps/desktop/src/main/ipc/browser-live-acts.ts`),
 * since the port they post reaches its windows; a browser tab refuses both,
 * opening the socket from its own page instead. They carry ids alone: what
 * the page shows travels on the port an attach posts to the asking panel.
 */

import {
  browserLiveAttachParamsSchema,
  browserLiveDetachParamsSchema,
} from "@luke/features/browser-live-acts";
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
