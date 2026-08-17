import {
  isRecord,
  OBSERVATION_WINDOW,
  PROVIDER_ACT_RESULT_STATUS,
  type ProviderActResult,
  type ProviderControlRequest,
  type ProviderControlResult,
  type ProviderMessageResult,
  type ProviderSessionMessage,
  type ProviderSessionObservation,
  type ProviderWorkspaceAgentRequest,
  type ProviderWorkspaceRequest,
  type ProviderWorkspaceResult,
  positiveInteger,
  resolveOptions,
  SESSION_LOCATION,
  SESSION_STATUS,
  type SessionControl,
  type SessionProvider,
  type SessionProviderAdapter,
  type SessionStatus,
  sessionMessageText,
  text,
  UNKNOWN_WORKSPACE_LABEL,
  WORKSPACE_TASK_SUPPORT,
  type WorkspaceAgentSelection,
  type WorkspaceProject,
  workspaceNameText,
} from "@sidecar/core";

const GIT_SUFFIX = ".git";

const HTTP_METHOD = {
  GET: "GET",
  POST: "POST",
} as const;

/** HTTP statuses the adapter names when a response is not simply ok. */
export const HTTP_STATUS = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
} as const;

/**
 * How a provider expects its credential to be presented. Every provider so far
 * takes a bearer token; Google's alpha APIs take the key in their own header
 * instead, and a provider that authenticates some third way is not supported
 * rather than approximated.
 */
export const CLOUD_AUTH_SCHEME = {
  BEARER: "bearer",
  GOOGLE_API_KEY_HEADER: "google-api-key-header",
} as const;

export type CloudAuthScheme = (typeof CLOUD_AUTH_SCHEME)[keyof typeof CLOUD_AUTH_SCHEME];

const GOOGLE_API_KEY_HEADER = "X-Goog-Api-Key";

const AUTHORIZATION_HEADERS: Readonly<
  Record<CloudAuthScheme, (apiKey: string) => Readonly<Record<string, string>>>
> = {
  [CLOUD_AUTH_SCHEME.BEARER]: (apiKey) => ({ Authorization: `Bearer ${apiKey}` }),
  [CLOUD_AUTH_SCHEME.GOOGLE_API_KEY_HEADER]: (apiKey) => ({ [GOOGLE_API_KEY_HEADER]: apiKey }),
};

const DEFAULT_REQUEST_HEADERS: Readonly<Record<string, string>> = {
  Accept: "application/json",
};

/**
 * The one body key a POSTed read document rides under. Linear's GraphQL and
 * Conductor's transcripts view both name it `query`, and a provider that names
 * it something else is asking for its own client rather than an option here.
 */
const READ_DOCUMENT_FIELD = "query";

export const CLOUD_FAILURE = {
  UNAUTHORIZED: "unauthorized",
  TRANSIENT: "transient",
} as const;

/** What a write acts on, as a refusal should name it. */
const WRITE_SUBJECT = {
  SESSION: "session",
  PROJECT: "project",
} as const;

type WriteSubject = (typeof WRITE_SUBJECT)[keyof typeof WRITE_SUBJECT];

export type CloudFailure = (typeof CLOUD_FAILURE)[keyof typeof CLOUD_FAILURE];

/**
 * Cloud-only request bounds. The freshness bound in `OBSERVATION_WINDOW` is
 * shared with every local provider.
 */
export const CLOUD_ADAPTER_DEFAULTS = {
  MINIMUM_REFRESH_INTERVAL_MS: 15 * 1000,
  REQUEST_TIMEOUT_MS: 8 * 1000,
  /**
   * For the rare read a provider documents as slow — Cursor's repository list
   * can take tens of seconds for a large organisation. A read on this deadline
   * must never hold the observation pass; it is for work that rides beside
   * one.
   */
  SLOW_REQUEST_TIMEOUT_MS: 45 * 1000,
} as const;

export type CloudFetch = (url: string, init: RequestInit) => Promise<Response>;

export class CloudRequestError extends Error {
  readonly failure: CloudFailure;

  constructor(failure: CloudFailure, message: string) {
    super(message);
    this.name = "CloudRequestError";
    this.failure = failure;
  }
}

