/**
 * How an observation fails, in one vocabulary for every way a provider is
 * observed. A cloud provider spoke of a rejected credential and a network
 * blip, a CLI provider of an absent binary and a command that failed, and the
 * two rules were already the same rule under different names: some failures
 * mean the observed state was read under something that no longer stands, and
 * the rest mean the read simply did not happen this time.
 */
export const ADAPTER_FAILURE = {
  /** The credential or login was rejected: observed state clears. */
  UNAUTHORIZED: "unauthorized",
  /** There is nothing to observe with — no binary, no key, signed out: observed state clears. */
  UNAVAILABLE: "unavailable",
  /** It ran and failed: the previous snapshot stands until the next attempt. */
  TRANSIENT: "transient",
} as const;

export type AdapterFailureKind = (typeof ADAPTER_FAILURE)[keyof typeof ADAPTER_FAILURE];

export class AdapterFailure extends Error {
  readonly failure: AdapterFailureKind;

  constructor(failure: AdapterFailureKind, message: string) {
    super(message);
    this.name = "AdapterFailure";
    this.failure = failure;
  }
}

/**
 * Whether this failure clears what the last pass observed. Nothing read under
 * a credential or login that has since been rejected or withdrawn may keep
 * being served; a failure that says nothing about either leaves the previous
 * snapshot standing, because a network blip is not news about a session.
 */
export function clearsObservedState(failure: AdapterFailureKind): boolean {
  return failure !== ADAPTER_FAILURE.TRANSIENT;
}

/**
 * Keeps one failed resource from discarding an otherwise complete pass. A
 * failure that clears observed state is not one resource's problem, so it
 * still ends the pass.
 */
export async function tolerateItemFailure<Result>(
  operation: () => Promise<Result>,
): Promise<Result | undefined> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AdapterFailure && clearsObservedState(error.failure)) throw error;
    return undefined;
  }
}
