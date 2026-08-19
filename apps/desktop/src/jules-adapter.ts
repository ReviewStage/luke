import {
  agedStatus,
  isRecord,
  OBSERVATION_WINDOW,
  type ProviderSessionObservation,
  SESSION_STATUS,
  type SessionControl,
  type SessionProvider,
  type SessionStatus,
  type WireRecord,
} from "@sidecar/core";
import {
  CLOUD_AUTH_SCHEME,
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
const JULES_PROVIDER_ID = CREDENTIAL_PROVIDER_ID.JULES;
const JULES_PROVIDER_NAME = CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.JULES].displayName;
/** A session Jules failed reports no reason of its own, so the state is the message. */
const JULES_SESSION_FAILED_MESSAGE = "The session failed";

const JULES_ENVIRONMENT = {
  API_URL: "JULES_API_URL",
} as const;

const JULES_DEFAULT_API_URL = "https://jules.googleapis.com";

const JULES_ROUTE_SEGMENT = {
  SESSIONS: "sessions",
  V1ALPHA: "v1alpha",
} as const;

/**
 * The one read-only route Luke calls, which is also where the two writers it
 * can make hang: Google custom methods on a session resource. `:sendMessage`
 * is Jules's documented way to hand a message to an active session, and
 * `:approvePlan` clears a plan the session is holding for.
 */
const JULES_ROUTE = {
  SESSIONS: [JULES_ROUTE_SEGMENT.V1ALPHA, JULES_ROUTE_SEGMENT.SESSIONS],
} as const;

/** The custom methods `POST …/sessions/{id}:<action>` documents. */
const JULES_ACTION = {
  SEND_MESSAGE: "sendMessage",
  APPROVE_PLAN: "approvePlan",
} as const;

/** The body `:sendMessage` documents; `:approvePlan` documents an empty one. */
const JULES_MESSAGE_FIELD = {
  PROMPT: "prompt",
} as const;

/**
 * The one control this adapter can honour, advertised only while a session is
 * actually holding for a plan approval.
 */
const JULES_APPROVE_PLAN_CONTROL = {
  id: "approve-plan",
  label: "Approve the plan",
} as const;

const JULES_QUERY = {
  PAGE_SIZE: "pageSize",
} as const;

const JULES_FIELD = {
  CREATE_TIME: "createTime",
  GITHUB_REPO_CONTEXT: "githubRepoContext",
  ID: "id",
  SESSIONS: "sessions",
  SOURCE: "source",
  SOURCE_CONTEXT: "sourceContext",
  STARTING_BRANCH: "startingBranch",
  STATE: "state",
  UPDATE_TIME: "updateTime",
  URL: "url",
} as const;

const JULES_STATE = {
  STATE_UNSPECIFIED: "STATE_UNSPECIFIED",
  QUEUED: "QUEUED",
  PLANNING: "PLANNING",
  AWAITING_PLAN_APPROVAL: "AWAITING_PLAN_APPROVAL",
  AWAITING_USER_FEEDBACK: "AWAITING_USER_FEEDBACK",
  IN_PROGRESS: "IN_PROGRESS",
  PAUSED: "PAUSED",
  FAILED: "FAILED",
  COMPLETED: "COMPLETED",
} as const;

type JulesState = (typeof JULES_STATE)[keyof typeof JULES_STATE];

/**
 * Jules reports one state per session, covering both what the agent is doing
 * and what it is holding for. Queueing and planning are work the user cannot
 * act on yet; the two awaiting states and a pause are the session holding for
 * the user. A failed session stopped on something it cannot get past on its
 * own, which is what Cursor's `ERROR` and Devin's `error` report too, and an
 * unspecified state says nothing at all.
 */
const SESSION_STATUS_BY_JULES_STATE = {
  [JULES_STATE.QUEUED]: SESSION_STATUS.WORKING,
  [JULES_STATE.PLANNING]: SESSION_STATUS.WORKING,
  [JULES_STATE.IN_PROGRESS]: SESSION_STATUS.WORKING,
  [JULES_STATE.AWAITING_PLAN_APPROVAL]: SESSION_STATUS.WAITING,
  [JULES_STATE.AWAITING_USER_FEEDBACK]: SESSION_STATUS.WAITING,
  [JULES_STATE.PAUSED]: SESSION_STATUS.WAITING,
  [JULES_STATE.COMPLETED]: SESSION_STATUS.COMPLETE,
  [JULES_STATE.FAILED]: SESSION_STATUS.ERROR,
  [JULES_STATE.STATE_UNSPECIFIED]: SESSION_STATUS.UNKNOWN,
};

const JULES_ADAPTER_DEFAULTS = {
  // SAFETY: The preceding check establishes the asserted contract.
  /** The documented maximum, so one call reaches as deep into the history as it can. */
  SESSION_PAGE_SIZE: 100,
  MAXIMUM_BRANCH_LABEL_LENGTH: 60,
} as const;

export const JULES_PROVIDER: SessionProvider = {
  id: JULES_PROVIDER_ID,
  displayName: JULES_PROVIDER_NAME,
};

export type JulesAdapterOptions = CloudAdapterOptions;

interface JulesSession {
  id: string;
  repositoryLabel: string;
  state: JulesState | undefined;
  observedAt: number;
  branch?: string;
  link?: string;
}

