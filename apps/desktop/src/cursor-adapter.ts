import {
  agedStatus,
  isRecord,
  maximumObservedWorkspaceProjects,
  maximumSessionSummaryLength,
  maximumSessionTitleLength,
  type ProviderSessionObservation,
  positiveInteger,
  SESSION_CONTROL_KIND,
  SESSION_STATUS,
  type SessionControl,
  type SessionProvider,
  type SessionStatus,
  WORKSPACE_TASK_SUPPORT,
  type WorkspaceProject,
} from "@sidecar/core";
import {
  CLOUD_ADAPTER_DEFAULTS,
  type CloudAdapterOptions,
  type CloudRequest,
  CloudSessionAdapter,
  type CloudWriteRoute,
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
const CURSOR_PROVIDER_ID = CREDENTIAL_PROVIDER_ID.CURSOR;
const CURSOR_PROVIDER_NAME = CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.CURSOR].displayName;
const UNKNOWN_AGENT_LABEL = "Cloud agent";
/** A run Cursor failed reports no reason of its own, so the state is the message. */
const CURSOR_RUN_FAILED_MESSAGE = "The run failed";

const CURSOR_ENVIRONMENT = {
  API_URL: "CURSOR_API_URL",
} as const;

const CURSOR_DEFAULT_API_URL = "https://api.cursor.com";

const CURSOR_ROUTE_SEGMENT = {
  AGENTS: "agents",
  CANCEL: "cancel",
  REPOSITORIES: "repositories",
  RUNS: "runs",
  V1: "v1",
} as const;

/**
 * Documented public API routes. The reads list agents, their runs, and the
 * repositories the key may launch agents in; the writers are
 * `POST …/agents/{id}/runs`, which is Cursor's documented follow-up — a new
 * run on the agent's existing conversation and workspace state —
 * `POST …/runs/{runId}/cancel`, which stops one that is active, and
 * `POST /v1/agents`, which is its documented way to launch a new agent on a
 * repository the key can reach.
 */
const CURSOR_ROUTE = {
  AGENTS: [CURSOR_ROUTE_SEGMENT.V1, CURSOR_ROUTE_SEGMENT.AGENTS],
  REPOSITORIES: [CURSOR_ROUTE_SEGMENT.V1, CURSOR_ROUTE_SEGMENT.REPOSITORIES],
} as const;

/** The body `POST …/agents/{id}/runs` documents. */
const CURSOR_MESSAGE_FIELD = {
  PROMPT: "prompt",
  TEXT: "text",
} as const;

/** The body `POST /v1/agents` documents, of it the fields Luke ever sends. */
const CURSOR_CREATE_FIELD = {
  PROMPT: "prompt",
  TEXT: "text",
  NAME: "name",
  REPOS: "repos",
  URL: "url",
} as const;

/**
 * How often the repository list is re-read. Cursor documents strict limits on
 * this endpoint — one request a minute, thirty an hour — and repository access
 * changes on the scale of days, so the list rides its own slow cadence rather
 * than the observation pass. A failed read retries sooner, but never inside
 * the documented per-minute limit.
 */
const CURSOR_REPOSITORY_REFRESH_MS = 60 * 60 * 1000;
const CURSOR_REPOSITORY_RETRY_MS = 5 * 60 * 1000;

const CURSOR_CANCEL_RUN_CONTROL_ID = "cancel-run";

/**
 * The one control this adapter can honour, advertised per session and only in
 * the state Cursor documents it for. The run it would cancel rides the
 * advertisement as the control's target, so a press stops the run the user
 * was shown — state an adapter kept on the side could outlive the snapshot
 * that promised it, but a control cannot.
 */
function cursorCancelRunControl(runId: string): SessionControl {
  return {
    id: CURSOR_CANCEL_RUN_CONTROL_ID,
    label: "Stop this run",
    kind: SESSION_CONTROL_KIND.STOP,
    target: runId,
  };
}

