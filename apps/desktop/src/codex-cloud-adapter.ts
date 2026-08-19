import {
  PROVIDER_ACT_RESULT_STATUS,
  type ProviderSessionObservation,
  type ProviderWorkspaceRequest,
  type ProviderWorkspaceResult,
  SESSION_STATUS,
  type SessionStatus,
  sessionMessageText,
  WORKSPACE_TASK_SUPPORT,
  type WorkspaceProject,
} from "@sidecar/core";
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
 * The invocations this adapter is allowed to make, fixed by the build the way
 * a cloud adapter's routes are. `login status` answers by exit code alone
 * whether the CLI holds the user's ChatGPT login; `cloud list --json` is the
 * CLI's documented machine-readable read of the account's cloud tasks — the
 * newest page is the roster, and a bounded walk of further pages on a slower
 * cadence gathers the environments in recent use; and `cloud exec --env` is
 * its documented way to start a task, the one write this adapter makes. The
 * `--` before the task text ends option parsing, so the developer's own words
 * can never read as a flag, and a page cursor rides as one `--cursor=` token
 * for the same reason.
 */
const CODEX_CLI = {
  BINARY: "codex",
  LOGIN_PROBE_ARGV: ["login", "status"],
  LIST_TASKS_ARGV: ["cloud", "list", "--json", "--limit", "20"],
  CURSOR_FLAG: "--cursor=",
  CREATE_TASK_ARGV: ["cloud", "exec", "--env"],
  ARGUMENT_SEPARATOR: "--",
} as const;

const CODEX_TASK_FIELD = {
  CURSOR: "cursor",
  ENVIRONMENT_ID: "environment_id",
  ENVIRONMENT_LABEL: "environment_label",
  ID: "id",
  STATUS: "status",
  TASKS: "tasks",
  UPDATED_AT: "updated_at",
  URL: "url",
} as const;