export interface CloudAdapterOptions {
  /** Resolves the credential at observation time so a settings change applies immediately. */
  readApiKey: () => Promise<string | undefined>;
  baseUrl?: string;
  fetch?: CloudFetch;
  now?: () => number;
  minimumRefreshIntervalMs?: number;
  /**
   * Called when an observation pass fails for a reason other than a network
   * or credential fault — a TypeError in a subclass's parsing, for example.
   * Transient and unauthorized {@link CloudRequestError} never reach it.
   */
  onDiagnostic?: (error: unknown) => void;
}

/** The provider-specific identity and endpoint a subclass supplies once. */
export interface CloudAdapterProfile {
  provider: SessionProvider;
  defaultBaseUrl: string;
  baseUrlEnvironmentVariable?: string;
  /** Defaults to a bearer token, which is what every other provider takes. */
  authScheme?: CloudAuthScheme;
}

/**
 * The only way a subclass reaches its provider while observing. It
 * authenticates, bounds, and parses the request, and it can express nothing
 * but a read, so no observation pass built on it can change provider state.
 * The deadline can be widened only to the slow bound, and only for a read the
 * provider itself documents as slow.
 *
 * A read the provider answers only at a POSTed query endpoint — Conductor's
 * transcripts view — names its document here, and the separation a GET gives
 * for free is held the way the Linear tracker holds it: the document's text is
 * fixed by the build, observation only ever sends a read, and an adapter
 * interpolates nothing into it beyond identifiers the same pass reported, each
 * validated against the shape its provider documents.
 */
export type CloudRequest = (
  segments: readonly string[],
  query?: Readonly<Record<string, string>>,
  options?: Readonly<{ timeoutMs?: number; document?: string }>,
) => Promise<Record<string, unknown>>;

/**
 * One documented write a provider takes for one of its sessions: the route and
 * the exact body its endpoint asks for. A subclass describes the request; the
 * base is the only thing that issues one.
 */
export interface CloudWriteRoute {
  segments: readonly string[];
  /**
   * A Google-style custom method, appended to the path as `:action` rather
   * than as a segment: it names what the request does to the resource the
   * segments already name.
   */
  action?: string;
  /** Left off entirely for an endpoint that documents an empty request. */
  body?: Readonly<Record<string, unknown>>;
}

export function isDefined<Value>(value: Value | undefined): value is Value {
  return value !== undefined;
}

export function textFromRecord(record: Record<string, unknown>, key: string): string | undefined {
  return text(record[key]);
}

export function timestampFromRecord(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = textFromRecord(record, key);
  if (!value) return undefined;
  const timestampMs = Date.parse(value);
  return Number.isFinite(timestampMs) ? timestampMs : undefined;
}

/**
 * Reads a value a provider reported only when this build knows it, so a state
 * added after this build shipped is left undefined rather than guessed at.
 */
export function knownValue<Value extends string>(
  values: Readonly<Record<string, Value>>,
  reported: string | undefined,
): Value | undefined {
  return Object.values(values).find((candidate) => candidate === reported);
}

/** Reads a list page without assuming which key a given provider wraps it in. */
export function recordsFromPage(
  body: Record<string, unknown>,
  key: string,
): Record<string, unknown>[] {
  const data = body[key];
  return Array.isArray(data) ? data.filter(isRecord) : [];
}

/**
 * Luke labels a session by its repository, never by a workspace, agent, or
 * session name. Cloud providers derive those names from the opening prompt, so
 * they are transcript content that no adapter may surface.
 */
export function repositoryLabel(
  gitRemote: string | undefined,
  fallbackName: string | undefined,
): string {
  const remote = gitRemote?.trim().replace(/\/+$/, "");
  const lastSegment = remote?.split(/[/:]/).pop()?.trim();
  const repository = lastSegment?.endsWith(GIT_SUFFIX)
    ? lastSegment.slice(0, -GIT_SUFFIX.length)
    : lastSegment;
  return repository || fallbackName?.trim() || UNKNOWN_WORKSPACE_LABEL;
}

const defaultFetch: CloudFetch = (url, init) => fetch(url, init);

function resolveBaseUrl(profile: CloudAdapterProfile, configured: string | undefined): string {
  const fromEnvironment = profile.baseUrlEnvironmentVariable
    ? process.env[profile.baseUrlEnvironmentVariable]?.trim()
    : undefined;
  return configured?.trim() || fromEnvironment || profile.defaultBaseUrl;
}

