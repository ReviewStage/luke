import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { THIS_MAC_HOST_ACT_KIND } from "./kinds.js";

/**
 * this-mac-host.ts -- This Mac's host as Settings › Hosts reads it, as a procedure: the device its record names, so Hosts draws This Mac on that device's row.
 *
 * The host answers it (`compose-this-mac-host.ts`) from the record of the
 * account install on this Mac, where that install was enrolled with this
 * app's service, and names no device where there is none. A browser tab has
 * no This Mac, so it refuses the read.
 */

export const thisMacHostReadSchema = EffectSchema.Struct({
  deviceId: EffectSchema.optionalKey(EffectSchema.String),
});

export type ThisMacHostRead = typeof thisMacHostReadSchema.Type;

export const thisMacHostActsContract = {
  [THIS_MAC_HOST_ACT_KIND.THIS_MAC_HOST_READ]: actProcedure("Could not read this Mac's host.")
    .input(exactInput(EffectSchema.Undefined))
    .output(thisMacHostReadSchema),
};
