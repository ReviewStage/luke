import type { APP_TOOL_KIND, CarriedAppAction } from "@sidecar/acts";
import type { ACT_RESULT_STATUS } from "@sidecar/wire";

/**
 * What crosses the bridge between the brain in the main process and the voice
 * in the renderer. The brain decides and acts on its own side; what reaches
 * the renderer is words to speak and the few app acts only a renderer can
 * perform.
 */

/**
 * One briefing the brain decided to give, on its way to the voice.
 * `decidedAt` lets the queue drop one that waited too long rather than read
 * it out as though it just happened.
 */
export interface BriefingPayload {
  briefing: string;
  decidedAt: number;
}

/**
 * What a developer ask comes back with: the reply for the voice to say, or a
 * bounded refusal the voice can say instead — no brain in this build, an ask
 * the deadline outran, a turn that failed.
 */
export type BrainAskResult =
  | { status: typeof ACT_RESULT_STATUS.ACCEPTED; briefing: string }
  | { status: typeof ACT_RESULT_STATUS.REJECTED; reason: string };

/**
 * An app act the brain decided that only the renderer can perform — a settings
 * change, showing the panel, opening the feedback composer, the Updates row's
 * button — already validated against the guide in the main process. The
 * renderer performs it and answers by `requestId`.
 */
export interface BrainAppActRequest {
  requestId: string;
  action: Exclude<
    CarriedAppAction,
    { kind: typeof APP_TOOL_KIND.REMEMBER | typeof APP_TOOL_KIND.FORGET }
  >;
}