/**
 * The shared half of every cloud provider adapter: credential handling, its own
 * refresh cadence, the failure rules that decide whether a snapshot survives,
 * and bounded read-only requests. A subclass supplies the provider's routes,
 * how its reported state maps onto Luke's, and — by declaring the matching
 * interfaces — which writes it actually routes.
 *
 * Write machinery lives here as protected helpers so a subclass that does not
 * route a capability does not grow the method the probe looks for: capability
 * is which interfaces the adapter declares, the same meaning local adapters
 * already have. Each helper acts on nothing but what a user asked for against
 * something the last pass observed — a session that advertised the capability
 * being used, or a project the provider itself listed. Observation itself
 * stays read-only.
 */
export abstract class CloudSessionAdapter implements SessionProviderAdapter {
  readonly provider: SessionProvider;

  readonly #readApiKey: () => Promise<string | undefined>;
  readonly #baseUrl: string;
  readonly #fetch: CloudFetch;
  readonly #authorizationHeaders: (apiKey: string) => Readonly<Record<string, string>>;
  readonly #now: () => number;
  readonly #minimumRefreshIntervalMs: number;
  readonly #onDiagnostic: ((error: unknown) => void) | undefined;

  #credential: string | undefined;
  /**
   * Bumped only when the credential changes or is rejected — unlike the pass
   * counter, which moves on every observation. It is what a slow read that
   * outlives its pass is bound to: several passes may come and go while it
   * runs, and only a different credential makes its answer wrong.
   */
  #credentialEpoch = 0;
  #observations: readonly ProviderSessionObservation[] = [];
  #lastAttemptAt = Number.NEGATIVE_INFINITY;
  #collectPass = 0;

  constructor(profile: CloudAdapterProfile, options: CloudAdapterOptions) {
    this.provider = profile.provider;
    this.#readApiKey = options.readApiKey;
    this.#baseUrl = resolveBaseUrl(profile, options.baseUrl);
    this.#fetch = options.fetch ?? defaultFetch;
    this.#authorizationHeaders =
      AUTHORIZATION_HEADERS[profile.authScheme ?? CLOUD_AUTH_SCHEME.BEARER];
    this.#now = options.now ?? Date.now;
    const { minimumRefreshIntervalMs } = resolveOptions(
      options,
      { minimumRefreshIntervalMs: CLOUD_ADAPTER_DEFAULTS.MINIMUM_REFRESH_INTERVAL_MS },
      { nonNegative: ["minimumRefreshIntervalMs"] },
    );
    this.#minimumRefreshIntervalMs = minimumRefreshIntervalMs;
    this.#onDiagnostic = options.onDiagnostic;
  }

