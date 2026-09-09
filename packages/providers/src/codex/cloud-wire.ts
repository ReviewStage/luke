import { SESSION_STATUS, type SessionDiffSummary, type SessionStatus } from "@sidecar/session";
import { isRecord, isWireNumber, type UnparsedWireValue, type WireRecord } from "@sidecar/wire";
import {
  knownValue,
  repositoryLabel,
  textFromRecord,
  timestampFromRecord,
} from "../shared/cloud-wire.js";

/**
 * The invocations the Codex cloud plugin is allowed to make, fixed by the
 * build the way a cloud provider's routes are. `login status` answers by exit
 * code alone whether the CLI holds the user's ChatGPT login; `cloud list
 * --json` is the CLI's documented machine-readable read of the account's
 * cloud tasks — the newest page is the roster, and a bounded walk of further
 * pages on a slower cadence gathers the environments in recent use; and
 * `cloud exec --env` is its documented way to start a task, the one write
 * made here. The `--` before the task text ends option parsing, so the
 * developer's own words can never read as a flag, and a page cursor rides as
 * one `--cursor=` token for the same reason.
 */
export const CODEX_CLI = {
  BINARY: "codex",
  LOGIN_PROBE_ARGV: ["login", "status"],
  LIST_TASKS_ARGV: ["cloud", "list", "--json", "--limit", "20"],
  CURSOR_FLAG: "--cursor=",
  CREATE_TASK_ARGV: ["cloud", "exec", "--env"],
  ARGUMENT_SEPARATOR: "--",
} as const;

export const CODEX_TASK_FIELD = {
  CURSOR: "cursor",
  ENVIRONMENT_ID: "environment_id",
  ENVIRONMENT_LABEL: "environment_label",
  ID: "id",
  STATUS: "status",
  SUMMARY: "summary",
  TASKS: "tasks",
  UPDATED_AT: "updated_at",
  URL: "url",
} as const;

export const CODEX_CLOUD_DEFAULTS = {
  /**
   * How often the environment sweep walks deeper into the task history. The
   * roster refreshes every pass; the set of environments changes at the pace
   * of hands, so its deeper read spends its invocations far more slowly.
   */
  ENVIRONMENT_SWEEP_INTERVAL_MS: 5 * 60 * 1000,
  /**
   * Pages per sweep, the first included: the newest hundred tasks. Bounded
   * because the walk is per-invocation work under a login that answers for
   * it, not because the history ends there — an environment older than the
   * sweep is offered again the next time a task runs in it.
   */
  ENVIRONMENT_SWEEP_MAXIMUM_PAGES: 5,
  /** A cursor is an opaque token, not a document; longer is a report to distrust. */
  MAXIMUM_CURSOR_LENGTH: 400,
  /** A created task's id reads back from the URL the CLI prints, and is only an id. */
  MAXIMUM_CREATED_TASK_ID_LENGTH: 120,
} as const;

/** The CLI's own names for the three counts inside a task's `summary`. */
const CODEX_SUMMARY_FIELD = {
  FILES_CHANGED: "files_changed",
  LINES_ADDED: "lines_added",
  LINES_REMOVED: "lines_removed",
} as const;

/** The CLI's documented task states, kebab-case as its JSON serializes them. */
const CODEX_TASK_STATUS = {
  PENDING: "pending",
  READY: "ready",
  APPLIED: "applied",
  ERROR: "error",
} as const;

/**
 * A pending task is queued or running; Codex documents no way to tell those
 * apart, and neither asks anything of the user yet. Ready and applied are both
 * a finished turn — ready holds a diff nobody has taken and applied one the
 * user already pulled down — and a Codex task takes no follow-up, so neither
 * is ever waiting. An errored task stopped on something it cannot get past.
 */
