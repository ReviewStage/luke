import {
  agedStatus,
  isRecord,
  OBSERVATION_WINDOW,
  type ProviderSessionObservation,
  resolveOptions,
  SESSION_STATUS,
  type SessionProvider,
  type SessionStatus,
} from "@sidecar/core";
import {
  type CloudAdapterOptions,
  type CloudRequest,
  CloudSessionAdapter,
  isDefined,
  knownValue,
  recordsFromPage,
  repositoryLabel,
  textFromRecord,
  timestampFromRecord,
} from "./cloud-session-adapter";
import { CREDENTIAL_PROVIDER_ID, CREDENTIAL_PROVIDERS } from "./shared/credential-providers";

// Shared with the credential registry so the key the user saves and the
// provider Luke observes with it can never name different things.
const COPILOT_PROVIDER_ID = CREDENTIAL_PROVIDER_ID.COPILOT;
const COPILOT_PROVIDER_NAME = CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.COPILOT].displayName;

const COPILOT_ENVIRONMENT = {
  API_URL: "COPILOT_API_URL",
} as const;

const COPILOT_DEFAULT_API_URL = "https://api.github.com";

const COPILOT_ROUTE_SEGMENT = {
  AGENTS: "agents",
  TASKS: "tasks",
} as const;

/** The one read-only route Luke calls. Every other agent-tasks route writes. */
const COPILOT_ROUTE = {
  TASKS: [COPILOT_ROUTE_SEGMENT.AGENTS, COPILOT_ROUTE_SEGMENT.TASKS],
} as const;

const COPILOT_QUERY = {
  PER_PAGE: "per_page",
  SINCE: "since",
} as const;

const COPILOT_FIELD = {
  ARCHIVED_AT: "archived_at",
  ARTIFACTS: "artifacts",
  BASE_REF: "base_ref",
  CREATED_AT: "created_at",
  DATA: "data",
  HTML_URL: "html_url",
  ID: "id",
  STATE: "state",
  TASKS: "tasks",
  TYPE: "type",
  UPDATED_AT: "updated_at",
  URL: "url",
} as const;

/** The structural segment in front of `{owner}/{repo}` in a task's API URL. */
const COPILOT_URL_SEGMENT = {
  REPOS: "repos",
} as const;

const GITHUB_REQUEST_HEADER = {
  ACCEPT: "Accept",
  API_VERSION: "X-GitHub-Api-Version",
} as const;

const GITHUB_MEDIA_TYPE = "application/vnd.github+json";

/**
 * The dated API version this adapter was written against. The agent-tasks
 * endpoint is in public preview and subject to change, so every request pins
 * the version rather than taking whatever shape GitHub answers with today.
 */
const GITHUB_API_VERSION = "2026-03-10";

const COPILOT_REQUEST_HEADERS: Readonly<Record<string, string>> = {
  [GITHUB_REQUEST_HEADER.ACCEPT]: GITHUB_MEDIA_TYPE,
  [GITHUB_REQUEST_HEADER.API_VERSION]: GITHUB_API_VERSION,
};

const COPILOT_ARTIFACT_TYPE = {
  BRANCH: "branch",
  PULL: "pull",
} as const;

const COPILOT_TASK_STATE = {
  QUEUED: "queued",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  FAILED: "failed",
  IDLE: "idle",
  WAITING_FOR_USER: "waiting_for_user",
  TIMED_OUT: "timed_out",
  CANCELLED: "cancelled",
} as const;

type CopilotTaskState = (typeof COPILOT_TASK_STATE)[keyof typeof COPILOT_TASK_STATE];

/**
 * A task is a container for sessions, and GitHub derives its state from the
 * most recent one. Queued and in-progress are work the user cannot act on yet;
 * `waiting_for_user` is the task holding for the user. Completed and cancelled
 * are both settled — cancelling is the user closing the task, not the task
 * stopping on something. A failed or timed-out task reports no reason on the
 * list projection and can be sent back to work from its task page with a new
 * session, so like a suspended Devin session it is neither settled nor asking;
 * Luke leaves it unknown rather than promoting it to an error it cannot
 * describe. Idle says only that no session is running at all.
 */
