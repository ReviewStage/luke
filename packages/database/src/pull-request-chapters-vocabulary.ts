/**
 * pull-request-chapters-vocabulary.ts -- the words a pull request's generated chapters are kept under: where a generation stands, and why one failed.
 */

/** Where a pull request's chapters stand: being made, made, or given up on. */
export const PULL_REQUEST_CHAPTERS_STATUS = {
  GENERATING: "generating",
  READY: "ready",
  FAILED: "failed",
} as const;

export type PullRequestChaptersStatus =
  (typeof PULL_REQUEST_CHAPTERS_STATUS)[keyof typeof PULL_REQUEST_CHAPTERS_STATUS];

/**
 * Why a generation failed: the diff was too large to send, the model took
 * too long, the model declined, what it answered could not be read as
 * chapters even after repair, or something else failed while it ran. The generator adds a kind here where it meets
 * a failure none of these names; the column is plain text, so a new kind
 * needs no migration.
 */
export const PULL_REQUEST_CHAPTERS_FAILURE = {
  TOO_LARGE: "too_large",
  TIMEOUT: "timeout",
  MODEL_REFUSED: "model_refused",
  INVALID_ANSWER: "invalid_answer",
  /** Something other than the generation itself went wrong while it ran; nothing more is kept of what. */
  UNEXPECTED: "unexpected",
} as const;

export type PullRequestChaptersFailure =
  (typeof PULL_REQUEST_CHAPTERS_FAILURE)[keyof typeof PULL_REQUEST_CHAPTERS_FAILURE];
