/**
 * What a provider line's delete is currently asking.
 *
 * Deleting a stored key is the one act in this panel that cannot be undone from
 * inside it. Luke never sends a key back — the main process reports where a
 * credential resolved from and nothing more — so a trash pressed by mistake
 * costs a trip to the provider's own site to put right. That is what the
 * confirm is for, and it is why the trash asks rather than acts.
 */
export const REMOVAL_STAGE = {
  /** Nothing asked: the line is showing what can be done to the key. */
  RESTING: "resting",
  /** Asked, and waiting to be answered. */
  ASKING: "asking",
  /** Answered, and the key is being cleared. */
  CLEARING: "clearing",
} as const;

export type RemovalStage = (typeof REMOVAL_STAGE)[keyof typeof REMOVAL_STAGE];

/** What is true around the question, which is what decides whether it survives. */
export interface RemovalSurroundings {
  /** True while Luke still keeps a key of its own for this provider. */
  stored: boolean;
  /** True while the panel is the shape on screen. */
  panelOpen: boolean;
}

/**
 * What the line draws, given the question it is holding and what has become
 * true around it.
 *
 * A question outlives neither its subject nor the surface it was asked on. The
 * key going takes it: there is nothing left to confirm, and a confirm left
 * standing where a key used to be would be pointed at whatever is stored there
 * next. The panel closing takes it too — a confirm is a question put to
 * somebody standing in front of it, and one still waiting behind a closed panel
 * would be the first thing under the pointer the next time it opened, with
 * nobody having asked for it. Standing down to the slot closes the panel by
 * this measure, which is what keeps a trip to fetch a key from bringing an
 * armed delete back with it.
 *
 * Both are the opposite of a key half-entered, which is the one thing here that
 * does survive a close: that is work someone is in the middle of, and this is a
 * question they walked away from.
 *
 * A delete already sent is the exception to both. It is no longer a question,
 * so it finishes wherever it is and the line reports what came back.
 */
export function removalStage(
  held: RemovalStage,
  { stored, panelOpen }: RemovalSurroundings,
): RemovalStage {
  if (held === REMOVAL_STAGE.CLEARING) return held;
  if (!stored || !panelOpen) return REMOVAL_STAGE.RESTING;
  return held;
}

/**
 * Whether the confirm is what the line is showing, rather than its controls.
 * A delete in flight still draws it, so the answer that was given stays on
 * screen saying what it is doing.
 */
export function removalAsked(stage: RemovalStage): boolean {
  return stage !== REMOVAL_STAGE.RESTING;
}

/**
 * Whether the question can still be taken back. Only one that is still a
 * question can be: an answer already given is nobody's to withdraw, and a line
 * that forgot a delete it had sent would draw the trash back over a key still
 * on its way out — and take a second ask over the top of the first.
 *
 * This is the same rule `removalStage` keeps against the panel closing, said
 * for the controls: `Cancel` goes disabled while a delete is in flight, so
 * today nothing focused inside the group can reach Escape, but the invariant
 * must not rest on which element happens to hold the caret.
 */
export function removalWithdrawable(stage: RemovalStage): boolean {
  return stage === REMOVAL_STAGE.ASKING;
}
