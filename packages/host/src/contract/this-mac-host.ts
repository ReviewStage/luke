import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { THIS_MAC_HOST_ACT_KIND } from "./kinds.js";

/**
 * this-mac-host.ts -- This Mac as the panel reads it, as a procedure: which machine it is and the device its host's record names, so every list of machines names This Mac.
 *
 * The host answers it (`compose-this-mac-host.ts`): the machine's id in the
 * keyed hash every host reports (`@luke/host/node`'s `machine-identity.ts`),
 * where it could be read, and the device of the record of the account
 * install on this Mac, where that install was enrolled with this app's
 * service. A browser tab has no This Mac, so it refuses the read.
 */

export const thisMacHostReadSchema = EffectSchema.Struct({
  deviceId: EffectSchema.optionalKey(EffectSchema.String),
  machineId: EffectSchema.optionalKey(EffectSchema.String),
});

export type ThisMacHostRead = typeof thisMacHostReadSchema.Type;

export const thisMacHostActsContract = {
  [THIS_MAC_HOST_ACT_KIND.THIS_MAC_HOST_READ]: actProcedure("Could not read this Mac's host.")
    .input(exactInput(EffectSchema.Undefined))
    .output(thisMacHostReadSchema),
};