const CURSOR_QUERY = {
  LIMIT: "limit",
} as const;

const CURSOR_FIELD = {
  BRANCH: "branch",
  BRANCHES: "branches",
  CREATED_AT: "createdAt",
  DURATION_MS: "durationMs",
  GIT: "git",
  ID: "id",
  ITEMS: "items",
  LATEST_RUN_ID: "latestRunId",
  NAME: "name",
  PR_URL: "prUrl",
  REPOS: "repos",
  REPO_URL: "repoUrl",
  RESULT: "result",
  STARTING_REF: "startingRef",
  STATUS: "status",
  UPDATED_AT: "updatedAt",
  URL: "url",
} as const;

/**
 * An agent is the standing definition of a task, so its own status says only
 * whether the user has filed it away. What the agent is doing right now belongs
 * to its latest run.
 */
const CURSOR_AGENT_STATUS = {
  ACTIVE: "ACTIVE",
  ARCHIVED: "ARCHIVED",
} as const;

const CURSOR_RUN_STATUS = {
  CREATING: "CREATING",
  RUNNING: "RUNNING",
  FINISHED: "FINISHED",
  CANCELLED: "CANCELLED",
  EXPIRED: "EXPIRED",
  ERROR: "ERROR",
} as const;

type CursorRunStatus = (typeof CURSOR_RUN_STATUS)[keyof typeof CURSOR_RUN_STATUS];

/**
 * A finished run has stopped and is holding for the user, which is what Luke
 * reports as waiting. A run that was cancelled or expired stopped for good. One
 * that is still being created, or that failed, is left unknown rather than
 * promoted to a state Luke cannot verify.
 */
const SESSION_STATUS_BY_CURSOR_RUN_STATUS: Readonly<Record<CursorRunStatus, SessionStatus>> = {
  [CURSOR_RUN_STATUS.RUNNING]: SESSION_STATUS.WORKING,
  [CURSOR_RUN_STATUS.FINISHED]: SESSION_STATUS.WAITING,
  [CURSOR_RUN_STATUS.CANCELLED]: SESSION_STATUS.COMPLETE,
  [CURSOR_RUN_STATUS.EXPIRED]: SESSION_STATUS.COMPLETE,
  [CURSOR_RUN_STATUS.CREATING]: SESSION_STATUS.UNKNOWN,
  [CURSOR_RUN_STATUS.ERROR]: SESSION_STATUS.ERROR,
};

const CURSOR_ADAPTER_DEFAULTS = {
  /** The documented maximum, so one call covers as much of a day as it can. */
  AGENT_PAGE_SIZE: 100,
  MAXIMUM_OBSERVED_SESSIONS: 12,
  MAXIMUM_REFERENCE_LABEL_LENGTH: 60,
} as const;

export const CURSOR_PROVIDER: SessionProvider = {
  id: CURSOR_PROVIDER_ID,
  displayName: CURSOR_PROVIDER_NAME,
};

export interface CursorAdapterOptions extends CloudAdapterOptions {
  maximumObservedSessions?: number;
}

interface CursorAgent {
  id: string;
  name?: string;
  repositoryLabel?: string;
  archived: boolean;
  lastActivityAt: number;
  latestRunId?: string;
  ref?: string;
  url?: string;
}

interface CursorRun {
  status: CursorRunStatus | undefined;
  updatedAt: number | undefined;
  repositoryLabel?: string;
  branch?: string;
  pullRequestUrl?: string;
  result?: string;
}

/** An agent can be attached to several repositories; the first is its subject. */
function firstRepository(record: Record<string, unknown>): Record<string, unknown> {
  const repositories = record[CURSOR_FIELD.REPOS];
  const first = Array.isArray(repositories) ? repositories[0] : undefined;
  return isRecord(first) ? first : {};
}

