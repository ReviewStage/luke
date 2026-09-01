export const INVOCATION_FAILURE = {
  UNAVAILABLE: "unavailable",
  TIMED_OUT: "timed-out",
  OUTPUT_LIMIT: "output-limit",
  FAILED: "failed",
} as const;

export type InvocationFailure = (typeof INVOCATION_FAILURE)[keyof typeof INVOCATION_FAILURE];

export class InvocationError extends Error {
  readonly failure: InvocationFailure;

  constructor(failure: InvocationFailure, binary: string) {
    super(`${binary} could not be invoked`);
    this.name = "InvocationError";
    this.failure = failure;
  }
}