function sessionFromRecord(record: WireRecord): JulesSession | undefined {
  const id = textFromRecord(record, JULES_FIELD.ID);
  const observedAt =
    timestampFromRecord(record, JULES_FIELD.UPDATE_TIME) ??
    timestampFromRecord(record, JULES_FIELD.CREATE_TIME);
  if (!id || observedAt === undefined) return undefined;

  const sourceContext = record[JULES_FIELD.SOURCE_CONTEXT];
  const context = isRecord(sourceContext) ? sourceContext : {};
  const repositoryContext = context[JULES_FIELD.GITHUB_REPO_CONTEXT];
  const branch = isRecord(repositoryContext)
    ? textFromRecord(repositoryContext, JULES_FIELD.STARTING_BRANCH)?.slice(
        0,
        JULES_ADAPTER_DEFAULTS.MAXIMUM_BRANCH_LABEL_LENGTH,
      )
    : undefined;
  const link = textFromRecord(record, JULES_FIELD.URL);

  return {
    id,
    observedAt,
    // A session's `prompt` is the task the user typed and its `title` is
    // generated from that prompt, so the source is the only label available
    // and there is deliberately no fallback to either.
    repositoryLabel: repositoryLabel(textFromRecord(context, JULES_FIELD.SOURCE), undefined),
    state: knownValue(JULES_STATE, textFromRecord(record, JULES_FIELD.STATE)),
    ...(branch ? { branch } : undefined),
    ...(link ? { link } : undefined),
  };
}

/**
 * Which states Jules documents `sendMessage` for: an "active" session — one
 * that is planning, working, or holding for the user. A paused session's
 * revival is documented nowhere, and a completed or failed one is settled, so
 * none of those advertises the capability.
 */
const JULES_MESSAGEABLE_STATES: ReadonlySet<JulesState> = new Set([
  JULES_STATE.PLANNING,
  JULES_STATE.IN_PROGRESS,
  JULES_STATE.AWAITING_PLAN_APPROVAL,
  JULES_STATE.AWAITING_USER_FEEDBACK,
]);

/**
 * Observes Google Jules sessions through the documented alpha API. It reads
 * only the sessions the supplied key owns, observation issues no request that
 * can change provider state, and it reports nothing at all without a
 * credential. The writes it supports are a user-typed message and a plan
 * approval, each through Jules's own custom method on a session that
 * advertised it.
 */
export class JulesSessionAdapter extends CloudSessionAdapter {
  constructor(options: JulesAdapterOptions) {
    super(
      {
        provider: JULES_PROVIDER,
        defaultBaseUrl: JULES_DEFAULT_API_URL,
        baseUrlEnvironmentVariable: JULES_ENVIRONMENT.API_URL,
        // Jules takes its key in Google's own header rather than as a bearer
        // token, which is the only way it differs from the other providers.
        authScheme: CLOUD_AUTH_SCHEME.GOOGLE_API_KEY_HEADER,
      },
      options,
    );
  }

  protected async collect(
    request: CloudRequest,
    now: number,
  ): Promise<readonly ProviderSessionObservation[]> {
    // One call per pass. The list projection already carries the state, the
    // timestamps, and the source, so there is nothing a per-session read would
    // add. Sessions are never capped — one page of the documented maximum is
    // the request's only bound — and Jules documents no ordering, so the sort
    // below is what orders the page rather than the order it arrives in.
    const body = await request(JULES_ROUTE.SESSIONS, {
      [JULES_QUERY.PAGE_SIZE]: String(JULES_ADAPTER_DEFAULTS.SESSION_PAGE_SIZE),
    });

    return recordsFromPage(body, JULES_FIELD.SESSIONS)
      .map(sessionFromRecord)
      .filter(isDefined)
      .sort((first, second) => second.observedAt - first.observedAt)
      .map((session) => this.#observationFor(session, now));
  }

  protected override messageRoute(
    providerSessionId: string,
    text: string,
  ): CloudWriteRoute | undefined {
    return {
      segments: [...JULES_ROUTE.SESSIONS, providerSessionId],
      action: JULES_ACTION.SEND_MESSAGE,
      body: { [JULES_MESSAGE_FIELD.PROMPT]: text },
    };
  }

  protected override controlRoute(
    providerSessionId: string,
    control: SessionControl,
  ): CloudWriteRoute | undefined {
    if (control.id !== JULES_APPROVE_PLAN_CONTROL.id) return undefined;
    return {
      segments: [...JULES_ROUTE.SESSIONS, providerSessionId],
      action: JULES_ACTION.APPROVE_PLAN,
      // Jules documents an empty request for an approval, so none is sent.
    };
  }

  #observationFor(session: JulesSession, now: number): ProviderSessionObservation {
    const status = this.#statusFor(session, now);
    return {
      providerSessionId: session.id,
      // The provider is already on the row as its mark and in the context line,
      // so the title carries only what tells one Jules session from another.
      title: session.repositoryLabel,
      status,
      observedAt: session.observedAt,
      canReceiveMessage: session.state !== undefined && JULES_MESSAGEABLE_STATES.has(session.state),
      ...(session.state === JULES_STATE.AWAITING_PLAN_APPROVAL
        ? { controls: [JULES_APPROVE_PLAN_CONTROL] }
        : undefined),
      detail: {
        repository: session.repositoryLabel,
        // The starting branch is chosen by whoever opened the session, unlike
        // the branch Jules names for its own patch from the prompt.
        ...(session.branch ? { branch: session.branch } : undefined),
        ...(status === SESSION_STATUS.ERROR ? { error: JULES_SESSION_FAILED_MESSAGE } : undefined),
        ...(session.link ? { link: session.link } : undefined),
      },
    };
  }

  #statusFor(session: JulesSession, now: number): SessionStatus {
    // A state this build does not know is not guessed at.
    if (!session.state) return SESSION_STATUS.UNKNOWN;
    return agedStatus(
      SESSION_STATUS_BY_JULES_STATE[session.state],
      session.observedAt,
      now,
      OBSERVATION_WINDOW.ACTIVE_SESSION_FRESHNESS_MS,
    );
  }
}
