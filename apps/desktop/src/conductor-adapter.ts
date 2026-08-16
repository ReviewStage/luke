import {
  agedStatus,
  type ControllableSessionProviderAdapter,
  type MessageCapableSessionProviderAdapter,
  maximumSessionRecapLength,
  maximumSessionTitleLength,
  OBSERVATION_WINDOW,
  type ProviderControlRequest,
  type ProviderControlResult,
  type ProviderMessageResult,
  type ProviderSessionMessage,
  type ProviderSessionObservation,
  type ProviderWorkspaceAgentRequest,
  type ProviderWorkspaceRequest,
  type ProviderWorkspaceResult,
  resolveOptions,
  SESSION_CONTROL_KIND,
  SESSION_STATUS,
  type SessionControl,
  type SessionProvider,
  type SessionStatus,
  WORKSPACE_TASK_SUPPORT,
  type WorkspaceAgentCapableSessionProviderAdapter,
  type WorkspaceAgentSelection,
  type WorkspaceCapableSessionProviderAdapter,
  type WorkspaceProject,
} from "@sidecar/core";
import {
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
import { isListedWorkspaceAgentModel, workspaceAgentModels } from "./shared/workspace-agents";

// Shared with the credential registry so the key the user saves and the
// provider Luke observes with it can never name different things.
const CONDUCTOR_PROVIDER_ID = CREDENTIAL_PROVIDER_ID.CONDUCTOR;
const CONDUCTOR_PROVIDER_NAME = CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.CONDUCTOR].displayName;

const CONDUCTOR_ENVIRONMENT = {
  API_URL: "CONDUCTOR_API_URL",
} as const;

const CONDUCTOR_DEFAULT_API_URL = "https://api.conductor.build";

/**
 * Documented public API routes. The reads walk projects, workspaces, and
 * sessions; the writers are `POST …/sessions/{id}/messages`, which is
 * Conductor's documented way to hand a prompt to an existing session — queued
 * while it is idle, steered into the running turn while it works —
 * `POST …/sessions/{id}/cancel`, which stops the current turn, and
 * `POST /v0/workspaces`, which is its documented way to create a workspace in
 * a project the user already connected.
 */
const CONDUCTOR_ROUTE = {
  IDENTITY: ["me"],
  PROJECTS: ["v0", "projects"],
  /** The documented read-only query endpoint over the transcripts view. */
  SQL: ["v0", "sql"],
} as const;

const CONDUCTOR_ROUTE_SEGMENT = {
  CANCEL: "cancel",
  MESSAGES: "messages",
  SESSIONS: "sessions",
  STATUS: "status",
  V0: "v0",
  WORKSPACES: "workspaces",
} as const;

/** The body `POST …/sessions/{id}/messages` documents. */
const CONDUCTOR_MESSAGE_FIELD = {
  MESSAGE: "message",
} as const;

/**
 * The body `POST /v0/workspaces` documents. The project names where; the name
 * is optional and Conductor generates one — and the branch it names — when it
 * is left off. The agent, model, and effort ride only when the user chose
 * them in settings, held to the build's documented table on the way; unset,
 * none is sent, so Conductor's own defaults decide. Fast mode is never sent —
 * the user is not offered it, so Conductor's default stands.
 */
const CONDUCTOR_WORKSPACE_FIELD = {
  PROJECT_ID: "projectId",
  NAME: "name",
  AGENT: "agent",
  MODEL: "model",
  EFFORT: "effort",
  /** The first session, as `POST /v0/workspaces` names it in its response. */
  SESSION_ID: "sessionId",
} as const;

/** The body `POST /v0/sessions` documents, of it the fields Luke ever sends. */
const CONDUCTOR_SESSION_CREATE_FIELD = {
  WORKSPACE_ID: "workspaceId",
  AGENT: "agent",
  MODEL: "model",
  EFFORT: "effort",
  NAME: "name",
  MESSAGE: "message",
} as const;

