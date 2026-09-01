/**
 * What this process is allowed to do, decided once from how it was launched.
 *
 * A fixture run must be deterministic and credential-free; a capture run is
 * that and also unattended — no system keys, no focus, no motion the camera
 * did not ask for. Call sites test a capability rather than re-deriving those
 * two booleans, so a third launch mode cannot silently inherit the wrong half.
 */
export interface RunMode {
  /** Require a stored Luke account before live capabilities start. */
  readonly requiresAccount: boolean;
  /** Watch session providers, issue trackers, and the machine's own output. */
  readonly observesProviders: boolean;
  /** Claim system-wide shortcuts. A capture run drives the panel itself. */
  readonly registersGlobalKeys: boolean;
  /** Wait for the panel's own collapse before shrinking the window. */
  readonly animates: boolean;
  /** Steal keyboard focus, raise windows, stand on more than the main display. */
  readonly takesFocus: boolean;
  /** Mint credentials, evaluate attention, create workspaces, send notes. */
  readonly sendsNetwork: boolean;
}

/**
 * Computes the capabilities for this launch. `capture` is `--capture-evidence`;
 * `fixture` is `--fixture` or a capture run, which always implies it.
 */
export function runModeFor(input: { capture: boolean; fixture: boolean }): RunMode {
  const deterministic = input.capture || input.fixture;
  const interactive = !input.capture;
  return {
    requiresAccount: !deterministic,
    observesProviders: !deterministic,
    registersGlobalKeys: interactive,
    animates: interactive,
    takesFocus: interactive,
    sendsNetwork: !deterministic,
  };
}

export function sentryReportingEnabled(sendsNetwork: boolean, dsn: string): boolean {
  return sendsNetwork && dsn.length > 0;
}
