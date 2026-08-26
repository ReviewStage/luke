/**
 * What a diagnostic is about, named beside the error rather than inside it, so
 * a consumer that may not carry free text — the counted event stream — can say
 * the kind while the error's own words stop at a local log.
 */
export const ADAPTER_DIAGNOSTIC_KIND = {
  /** An observation pass failed for a reason that is neither a network nor a credential fault. */
  PASS_FAILURE: "pass_failure",
  /** A read woke a workspace the provider bills for being awake. */
  ACCIDENTAL_WAKE: "accidental_wake",
} as const;

export type AdapterDiagnosticKind =
  (typeof ADAPTER_DIAGNOSTIC_KIND)[keyof typeof ADAPTER_DIAGNOSTIC_KIND];

export type AdapterDiagnosticCallback = (kind: AdapterDiagnosticKind, error: Error) => void;
