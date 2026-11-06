export const PULL_REQUEST_CHAPTERS_STATUS = {
  GENERATING: "generating",
  READY: "ready",
  FAILED: "failed",
} as const;

export type PullRequestChaptersStatus =
  (typeof PULL_REQUEST_CHAPTERS_STATUS)[keyof typeof PULL_REQUEST_CHAPTERS_STATUS];

export const PULL_REQUEST_CHAPTERS_FAILURE = {
  TOO_LARGE: "too_large",
  TIMEOUT: "timeout",
  MODEL_REFUSED: "model_refused",
  INVALID_ANSWER: "invalid_answer",
  UNEXPECTED: "unexpected",
} as const;

export type PullRequestChaptersFailure =
  (typeof PULL_REQUEST_CHAPTERS_FAILURE)[keyof typeof PULL_REQUEST_CHAPTERS_FAILURE];