/** The branch a run pushed, which is also the only place a run names its repository. */
function firstRunBranch(record: Record<string, unknown>): Record<string, unknown> {
  const git = record[CURSOR_FIELD.GIT];
  const branches = isRecord(git) ? git[CURSOR_FIELD.BRANCHES] : undefined;
  const first = Array.isArray(branches) ? branches[0] : undefined;
  return isRecord(first) ? first : {};
}

function agentFromRecord(record: Record<string, unknown>): CursorAgent | undefined {
  const id = textFromRecord(record, CURSOR_FIELD.ID);
  // An agent is a standing definition that can be run again months later, so
  // the time it was last touched is what places it in the observation window.
  const lastActivityAt =
    timestampFromRecord(record, CURSOR_FIELD.UPDATED_AT) ??
    timestampFromRecord(record, CURSOR_FIELD.CREATED_AT);
  if (!id || lastActivityAt === undefined) return undefined;

  // `GET /v1/agents` returns only the durable identity fields, so `repos` is
  // absent from a list item and its repository has to come from the run. It is
  // still read here, because the detail route returns it under the same name.
  const repository = firstRepository(record);
  const repositoryUrl = textFromRecord(repository, CURSOR_FIELD.URL);
  const ref = textFromRecord(repository, CURSOR_FIELD.STARTING_REF)?.slice(
    0,
    CURSOR_ADAPTER_DEFAULTS.MAXIMUM_REFERENCE_LABEL_LENGTH,
  );
  const latestRunId = textFromRecord(record, CURSOR_FIELD.LATEST_RUN_ID);
  const name = textFromRecord(record, CURSOR_FIELD.NAME)?.slice(0, maximumSessionTitleLength);
  const url = textFromRecord(record, CURSOR_FIELD.URL);
  return {
    id,
    lastActivityAt,
    ...(name ? { name } : {}),
    ...(repositoryUrl ? { repositoryLabel: repositoryLabel(repositoryUrl, undefined) } : {}),
    archived: textFromRecord(record, CURSOR_FIELD.STATUS) === CURSOR_AGENT_STATUS.ARCHIVED,
    ...(latestRunId ? { latestRunId } : {}),
    ...(ref ? { ref } : {}),
    ...(url ? { url } : {}),
  };
}

/**
 * Observes Cursor cloud agents through the documented public API. It reads only
 * the agents the supplied key owns, observation issues no request that can
 * change provider state, and it reports nothing at all without a credential.
 * The writes it supports are a user-typed follow-up, through Cursor's own run
 * endpoint, to an agent it advertised as taking one, and a new agent — asked
 * for with the user's own opening task — in a repository Cursor listed for
 * this key, through its documented creation endpoint.
 */
export class CursorSessionAdapter extends CloudSessionAdapter {
  readonly #maximumObservedSessions: number;

  /**
   * The repositories the key may launch agents in, as Cursor last listed
   * them. They are where a new workspace — a new agent — can be created, so a
   * creation ask is honoured only against what this cache holds.
   */
  #repositories: readonly string[] = [];
  #repositoriesAttemptedAt = Number.NEGATIVE_INFINITY;
  #repositoriesRefreshMs = CURSOR_REPOSITORY_RETRY_MS;

