import { type ProviderSessionObservation, SESSION_STATUS, type SessionStatus } from "@sidecar/core";
import {
  type CliAdapterOptions,
  type CliReadRequest,
  CliSessionAdapter,
} from "./cli-session-adapter";
import {
  isDefined,
  knownValue,
  recordsFromPage,
  repositoryLabel,
  textFromRecord,
  timestampFromRecord,
} from "./cloud-session-adapter";
import { CODEX_PROVIDER } from "./codex-adapter";

/**
 * The two invocations this adapter is allowed to make, fixed by the build the
 * way a cloud adapter's routes are. `login status` answers by exit code alone
 * whether the CLI holds the user's ChatGPT login, and `cloud list --json` is
 * the CLI's documented machine-readable read of the account's cloud tasks —
 * the documented maximum page, newest tasks first, so one call per pass is
 * the whole read.
 */
const CODEX_CLI = {
  BINARY: "codex",
  LOGIN_PROBE_ARGV: ["login", "status"],
  LIST_TASKS_ARGV: ["cloud", "list", "--json", "--limit", "20"],
} as const;

const CODEX_TASK_FIELD = {
  ENVIRONMENT_LABEL: "environment_label",
  ID: "id",
  STATUS: "status",
  TASKS: "tasks",
  UPDATED_AT: "updated_at",
  URL: "url",
} as const;

/** The CLI's documented task states, kebab-case as its JSON serializes them. */
const CODEX_TASK_STATUS = {
  PENDING: "pending",
  READY: "ready",
  APPLIED: "applied",
  ERROR: "error",
} as const;

type CodexTaskStatus = (typeof CODEX_TASK_STATUS)[keyof typeof CODEX_TASK_STATUS];

/**
 * A pending task is queued or running; Codex documents no way to tell those
 * apart, and neither asks anything of the user yet. Ready and applied are both
 * a finished turn — ready holds a diff nobody has taken and applied one the
 * user already pulled down — and a Codex task takes no follow-up, so neither
 * is ever waiting. An errored task stopped on something it cannot get past.
 */
const SESSION_STATUS_BY_CODEX_TASK_STATUS: Readonly<Record<CodexTaskStatus, SessionStatus>> = {
  [CODEX_TASK_STATUS.PENDING]: SESSION_STATUS.WORKING,
  [CODEX_TASK_STATUS.READY]: SESSION_STATUS.COMPLETE,
  [CODEX_TASK_STATUS.APPLIED]: SESSION_STATUS.COMPLETE,
  [CODEX_TASK_STATUS.ERROR]: SESSION_STATUS.ERROR,
} as const;

export type CodexCloudAdapterOptions = CliAdapterOptions;

interface CodexCloudTask {
  id: string;
  repositoryLabel: string;
  status: SessionStatus;
  observedAt: number;
  link?: string;
}

function taskFromRecord(record: Record<string, unknown>): CodexCloudTask | undefined {
  const id = textFromRecord(record, CODEX_TASK_FIELD.ID);
  const observedAt = timestampFromRecord(record, CODEX_TASK_FIELD.UPDATED_AT);
  if (!id || observedAt === undefined) return undefined;

  const status = knownValue(CODEX_TASK_STATUS, textFromRecord(record, CODEX_TASK_FIELD.STATUS));
  const link = textFromRecord(record, CODEX_TASK_FIELD.URL);

  return {
    id,
    observedAt,
    // A task's `title` is generated from the prompt the user typed, so it is
    // transcript content that no observation may carry. The environment label
    // — the repository the environment was made for — is the label available.
    repositoryLabel: repositoryLabel(
      textFromRecord(record, CODEX_TASK_FIELD.ENVIRONMENT_LABEL),
      undefined,
    ),
    // A state this build does not know is not guessed at.
    status: status ? SESSION_STATUS_BY_CODEX_TASK_STATUS[status] : SESSION_STATUS.UNKNOWN,
    ...(link ? { link } : {}),
  };
}

/**
 * Observes Codex cloud tasks through the Codex CLI's own documented read,
 * under the ChatGPT login the user already gave that CLI — Luke reads no
 * token and stores none, and a machine whose CLI is absent or signed out is
 * observed as having nothing. Codex documents no way to message or control a
 * running task, so these sessions advertise no writes at all: rows say where
 * cloud tasks stand, and their address opens them where they live.
 */
export class CodexCloudSessionAdapter extends CliSessionAdapter {
  constructor(options: CodexCloudAdapterOptions = {}) {
    super(
      {
        provider: CODEX_PROVIDER,
        binary: CODEX_CLI.BINARY,
        loginProbeArgv: CODEX_CLI.LOGIN_PROBE_ARGV,
      },
      options,
    );
  }

  protected async collect(
    request: CliReadRequest,
    _now: number,
  ): Promise<readonly ProviderSessionObservation[]> {
    const body = await request(CODEX_CLI.LIST_TASKS_ARGV);
    return recordsFromPage(body, CODEX_TASK_FIELD.TASKS)
      .map(taskFromRecord)
      .filter(isDefined)
      .sort((first, second) => second.observedAt - first.observedAt)
      .map((task) => observationFor(task));
  }
}

function observationFor(task: CodexCloudTask): ProviderSessionObservation {
  return {
    providerSessionId: task.id,
    // The provider is already on the row as its mark, so the title carries
    // only what tells one Codex cloud task from another.
    title: task.repositoryLabel,
    status: task.status,
    observedAt: task.observedAt,
    detail: {
      repository: task.repositoryLabel,
      ...(task.link ? { link: task.link } : {}),
    },
  };
}