const SESSION_STATUS_BY_CODEX_TASK_STATUS = {
  [CODEX_TASK_STATUS.PENDING]: SESSION_STATUS.WORKING,
  [CODEX_TASK_STATUS.READY]: SESSION_STATUS.COMPLETE,
  [CODEX_TASK_STATUS.APPLIED]: SESSION_STATUS.COMPLETE,
  [CODEX_TASK_STATUS.ERROR]: SESSION_STATUS.ERROR,
} as const;

export interface CodexCloudTask {
  id: string;
  repositoryLabel: string;
  status: SessionStatus;
  lastActivityAt: number;
  link?: string;
  environmentId?: string;
  environmentLabel?: string;
  diff?: SessionDiffSummary;
}

/**
 * The three counts the CLI reports for a task's change, or nothing: a summary
 * missing any count is not half-reported, and the all-zero summary of a task
 * still working is left to the normalizer to drop.
 */
function diffFromRecord(value: UnparsedWireValue): SessionDiffSummary | undefined {
  if (!isRecord(value)) return undefined;
  const filesChanged = value[CODEX_SUMMARY_FIELD.FILES_CHANGED];
  const linesAdded = value[CODEX_SUMMARY_FIELD.LINES_ADDED];
  const linesRemoved = value[CODEX_SUMMARY_FIELD.LINES_REMOVED];
  if (!isWireNumber(filesChanged) || !isWireNumber(linesAdded) || !isWireNumber(linesRemoved)) {
    return undefined;
  }
  return { filesChanged, linesAdded, linesRemoved };
}

export function taskFromRecord(record: WireRecord): CodexCloudTask | undefined {
  const id = textFromRecord(record, CODEX_TASK_FIELD.ID);
  const lastActivityAt = timestampFromRecord(record, CODEX_TASK_FIELD.UPDATED_AT);
  if (!id || lastActivityAt === undefined) return undefined;

  const status = knownValue(CODEX_TASK_STATUS, textFromRecord(record, CODEX_TASK_FIELD.STATUS));
  const link = textFromRecord(record, CODEX_TASK_FIELD.URL);
  const environmentId = textFromRecord(record, CODEX_TASK_FIELD.ENVIRONMENT_ID);
  const environmentLabel = textFromRecord(record, CODEX_TASK_FIELD.ENVIRONMENT_LABEL);
  const diff = diffFromRecord(record[CODEX_TASK_FIELD.SUMMARY]);

  return {
    id,
    lastActivityAt,
    // A task's `title` is generated from the prompt the user typed, so it is
    // transcript content that no observation may carry. The environment label
    // — the repository the environment was made for — is the label available.
    repositoryLabel: repositoryLabel(environmentLabel, undefined),
    // A state this build does not know is not guessed at.
    status: status ? SESSION_STATUS_BY_CODEX_TASK_STATUS[status] : SESSION_STATUS.UNKNOWN,
    ...(link ? { link } : undefined),
    ...(environmentId ? { environmentId } : undefined),
    ...(environmentLabel ? { environmentLabel } : undefined),
    ...(diff ? { diff } : undefined),
  };
}

/** The next page's cursor, or nothing where the history ends. */
export function sweepCursor(body: WireRecord): string | undefined {
  const cursor = textFromRecord(body, CODEX_TASK_FIELD.CURSOR);
  if (!cursor || cursor.length > CODEX_CLOUD_DEFAULTS.MAXIMUM_CURSOR_LENGTH) return undefined;
  return cursor;
}

/**
 * The id of the task a creation printed. The CLI's documented output is the
 * new task's URL on one line; the id is its last path segment, and the id is
 * all that is read — an identifier for the next pass to report on its own,
 * never an address to act on.
 */
export function createdTaskId(stdout: string): string | undefined {
  const line = stdout
    .split("\n")
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.length > 0);
  if (!line) return undefined;
  let url: URL;
  try {
    url = new URL(line);
  } catch {
    return undefined;
  }
  const id = url.pathname.split("/").filter(Boolean).pop();
  if (!id || id.length > CODEX_CLOUD_DEFAULTS.MAXIMUM_CREATED_TASK_ID_LENGTH) return undefined;
  return id;
}
