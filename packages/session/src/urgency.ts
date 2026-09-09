/**
 * How urgently a surface treats a row — not the provider-observed condition in
 * `SESSION_STATUS`. Each literal carries the `urgency-` prefix so no urgency
 * value can be passed where a session status is expected, and the CSS
 * `data-state` selectors read the same prefix. The vocabulary lives here
 * because a fixture snapshot and a session model both name it, and neither may
 * reach presentation for a value set; the labels and the order it is drawn in
 * stay `@sidecar/surface`'s.
 */

export const SESSION_URGENCY = {
  WORKING: "urgency-working",
  ATTENTION: "urgency-attention",
  COMPLETE: "urgency-complete",
  UNKNOWN: "urgency-unknown",
} as const;

export type SessionUrgency = (typeof SESSION_URGENCY)[keyof typeof SESSION_URGENCY];
