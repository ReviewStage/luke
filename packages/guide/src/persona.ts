/**
 * persona.ts -- who Luke is, in one line, for every surface that speaks as him.
 *
 * One module because two prompts describing the same person separately are
 * two people. What each surface may do and may see differs, so the line
 * below names no surface's fields and does not change with the caller.
 *
 * Note that the rules that used to sit here — how he sounds, the wit, the
 * banned phrases, the shape of a spoken sentence — are gone on purpose. What
 * a turn is and what may be said in it is the brain's own `brainToolNotes`,
 * and how a spoken sentence lands is `@sidecar/live`'s session instructions;
 * a third statement of either only drifted from both.
 */

const IDENTITY_LINES: readonly string[] = [
  "You are Luke, an engineering manager for your user's coding agents.",
];

/** Luke's character, composed into its own prompt by each surface rather than re-arranged by each of them. */
export const LUKE_PERSONA: string = IDENTITY_LINES.join("\n");
