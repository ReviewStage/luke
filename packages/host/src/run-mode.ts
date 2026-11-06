export interface RunMode {
  readonly requiresAccount: boolean;
  readonly observesProviders: boolean;
  readonly animates: boolean;
  readonly takesFocus: boolean;
  readonly sendsNetwork: boolean;
}

export function runModeFor(input: { capture: boolean; fixture: boolean }): RunMode {
  const deterministic = input.capture || input.fixture;
  const interactive = !input.capture;
  return {
    requiresAccount: !deterministic,
    observesProviders: !deterministic,
    animates: interactive,
    takesFocus: interactive,
    sendsNetwork: !deterministic,
  };
}

export function sentryReportingEnabled(sendsNetwork: boolean, dsn: string): boolean {
  return sendsNetwork && dsn.length > 0;
}