/**
 * The kinds of agent Conductor's session-creation endpoint documents, named
 * exactly as it takes them — read from the build's one table of Conductor's
 * agents and models, so the kinds a roster advertises and the pairings the
 * settings row offers can never disagree. The endpoint also takes `acp`,
 * which is a protocol shim with no defaults of its own rather than an agent
 * someone asks for by name, so the table deliberately leaves it out. Effort
 * and fast mode are never sent: the user is not offered either, so
 * Conductor's defaults stand.
 */
const CONDUCTOR_SPAWNABLE_AGENTS: readonly string[] = workspaceAgentModels(
  CONDUCTOR_PROVIDER_ID,
).map((entry) => entry.agent);

/**
 * The one control this adapter can honour, advertised only while a session is
 * actually working a turn there is something to stop.
 */
const CONDUCTOR_CANCEL_CONTROL = {
  id: "cancel-turn",
  label: "Stop this turn",
  kind: SESSION_CONTROL_KIND.STOP,
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

/** The columns the transcripts read asks for, named as the view answers them. */
const CONDUCTOR_SQL_FIELD = {
  ROWS: "rows",
  SESSION_ID: "session_id",
  AGENT_TYPE: "agent_type",
  TRANSCRIPT_TAIL: "transcript_tail",
} as const;

/**
 * How much of the final message is read: enough for a recap's worth of its
 * opening words — where an agent puts the outcome — and no more of it.
 */
const CONDUCTOR_TRANSCRIPT_TAIL_LENGTH = 2_000;

/**
 * How Conductor's plain-text transcript marks who is speaking. A line inside a
 * message can imitate a header, so the parse can misattribute the tail of a
 * chat whose agent wrote one — the cost is a recap dropped or drawn from the
 * wrong words, never anything acted on.
 */
const CONDUCTOR_TRANSCRIPT_SPEAKER = {
  USER: "## User",
  ASSISTANT: "## Assistant",
} as const;

/** A header as the transcript embeds it: its own line between two messages. */
const CONDUCTOR_ASSISTANT_HEADER = `\n${CONDUCTOR_TRANSCRIPT_SPEAKER.ASSISTANT}\n`;
const CONDUCTOR_USER_HEADER = `\n${CONDUCTOR_TRANSCRIPT_SPEAKER.USER}\n`;

/** The header as a Postgres string literal, its newlines written as escapes. */
function sqlHeaderLiteral(header: string): string {
  return `E'${header.replaceAll("\n", "\\n")}'`;
}

/**
 * The one query document this adapter ever sends, fixed by this build. The
 * endpoint takes a read as a POSTed document rather than a GET, so the
 * separation is held the way the Linear tracker holds it: observation only
 * ever sends this SELECT, and nothing reaches its text but session ids the
 * same pass reported — each validated as a UUID first, so no name, title, or
 * message a provider controls can ever be spliced into the document.
 *
 * The columns ask for the agent kind and the opening of the transcript's
 * final message — the settled turn's parting words — and never the
 * conversation behind it. Who wrote that message is computed in the view,
 * from whichever speaker header stands nearest the transcript's end, and the
 * returned tail is anchored at that header rather than cut at a fixed
 * distance: a fixed cut left any final message longer than the cut without
 * its header, which read as unattributable and silently cost most long-form
 * agents their recap. A chat whose user spoke last answers with no tail at
 * all.
 */
const CONDUCTOR_READ_TRANSCRIPT_TAILS_PREFIX =
  `SELECT ${CONDUCTOR_SQL_FIELD.SESSION_ID}, ${CONDUCTOR_SQL_FIELD.AGENT_TYPE}, ` +
  `CASE WHEN assistant_from_end > 0 AND (user_from_end = 0 OR assistant_from_end < user_from_end) ` +
  `THEN SUBSTRING(transcript FROM GREATEST(LENGTH(transcript) - assistant_from_end - ${CONDUCTOR_ASSISTANT_HEADER.length - 2}, 1) ` +
  `FOR ${CONDUCTOR_ASSISTANT_HEADER.length + CONDUCTOR_TRANSCRIPT_TAIL_LENGTH}) ` +
  `END AS ${CONDUCTOR_SQL_FIELD.TRANSCRIPT_TAIL} ` +
  `FROM (SELECT ${CONDUCTOR_SQL_FIELD.SESSION_ID}, ${CONDUCTOR_SQL_FIELD.AGENT_TYPE}, transcript, ` +
  `position(reverse(${sqlHeaderLiteral(CONDUCTOR_ASSISTANT_HEADER)}) in reverse(transcript)) AS assistant_from_end, ` +
  `position(reverse(${sqlHeaderLiteral(CONDUCTOR_USER_HEADER)}) in reverse(transcript)) AS user_from_end ` +
  `FROM session_transcripts_view WHERE ${CONDUCTOR_SQL_FIELD.SESSION_ID} IN (`;

const CONDUCTOR_READ_TRANSCRIPT_TAILS_SUFFIX = ")) AS attributed";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The view's own mark for history it left out of the concise transcript. */
const CONDUCTOR_TRANSCRIPT_ELIDED = /^\[\d+ messages? elided\]$/;

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
  MAXIMUM_AGENT_KIND_LENGTH: 40,
} as const;

