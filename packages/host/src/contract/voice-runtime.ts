import {
  voiceCreateLiveSessionParamsSchema,
  voiceCreateLiveSessionResultSchema,
  voiceEndLiveSessionParamsSchema,
  voiceReportLiveActivityParamsSchema,
  voiceReportLiveTransportParamsSchema,
} from "@luke/gateway";
import { liveDiagnosticsSchema } from "@luke/live";
import { VOICE_COMMAND } from "@luke/voice/voice-view";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { VOICE_RUNTIME_ACT_KIND } from "./kinds.js";

/**
 * voice-runtime.ts -- the voice window's runtime as the windows reach it: its commands, its live session, the stop, and its diagnostics, as procedures.
 *
 * Main answers them itself (`apps/desktop/src/main/ipc/voice-runtime.ts`).
 * A window that may not ask one of them is answered nothing rather than
 * refused.
 */
export const voiceRuntimeActsContract = {
  [VOICE_RUNTIME_ACT_KIND.VOICE_COMMAND]: actProcedure(
    "Could not carry that command on this system.",
  )
    .input(
      exactInput(
        EffectSchema.Struct({ command: EffectSchema.Literals(Object.values(VOICE_COMMAND)) }),
      ),
    )
    .output(EffectSchema.Void),
  [VOICE_RUNTIME_ACT_KIND.CALL_SHOW_TASK]: actProcedure(
    "Could not bring the call's task forward on this system.",
  )
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.Void),
  [VOICE_RUNTIME_ACT_KIND.VOICE_CREATE_LIVE_SESSION]: actProcedure(
    "Could not open a voice session on this system.",
  )
    .input(exactInput(voiceCreateLiveSessionParamsSchema))
    .output(EffectSchema.UndefinedOr(EffectSchema.flip(voiceCreateLiveSessionResultSchema))),
  [VOICE_RUNTIME_ACT_KIND.VOICE_END_LIVE_SESSION]: actProcedure(
    "Could not end the voice session on this system.",
  )
    .input(exactInput(voiceEndLiveSessionParamsSchema))
    .output(EffectSchema.Undefined),
  [VOICE_RUNTIME_ACT_KIND.VOICE_REPORT_LIVE_TRANSPORT]: actProcedure(
    "Could not report the voice transport on this system.",
  )
    .input(exactInput(voiceReportLiveTransportParamsSchema))
    .output(EffectSchema.Undefined),
  [VOICE_RUNTIME_ACT_KIND.VOICE_REPORT_LIVE_ACTIVITY]: actProcedure(
    "Could not report the voice activity on this system.",
  )
    .input(exactInput(voiceReportLiveActivityParamsSchema))
    .output(EffectSchema.Undefined),
  [VOICE_RUNTIME_ACT_KIND.VOICE_STOP_SPEAKING]: actProcedure(
    "Could not tell Luke to stop speaking on this system.",
  )
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.Boolean),
  [VOICE_RUNTIME_ACT_KIND.LUKE_STOP]: actProcedure("Could not stop Luke on this system.")
    .input(
      exactInput(
        EffectSchema.Struct({ taskId: EffectSchema.optionalKey(EffectSchema.NonEmptyString) }),
      ),
    )
    .output(EffectSchema.Void),
  [VOICE_RUNTIME_ACT_KIND.VOICE_DIAGNOSTICS]: actProcedure(
    "Could not read the voice diagnostics on this system.",
  )
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.UndefinedOr(EffectSchema.flip(liveDiagnosticsSchema))),
  [VOICE_RUNTIME_ACT_KIND.MICROPHONE_OPEN_SETTINGS]: actProcedure(
    "Could not open the microphone privacy settings.",
  )
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.Void),
};
