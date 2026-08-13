import {
  maximumSessionTitleLength,
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
const CONDUCTOR_PROVIDER_ID = CREDENTIAL_PROVIDER_ID.CONDUCTOR;
const CONDUCTOR_PROVIDER_NAME = CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.CONDUCTOR].displayName;

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
  DEEP_LINK: "deepLink",
  EFFORT: "effort",
  ERROR_MESSAGE: "errorMessage",
  FAST_MODE: "fastMode",
  GIT_REMOTE: "gitRemote",
  ID: "id",
  LAST_ACTIVITY_AT: "lastActivityAt",
  LAST_ERROR: "lastError",
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

/**
 * Which chat gets to speak for its workspace, most urgent first. A failure
 * outranks a question — both want a person, but only one of them is stuck —
 * a question outranks work still running, and anything known outranks a chat
 * whose status could not be read.
 */
const STATUS_URGENCY: readonly SessionStatus[] = [
  SESSION_STATUS.ERROR,
  SESSION_STATUS.WAITING,
  SESSION_STATUS.WORKING,
  SESSION_STATUS.COMPLETE,
  SESSION_STATUS.UNKNOWN,
];

type ConductorSessionStatus =
  (typeof CONDUCTOR_SESSION_STATUS)[keyof typeof CONDUCTOR_SESSION_STATUS];

/**
 * An idle Conductor session has finished its turn and is holding for the user,
 * which is what Luke reports as waiting. A session the provider reports as
 * errored stopped on something the user has to deal with, and it carries the
 * message that says what.
 */
const SESSION_STATUS_BY_CONDUCTOR_STATUS: Readonly<Record<ConductorSessionStatus, SessionStatus>> =
  {
    [CONDUCTOR_SESSION_STATUS.IDLE]: SESSION_STATUS.WAITING,
    [CONDUCTOR_SESSION_STATUS.WORKING]: SESSION_STATUS.WORKING,
    [CONDUCTOR_SESSION_STATUS.ERROR]: SESSION_STATUS.ERROR,
  };

const CONDUCTOR_ADAPTER_DEFAULTS = {
  MAXIMUM_PROJECTS: 10,
  WORKSPACE_PAGE_SIZE: 100,
  MAXIMUM_OBSERVED_WORKSPACES: 8,
  SESSION_PAGE_SIZE: 20,
  MAXIMUM_SESSIONS_PER_WORKSPACE: 4,
  MAXIMUM_OBSERVED_SESSIONS: 12,
  MAXIMUM_MODEL_LABEL_LENGTH: 60,
  MAXIMUM_ERROR_LENGTH: 120,
} as const;

interface ConductorReportedStatus {
  status: ConductorSessionStatus | undefined;
  updatedAt: number | undefined;
  errorMessage?: string;
}

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
  name?: string;
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
  deepLink?: string;
}

