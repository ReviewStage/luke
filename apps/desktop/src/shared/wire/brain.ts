import type { CarriedAppAction } from "@sidecar/acts";
import type { SessionIdentity } from "@sidecar/session";
import type { ACT_RESULT_STATUS, WireRecord } from "@sidecar/wire";

/**
 * What crosses the bridge between the brain in the main process and the voice
 * in the renderer. The brain decides and acts on its own side; what reaches
 * the renderer is words to speak, the observed sessions they are about, and
 * the few app acts only a renderer can perform.
 */

/**
 * One briefing the brain decided to give, on its way to the voice. The
 * session identities were validated against the roster at the decision, so
 * the notice band may point at them; `decidedAt` lets the queue drop one that
 * waited too long rather than read it out as though it just happened.
 */
export interface BriefingPayload {
  briefing: string;
  sessionIds: readonly SessionIdentity[];
  decidedAt: number;
}

/**
 * What a developer ask comes back with: the reply for the voice to say and
 * the sessions it named, or a bounded refusal the voice can say instead — no
 * brain in this build, an ask the deadline outran, a turn that failed.
 */
export type BrainAskResult =
  | {
      status: typeof ACT_RESULT_STATUS.ACCEPTED;
      briefing: string;
      sessionIds: readonly SessionIdentity[];
    }
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
