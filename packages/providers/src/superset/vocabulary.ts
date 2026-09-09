import { text, type UnparsedWireValue, wireRecord } from "@sidecar/wire";

/** What Superset's own surfaces call things, and the bounds every read is held to. */

export const SUPERSET_CONTROL_ID = {
  DELETE_WORKSPACE: "superset-delete-workspace",
} as const;

export function isSupersetControlId(controlId: string): boolean {
  return Object.values(SUPERSET_CONTROL_ID).some((candidate) => candidate === controlId);
}

export const SUPERSET_LIMIT = {
  QUERY_OUTPUT_BYTES: 64 * 1024,
  ORGANIZATIONS: 20,
  TARGETS: 20,
  PROJECTS: 50,
  FAILURE_REASON: 300,
  PROJECT_REFRESH_INTERVAL_MS: 60_000,
  /** How long any one CLI invocation may run before it is given up on. */
  INVOCATION_TIMEOUT_MS: 30_000,
} as const;

export const SUPERSET_LOCAL_TARGET_ID = "local";

const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "gu");
/**
 * C0 and DEL, exactly what a terminal writes into an error and a row must not
 * carry.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is what this pattern is for — the rule guards against writing one by accident.
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/gu;

/**
 * One line of a CLI's output, fit to be read on a row: no escape sequences,
 * no control characters, no `error:` prefix restating what a failure already
 * is, and never longer than a sentence.
 */
function strippedLine(output: string, limit: number): string | undefined {
  return (
    output
      .replace(ANSI_ESCAPE_PATTERN, "")
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find(Boolean)
      ?.replace(/^error:\s*/iu, "")
      .replace(CONTROL_CHARACTER_PATTERN, " ")
      .replace(/\s+/gu, " ")
      .slice(0, limit)
      .trim() || undefined
  );
}

/** The CLI's own words for why it refused, or the caller's fallback. */
export function supersetFailureReason(error: UnparsedWireValue, fallback: string): string {
  const stderr = text(wireRecord(error)?.stderr);
  return (stderr && strippedLine(stderr, SUPERSET_LIMIT.FAILURE_REASON)) ?? fallback;
}