interface ConductorReportedStatus {
  status: ConductorSessionStatus | undefined;
  updatedAt: number | undefined;
  errorMessage?: string;
}

/** What the transcripts view said about one session: who runs it, and how it left off. */
interface ConductorTranscript {
  agentKind?: string;
  recap?: string;
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
  name?: string;
  model?: string;
  deepLink?: string;
}

/**
 * Observes Conductor cloud sessions through the documented public API. It reads
 * only workspaces the authenticated user created, observation issues no request
 * that can change provider state, and it reports nothing at all without a
 * credential. Beside the roster reads, one fixed query to Conductor's
 * transcripts view names the sessions the same pass observed and takes back
 * each chat's agent kind and the bounded tail its recap — the settled turn's
 * parting words — is read from; the history behind that tail is never asked
 * for, and the tail itself never leaves this adapter. Each chat is reported
 * as its own session, carrying the workspace around it as its group — the
 * workspace is the unit Conductor's own surface shows, but the chat is the
 * thing a press opens and a write reaches, and a workspace holding two chats
 * in two states is two facts, not one. The writes it supports are a
 * user-typed prompt and a stop for the running turn, each through Conductor's
 * own endpoint on a chat that advertised it, and a new workspace in a project
 * the latest pass listed, through Conductor's documented creation endpoint.
 */
