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
  positiveInteger,
  recordsFromPage,
  repositoryLabel,
  textFromRecord,
  timestampFromRecord,
} from "./cloud-session-adapter";

const CONDUCTOR_PROVIDER_ID = "conductor";
const CONDUCTOR_PROVIDER_NAME = "Conductor";

const CONDUCTOR_ENVIRONMENT = {
  API_URL: "CONDUCTOR_API_URL",
} as const;

const CONDUCTOR_DEFAULT_API_URL = "https://api.conductor.build";

/** Read-only routes from the documented public API. Luke never calls a writer. */
const CONDUCTOR_ROUTE = {
  IDENTITY: ["me"],
  PROJECTS: ["v0", "projects"],
} as const;

const CONDUCTOR_ROUTE_SEGMENT = {
  SESSIONS: "sessions",
  STATUS: "status",
  V0: "v0",
  WORKSPACES: "workspaces",
} as const;

const CONDUCTOR_QUERY = {
  LIMIT: "limit",
} as const;

const CONDUCTOR_FIELD = {
  ARCHIVED_AT: "archivedAt",
  CREATED_AT: "createdAt",
  CREATOR_ID: "creatorId",
  DATA: "data",
  GIT_REMOTE: "gitRemote",
  ID: "id",
  LAST_ACTIVITY_AT: "lastActivityAt",
  MODEL: "model",
  NAME: "name",
  RESOLVED_MODEL: "resolvedModel",
  STATUS: "status",
  UPDATED_AT: "updatedAt",
  USER_ID: "userId",
} as const;

const CONDUCTOR_SESSION_STATUS = {
  IDLE: "idle",
  WORKING: "working",
  ERROR: "error",
} as const;

type ConductorSessionStatus =
  (typeof CONDUCTOR_SESSION_STATUS)[keyof typeof CONDUCTOR_SESSION_STATUS];

/**
 * An idle Conductor session has finished its turn and is holding for the user,
 * which is what Luke reports as waiting. A session the provider reports as
 * errored is left unknown rather than promoted to a state Luke cannot verify.
 */
const SESSION_STATUS_BY_CONDUCTOR_STATUS: Readonly<Record<ConductorSessionStatus, SessionStatus>> =
  {
    [CONDUCTOR_SESSION_STATUS.IDLE]: SESSION_STATUS.WAITING,
    [CONDUCTOR_SESSION_STATUS.WORKING]: SESSION_STATUS.WORKING,
    [CONDUCTOR_SESSION_STATUS.ERROR]: SESSION_STATUS.UNKNOWN,
  };

const CONDUCTOR_ADAPTER_DEFAULTS = {
  MAXIMUM_PROJECTS: 10,
  WORKSPACE_PAGE_SIZE: 100,
  MAXIMUM_OBSERVED_WORKSPACES: 8,
  SESSION_PAGE_SIZE: 20,
  MAXIMUM_SESSIONS_PER_WORKSPACE: 4,
  MAXIMUM_OBSERVED_SESSIONS: 12,
  MAXIMUM_MODEL_LABEL_LENGTH: 60,
} as const;

export const CONDUCTOR_PROVIDER: SessionProvider = {
  id: CONDUCTOR_PROVIDER_ID,
  displayName: CONDUCTOR_PROVIDER_NAME,
};

export interface ConductorAdapterOptions extends CloudAdapterOptions {
  maximumObservedWorkspaces?: number;
  maximumObservedSessions?: number;
}

interface ConductorProject {
  id: string;
  repositoryLabel: string;
}

interface ConductorWorkspace {
  id: string;
  repositoryLabel: string;
  creatorId?: string;
  lastActivityAt: number;
}

interface ConductorSession {
  id: string;
  workspace: ConductorWorkspace;
  archived: boolean;
  archivedAt?: number;
  model?: string;
}

function conductorSessionStatus(value: string | undefined): ConductorSessionStatus | undefined {
  return value !== undefined &&
    Object.values(CONDUCTOR_SESSION_STATUS).includes(value as ConductorSessionStatus)
    ? (value as ConductorSessionStatus)
    : undefined;
}

/**
 * Observes Conductor cloud sessions through the documented public API. It reads
 * only workspaces the authenticated user created, issues no request that can
 * change provider state, and reports nothing at all without a credential.
 */
export class ConductorSessionAdapter extends CloudSessionAdapter {
  readonly #maximumObservedWorkspaces: number;
  readonly #maximumObservedSessions: number;

  #userId: string | undefined;

