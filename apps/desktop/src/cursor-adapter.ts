import {
  type ProviderSessionObservation,
  SESSION_STATUS,
  type SessionProvider,
  type SessionStatus,
} from "@sidecar/core";
import {
  CLOUD_ADAPTER_DEFAULTS,
  type CloudAdapterOptions,
  type CloudRequest,
  CloudSessionAdapter,
  isDefined,
  isRecord,
  knownValue,
  positiveInteger,
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

const CURSOR_ENVIRONMENT = {
  API_URL: "CURSOR_API_URL",
} as const;

const CURSOR_DEFAULT_API_URL = "https://api.cursor.com";

const CURSOR_ROUTE_SEGMENT = {
  AGENTS: "agents",
  RUNS: "runs",
  V1: "v1",
} as const;

/** Read-only routes from the documented public API. Luke never calls a writer. */
const CURSOR_ROUTE = {
  AGENTS: [CURSOR_ROUTE_SEGMENT.V1, CURSOR_ROUTE_SEGMENT.AGENTS],
} as const;

const CURSOR_QUERY = {
  LIMIT: "limit",
} as const;

const CURSOR_FIELD = {
  CREATED_AT: "createdAt",
  ID: "id",
  ITEMS: "items",
  LATEST_RUN_ID: "latestRunId",
  REPOS: "repos",
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
  [CURSOR_RUN_STATUS.ERROR]: SESSION_STATUS.UNKNOWN,
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
  repositoryLabel: string;
  archived: boolean;
  lastActivityAt: number;
  latestRunId?: string;
  ref?: string;
}

interface CursorRun {
  status: CursorRunStatus | undefined;
  updatedAt: number | undefined;
}

/** An agent can be attached to several repositories; the first is its subject. */
function firstRepository(record: Record<string, unknown>): Record<string, unknown> {
  const repositories = record[CURSOR_FIELD.REPOS];
  const first = Array.isArray(repositories) ? repositories[0] : undefined;
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

  const repository = firstRepository(record);
  const ref = textFromRecord(repository, CURSOR_FIELD.STARTING_REF)?.slice(
    0,
    CURSOR_ADAPTER_DEFAULTS.MAXIMUM_REFERENCE_LABEL_LENGTH,
  );
  const latestRunId = textFromRecord(record, CURSOR_FIELD.LATEST_RUN_ID);
  return {
    id,
    lastActivityAt,
    // An agent's name and summary are written from its opening prompt, so the
    // repository is the only label available and there is deliberately no
    // fallback to the name Cursor reports.
    repositoryLabel: repositoryLabel(textFromRecord(repository, CURSOR_FIELD.URL), undefined),
    archived: textFromRecord(record, CURSOR_FIELD.STATUS) === CURSOR_AGENT_STATUS.ARCHIVED,
    ...(latestRunId ? { latestRunId } : {}),
    ...(ref ? { ref } : {}),
  };
}

/**
 * Observes Cursor cloud agents through the documented public API. It reads only
 * the agents the supplied key owns, issues no request that can change provider
 * state, and reports nothing at all without a credential.
 */
export class CursorSessionAdapter extends CloudSessionAdapter {
  readonly #maximumObservedSessions: number;

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

  protected async collect(
    request: CloudRequest,
    now: number,
  ): Promise<readonly ProviderSessionObservation[]> {
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
    return {
      providerSessionId: agent.id,
      title: `${CURSOR_PROVIDER_NAME}: ${agent.repositoryLabel}`,
      status,
      observedAt,
      summary: summaryFromStatus(status, agent.ref),
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
    const status = SESSION_STATUS_BY_CURSOR_RUN_STATUS[run.status];
    // Cursor reports live state, and the run's timestamp marks when that state
    // was entered rather than a heartbeat, so a long turn is still working and
    // a run that stopped for good stays complete however long ago it stopped.
    // Only a finished run decays: once it is stale Luke cannot tell a turn that
    // just ended from one the user walked away from hours ago.
    return status === SESSION_STATUS.WAITING
      ? this.statusWhileRecent(status, observedAt, now)
      : status;
  }

  async #latestRun(request: CloudRequest, agentId: string, runId: string): Promise<CursorRun> {
    // The agent names its own latest run, so this reads that run rather than
    // assuming how the run list happens to be ordered.
    const body = await request([...CURSOR_ROUTE.AGENTS, agentId, CURSOR_ROUTE_SEGMENT.RUNS, runId]);
    return {
      status: knownValue(CURSOR_RUN_STATUS, textFromRecord(body, CURSOR_FIELD.STATUS)),
      updatedAt:
        timestampFromRecord(body, CURSOR_FIELD.UPDATED_AT) ??
        timestampFromRecord(body, CURSOR_FIELD.CREATED_AT),
    };
  }
}

function summaryFromStatus(status: SessionStatus, ref: string | undefined): string {
  // The starting ref is chosen by whoever launched the agent, unlike the branch
  // Cursor generates for the work, which is named from the prompt.
  const refDetail = ref ? ` from ${ref}` : "";
  return `${CURSOR_PROVIDER_NAME} ${status}${refDetail}; cloud session metadata is observed read-only and transcript content is not retained.`;
}
