import { voiceSetVideoParamsSchema } from "@luke/gateway";
import { avatarStateSchema } from "@luke/voice/avatar";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { AVATAR_ACT_KIND } from "./kinds.js";

/**
 * avatar.ts -- Luke's avatar as the windows reach it: the panel's report on it, and the video tile's toggle, as procedures.
 *
 * Main answers both itself (`apps/desktop/src/main/ipc/avatar-acts.ts`),
 * since the avatar's link lives there; neither answers anything.
 */
export const avatarActsContract = {
  [AVATAR_ACT_KIND.AVATAR_REPORT]: actProcedure("Could not report the video on this system.")
    .input(exactInput(avatarStateSchema))
    .output(EffectSchema.Void),
  [AVATAR_ACT_KIND.VOICE_SET_VIDEO]: actProcedure(
    "Could not turn the video on or off on this system.",
  )
    .input(exactInput(voiceSetVideoParamsSchema))
    .output(EffectSchema.Void),
};