const SESSION_STATUS_BY_COPILOT_STATE: Readonly<Record<CopilotTaskState, SessionStatus>> = {
  [COPILOT_TASK_STATE.QUEUED]: SESSION_STATUS.WORKING,
  [COPILOT_TASK_STATE.IN_PROGRESS]: SESSION_STATUS.WORKING,
  [COPILOT_TASK_STATE.WAITING_FOR_USER]: SESSION_STATUS.WAITING,
  [COPILOT_TASK_STATE.COMPLETED]: SESSION_STATUS.COMPLETE,
  [COPILOT_TASK_STATE.CANCELLED]: SESSION_STATUS.COMPLETE,
  [COPILOT_TASK_STATE.FAILED]: SESSION_STATUS.UNKNOWN,
  [COPILOT_TASK_STATE.TIMED_OUT]: SESSION_STATUS.UNKNOWN,
  [COPILOT_TASK_STATE.IDLE]: SESSION_STATUS.UNKNOWN,
};

const COPILOT_ADAPTER_DEFAULTS = {
  /** The documented maximum, so one call covers as much of a day as it can. */
  TASK_PAGE_SIZE: 100,
  MAXIMUM_OBSERVED_TASKS: 12,
  MAXIMUM_BRANCH_LABEL_LENGTH: 60,
} as const;

export const COPILOT_PROVIDER: SessionProvider = {
  id: COPILOT_PROVIDER_ID,
  displayName: COPILOT_PROVIDER_NAME,
};

export interface CopilotAdapterOptions extends CloudAdapterOptions {
  maximumObservedTasks?: number;
}

interface CopilotTask {
  id: string;
  repositoryLabel: string;
  state: CopilotTaskState | undefined;
  archived: boolean;
  observedAt: number;
  branch?: string;
  link?: string;
}

/**
 * The list projection names a task's repository only by a numeric id, but the
 * task's own API address is `/agents/repos/{owner}/{repo}/tasks/{id}`, so the
 * repository is the segment two past `repos`.
 */
function repositoryFromTaskUrl(url: string | undefined): string | undefined {
  const segments = url?.split("/").filter(Boolean) ?? [];
  const repos = segments.indexOf(COPILOT_URL_SEGMENT.REPOS);
  return repos > 0 ? segments[repos + 2] : undefined;
}

/**
 * The branch a task was pointed at, from its branch artifact. The artifact's
 * `head_ref` is named by Copilot from the task prompt, so like the task's
 * `name` it stays off the row; `base_ref` is chosen by whoever opened the
 * task, the same thing Jules' starting branch reports.
 */
function baseBranchFromArtifacts(record: Record<string, unknown>): string | undefined {
  const artifacts = record[COPILOT_FIELD.ARTIFACTS];
  if (!Array.isArray(artifacts)) return undefined;
  const branch = artifacts
    .filter(isRecord)
    .find(
      (artifact) => textFromRecord(artifact, COPILOT_FIELD.TYPE) === COPILOT_ARTIFACT_TYPE.BRANCH,
    );
  const data = branch?.[COPILOT_FIELD.DATA];
  return isRecord(data) ? textFromRecord(data, COPILOT_FIELD.BASE_REF) : undefined;
}

function taskFromRecord(record: Record<string, unknown>): CopilotTask | undefined {
  const id = textFromRecord(record, COPILOT_FIELD.ID);
  const observedAt =
    timestampFromRecord(record, COPILOT_FIELD.UPDATED_AT) ??
    timestampFromRecord(record, COPILOT_FIELD.CREATED_AT);
  if (!id || observedAt === undefined) return undefined;

  const branch = baseBranchFromArtifacts(record)?.slice(
    0,
    COPILOT_ADAPTER_DEFAULTS.MAXIMUM_BRANCH_LABEL_LENGTH,
  );
  const link = textFromRecord(record, COPILOT_FIELD.HTML_URL);

  return {
    id,
    observedAt,
    // GitHub documents a task's `name` as derived from the task prompt, so it
    // is transcript content and there is deliberately no fallback to it.
    repositoryLabel: repositoryLabel(
      repositoryFromTaskUrl(textFromRecord(record, COPILOT_FIELD.URL)),
      undefined,
    ),
    state: knownValue(COPILOT_TASK_STATE, textFromRecord(record, COPILOT_FIELD.STATE)),
    archived: textFromRecord(record, COPILOT_FIELD.ARCHIVED_AT) !== undefined,
    ...(branch ? { branch } : {}),
    ...(link ? { link } : {}),
  };
}

