import {
  type ProviderSessionObservation,
  SESSION_STATUS,
  type SessionProvider,
  type SessionStatus,
} from "@sidecar/core";
import {
  CLOUD_ADAPTER_DEFAULTS,
  CLOUD_AUTH_SCHEME,
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

/** The one read-only route Luke calls. Every other route writes or is transcript. */
const JULES_ROUTE = {
  SESSIONS: [JULES_ROUTE_SEGMENT.V1ALPHA, JULES_ROUTE_SEGMENT.SESSIONS],
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
const SESSION_STATUS_BY_JULES_STATE: Readonly<Record<JulesState, SessionStatus>> = {
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
  /** The documented maximum, so one call covers as much of a day as it can. */
  SESSION_PAGE_SIZE: 100,
  MAXIMUM_OBSERVED_SESSIONS: 12,
  MAXIMUM_BRANCH_LABEL_LENGTH: 60,
} as const;

export const JULES_PROVIDER: SessionProvider = {
  id: JULES_PROVIDER_ID,
  displayName: JULES_PROVIDER_NAME,
};

export interface JulesAdapterOptions extends CloudAdapterOptions {
  maximumObservedSessions?: number;
}

interface JulesSession {
  id: string;
  repositoryLabel: string;
  state: JulesState | undefined;
  observedAt: number;
  branch?: string;
  link?: string;
}

function sessionFromRecord(record: Record<string, unknown>): JulesSession | undefined {
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
    ...(branch ? { branch } : {}),
    ...(link ? { link } : {}),
  };
}

/**
 * Observes Google Jules sessions through the documented alpha API. It reads
 * only the sessions the supplied key owns, issues no request that can change
 * provider state, and reports nothing at all without a credential.
 */
export class JulesSessionAdapter extends CloudSessionAdapter {
  readonly #maximumObservedSessions: number;

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
    this.#maximumObservedSessions = positiveInteger(
      options.maximumObservedSessions,
      JULES_ADAPTER_DEFAULTS.MAXIMUM_OBSERVED_SESSIONS,
    );
  }

  protected async collect(
    request: CloudRequest,
    now: number,
  ): Promise<readonly ProviderSessionObservation[]> {
    // One call per pass. The list projection already carries the state, the
    // timestamps, and the source, so there is nothing a per-session read would
    // add, and Jules documents no ordering — the window filter and the sort
    // below are what bound the page rather than the order it arrives in.
    const body = await request(JULES_ROUTE.SESSIONS, {
      [JULES_QUERY.PAGE_SIZE]: String(JULES_ADAPTER_DEFAULTS.SESSION_PAGE_SIZE),
    });

    return recordsFromPage(body, JULES_FIELD.SESSIONS)
      .map(sessionFromRecord)
      .filter(isDefined)
      .filter(
        (session) => now - session.observedAt <= CLOUD_ADAPTER_DEFAULTS.MAXIMUM_SESSION_AGE_MS,
      )
      .sort((first, second) => second.observedAt - first.observedAt)
      .slice(0, this.#maximumObservedSessions)
      .map((session) => this.#observationFor(session, now));
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
      detail: {
        repository: session.repositoryLabel,
        // The starting branch is chosen by whoever opened the session, unlike
        // the branch Jules names for its own patch from the prompt.
        ...(session.branch ? { branch: session.branch } : {}),
        ...(status === SESSION_STATUS.ERROR ? { error: JULES_SESSION_FAILED_MESSAGE } : {}),
        ...(session.link ? { link: session.link } : {}),
      },
    };
  }

  #statusFor(session: JulesSession, now: number): SessionStatus {
    // A state this build does not know is not guessed at.
    if (!session.state) return SESSION_STATUS.UNKNOWN;
    const status = SESSION_STATUS_BY_JULES_STATE[session.state];
    // `updateTime` marks when the session last changed rather than a
    // heartbeat, so a long turn is still working and a completed session stays
    // complete however long ago it finished. Only waiting decays: once it is
    // stale Luke cannot tell a session that just asked for feedback from one
    // the user walked away from hours ago.
    return status === SESSION_STATUS.WAITING
      ? this.statusWhileRecent(status, session.observedAt, now)
      : status;
  }
}