  async observe(): Promise<readonly ProviderSessionObservation[]> {
    // One observer must never abort the shared refresh pass, so a settings read
    // that fails is treated the same as having no credential at all.
    const apiKey = await this.#readApiKey().catch(() => undefined);
    if (!apiKey) {
      this.#credential = undefined;
      this.#forgetObservedState();
      return this.#observations;
    }

    const now = this.#now();
    if (apiKey === this.#credential) {
      // A network provider refreshes on its own cadence instead of on every
      // tick of the shared observation timer.
      if (now - this.#lastAttemptAt < this.#minimumRefreshIntervalMs) return this.#observations;
    } else {
      this.#credential = apiKey;
      this.#forgetObservedState();
    }
    this.#lastAttemptAt = now;

    // Observers can overlap: a settings save refreshes this adapter while a
    // timer-driven pass is still in flight with the key it replaced. Only the
    // newest pass may write, or sessions read as one credential would be
    // served as another's until the next refresh.
    const pass = ++this.#collectPass;
    try {
      const collected = await this.collect(this.#requestForPass(pass, apiKey), now);
      if (pass === this.#collectPass) this.#observations = cloudObservations(collected);
    } catch (error) {
      // A rejected credential clears observed state; a transient network or
      // server failure keeps the previous snapshot until the next attempt. A
      // superseded pass reports on a credential that no longer stands, so its
      // rejection says nothing about the current one.
      if (pass !== this.#collectPass) {
        return this.#observations;
      }
      if (error instanceof CloudRequestError) {
        if (error.failure === CLOUD_FAILURE.UNAUTHORIZED) this.#forgetObservedState();
        return this.#observations;
      }
      // Anything else is a bug in this pass — a TypeError thrown by a
      // subclass's parsing is not a network blip, and must not keep serving
      // the stale snapshot with no log, counter, or hook.
      this.#onDiagnostic?.(error);
      throw error;
    }
    return this.#observations;
  }

  /**
   * Sends one user-typed message to one observed session, through the
   * provider's documented message endpoint. Everything that could make this a
   * different kind of write is refused before a request exists: a session the
   * last pass did not observe, one that did not advertise `canReceiveMessage`,
   * text outside the message bound, and a missing credential all answer
   * without touching the network.
   */
  protected async sendObservedMessage(
    message: ProviderSessionMessage,
  ): Promise<ProviderMessageResult> {
    const observation = this.#observations.find(
      (candidate) => candidate.providerSessionId === message.providerSessionId,
    );
    if (!observation?.canReceiveMessage) {
      return { status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED };
    }

    const text = sessionMessageText(message.text);
    if (!text) {
      return {
        status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
        reason: "A message has to be shorter than a document and longer than nothing.",
      };
    }

    // The credential is read at send time, not held from the observation pass,
    // so a key the user just replaced or removed is honoured immediately. Its
    // absence is a rejection with the actual reason, not "unsupported": the
    // session advertised taking messages while a key stood behind it, and a
    // key that has since gone is a different fact than a session that moved on.
    const apiKey = await this.#readApiKey().catch(() => undefined);
    if (!apiKey) return this.#missingKeyRejection();

    const route = this.messageRoute(message.providerSessionId, text);
    if (!route) return { status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED };
    return this.#postWrite(apiKey, route);
  }

  #missingKeyRejection(): ProviderActResult {
    return {
      status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
      reason: `${this.provider.displayName}'s API key is no longer configured.`,
    };
  }

  /**
   * Runs one provider-defined control against one observed session, through
   * the endpoint the provider documents for it. The same refusals guard it
   * that guard a message: no request exists for a session the last pass did
   * not observe, for a control that session did not advertise, or without a
   * credential.
   */
  protected async executeObservedControl(
    request: ProviderControlRequest,
  ): Promise<ProviderControlResult> {
    const observation = this.#observations.find(
      (candidate) => candidate.providerSessionId === request.providerSessionId,
    );
    // The advertised control — not the caller's copy of it — is what the route
    // is built from, so whatever it targets is the thing the last pass actually
    // saw, and nothing a caller sends can redirect it.
    const advertised = observation?.controls?.find((control) => control.id === request.control.id);
    if (!advertised) return { status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED };

    const apiKey = await this.#readApiKey().catch(() => undefined);
    if (!apiKey) return this.#missingKeyRejection();

    const route = this.controlRoute(request.providerSessionId, advertised);
    if (!route) return { status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED };
    return this.#postWrite(apiKey, route);
  }

  /**
   * Starts another agent in the workspace one observed session runs in,
   * through the provider's documented endpoint. The same refusals guard it
   * that guard a message: a session the last pass did not observe, an agent
   * its observation did not list, a name or task outside its bound, and a
   * missing credential all answer without touching the network.
   */
  protected async spawnObservedWorkspaceAgent(
    request: ProviderWorkspaceAgentRequest,
  ): Promise<ProviderWorkspaceResult> {
    const observation = this.#observations.find(
      (candidate) => candidate.providerSessionId === request.providerSessionId,
    );
    if (!observation) return { status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED };
    // The advertised list — not the caller's word — is what the route is
    // built from, so an agent kind is only ever one the last pass promised.
    const agent = observation.spawnableAgents?.find((candidate) => candidate === request.agent);
    if (!agent) return { status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED };

    const name = request.name === undefined ? undefined : workspaceNameText(request.name);
    if (request.name !== undefined && !name) {
      return {
        status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
        reason: "A session name has to be short enough to say and longer than nothing.",
      };
    }
    const task = request.task === undefined ? undefined : sessionMessageText(request.task);
    if (request.task !== undefined && !task) {
      return {
        status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
        reason: "A task has to be shorter than a document and longer than nothing.",
      };
    }

    // The route is built in the same synchronous step as the validation, from
    // the observation's own spawn target: a pass landing while the key is read
    // must not be able to swap the snapshot between the check and the route.
    const route = this.workspaceAgentRoute(observation.spawnTarget ?? request.providerSessionId, {
      ...request,
      agent,
      name,
      task,
    });
    if (!route) return { status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED };

    const apiKey = await this.#readApiKey().catch(() => undefined);
    if (!apiKey) return this.#missingKeyRejection();
    return this.#postWrite(apiKey, route);
  }

  /**
   * Where this provider's documented start-another-agent endpoint lives and
   * what it takes. The target handed in is the observation's own `spawnTarget`
   * — the session id itself when none was reported — and the request is the
   * validated ask, so the route is built from what the provider itself
   * promised. The default is that a provider starts nothing, the same way a
   * read-only adapter stays read-only by writing nothing.
   */
  protected workspaceAgentRoute(
    _spawnTarget: string,
    _request: ProviderWorkspaceAgentRequest,
  ): CloudWriteRoute | undefined {
    return undefined;
  }

  /**
   * Creates one workspace the user just asked for, in one project the latest
   * pass reported, through the provider's documented creation endpoint — and,
   * when the user gave the new agent an opening task, hands that over too,
   * either inside the creation request or through the provider's documented
   * follow-up on what the creation returned. The same refusals guard it that
   * guard a message: a project the last pass did not report, a name or task
   * outside its bound, a task a project does not take or the absence of one it
   * needs, and a missing credential all answer without touching the network.
   */
  protected async createObservedWorkspace(
    request: ProviderWorkspaceRequest,
    projects: readonly WorkspaceProject[],
  ): Promise<ProviderWorkspaceResult> {
    const project = projects.find(
      (candidate) => candidate.providerProjectId === request.providerProjectId,
    );
    if (!project) return { status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED };

    const name = request.name === undefined ? undefined : workspaceNameText(request.name);
    if (request.name !== undefined && !name) {
      return {
        status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
        reason: "A workspace name has to be short enough to say and longer than nothing.",
      };
    }

    // The task is held to the project's own word for it, again here: the
    // renderer already refused what it could, but an adapter answers for its
    // own writes.
    const task = request.task === undefined ? undefined : sessionMessageText(request.task);
    if (request.task !== undefined && !task) {
      return {
        status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
        reason: "A task has to be shorter than a document and longer than nothing.",
      };
    }
    if (task && project.taskSupport === WORKSPACE_TASK_SUPPORT.NONE) {
      return {
        status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
        reason: "This project takes no opening task.",
      };
    }
    if (!task && project.taskSupport === WORKSPACE_TASK_SUPPORT.REQUIRED) {
      return {
        status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
        reason: "This project needs an opening task to create a workspace.",
      };
    }

    const apiKey = await this.#readApiKey().catch(() => undefined);
    if (!apiKey) return this.#missingKeyRejection();

    const route = this.workspaceCreationRoute(project, name, task, request.agentSelection);
    if (!route) return { status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED };
    const created = await this.#postWriteDetailed(apiKey, route, WRITE_SUBJECT.PROJECT);
    if (created.outcome.status !== PROVIDER_ACT_RESULT_STATUS.ACCEPTED) {
      return created.outcome;
    }
    // The id the response named rides the acceptance — an identifier only,
    // never an address — so the surface can open the workspace once an
    // observation pass reports that session itself. The body it was read
    // from still never leaves the adapter.
    const createdSessionId = this.createdWorkspaceSessionId(created.body ?? {});
    const landed: ProviderWorkspaceResult = {
      status: PROVIDER_ACT_RESULT_STATUS.ACCEPTED,
      ...(createdSessionId ? { providerSessionId: createdSessionId } : {}),
    };
    if (!task) return landed;

    // The workspace stands; what is left is the task. A provider whose
    // creation request already carried it has nothing to answer here, and one
    // that hands tasks somewhere the creation response names answers with
    // that route — built from what the provider itself just returned.
    const followUp = this.workspaceTaskRoute(created.body ?? {}, task);
    if (followUp === undefined) return landed;
    if ("undeliverable" in followUp) {
      return {
        status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
        reason: `The workspace was created, but its opening task was not delivered: ${followUp.undeliverable}`,
      };
    }
    const delivered = await this.#postWriteDetailed(apiKey, followUp, WRITE_SUBJECT.SESSION);
    if (delivered.outcome.status === PROVIDER_ACT_RESULT_STATUS.ACCEPTED) {
      return landed;
    }
    return {
      status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
      reason: `The workspace was created, but its opening task was not delivered: ${
        delivered.outcome.status === PROVIDER_ACT_RESULT_STATUS.REJECTED
          ? delivered.outcome.reason
          : "the provider documents no way to hand it over."
      }`,
    };
  }

  /**
   * Where this provider's documented workspace-creation endpoint lives and what
   * it takes. The project handed in is one the latest pass reported, so the
   * route is built from what the provider itself offered; the task arrives
   * here so a provider whose creation request carries it can put it in the
   * body. The default is that a provider creates nothing, the same way a
   * read-only adapter stays read-only by writing nothing.
   */
  protected workspaceCreationRoute(
    _project: WorkspaceProject,
    _name: string | undefined,
    _task: string | undefined,
    _agentSelection: WorkspaceAgentSelection | undefined,
  ): CloudWriteRoute | undefined {
    return undefined;
  }

  /**
   * The id of the session a creation response names, for a provider whose
   * documented response names one. It is the one thing read out of the body
   * that outlives the adapter — an identifier the next observation pass will
   * report on its own, never an address — and it exists so the surface can
   * open the created workspace once that pass has. The default is that a
   * provider names none, so an acceptance stays a plain acceptance and the
   * workspace is simply left where it was made.
   */
  protected createdWorkspaceSessionId(_creationBody: Record<string, unknown>): string | undefined {
    return undefined;
  }

  /**
   * Where an opening task goes once the workspace exists, for a provider that
   * documents the hand-over as its own endpoint on something the creation
   * response names. Returning nothing says the creation request already
   * carried the task; a provider whose response did not name the place the
   * task goes answers `undeliverable` with why, so a created-but-idle
   * workspace is reported as exactly that rather than claimed complete.
   */
  protected workspaceTaskRoute(
    _creationBody: Record<string, unknown>,
    _task: string,
  ): CloudWriteRoute | { undeliverable: string } | undefined {
    return undefined;
  }

  /**
   * Where this provider's documented message endpoint lives and what it takes.
   * Returning nothing says this adapter cannot form the request — a provider
   * that documents no message endpoint at all, or an identity it has not
   * learned — never that the send failed. The default is that a provider takes
   * no messages, so a read-only adapter stays read-only by writing nothing.
   */
  protected messageRoute(_providerSessionId: string, _text: string): CloudWriteRoute | undefined {
    return undefined;
  }

  /**
   * Where a documented control's endpoint lives. The control handed in is the
   * one the latest observation advertised, so a route built from its `target`
   * acts on what the user was shown. The default is that a provider advertises
   * no controls, so only an adapter that advertised one has anything to answer
   * here.
   */
  protected controlRoute(
    _providerSessionId: string,
    _control: SessionControl,
  ): CloudWriteRoute | undefined {
    return undefined;
  }

  /** Runs one authenticated pass. Duplicate session ids are dropped by the base. */
  protected abstract collect(
    request: CloudRequest,
    now: number,
  ): Promise<readonly ProviderSessionObservation[]>;

  /**
   * Clears anything a subclass cached across passes. It runs whenever the
   * credential changes or is rejected, so nothing read as one user can be
   * reported as another.
   */
  protected forgetCachedIdentity(): void {}

  /**
   * Holds a status only while its timestamp is recent. Luke cannot tell a turn
   * that just finished from a chat abandoned hours ago once a session goes
   * stale, and reporting the stale state would speak at the wrong moment.
   */
  protected statusWhileRecent(
    status: SessionStatus,
    observedAt: number,
    now: number,
  ): SessionStatus {
    return now - observedAt <= OBSERVATION_WINDOW.ACTIVE_SESSION_FRESHNESS_MS
      ? status
      : SESSION_STATUS.UNKNOWN;
  }

  /**
   * The headers every request carries besides the credential. A subclass
   * overrides this only when its provider asks for its own media type or a
   * version pin; the authorization header is layered on after these, so no
   * override can replace the credential.
   */
  protected requestHeaders(): Readonly<Record<string, string>> {
    return DEFAULT_REQUEST_HEADERS;
  }

  /** Keeps one failed resource from discarding an otherwise complete pass. */
  protected async tolerateItemFailure<Result>(
    operation: () => Promise<Result>,
  ): Promise<Result | undefined> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof CloudRequestError && error.failure === CLOUD_FAILURE.UNAUTHORIZED) {
        throw error;
      }
      return undefined;
    }
  }

  #forgetObservedState(): void {
    // A pass still in flight was started under a credential that no longer
    // stands, so its result must not land — and neither may a slow read's.
    this.#collectPass += 1;
    this.#credentialEpoch += 1;
    this.forgetCachedIdentity();
    this.#observations = [];
  }

  /**
   * One read bound to the credential rather than to one pass, for an offer
   * that rides beside the passes and may outlive several — the pass-scoped
   * request would discard exactly the slow answer such a read exists for.
   * Only a credential change discards it: the read refuses to land across
   * one, so nothing read as one user is ever kept as another's. What the
   * caller does with the answer is handed in rather than returned, so the
   * check and the write share one synchronous step and a credential cleared
   * in the gap between them has no gap to land in.
   */
  protected async credentialBoundRead(
    segments: readonly string[],
    query: Readonly<Record<string, string>> | undefined,
    options: Readonly<{ timeoutMs?: number }> | undefined,
    apply: (body: Record<string, unknown>) => void,
  ): Promise<void> {
    const epoch = this.#credentialEpoch;
    const apiKey = this.#credential;
    if (!apiKey) {
      throw new CloudRequestError(
        CLOUD_FAILURE.TRANSIENT,
        `${this.provider.displayName} has no credential to read with`,
      );
    }
    const body = await this.#requestJson(apiKey, segments, query, options);
    if (epoch !== this.#credentialEpoch) {
      throw new CloudRequestError(
        CLOUD_FAILURE.TRANSIENT,
        `${this.provider.displayName} read outlived its credential`,
      );
    }
    apply(body);
  }

  /**
   * Binds one pass's requests to the credential it started with. A superseded
   * pass fails instead of issuing another request with a replaced key, and
   * whatever a request already read is discarded before a subclass can cache
   * it over state that belongs to the new credential.
   */
  #requestForPass(pass: number, apiKey: string): CloudRequest {
    return async (segments, query, options) => {
      this.#assertPassCurrent(pass);
      const body = await this.#requestJson(apiKey, segments, query, options);
      this.#assertPassCurrent(pass);
      return body;
    };
  }

  #assertPassCurrent(pass: number): void {
    if (pass !== this.#collectPass) {
      throw new CloudRequestError(
        CLOUD_FAILURE.TRANSIENT,
        `${this.provider.displayName} pass was superseded`,
      );
    }
  }

  #url(
    segments: readonly string[],
    query: Readonly<Record<string, string>>,
    action?: string,
  ): string {
    const url = new URL(this.#baseUrl);
    // The action rides after the segments unencoded: `:sendMessage` is part of
    // the route, and encoding its colon would name a different route.
    url.pathname = `/${segments.map((segment) => encodeURIComponent(segment)).join("/")}${
      action ? `:${action}` : ""
    }`;
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
    return url.href;
  }

  /**
   * The one authenticated write. It shares the read path's timeout and its
   * refusal to echo anything the provider said into an error a user sees, and
   * it answers with what became of the request rather than throwing: a write
   * is a user's own act, so every outcome has to land back on the row it left.
   * The subject is what the route acts on, so a refusal names the thing that
   * actually went missing.
   */
  async #postWrite(
    apiKey: string,
    route: CloudWriteRoute,
    subject: WriteSubject = WRITE_SUBJECT.SESSION,
  ): Promise<ProviderActResult> {
    return (await this.#postWriteDetailed(apiKey, route, subject)).outcome;
  }

  /**
   * The same write, keeping what the provider answered with: a creation
   * response names the thing it created, and a follow-up write is built from
   * that. The body never travels further than the adapter that asked for it.
   */
  async #postWriteDetailed(
    apiKey: string,
    route: CloudWriteRoute,
    subject: WriteSubject,
  ): Promise<{ outcome: ProviderActResult; body?: Record<string, unknown> }> {
    const name = this.provider.displayName;
    let response: Response;
    try {
      response = await this.#fetch(this.#url(route.segments, {}, route.action), {
        method: HTTP_METHOD.POST,
        // The same layering as a read: the provider's own headers first, the
        // credential after them so no override can replace it.
        headers: {
          ...this.requestHeaders(),
          ...this.#authorizationHeaders(apiKey),
          // An endpoint that documents an empty request gets exactly that,
          // not an empty JSON object it never asked for.
          ...(route.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(route.body === undefined ? {} : { body: JSON.stringify(route.body) }),
        signal: AbortSignal.timeout(CLOUD_ADAPTER_DEFAULTS.REQUEST_TIMEOUT_MS),
      });
    } catch {
      return {
        outcome: {
          status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
          reason: `${name} could not be reached, so nothing was sent.`,
        },
      };
    }

    if (response.ok) {
      // A write that landed changes what the session is doing, so the refresh
      // that follows must actually ask: served from the cache inside the
      // minimum interval, the row would keep offering what the provider has
      // already taken.
      this.#lastAttemptAt = Number.NEGATIVE_INFINITY;
      // An unreadable body is not a failed write: the provider already said
      // yes, so only a follow-up that needed the body has anything to miss.
      const body = await response.json().catch(() => undefined);
      return {
        outcome: { status: PROVIDER_ACT_RESULT_STATUS.ACCEPTED },
        ...(isRecord(body) ? { body } : {}),
      };
    }
    if (response.status === HTTP_STATUS.UNAUTHORIZED || response.status === HTTP_STATUS.FORBIDDEN) {
      return {
        outcome: {
          status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
          reason: `${name} rejected the configured API key.`,
        },
      };
    }
    if (response.status === HTTP_STATUS.NOT_FOUND) {
      return {
        outcome: {
          status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
          reason: `${name} no longer has this ${subject}.`,
        },
      };
    }
    if (response.status === HTTP_STATUS.CONFLICT) {
      return {
        outcome: {
          status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
          reason: `${name} says this ${subject} has moved on since Luke last looked.`,
        },
      };
    }
    return {
      outcome: {
        status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
        reason: `${name} answered with status ${response.status}, so the request may not have landed.`,
      },
    };
  }

  async #requestJson(
    apiKey: string,
    segments: readonly string[],
    query: Readonly<Record<string, string>> = {},
    options: Readonly<{ timeoutMs?: number; document?: string }> = {},
  ): Promise<Record<string, unknown>> {
    const name = this.provider.displayName;
    // A widened deadline never widens past the slow bound: the option exists
    // for a read the provider documents as slow, not for one that never ends.
    const timeoutMs = Math.min(
      positiveInteger(options.timeoutMs, CLOUD_ADAPTER_DEFAULTS.REQUEST_TIMEOUT_MS),
      CLOUD_ADAPTER_DEFAULTS.SLOW_REQUEST_TIMEOUT_MS,
    );
    // A read document rides as a POST because that is how its endpoint is
    // documented, not because it writes: the body carries the document and
    // nothing else, so the request can still express nothing but a read.
    const document = options.document;
    let response: Response;
    try {
      response = await this.#fetch(this.#url(segments, query), {
        method: document === undefined ? HTTP_METHOD.GET : HTTP_METHOD.POST,
        headers: {
          ...this.requestHeaders(),
          ...this.#authorizationHeaders(apiKey),
          ...(document === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(document === undefined
          ? {}
          : { body: JSON.stringify({ [READ_DOCUMENT_FIELD]: document }) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new CloudRequestError(CLOUD_FAILURE.TRANSIENT, `${name} request failed`);
    }

    if (response.status === HTTP_STATUS.UNAUTHORIZED || response.status === HTTP_STATUS.FORBIDDEN) {
      throw new CloudRequestError(
        CLOUD_FAILURE.UNAUTHORIZED,
        `${name} rejected the configured API key`,
      );
    }
    if (!response.ok) {
      throw new CloudRequestError(
        CLOUD_FAILURE.TRANSIENT,
        `${name} responded with status ${response.status}`,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new CloudRequestError(
        CLOUD_FAILURE.TRANSIENT,
        `${name} returned an unreadable response`,
      );
    }
    if (!isRecord(body)) {
      throw new CloudRequestError(
        CLOUD_FAILURE.TRANSIENT,
        `${name} returned an unexpected response`,
      );
    }
    return body;
  }
}

/**
 * Drops a session a subclass reported twice, and stamps the location the base
 * already knows: nothing reaches this point except over the network, so a
 * subclass cannot forget to say its sessions run somewhere else.
 */
function cloudObservations(
  observations: readonly ProviderSessionObservation[],
): readonly ProviderSessionObservation[] {
  const unique = new Map<string, ProviderSessionObservation>();
  for (const observation of observations) {
    if (!unique.has(observation.providerSessionId)) {
      unique.set(observation.providerSessionId, {
        ...observation,
        location: SESSION_LOCATION.CLOUD,
      });
    }
  }
  return [...unique.values()];
}