/**
 * Observes Conductor cloud sessions through the documented public API. It reads
 * only workspaces the authenticated user created, issues no request that can
 * change provider state, and reports nothing at all without a credential.
 * Each workspace is reported as one session — the workspace is the unit
 * Conductor's own surface shows, and the one its name names — in the state of
 * whichever chat inside it most needs a person.
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

    const observed = await Promise.all(
      sessions.map((session) =>
        this.#observationFor(request, session, now).then(
          (observation) => observation && { workspaceId: session.workspace.id, observation },
        ),
      ),
    );

    // One row per workspace. The workspace is the session the user knows —
    // it is what titles the row — so two chats inside it would draw as
    // identical lines that open different places. Every chat's status is
    // still read, because the workspace is in whatever state its neediest
    // chat is in; that chat is the one the row reports and the one a press
    // opens.
    const byWorkspace = new Map<string, ProviderSessionObservation>();
    for (const { workspaceId, observation } of observed.filter(isDefined)) {
      const held = byWorkspace.get(workspaceId);
      if (!held || urgencyOrder(observation, held) < 0) {
        byWorkspace.set(workspaceId, observation);
      }
    }
    return [...byWorkspace.values()];
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
        const name = textFromRecord(record, CONDUCTOR_FIELD.NAME)?.slice(
          0,
          maximumSessionTitleLength,
        );
        return {
          id,
          repositoryLabel: project.repositoryLabel,
          lastActivityAt,
          ...(name ? { name } : {}),
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
          const model = modelLabel(record);
          const deepLink = textFromRecord(record, CONDUCTOR_FIELD.DEEP_LINK);
          // The chat's own `name` is deliberately not read: Conductor generates
          // it, nobody chose it, and the one thing it ever did here — titling
          // the row — belongs to the workspace's name instead.
          return {
            id,
            workspace,
            archived: textFromRecord(record, CONDUCTOR_FIELD.ARCHIVED_AT) !== undefined,
            ...(archivedAt === undefined ? {} : { archivedAt }),
            ...(model ? { model } : {}),
            ...(deepLink ? { deepLink } : {}),
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
      // The workspace's name is the name the user knows this work by — it is
      // what Conductor itself shows them — where a chat's own name is generated
      // and identifies nothing. So the workspace titles the row, and it is not
      // reported as a branch: it never was one, and the surface now draws a
      // branch under a glyph that says so.
      title: session.workspace.name ?? session.workspace.repositoryLabel,
      status,
      observedAt,
      detail: {
        repository: session.workspace.repositoryLabel,
        ...(session.model ? { model: session.model } : {}),
        ...(reported?.errorMessage ? { error: reported.errorMessage } : {}),
        ...(session.deepLink ? { link: session.deepLink } : {}),
      },
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
    // A failure does not heal by going stale, so only an idle session decays:
    // once it is stale Luke cannot tell a turn that just ended from a chat the
    // user walked away from hours ago.
    if (reportedStatus === CONDUCTOR_SESSION_STATUS.ERROR) return SESSION_STATUS.ERROR;
    return this.statusWhileRecent(
      SESSION_STATUS_BY_CONDUCTOR_STATUS[reportedStatus],
      observedAt,
      now,
    );
  }

  async #sessionStatus(request: CloudRequest, sessionId: string): Promise<ConductorReportedStatus> {
    const body = await request([
      CONDUCTOR_ROUTE_SEGMENT.V0,
      CONDUCTOR_ROUTE_SEGMENT.SESSIONS,
      sessionId,
      CONDUCTOR_ROUTE_SEGMENT.STATUS,
    ]);
    // A session that failed says why, and dropping that left the panel showing
    // a failed chat as though nothing had happened to it. `lastError` is the
    // last failure this session ever had rather than its current state, so both
    // are read only while the session is actually reporting an error: otherwise
    // a chat that recovered hours ago would keep showing the failure it
    // recovered from, ahead of whatever it is really doing.
    const status = knownValue(
      CONDUCTOR_SESSION_STATUS,
      textFromRecord(body, CONDUCTOR_FIELD.STATUS),
    );
    const errorMessage =
      status === CONDUCTOR_SESSION_STATUS.ERROR
        ? (
            textFromRecord(body, CONDUCTOR_FIELD.ERROR_MESSAGE) ??
            textFromRecord(body, CONDUCTOR_FIELD.LAST_ERROR)
          )?.slice(0, CONDUCTOR_ADAPTER_DEFAULTS.MAXIMUM_ERROR_LENGTH)
        : undefined;
    return {
      status,
      updatedAt: timestampFromRecord(body, CONDUCTOR_FIELD.UPDATED_AT),
      ...(errorMessage ? { errorMessage } : {}),
    };
  }
}

/** Most urgent first, and between two equally urgent chats, the one that moved last. */
function urgencyOrder(
  first: ProviderSessionObservation,
  second: ProviderSessionObservation,
): number {
  return (
    STATUS_URGENCY.indexOf(first.status) - STATUS_URGENCY.indexOf(second.status) ||
    second.observedAt - first.observedAt
  );
}

/** Conductor reports the model it resolved as well as the one that was asked for. */
function modelLabel(record: Record<string, unknown>): string | undefined {
  const model = (
    textFromRecord(record, CONDUCTOR_FIELD.RESOLVED_MODEL) ??
    textFromRecord(record, CONDUCTOR_FIELD.MODEL)
  )?.slice(0, CONDUCTOR_ADAPTER_DEFAULTS.MAXIMUM_MODEL_LABEL_LENGTH);
  if (!model) return undefined;
  const effort = textFromRecord(record, CONDUCTOR_FIELD.EFFORT);
  const fast = record[CONDUCTOR_FIELD.FAST_MODE] === true ? "fast" : undefined;
  return [model, effort, fast].filter(isDefined).join(" · ");
}