export class ConductorSessionAdapter
  extends CloudSessionAdapter
  implements
    MessageCapableSessionProviderAdapter,
    ControllableSessionProviderAdapter,
    WorkspaceCapableSessionProviderAdapter,
    WorkspaceAgentCapableSessionProviderAdapter
{
  readonly #maximumObservedWorkspaces: number;
  readonly #maximumObservedSessions: number;

  #userId: string | undefined;
  /**
   * The projects the latest pass listed, kept because they are also where a
   * workspace can be created: a creation ask is honoured only against what
   * this cache holds, so it can never name a project observation did not see.
   */
  #projects: readonly ConductorProject[] = [];

  constructor(options: ConductorAdapterOptions) {
    super(
      {
        provider: CONDUCTOR_PROVIDER,
        defaultBaseUrl: CONDUCTOR_DEFAULT_API_URL,
        baseUrlEnvironmentVariable: CONDUCTOR_ENVIRONMENT.API_URL,
      },
      options,
    );
    const resolved = resolveOptions(
      options,
      {
        maximumObservedWorkspaces: CONDUCTOR_ADAPTER_DEFAULTS.MAXIMUM_OBSERVED_WORKSPACES,
        maximumObservedSessions: CONDUCTOR_ADAPTER_DEFAULTS.MAXIMUM_OBSERVED_SESSIONS,
      },
      { positive: ["maximumObservedWorkspaces", "maximumObservedSessions"] },
    );
    this.#maximumObservedWorkspaces = resolved.maximumObservedWorkspaces;
    this.#maximumObservedSessions = resolved.maximumObservedSessions;
  }

  async sendMessage(message: ProviderSessionMessage): Promise<ProviderMessageResult> {
    return this.sendObservedMessage(message);
  }

  async executeControl(request: ProviderControlRequest): Promise<ProviderControlResult> {
    return this.executeObservedControl(request);
  }

  async createWorkspace(request: ProviderWorkspaceRequest): Promise<ProviderWorkspaceResult> {
    return this.createObservedWorkspace(request, this.workspaceProjects());
  }

  async spawnWorkspaceAgent(
    request: ProviderWorkspaceAgentRequest,
  ): Promise<ProviderWorkspaceResult> {
    return this.spawnObservedWorkspaceAgent(request);
  }

  protected override forgetCachedIdentity(): void {
    this.#userId = undefined;
    this.#projects = [];
  }

  /**
   * Where Conductor will create a workspace: the projects the last pass
   * listed. An opening task is optional — Conductor makes an idle workspace
   * happily — and is handed over after creation, through the documented
   * message endpoint on the first session the creation response names.
   */
  workspaceProjects(): readonly WorkspaceProject[] {
    return this.#projects.map((project) => ({
      providerProjectId: project.id,
      repository: project.repositoryLabel,
      taskSupport: WORKSPACE_TASK_SUPPORT.OPTIONAL,
    }));
  }

  protected override workspaceCreationRoute(
    project: WorkspaceProject,
    name: string | undefined,
    _task: string | undefined,
    agentSelection: WorkspaceAgentSelection | undefined,
  ): CloudWriteRoute {
    // The task deliberately does not ride here: Conductor's creation endpoint
    // documents no prompt field, so the task goes through the documented
    // message endpoint once the response says which session takes it.
    //
    // The chosen agent, model, and effort ride together, and only as a
    // selection the build's table lists — the adapter answers for its own
    // writes, so a value that slipped past the store is dropped here rather
    // than sent.
    const chosen =
      agentSelection && isListedWorkspaceAgentModel(CONDUCTOR_PROVIDER_ID, agentSelection)
        ? agentSelection
        : undefined;
    return {
      segments: [CONDUCTOR_ROUTE_SEGMENT.V0, CONDUCTOR_ROUTE_SEGMENT.WORKSPACES],
      body: {
        [CONDUCTOR_WORKSPACE_FIELD.PROJECT_ID]: project.providerProjectId,
        ...(name ? { [CONDUCTOR_WORKSPACE_FIELD.NAME]: name } : {}),
        ...(chosen
          ? {
              [CONDUCTOR_WORKSPACE_FIELD.AGENT]: chosen.agent,
              [CONDUCTOR_WORKSPACE_FIELD.MODEL]: chosen.model,
              ...(chosen.effort ? { [CONDUCTOR_WORKSPACE_FIELD.EFFORT]: chosen.effort } : {}),
            }
          : {}),
      },
    };
  }

  protected override workspaceTaskRoute(
    creationBody: Record<string, unknown>,
    task: string,
  ): CloudWriteRoute | { undeliverable: string } {
    // The creation response documents the first session's id; the task is a
    // message to exactly that session, under the same key, through the same
    // documented endpoint a typed row uses.
    const sessionId = textFromRecord(creationBody, CONDUCTOR_WORKSPACE_FIELD.SESSION_ID);
    const route = sessionId ? this.messageRoute(sessionId, task) : undefined;
    if (!route) {
      return { undeliverable: "Conductor did not say which session takes the opening message." };
    }
    return route;
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
    this.#projects = projects;
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
      .sort((first, second) => second.lastActivityAt - first.lastActivityAt)
      .slice(0, this.#maximumObservedWorkspaces);

    const sessions = (
      await Promise.all(
        workspaces.map((workspace) =>
          this.tolerateItemFailure(() => this.#listSessions(request, workspace)),
        ),
      )
    )
      .filter(isDefined)
      .flat()
      // An open chat can still change, so it takes the budget before any
      // closed one however old the closed chat is; closed chats spend what
      // remains, newest first. Open chats carry no timestamp of their own
      // yet, and the stable sort keeps them in workspace-recency order.
      .sort(
        (first, second) =>
          Number(first.archived) - Number(second.archived) ||
          (second.archivedAt ?? 0) - (first.archivedAt ?? 0),
      )
      .slice(0, this.#maximumObservedSessions);

    // The transcripts read rides beside the status reads: one bounded query
    // for every observed session, so a failed or missing answer costs a recap
    // and an agent kind, never the pass. That holds even for a credential
    // refusal: a key an org scopes away from the query endpoint alone still
    // reads the roster, and the roster reads above are what judge the
    // credential — so this one read swallows everything rather than letting
    // an enrichment 403 clear every observed row.
    const [transcripts, reportedStatuses] = await Promise.all([
      this.#sessionTranscripts(request, sessions).catch(() => undefined),
      Promise.all(
        sessions.map((session) =>
          // An archived session is a closed chat, so its state is already
          // settled and no status request is needed.
          session.archived
            ? Promise.resolve(undefined)
            : this.tolerateItemFailure(() => this.#sessionStatus(request, session.id)),
        ),
      ),
    ]);

    // One row per chat, each grouped under its workspace. Two chats used to
    // collapse into one row because their generated names drew as identical
    // lines — but the workspace grouping now names the group once, which
    // leaves each chat free to say what it alone is doing, be opened where it
    // alone lives, and take the message meant for it rather than for whichever
    // sibling most needed a person.
    return sessions
      .map((session, index) =>
        this.#observationFor(session, reportedStatuses[index], transcripts?.get(session.id), now),
      )
      .filter(isDefined);
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
          // The chat's own name tells it from its siblings now that every chat
          // is a row of its own; the workspace's name moved to the group.
          const name = textFromRecord(record, CONDUCTOR_FIELD.NAME)?.slice(
            0,
            maximumSessionTitleLength,
          );
          return {
            id,
            workspace,
            archived: archivedAt !== undefined,
            ...(archivedAt === undefined ? {} : { archivedAt }),
            ...(name ? { name } : {}),
            ...(model ? { model } : {}),
            ...(deepLink ? { deepLink } : {}),
          };
        })
        .filter(isDefined)
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

  protected override workspaceAgentRoute(
    spawnTarget: string,
    request: ProviderWorkspaceAgentRequest,
  ): CloudWriteRoute {
    // The target is the workspace id the observation itself advertised, so
    // the route acts on what the user was shown — never on state kept aside.
    //
    // The model and effort arrive only when the stored selection names
    // exactly this agent kind, and are held to the build's table once more
    // here as the whole they were chosen as: the adapter answers for its own
    // writes, and an effort must not outlive the model it was chosen beside.
    const chosen =
      request.model &&
      isListedWorkspaceAgentModel(CONDUCTOR_PROVIDER_ID, {
        agent: request.agent,
        model: request.model,
        ...(request.effort ? { effort: request.effort } : {}),
      })
        ? { model: request.model, effort: request.effort }
        : undefined;
    return {
      segments: [CONDUCTOR_ROUTE_SEGMENT.V0, CONDUCTOR_ROUTE_SEGMENT.SESSIONS],
      body: {
        [CONDUCTOR_SESSION_CREATE_FIELD.WORKSPACE_ID]: spawnTarget,
        [CONDUCTOR_SESSION_CREATE_FIELD.AGENT]: request.agent,
        ...(chosen ? { [CONDUCTOR_SESSION_CREATE_FIELD.MODEL]: chosen.model } : {}),
        ...(chosen?.effort ? { [CONDUCTOR_SESSION_CREATE_FIELD.EFFORT]: chosen.effort } : {}),
        ...(request.name ? { [CONDUCTOR_SESSION_CREATE_FIELD.NAME]: request.name } : {}),
        // The opening task rides the creation itself: `POST /v0/sessions`
        // documents taking the first message inline.
        ...(request.task ? { [CONDUCTOR_SESSION_CREATE_FIELD.MESSAGE]: request.task } : {}),
      },
    };
  }

  protected override messageRoute(
    providerSessionId: string,
    text: string,
  ): CloudWriteRoute | undefined {
    return {
      segments: [
        CONDUCTOR_ROUTE_SEGMENT.V0,
        CONDUCTOR_ROUTE_SEGMENT.SESSIONS,
        providerSessionId,
        CONDUCTOR_ROUTE_SEGMENT.MESSAGES,
      ],
      body: { [CONDUCTOR_MESSAGE_FIELD.MESSAGE]: text },
    };
  }

  protected override controlRoute(
    providerSessionId: string,
    control: SessionControl,
  ): CloudWriteRoute | undefined {
    if (control.id !== CONDUCTOR_CANCEL_CONTROL.id) return undefined;
    return {
      segments: [
        CONDUCTOR_ROUTE_SEGMENT.V0,
        CONDUCTOR_ROUTE_SEGMENT.SESSIONS,
        providerSessionId,
        CONDUCTOR_ROUTE_SEGMENT.CANCEL,
      ],
      // Conductor documents no body for a cancel, so none is sent.
    };
  }

  #observationFor(
    session: ConductorSession,
    reported: ConductorReportedStatus | undefined,
    transcript: ConductorTranscript | undefined,
    now: number,
  ): ProviderSessionObservation | undefined {
    // A workspace timestamp covers every chat in that workspace, so it would
    // make chats a user left hours ago look like they just stopped. The status
    // timestamp is per-session, and a closed chat's archive time is the moment
    // it settled; the workspace timestamp is only the last resort.
    const observedAt =
      reported?.updatedAt ?? session.archivedAt ?? session.workspace.lastActivityAt;
    const status = this.#statusFor(session, reported?.status, observedAt, now);
    // The parting words are a recap only once the turn has actually parted:
    // read for an idle or closed chat, they say where the agent left the work;
    // read mid-turn they are half a sentence posing as an outcome, and read
    // beside a failure they predate the thing the row now has to say.
    const recap =
      session.archived || reported?.status === CONDUCTOR_SESSION_STATUS.IDLE
        ? transcript?.recap
        : undefined;
    const model = agentAndModelLabel(transcript?.agentKind, session.model);
    return {
      providerSessionId: session.id,
      // The chat's own name titles the row, because the row is the chat; the
      // workspace's name — the name the user knows the work by — rides the
      // grouping below and names all of its chats at once. A chat Conductor
      // never named still falls back to those, and none of them is reported
      // as a branch: a workspace name never was one.
      title: session.name ?? session.workspace.name ?? session.workspace.repositoryLabel,
      status,
      observedAt,
      // The workspace this chat is one voice of. Its name falls back to the
      // repository so an unnamed workspace still groups under something a
      // person can say out loud.
      workspace: {
        providerWorkspaceId: session.workspace.id,
        name: session.workspace.name ?? session.workspace.repositoryLabel,
      },
      // Conductor documents both halves of a send — queued while a session is
      // idle, steered into the turn while it works — so any open chat takes a
      // message. A closed one is settled, and an errored one is documented for
      // no writer.
      canReceiveMessage:
        !session.archived &&
        (reported?.status === CONDUCTOR_SESSION_STATUS.IDLE ||
          reported?.status === CONDUCTOR_SESSION_STATUS.WORKING),
      // Another agent lands in the workspace around this row, whatever state
      // the row's own chat is in: the workspace was observed this pass, and
      // that is the thing the creation endpoint takes. Its id rides the
      // advertisement — like a control's target — so it can never outlive the
      // snapshot that promised it.
      spawnableAgents: CONDUCTOR_SPAWNABLE_AGENTS,
      spawnTarget: session.workspace.id,
      ...(reported?.status === CONDUCTOR_SESSION_STATUS.WORKING
        ? { controls: [CONDUCTOR_CANCEL_CONTROL] }
        : {}),
      ...(recap ? { recap } : {}),
      detail: {
        repository: session.workspace.repositoryLabel,
        ...(model ? { model } : {}),
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
    return agedStatus(
      SESSION_STATUS_BY_CONDUCTOR_STATUS[reportedStatus],
      observedAt,
      now,
      OBSERVATION_WINDOW.ACTIVE_SESSION_FRESHNESS_MS,
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

  /**
   * One bounded read of the transcripts view for every session this pass
   * observed: which agent runs each chat, and the tail its recap is taken
   * from. Only ids that are actually UUIDs may enter the fixed document — an
   * id that is anything else is a shape this build does not know, so it is
   * left out rather than sent — and with none there is no read at all.
   */
  async #sessionTranscripts(
    request: CloudRequest,
    sessions: readonly ConductorSession[],
  ): Promise<ReadonlyMap<string, ConductorTranscript>> {
    const transcripts = new Map<string, ConductorTranscript>();
    const ids = sessions.map((session) => session.id).filter((id) => UUID_PATTERN.test(id));
    if (ids.length === 0) return transcripts;

    const document = `${CONDUCTOR_READ_TRANSCRIPT_TAILS_PREFIX}${ids
      .map((id) => `'${id}'`)
      .join(", ")}${CONDUCTOR_READ_TRANSCRIPT_TAILS_SUFFIX}`;
    const body = await request(CONDUCTOR_ROUTE.SQL, undefined, { document });
    for (const row of recordsFromPage(body, CONDUCTOR_SQL_FIELD.ROWS)) {
      const sessionId = textFromRecord(row, CONDUCTOR_SQL_FIELD.SESSION_ID);
      if (!sessionId) continue;
      const agentKind = textFromRecord(row, CONDUCTOR_SQL_FIELD.AGENT_TYPE)?.slice(
        0,
        CONDUCTOR_ADAPTER_DEFAULTS.MAXIMUM_AGENT_KIND_LENGTH,
      );
      const recap = recapFromTranscriptTail(
        textFromRecord(row, CONDUCTOR_SQL_FIELD.TRANSCRIPT_TAIL),
      );
      transcripts.set(sessionId, {
        ...(agentKind ? { agentKind } : {}),
        ...(recap ? { recap } : {}),
      });
    }
    return transcripts;
  }
}

/**
 * The parting words of the transcript's last message, only when that message
 * is attributably the agent's: the tail must still hold the message's own
 * header, and a chat whose user spoke last has no parting words to report.
 * The view's elision markers are dropped, whitespace is flattened to the one
 * line a recap is drawn as, and everything earlier in the tail is discarded
 * unread — the recap is what leaves this function, never the history.
 */
function recapFromTranscriptTail(tail: string | undefined): string | undefined {
  if (!tail) return undefined;
  const lines = tail.split("\n").map((line) => line.trim());
  const lastHeader = lines.findLastIndex(
    (line) =>
      line === CONDUCTOR_TRANSCRIPT_SPEAKER.ASSISTANT || line === CONDUCTOR_TRANSCRIPT_SPEAKER.USER,
  );
  if (lastHeader < 0 || lines[lastHeader] !== CONDUCTOR_TRANSCRIPT_SPEAKER.ASSISTANT) {
    return undefined;
  }
  const recap = lines
    .slice(lastHeader + 1)
    .filter((line) => !CONDUCTOR_TRANSCRIPT_ELIDED.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return recap ? recap.slice(0, maximumSessionRecapLength) : undefined;
}

/**
 * The agent kind joins the model label — `codex · gpt-5.5 · high` — because
 * which agent runs a chat is as much its configuration as which model does.
 */
function agentAndModelLabel(
  agentKind: string | undefined,
  model: string | undefined,
): string | undefined {
  const label = [agentKind, model].filter(isDefined).join(" · ");
  return label || undefined;
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