  constructor(options: CursorAdapterOptions) {
    super(
      {
        provider: CURSOR_PROVIDER,
        defaultBaseUrl: CURSOR_DEFAULT_API_URL,
        baseUrlEnvironmentVariable: CURSOR_ENVIRONMENT.API_URL,
      },
      options,
    );
    this.#maximumObservedSessions = positiveInteger(
      options.maximumObservedSessions,
      CURSOR_ADAPTER_DEFAULTS.MAXIMUM_OBSERVED_SESSIONS,
    );
  }

  protected override forgetCachedIdentity(): void {
    this.#repositories = [];
    this.#repositoriesAttemptedAt = Number.NEGATIVE_INFINITY;
    this.#repositoriesRefreshMs = CURSOR_REPOSITORY_RETRY_MS;
  }

  protected async collect(
    request: CloudRequest,
    now: number,
  ): Promise<readonly ProviderSessionObservation[]> {
    // The repository offer rides beside the pass, never inside it: Cursor
    // documents this read as slow for a large organisation, so it runs on its
    // own clock with its own wide deadline, the sessions never wait on it, and
    // an offer that lands after the pass — or several — is announced by the
    // next one. It reads through the credential-bound path rather than the
    // pass-scoped request, because passes keep coming while it runs and each
    // would discard exactly the slow answer this exists for; only a
    // credential change may do that.
    void this.#refreshRepositories(now);

    const body = await request(CURSOR_ROUTE.AGENTS, {
      [CURSOR_QUERY.LIMIT]: String(CURSOR_ADAPTER_DEFAULTS.AGENT_PAGE_SIZE),
    });

    // Cursor lists agents newest-first, so a full first page already reaches
    // past the observation window and the `cursor` page after it could only
    // hold agents Luke has already aged out.
    const agents = recordsFromPage(body, CURSOR_FIELD.ITEMS)
      .map(agentFromRecord)
      .filter(isDefined)
      .filter(
        (agent) => now - agent.lastActivityAt <= CLOUD_ADAPTER_DEFAULTS.MAXIMUM_SESSION_AGE_MS,
      )
      // When a day holds more agents than Luke observes, the ones that can
      // still change take the budget: an agent the user filed away has nothing
      // left to say, however recently it was touched.
      .sort(
        (first, second) =>
          Number(first.archived) - Number(second.archived) ||
          second.lastActivityAt - first.lastActivityAt,
      )
      .slice(0, this.#maximumObservedSessions);

    // The only fan-out in a pass, already bounded by the cap above: an agent
    // record reports whether it was filed away, never what it is doing, so the
    // status Luke shows exists only on the run.
    const observations = await Promise.all(
      agents.map((agent) => this.#observationFor(request, agent, now)),
    );
    return observations.filter(isDefined);
  }

  /**
   * Cursor documents a follow-up only against an agent whose latest run has
   * finished: an archived agent cannot take new runs, a running one answers
   * conflict until its run ends, and what a follow-up does to a failed or
   * expired run is documented nowhere. Only the case Cursor has promised is
   * advertised.
   */
  #agentTakesMessages(agent: CursorAgent, run: CursorRun | undefined): boolean {
    return !agent.archived && run?.status === CURSOR_RUN_STATUS.FINISHED;
  }

  /**
   * Cursor documents cancelling a run that is still active, and answers
   * conflict for one that has already settled. An active run is the only state
   * the control is advertised in.
   */
  #agentTakesCancel(agent: CursorAgent, run: CursorRun | undefined): boolean {
    return (
      !agent.archived &&
      (run?.status === CURSOR_RUN_STATUS.RUNNING || run?.status === CURSOR_RUN_STATUS.CREATING)
    );
  }

  /**
   * Reads `GET /v1/repositories` on its own cadence, keeping only usable
   * entries. Every failure is swallowed here — including a rejected key, which
   * the agents read in the same pass will surface — because nothing awaits
   * this, and an offer read must never fail a pass or escape as an unhandled
   * rejection.
   */
  async #refreshRepositories(now: number): Promise<void> {
    if (now - this.#repositoriesAttemptedAt < this.#repositoriesRefreshMs) return;
    this.#repositoriesAttemptedAt = now;
    try {
      // The write rides inside the read's own credential check, so a key
      // cleared while the answer was in flight finds no gap to be overwritten
      // in.
      await this.credentialBoundRead(
        CURSOR_ROUTE.REPOSITORIES,
        undefined,
        { timeoutMs: CLOUD_ADAPTER_DEFAULTS.SLOW_REQUEST_TIMEOUT_MS },
        (body) => {
          // Only the newest attempt may land: an answer outlasted by a fresher
          // read — or by a credential coming back — is an older offer, not a
          // newer one.
          if (this.#repositoriesAttemptedAt !== now) return;
          this.#repositories = recordsFromPage(body, CURSOR_FIELD.ITEMS)
            .map((record) => textFromRecord(record, CURSOR_FIELD.URL))
            .filter(isDefined)
            .slice(0, maximumObservedWorkspaceProjects);
          this.#repositoriesRefreshMs = CURSOR_REPOSITORY_REFRESH_MS;
        },
      );
    } catch {
      // Only this attempt's own failure sets the retry cadence: a stale read —
      // discarded because the credential moved on, or outlasted by a newer
      // attempt — must not clobber what that newer attempt decided.
      if (this.#repositoriesAttemptedAt === now) {
        this.#repositoriesRefreshMs = CURSOR_REPOSITORY_RETRY_MS;
      }
    }
  }

  /**
   * Where Cursor will launch a new agent: the repositories it listed for this
   * key. Cursor's creation endpoint requires a prompt — there is no idle agent
   * to make — so every project needs an opening task. The repository URL is
   * the identifier because it is the identifier Cursor's own API uses; it is
   * still one the provider reported, never one an ask composed.
   */
  override workspaceProjects(): readonly WorkspaceProject[] {
    return this.#repositories.map((url) => ({
      providerProjectId: url,
      repository: repositoryLabel(url, undefined),
      taskSupport: WORKSPACE_TASK_SUPPORT.REQUIRED,
    }));
  }

  protected override workspaceCreationRoute(
    project: WorkspaceProject,
    name: string | undefined,
    task: string | undefined,
  ): CloudWriteRoute | undefined {
    // The base refuses a task-less ask before this is called; the guard here
    // is that a request without a prompt must not exist even in principle.
    if (!task) return undefined;
    return {
      segments: CURSOR_ROUTE.AGENTS,
      body: {
        [CURSOR_CREATE_FIELD.PROMPT]: { [CURSOR_CREATE_FIELD.TEXT]: task },
        [CURSOR_CREATE_FIELD.REPOS]: [{ [CURSOR_CREATE_FIELD.URL]: project.providerProjectId }],
        ...(name ? { [CURSOR_CREATE_FIELD.NAME]: name } : {}),
      },
    };
  }

  protected override messageRoute(
    providerSessionId: string,
    text: string,
  ): CloudWriteRoute | undefined {
    return {
      segments: [...CURSOR_ROUTE.AGENTS, providerSessionId, CURSOR_ROUTE_SEGMENT.RUNS],
      body: {
        [CURSOR_MESSAGE_FIELD.PROMPT]: { [CURSOR_MESSAGE_FIELD.TEXT]: text },
      },
    };
  }

  protected override controlRoute(
    providerSessionId: string,
    control: SessionControl,
  ): CloudWriteRoute | undefined {
    // The run to cancel is the advertised control's own target, so it is the
    // run of the observation the user pressed, under the credential that
    // observed it.
    if (control.id !== CURSOR_CANCEL_RUN_CONTROL_ID || !control.target) return undefined;
    return {
      segments: [
        ...CURSOR_ROUTE.AGENTS,
        providerSessionId,
        CURSOR_ROUTE_SEGMENT.RUNS,
        control.target,
        CURSOR_ROUTE_SEGMENT.CANCEL,
      ],
      // Cursor documents no body for a cancel, so none is sent.
    };
  }

  async #observationFor(
    request: CloudRequest,
    agent: CursorAgent,
    now: number,
  ): Promise<ProviderSessionObservation | undefined> {
    // An archived agent is already settled, and one that has never run has no
    // run to ask about, so neither spends a request.
    const latestRunId = agent.archived ? undefined : agent.latestRunId;
    const run = latestRunId
      ? await this.tolerateItemFailure(() => this.#latestRun(request, agent.id, latestRunId))
      : undefined;
    // The run's timestamp is the moment its state was entered; the agent's is
    // only the last resort, because it also moves for edits that are not work.
    const observedAt = run?.updatedAt ?? agent.lastActivityAt;
    if (now - observedAt > CLOUD_ADAPTER_DEFAULTS.MAXIMUM_SESSION_AGE_MS) return undefined;

    const status = this.#statusFor(agent, run, observedAt, now);
    // A run names the repository it pushed to, so a list item that carries no
    // `repos` still resolves to something better than "workspace".
    const repository = agent.repositoryLabel ?? run?.repositoryLabel;
    return {
      providerSessionId: agent.id,
      title: agent.name ?? repository ?? UNKNOWN_AGENT_LABEL,
      status,
      observedAt,
      canReceiveMessage: this.#agentTakesMessages(agent, run),
      ...(latestRunId && this.#agentTakesCancel(agent, run)
        ? { controls: [cursorCancelRunControl(latestRunId)] }
        : {}),
      ...(run?.result ? { summary: run.result } : {}),
      detail: {
        ...(repository ? { repository } : {}),
        // The branch a run opened says more than the ref it started from, but
        // a run that has pushed nothing still has a starting point worth naming.
        ...(run?.branch ? { branch: run.branch } : agent.ref ? { branch: agent.ref } : {}),
        ...(status === SESSION_STATUS.ERROR ? { error: CURSOR_RUN_FAILED_MESSAGE } : {}),
        ...(agent.url ? { link: agent.url } : {}),
        ...(run?.pullRequestUrl ? { change: run.pullRequestUrl } : {}),
      },
    };
  }

  #statusFor(
    agent: CursorAgent,
    run: CursorRun | undefined,
    observedAt: number,
    now: number,
  ): SessionStatus {
    if (agent.archived) return SESSION_STATUS.COMPLETE;
    // A run state this build does not know is not guessed at.
    if (!run?.status) return SESSION_STATUS.UNKNOWN;
    return agedStatus(
      SESSION_STATUS_BY_CURSOR_RUN_STATUS[run.status],
      observedAt,
      now,
      CLOUD_ADAPTER_DEFAULTS.ACTIVE_SESSION_FRESHNESS_MS,
    );
  }

  async #latestRun(request: CloudRequest, agentId: string, runId: string): Promise<CursorRun> {
    // The agent names its own latest run, so this reads that run rather than
    // assuming how the run list happens to be ordered.
    const body = await request([...CURSOR_ROUTE.AGENTS, agentId, CURSOR_ROUTE_SEGMENT.RUNS, runId]);
    const branch = firstRunBranch(body);
    const repositoryUrl = textFromRecord(branch, CURSOR_FIELD.REPO_URL);
    const branchName = textFromRecord(branch, CURSOR_FIELD.BRANCH)?.slice(
      0,
      CURSOR_ADAPTER_DEFAULTS.MAXIMUM_REFERENCE_LABEL_LENGTH,
    );
    const pullRequestUrl = textFromRecord(branch, CURSOR_FIELD.PR_URL);
    const result = textFromRecord(body, CURSOR_FIELD.RESULT)?.slice(0, maximumSessionSummaryLength);
    return {
      status: knownValue(CURSOR_RUN_STATUS, textFromRecord(body, CURSOR_FIELD.STATUS)),
      updatedAt:
        timestampFromRecord(body, CURSOR_FIELD.UPDATED_AT) ??
        timestampFromRecord(body, CURSOR_FIELD.CREATED_AT),
      ...(repositoryUrl ? { repositoryLabel: repositoryLabel(repositoryUrl, undefined) } : {}),
      ...(branchName ? { branch: branchName } : {}),
      ...(pullRequestUrl ? { pullRequestUrl } : {}),
      ...(result ? { result } : {}),
    };
  }
}