const CODEX_ADAPTER_DEFAULTS = {
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

/** A created task's id reads back from the URL the CLI prints, and is only an id. */
const MAXIMUM_CREATED_TASK_ID_LENGTH = 120;

export type CodexCloudAdapterOptions = CliAdapterOptions;

interface CodexCloudTask {
  id: string;
  repositoryLabel: string;
  status: SessionStatus;
  observedAt: number;
  link?: string;
  environmentId?: string;
  environmentLabel?: string;
}

function taskFromRecord(record: Record<string, unknown>): CodexCloudTask | undefined {
  const id = textFromRecord(record, CODEX_TASK_FIELD.ID);
  const observedAt = timestampFromRecord(record, CODEX_TASK_FIELD.UPDATED_AT);
  if (!id || observedAt === undefined) return undefined;

  const status = knownValue(CODEX_TASK_STATUS, textFromRecord(record, CODEX_TASK_FIELD.STATUS));
  const link = textFromRecord(record, CODEX_TASK_FIELD.URL);
  const environmentId = textFromRecord(record, CODEX_TASK_FIELD.ENVIRONMENT_ID);
  const environmentLabel = textFromRecord(record, CODEX_TASK_FIELD.ENVIRONMENT_LABEL);

  return {
    id,
    observedAt,
    // A task's `title` is generated from the prompt the user typed, so it is
    // transcript content that no observation may carry. The environment label
    // — the repository the environment was made for — is the label available.
    repositoryLabel: repositoryLabel(environmentLabel, undefined),
    // A state this build does not know is not guessed at.
    status: status ? SESSION_STATUS_BY_CODEX_TASK_STATUS[status] : SESSION_STATUS.UNKNOWN,
    ...(link ? { link } : {}),
    ...(environmentId ? { environmentId } : {}),
    ...(environmentLabel ? { environmentLabel } : {}),
  };
}

/**
 * The id of the task a creation printed. The CLI's documented output is the
 * new task's URL on one line; the id is its last path segment, and the id is
 * all that is read — an identifier for the next pass to report on its own,
 * never an address to act on.
 */
function createdTaskId(stdout: string): string | undefined {
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
  if (!id || id.length > MAXIMUM_CREATED_TASK_ID_LENGTH) return undefined;
  return id;
}

/**
 * Observes Codex cloud tasks through the Codex CLI's own documented read,
 * under the ChatGPT login the user already gave that CLI — Luke reads no
 * token and stores none, and a machine whose CLI is absent or signed out is
 * observed as having nothing. The one write is the one the user asks for: a
 * new task, through the CLI's documented `cloud exec`, in an environment the
 * latest pass reported. Codex documents no way to message or steer a task
 * already running, so its sessions advertise no writes at all: rows say where
 * cloud tasks stand, and their address opens them where they live.
 */
export class CodexCloudSessionAdapter extends CliSessionAdapter {
  #projects: readonly WorkspaceProject[] = [];
  #lastEnvironmentSweepAt = Number.NEGATIVE_INFINITY;

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

  /**
   * The environments the latest pass's tasks ran in, which is the only place
   * the CLI reports environments at all: an account whose recent tasks are
   * empty is offered nowhere to create, honestly, until it runs one by hand.
   */
  override workspaceProjects(): readonly WorkspaceProject[] {
    return this.#projects;
  }

  override async createWorkspace(
    request: ProviderWorkspaceRequest,
  ): Promise<ProviderWorkspaceResult> {
    const project = this.#projects.find(
      (candidate) => candidate.providerProjectId === request.providerProjectId,
    );
    if (!project) return { status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED };

    // Codex names tasks itself from the prompt; a name the user typed has
    // nowhere to go, and dropping it silently would honour half the ask.
    if (request.name !== undefined) {
      return {
        status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
        reason: "Codex names cloud tasks itself, so a chosen name has nowhere to go.",
      };
    }

    // The task is the whole creation — `cloud exec` starts nothing without a
    // prompt — and it is held to the same bound as a message.
    const task = request.task === undefined ? undefined : sessionMessageText(request.task);
    if (!task) {
      return {
        status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
        reason: "A Codex cloud task needs an opening task shorter than a document.",
      };
    }

    const written = await this.performWrite([
      ...CODEX_CLI.CREATE_TASK_ARGV,
      project.providerProjectId,
      CODEX_CLI.ARGUMENT_SEPARATOR,
      task,
    ]);
    if (written.outcome.status !== PROVIDER_ACT_RESULT_STATUS.ACCEPTED) {
      return written.outcome;
    }
    const providerSessionId = createdTaskId(written.stdout ?? "");
    return {
      status: PROVIDER_ACT_RESULT_STATUS.ACCEPTED,
      ...(providerSessionId ? { providerSessionId } : {}),
    };
  }

  protected async collect(
    request: CliReadRequest,
    now: number,
  ): Promise<readonly ProviderSessionObservation[]> {
    const body = await request(CODEX_CLI.LIST_TASKS_ARGV);
    const tasks = recordsFromPage(body, CODEX_TASK_FIELD.TASKS)
      .map(taskFromRecord)
      .filter(isDefined)
      .sort((first, second) => second.observedAt - first.observedAt);

    if (
      now - this.#lastEnvironmentSweepAt >=
      CODEX_ADAPTER_DEFAULTS.ENVIRONMENT_SWEEP_INTERVAL_MS
    ) {
      this.#projects = await this.#sweepEnvironments(request, body, tasks);
      this.#lastEnvironmentSweepAt = now;
    } else {
      // Between sweeps the newest page still joins the offer, so an
      // environment first used moments ago is offered without waiting for
      // one; only a sweep, or the login going away, removes an environment.
      const environments = new Map(
        this.#projects.map((project) => [project.providerProjectId, project]),
      );
      collectEnvironments(environments, tasks);
      this.#projects = [...environments.values()];
    }
    return tasks.map((task) => observationFor(task));
  }

  /**
   * Walks a bounded few pages further into the task history for the
   * environments in recent use, so one older than the newest page is still
   * offered for creation. The cursor is the one value a read hands back into
   * an invocation: bounded, and passed as a single `--cursor=` token so it can
   * never read as a flag of its own. A page that fails mid-sweep keeps what
   * the sweep has — the offer grows by what was actually read, and the pages
   * beyond it wait for the next sweep rather than costing the whole pass.
   */
  async #sweepEnvironments(
    request: CliReadRequest,
    firstPage: Record<string, unknown>,
    firstTasks: readonly CodexCloudTask[],
  ): Promise<readonly WorkspaceProject[]> {
    const environments = new Map<string, WorkspaceProject>();
    collectEnvironments(environments, firstTasks);
    let cursor = sweepCursor(firstPage);
    try {
      for (
        let page = 1;
        page < CODEX_ADAPTER_DEFAULTS.ENVIRONMENT_SWEEP_MAXIMUM_PAGES && cursor;
        page += 1
      ) {
        const body = await request([
          ...CODEX_CLI.LIST_TASKS_ARGV,
          `${CODEX_CLI.CURSOR_FLAG}${cursor}`,
        ]);
        collectEnvironments(
          environments,
          recordsFromPage(body, CODEX_TASK_FIELD.TASKS).map(taskFromRecord).filter(isDefined),
        );
        cursor = sweepCursor(body);
      }
    } catch {
      // Deliberately swallowed: the roster page already succeeded, and a
      // shallower environment offer is better than losing the pass whole.
    }
    return [...environments.values()];
  }

  protected override forgetCachedIdentity(): void {
    this.#projects = [];
    this.#lastEnvironmentSweepAt = Number.NEGATIVE_INFINITY;
  }
}

/** The next page's cursor, or nothing where the history ends. */
function sweepCursor(body: Record<string, unknown>): string | undefined {
  const cursor = textFromRecord(body, CODEX_TASK_FIELD.CURSOR);
  if (!cursor || cursor.length > CODEX_ADAPTER_DEFAULTS.MAXIMUM_CURSOR_LENGTH) return undefined;
  return cursor;
}

/**
 * One creation target per environment, newest task first — the same recency
 * the roster reads in, so the environments offered are the ones the account
 * actually uses. The identifier a creation names the environment by is the id
 * when the list reported one and the label otherwise: the CLI's creation
 * command documents taking either, and real accounts routinely carry only the
 * label — keyed on the id alone, they would be offered nowhere.
 */
function collectEnvironments(
  environments: Map<string, WorkspaceProject>,
  tasks: readonly CodexCloudTask[],
): void {
  for (const task of tasks) {
    const target = task.environmentId ?? task.environmentLabel;
    if (!target || environments.has(target)) continue;
    environments.set(target, {
      providerProjectId: target,
      repository: task.repositoryLabel,
      taskSupport: WORKSPACE_TASK_SUPPORT.REQUIRED,
    });
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
