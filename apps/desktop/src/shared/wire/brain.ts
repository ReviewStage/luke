import type { CarriedAppAction } from "@sidecar/acts";
import type { ACT_RESULT_STATUS, WireRecord } from "@sidecar/wire";

/**
 * What crosses the bridge between the brain in the main process and the voice
 * in the renderer. The brain decides and acts on its own side; what reaches
 * the renderer is the reply to a developer's ask and the few app acts only a
 * renderer can perform. A briefing travels as a speech offer instead, from
 * the speech arbiter that decides when it may be said.
 */

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
  action: Exclude<CarriedAppAction, { kind: "remember" | "forget" }>;
}

/** The renderer's answer to one app act: what became of it, as the brain reads outcomes. */
export type BrainAppActAnswer = WireRecord;
