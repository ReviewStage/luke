import { HOSTED_BRAIN_OPTION_BOUNDS } from "@sidecar/hosted";

/** The output budget one inference is asked for, the same on every transport: the hosted contract's ceiling. */
export const BRAIN_MAXIMUM_OUTPUT_TOKENS = HOSTED_BRAIN_OPTION_BOUNDS.MAXIMUM_OUTPUT_TOKENS;

/** A turn may read a transcript, reason over it, and act; the ceiling is for a runaway, not a budget. */
export const BRAIN_REQUEST_TIMEOUT_MS = 90_000;