  constructor(options: ConductorAdapterOptions) {
    super(
      {
        provider: CONDUCTOR_PROVIDER,
        defaultBaseUrl: CONDUCTOR_DEFAULT_API_URL,
        baseUrlEnvironmentVariable: CONDUCTOR_ENVIRONMENT.API_URL,
      },
      options,
    );
    this.#maximumObservedWorkspaces = positiveInteger(
      options.maximumObservedWorkspaces,
      CONDUCTOR_ADAPTER_DEFAULTS.MAXIMUM_OBSERVED_WORKSPACES,
    );
    this.#maximumObservedSessions = positiveInteger(
      options.maximumObservedSessions,
      CONDUCTOR_ADAPTER_DEFAULTS.MAXIMUM_OBSERVED_SESSIONS,
    );
  }

  protected override forgetCachedIdentity(): void {
    this.#userId = undefined;
  }

  protected async collect(
    request: CloudRequest,
    now: number,
  ): Promise<readonly ProviderSessionObservation[]> {
    const userId = await this.#identity(request);
    if (!userId) return [];

    // Every fan-out below is already bounded by the caps in
    // CONDUCTOR_ADAPTER_DEFAULTS, so at most a dozen requests are ever in flight.
    const projects = await this.#listProjects(request);
    const workspaces = (
      await Promise.all(
        projects.map((project) =>
          this.tolerateItemFailure(() => this.#listWorkspaces(request, project)),
        ),
      )
    )
      .filter(isDefined)
      .flat()
      // Conductor does not attribute a workspace Luke can prove belongs to this
      // user unless it reports a creator, and unattributed org workspaces stay
      // out of a personal sidecar.
      .filter((workspace) => workspace.creatorId === userId)
      .filter(
        (workspace) =>
          now - workspace.lastActivityAt <= CLOUD_ADAPTER_DEFAULTS.MAXIMUM_SESSION_AGE_MS,
      )
      .sort((first, second) => second.lastActivityAt - first.lastActivityAt)
      .slice(0, this.#maximumObservedWorkspaces);

    const sessions = (
      await Promise.all(
        workspaces.map((workspace) =>
          this.tolerateItemFailure(() => this.#listSessions(request, workspace, now)),
        ),
      )
    )
      .filter(isDefined)
      .flat()
      .slice(0, this.#maximumObservedSessions);

    const observations = await Promise.all(
      sessions.map((session) => this.#observationFor(request, session, now)),
    );
    return observations.filter(isDefined);
  }

  async #identity(request: CloudRequest): Promise<string | undefined> {
    if (this.#userId) return this.#userId;
    const body = await request(CONDUCTOR_ROUTE.IDENTITY);
    this.#userId = textFromRecord(body, CONDUCTOR_FIELD.USER_ID);
    return this.#userId;
  }

  async #listProjects(request: CloudRequest): Promise<ConductorProject[]> {
    const body = await request(CONDUCTOR_ROUTE.PROJECTS, {
      [CONDUCTOR_QUERY.LIMIT]: String(CONDUCTOR_ADAPTER_DEFAULTS.MAXIMUM_PROJECTS),
    });
    return recordsFromPage(body, CONDUCTOR_FIELD.DATA)
      .map((record): ConductorProject | undefined => {
        const id = textFromRecord(record, CONDUCTOR_FIELD.ID);
        return id
          ? {
              id,
              repositoryLabel: repositoryLabel(
                textFromRecord(record, CONDUCTOR_FIELD.GIT_REMOTE),
                textFromRecord(record, CONDUCTOR_FIELD.NAME),
              ),
            }
          : undefined;
      })
      .filter(isDefined)
      .slice(0, CONDUCTOR_ADAPTER_DEFAULTS.MAXIMUM_PROJECTS);
  }

  async #listWorkspaces(
    request: CloudRequest,
    project: ConductorProject,
  ): Promise<ConductorWorkspace[]> {
    const body = await request(
      [...CONDUCTOR_ROUTE.PROJECTS, project.id, CONDUCTOR_ROUTE_SEGMENT.WORKSPACES],
      { [CONDUCTOR_QUERY.LIMIT]: String(CONDUCTOR_ADAPTER_DEFAULTS.WORKSPACE_PAGE_SIZE) },
    );
    return recordsFromPage(body, CONDUCTOR_FIELD.DATA)
      .map((record): ConductorWorkspace | undefined => {
        const id = textFromRecord(record, CONDUCTOR_FIELD.ID);
        const lastActivityAt =
          timestampFromRecord(record, CONDUCTOR_FIELD.LAST_ACTIVITY_AT) ??
          timestampFromRecord(record, CONDUCTOR_FIELD.CREATED_AT);
        if (!id || lastActivityAt === undefined) return undefined;
        const creatorId = textFromRecord(record, CONDUCTOR_FIELD.CREATOR_ID);
        return {
          id,
          repositoryLabel: project.repositoryLabel,
          lastActivityAt,
          ...(creatorId ? { creatorId } : {}),
        };
      })
      .filter(isDefined);
  }

  async #listSessions(
    request: CloudRequest,
    workspace: ConductorWorkspace,
    now: number,
  ): Promise<ConductorSession[]> {
    const body = await request(
      [
        CONDUCTOR_ROUTE_SEGMENT.V0,
        CONDUCTOR_ROUTE_SEGMENT.WORKSPACES,
        workspace.id,
        CONDUCTOR_ROUTE_SEGMENT.SESSIONS,
      ],
      { [CONDUCTOR_QUERY.LIMIT]: String(CONDUCTOR_ADAPTER_DEFAULTS.SESSION_PAGE_SIZE) },
    );
    return (
      recordsFromPage(body, CONDUCTOR_FIELD.DATA)
        .map((record): ConductorSession | undefined => {
          const id = textFromRecord(record, CONDUCTOR_FIELD.ID);
          if (!id) return undefined;
          const archivedAt = timestampFromRecord(record, CONDUCTOR_FIELD.ARCHIVED_AT);
          const model = (
            textFromRecord(record, CONDUCTOR_FIELD.RESOLVED_MODEL) ??
            textFromRecord(record, CONDUCTOR_FIELD.MODEL)
          )?.slice(0, CONDUCTOR_ADAPTER_DEFAULTS.MAXIMUM_MODEL_LABEL_LENGTH);
          return {
            id,
            workspace,
            archived: textFromRecord(record, CONDUCTOR_FIELD.ARCHIVED_AT) !== undefined,
            ...(archivedAt === undefined ? {} : { archivedAt }),
            ...(model ? { model } : {}),
          };
        })
        .filter(isDefined)
        // A chat closed before the observation window opened is already
        // outside it, so it must not spend budget a live session could hold.
        .filter(
          (session) =>
            session.archivedAt === undefined ||
            now - session.archivedAt <= CLOUD_ADAPTER_DEFAULTS.MAXIMUM_SESSION_AGE_MS,
        )
        // An open chat carries no timestamp until its status is read, so open
        // chats are preferred over closed ones, then closed ones by how
        // recently they closed. Capping here keeps one crowded workspace from
        // spending the whole session budget.
        .sort(
          (first, second) =>
            Number(first.archived) - Number(second.archived) ||
            (second.archivedAt ?? 0) - (first.archivedAt ?? 0),
        )
        .slice(0, CONDUCTOR_ADAPTER_DEFAULTS.MAXIMUM_SESSIONS_PER_WORKSPACE)
    );
  }

  async #observationFor(
    request: CloudRequest,
    session: ConductorSession,
    now: number,
  ): Promise<ProviderSessionObservation | undefined> {
    // An archived session is a closed chat, so its state is already settled and
    // no status request is needed.
    const reported = session.archived
      ? undefined
      : await this.tolerateItemFailure(() => this.#sessionStatus(request, session.id));
    // A workspace timestamp covers every chat in that workspace, so it would
    // make chats a user left hours ago look like they just stopped. The status
    // timestamp is per-session, and a closed chat's archive time is the moment
    // it settled; the workspace timestamp is only the last resort.
    const observedAt =
      reported?.updatedAt ?? session.archivedAt ?? session.workspace.lastActivityAt;
    if (now - observedAt > CLOUD_ADAPTER_DEFAULTS.MAXIMUM_SESSION_AGE_MS) return undefined;

    const status = this.#statusFor(session, reported?.status, observedAt, now);
    return {
      providerSessionId: session.id,
      title: `${CONDUCTOR_PROVIDER_NAME}: ${session.workspace.repositoryLabel}`,
      status,
      observedAt,
      summary: summaryFromStatus(status, session.model),
    };
  }

  #statusFor(
    session: ConductorSession,
    reportedStatus: ConductorSessionStatus | undefined,
    observedAt: number,
    now: number,
  ): SessionStatus {
    if (session.archived) return SESSION_STATUS.COMPLETE;
    if (!reportedStatus) return SESSION_STATUS.UNKNOWN;
    // Conductor reports live state, and its timestamp marks when that state was
    // entered rather than a heartbeat, so a long turn is still working.
    if (reportedStatus === CONDUCTOR_SESSION_STATUS.WORKING) return SESSION_STATUS.WORKING;
    return this.statusWhileRecent(
      SESSION_STATUS_BY_CONDUCTOR_STATUS[reportedStatus],
      observedAt,
      now,
    );
  }

  async #sessionStatus(
    request: CloudRequest,
    sessionId: string,
  ): Promise<{ status: ConductorSessionStatus | undefined; updatedAt: number | undefined }> {
    const body = await request([
      CONDUCTOR_ROUTE_SEGMENT.V0,
      CONDUCTOR_ROUTE_SEGMENT.SESSIONS,
      sessionId,
      CONDUCTOR_ROUTE_SEGMENT.STATUS,
    ]);
    return {
      status: conductorSessionStatus(textFromRecord(body, CONDUCTOR_FIELD.STATUS)),
      updatedAt: timestampFromRecord(body, CONDUCTOR_FIELD.UPDATED_AT),
    };
  }
}

function summaryFromStatus(status: SessionStatus, model: string | undefined): string {
  const modelDetail = model ? ` on ${model}` : "";
  return `${CONDUCTOR_PROVIDER_NAME} ${status}${modelDetail}; cloud session metadata is observed read-only and transcript content is not retained.`;
}