/**
 * Observes GitHub Copilot coding-agent tasks through the documented
 * agent-tasks API. It reads only the tasks the supplied token can see, issues
 * no request that can change provider state, and reports nothing at all
 * without a credential.
 *
 * Deliberately read-only where the other cloud adapters write: as of the
 * pinned API version, GitHub documents no way to message, steer, or stop an
 * existing task — the agents panel can, but its API is undocumented, and the
 * one documented follow-up is a public `@copilot` comment on the task's pull
 * request, which is an act of publishing to the repository rather than a
 * message to a session and needs scopes this adapter never asks for. So no
 * task advertises `canReceiveMessage` or a control, and the row's link — the
 * task's own page, where steering lives — is the honest way in.
 */
export class CopilotSessionAdapter extends CloudSessionAdapter {
  readonly #maximumObservedTasks: number;

  constructor(options: CopilotAdapterOptions) {
    super(
      {
        provider: COPILOT_PROVIDER,
        defaultBaseUrl: COPILOT_DEFAULT_API_URL,
        baseUrlEnvironmentVariable: COPILOT_ENVIRONMENT.API_URL,
      },
      options,
    );
    const { maximumObservedTasks } = resolveOptions(
      options,
      { maximumObservedTasks: COPILOT_ADAPTER_DEFAULTS.MAXIMUM_OBSERVED_TASKS },
      { positive: ["maximumObservedTasks"] },
    );
    this.#maximumObservedTasks = maximumObservedTasks;
  }

  /** GitHub asks for its own media type, and the preview endpoint is pinned. */
  protected override requestHeaders(): Readonly<Record<string, string>> {
    return COPILOT_REQUEST_HEADERS;
  }

  protected async collect(
    request: CloudRequest,
    now: number,
  ): Promise<readonly ProviderSessionObservation[]> {
    // One call per pass. The list projection already carries the state, the
    // timestamps, and the task's own addresses, so there is nothing a
    // per-task read would add. `since` asks GitHub for the observation window,
    // and the filter below holds it against whatever comes back.
    const body = await request(COPILOT_ROUTE.TASKS, {
      [COPILOT_QUERY.PER_PAGE]: String(COPILOT_ADAPTER_DEFAULTS.TASK_PAGE_SIZE),
      [COPILOT_QUERY.SINCE]: new Date(
        now - OBSERVATION_WINDOW.MAXIMUM_SESSION_AGE_MS,
      ).toISOString(),
    });

    return recordsFromPage(body, COPILOT_FIELD.TASKS)
      .map(taskFromRecord)
      .filter(isDefined)
      .filter((task) => now - task.observedAt <= OBSERVATION_WINDOW.MAXIMUM_SESSION_AGE_MS)
      .sort((first, second) => second.observedAt - first.observedAt)
      .slice(0, this.#maximumObservedTasks)
      .map((task) => this.#observationFor(task, now));
  }

  #observationFor(task: CopilotTask, now: number): ProviderSessionObservation {
    return {
      providerSessionId: task.id,
      // The provider is already on the row as its mark and in the context line,
      // so the title carries only what tells one Copilot task from another.
      title: task.repositoryLabel,
      status: this.#statusFor(task, now),
      observedAt: task.observedAt,
      detail: {
        repository: task.repositoryLabel,
        ...(task.branch ? { branch: task.branch } : {}),
        ...(task.link ? { link: task.link } : {}),
      },
    };
  }

  #statusFor(task: CopilotTask, now: number): SessionStatus {
    // A task the user filed away is settled whatever its last session did.
    if (task.archived) return SESSION_STATUS.COMPLETE;
    // A state this build does not know is not guessed at.
    if (!task.state) return SESSION_STATUS.UNKNOWN;
    return agedStatus(
      SESSION_STATUS_BY_COPILOT_STATE[task.state],
      task.observedAt,
      now,
      OBSERVATION_WINDOW.ACTIVE_SESSION_FRESHNESS_MS,
    );
  }
}
