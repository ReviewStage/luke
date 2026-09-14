import type { CarriedAppAction } from "@sidecar/actions";
import type { WireRecord } from "@sidecar/wire";

/**
 * What crosses between a brain and the windows that draw for it: the few app
 * actions only a renderer can perform. A briefing travels as a speech offer
 * instead, from the speech arbiter that decides when it may be said, and the
 * record of a run a renderer once drew went with the desktop's local brain
 * (LUKE-206).
 */

/**
 * An app act the brain decided that only the renderer can perform — a settings
 * change, showing the panel, opening the feedback composer, the Updates row's
 * button — already validated against the guide in the main process. The
 * renderer performs it and answers by `requestId`.
 */
export interface BrainAppActionRequest {
  requestId: string;
  action: Exclude<CarriedAppAction, { kind: "remember" | "forget" }>;
}

/** The renderer's answer to one app act: what became of it, as the brain reads outcomes. */
export type BrainAppActionAnswer = WireRecord;
