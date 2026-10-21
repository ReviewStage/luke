/**
 * browser.ts -- a Browser tab's view as the panel reaches it: opened, sent on, stepped, placed, caught as a still, closed, and kept from an agent, as procedures.
 *
 * Main answers them itself (`apps/desktop/src/main/ipc/browser-acts.ts`),
 * since the views hang over its windows; a browser tab refuses every one.
 */

import {
  browserAddressParamsSchema,
  browserOpenParamsSchema,
  browserPageSchema,
  browserPlaceParamsSchema,
  browserStepParamsSchema,
  browserViewParamsSchema,
} from "@luke/features/browser-acts";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { BROWSER_ACT_KIND } from "./kinds.js";

export const browserActsContract = {
  [BROWSER_ACT_KIND.BROWSER_OPEN]: actProcedure("Could not open that page.")
    .input(exactInput(browserOpenParamsSchema))
    .output(browserPageSchema),
  [BROWSER_ACT_KIND.BROWSER_NAVIGATE]: actProcedure("Could not open that page.")
    .input(exactInput(browserAddressParamsSchema))
    .output(EffectSchema.Void),
  [BROWSER_ACT_KIND.BROWSER_STEP]: actProcedure("Could not move the page.")
    .input(exactInput(browserStepParamsSchema))
    .output(EffectSchema.Void),
  [BROWSER_ACT_KIND.BROWSER_PLACE]: actProcedure("Could not show the page.")
    .input(exactInput(browserPlaceParamsSchema))
    .output(EffectSchema.Void),
  // A still of the page as a data address, or none where the view stands nowhere.
  [BROWSER_ACT_KIND.BROWSER_CAPTURE]: actProcedure("Could not draw the page.")
    .input(exactInput(browserViewParamsSchema))
    .output(EffectSchema.NullOr(EffectSchema.String)),
  [BROWSER_ACT_KIND.BROWSER_CLOSE]: actProcedure("Could not close the page.")
    .input(exactInput(browserViewParamsSchema))
    .output(EffectSchema.Void),
  // The bar's Stop: the agent driving the page is cut off, and every agent's action on it refused until the developer clicks into it.
  [BROWSER_ACT_KIND.BROWSER_STOP]: actProcedure("Could not stop the agent.")
    .input(exactInput(browserViewParamsSchema))
    .output(EffectSchema.Void),
};
