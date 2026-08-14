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
  type CloudWriteRoute,
  isDefined,
  isRecord,
  knownValue,
  positiveInteger,
  recordsFromPage,
  textFromRecord,
} from "./cloud-session-adapter";
import { CREDENTIAL_PROVIDER_ID, CREDENTIAL_PROVIDERS } from "./shared/credential-providers";

// Shared with the credential registry so the key the user saves and the
// provider Luke observes with it can never name different things.
const DEVIN_PROVIDER_ID = CREDENTIAL_PROVIDER_ID.DEVIN;
const DEVIN_PROVIDER_NAME = CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.DEVIN].displayName;

const DEVIN_ENVIRONMENT = {
  API_URL: "DEVIN_API_URL",
} as const;

const DEVIN_DEFAULT_API_URL = "https://api.devin.ai";

/** Used only for a session Devin has not named yet and that opened nothing. */
const UNKNOWN_SESSION_LABEL = "Cloud session";
const DEVIN_SESSION_FAILED_MESSAGE = "The session stopped on an error";

/**
 * Documented public API routes, read with v3 rather than the deprecated v1 the
 * older `apk_` keys are for: v3 is the only version that says who a credential
 * belongs to and that can narrow a list to one person. The one writer among
 * them is `messages`, which is Devin's documented way to hand a message to an
 * existing session.
 */
const DEVIN_ROUTE_SEGMENT = {
  SELF: "self",
  V3: "v3",
  ORGANIZATIONS: "organizations",
  SESSIONS: "sessions",
  MESSAGES: "messages",
} as const;

const DEVIN_QUERY = {
  FIRST: "first",
  UPDATED_AFTER: "updated_after",
  USER_IDS: "user_ids",
} as const;

/** The body `POST …/sessions/{id}/messages` documents. */
const DEVIN_MESSAGE_FIELD = {
  MESSAGE: "message",
} as const;

const DEVIN_FIELD = {
  IS_ARCHIVED: "is_archived",
  TITLE: "title",
  URL: "url",
  ITEMS: "items",
  ORG_ID: "org_id",
  PRINCIPAL_TYPE: "principal_type",
  PR_URL: "pr_url",
  PULL_REQUESTS: "pull_requests",
  SESSION_ID: "session_id",
  STATUS: "status",
  STATUS_DETAIL: "status_detail",
  UPDATED_AT: "updated_at",
  USER_ID: "user_id",
} as const;

/**
 * Who a credential authenticates as. A service user is a non-human automation
 * account: it belongs to an organization rather than to a person, and the
 * sessions it can reach are attributed to it rather than to anyone using this
 * Mac. Only a personal access token names the human Luke is sitting beside.
 */
const DEVIN_PRINCIPAL = {
  PAT_USER: "pat_user",
} as const;

/** The session lifecycle, which is what a status means on its own. */
const DEVIN_SESSION_STATUS = {
  NEW: "new",
  CLAIMED: "claimed",
  RUNNING: "running",
  EXIT: "exit",
  ERROR: "error",
  SUSPENDED: "suspended",
  RESUMING: "resuming",
} as const;

type DevinSessionStatus = (typeof DEVIN_SESSION_STATUS)[keyof typeof DEVIN_SESSION_STATUS];

/**
 * What a running session is doing. Devin also reports a detail for a suspended
 * session, but those are reasons for the suspension rather than states, so this
 * map deliberately holds none of them and a suspended session falls through to
 * its status.
 */
const DEVIN_RUNNING_DETAIL = {
  WORKING: "working",
  WAITING_FOR_USER: "waiting_for_user",
  WAITING_FOR_APPROVAL: "waiting_for_approval",
  FINISHED: "finished",
} as const;

type DevinRunningDetail = (typeof DEVIN_RUNNING_DETAIL)[keyof typeof DEVIN_RUNNING_DETAIL];

/**
 * A session that exited is over for good, and one Devin reports as errored
 * stopped on something it cannot pass. The rest are either on their way
 * somewhere — being created, claimed by a machine, or resuming — or dormant:
 * unlike a Cursor run that expired, a suspended Devin session can be resumed,
 * so it is neither settled nor holding for anyone. Luke leaves those unknown
 * rather than promoting them to a state it cannot verify.
 */
const SESSION_STATUS_BY_DEVIN_STATUS: Readonly<Record<DevinSessionStatus, SessionStatus>> = {
  [DEVIN_SESSION_STATUS.RUNNING]: SESSION_STATUS.WORKING,
  [DEVIN_SESSION_STATUS.EXIT]: SESSION_STATUS.COMPLETE,
  [DEVIN_SESSION_STATUS.NEW]: SESSION_STATUS.UNKNOWN,
  [DEVIN_SESSION_STATUS.CLAIMED]: SESSION_STATUS.UNKNOWN,
  [DEVIN_SESSION_STATUS.SUSPENDED]: SESSION_STATUS.UNKNOWN,
  [DEVIN_SESSION_STATUS.RESUMING]: SESSION_STATUS.UNKNOWN,
  // Not left unknown: a session that stopped on an error is asking to be
  // rescued rather than answered, and Luke has a state that says so.
  [DEVIN_SESSION_STATUS.ERROR]: SESSION_STATUS.ERROR,
};

/**
 * A running session that is waiting on the user, waiting on an approval, or has
 * finished its task has stopped and is holding for the user, which is what Luke
 * reports as waiting. This is the one thing v1 could not say: it reported only
 * that a session was blocked, never that the machine was still up and the turn
 * had simply ended.
 */
const SESSION_STATUS_BY_RUNNING_DETAIL: Readonly<Record<DevinRunningDetail, SessionStatus>> = {
  [DEVIN_RUNNING_DETAIL.WORKING]: SESSION_STATUS.WORKING,
  [DEVIN_RUNNING_DETAIL.WAITING_FOR_USER]: SESSION_STATUS.WAITING,
  [DEVIN_RUNNING_DETAIL.WAITING_FOR_APPROVAL]: SESSION_STATUS.WAITING,
  [DEVIN_RUNNING_DETAIL.FINISHED]: SESSION_STATUS.WAITING,
};

/**
 * Where a forge's path stops naming the repository and starts naming the
 * request it holds: GitHub's `/pull/1`, Bitbucket's `/pull-requests/1`, and the
 * `/-/` GitLab puts before `merge_requests/1`.
 */
const PULL_REQUEST_PATH_SEGMENT = {
  GITHUB: "pull",
  GITLAB: "-",
  BITBUCKET: "pull-requests",
} as const;

const PULL_REQUEST_PATH_SEGMENTS: ReadonlySet<string> = new Set(
  Object.values(PULL_REQUEST_PATH_SEGMENT),
);

const DEVIN_ADAPTER_DEFAULTS = {
  /** The documented maximum, so one call covers as much of a day as it can. */
  SESSION_PAGE_SIZE: 200,
  MAXIMUM_OBSERVED_SESSIONS: 12,
} as const;

/**
 * Below this a reported timestamp cannot be milliseconds — it would be 1973 —
 * so it is seconds. Devin types both `created_at` and `updated_at` as integers
 * without naming the unit, and reading one as the other would place every
 * session either far in the past or far in the future.
 */
const EARLIEST_MILLISECOND_TIMESTAMP = 1e11;

export const DEVIN_PROVIDER: SessionProvider = {
  id: DEVIN_PROVIDER_ID,
  displayName: DEVIN_PROVIDER_NAME,
};

export interface DevinAdapterOptions extends CloudAdapterOptions {
  maximumObservedSessions?: number;
}

/** The person a credential belongs to, and the organization to read as them. */
interface DevinIdentity {
  userId: string;
  orgId: string;
}

interface DevinSession {
  id: string;
  /** What Devin named the session, which is what the row is labelled by. */
  name?: string;
  repository?: string;
  link?: string;
  pullRequest?: string;
  status: DevinSessionStatus | undefined;
  detail: DevinRunningDetail | undefined;
  archived: boolean;
  observedAt: number;
}

function millisecondsFromRecord(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return value < EARLIEST_MILLISECOND_TIMESTAMP ? value * 1000 : value;
}

/**
 * Devin reports the pull request a session opened rather than the repository it
 * opened it in, so the repository is the path segment in front of the request.
 */
function pullRequestUrl(record: Record<string, unknown>): string | undefined {
  const pullRequests = record[DEVIN_FIELD.PULL_REQUESTS];
  const first = Array.isArray(pullRequests) ? pullRequests[0] : undefined;
  return isRecord(first) ? textFromRecord(first, DEVIN_FIELD.PR_URL) : undefined;
}

function repositoryFromPullRequest(url: string | undefined): string | undefined {
  const segments = url?.split("/").filter(Boolean) ?? [];
  const request = segments.findIndex((segment) => PULL_REQUEST_PATH_SEGMENTS.has(segment));
  return request > 0 ? segments[request - 1] : undefined;
}

function sessionFromRecord(
  record: Record<string, unknown>,
  identity: DevinIdentity,
): DevinSession | undefined {
  const id = textFromRecord(record, DEVIN_FIELD.SESSION_ID);
  const observedAt = millisecondsFromRecord(record, DEVIN_FIELD.UPDATED_AT);
  if (!id || observedAt === undefined) return undefined;

  // The request already asked for this person's sessions, but a filter Luke
  // cannot see is not one it can answer for, and what it would be answering for
  // is a teammate's work in a personal sidecar.
  if (textFromRecord(record, DEVIN_FIELD.USER_ID) !== identity.userId) return undefined;

  const pullRequest = pullRequestUrl(record);
  const repository = repositoryFromPullRequest(pullRequest);
  const name = textFromRecord(record, DEVIN_FIELD.TITLE);
  const link = textFromRecord(record, DEVIN_FIELD.URL);
  return {
    id,
    observedAt,
    status: knownValue(DEVIN_SESSION_STATUS, textFromRecord(record, DEVIN_FIELD.STATUS)),
    detail: knownValue(DEVIN_RUNNING_DETAIL, textFromRecord(record, DEVIN_FIELD.STATUS_DETAIL)),
    archived: record[DEVIN_FIELD.IS_ARCHIVED] === true,
    ...(name ? { name } : {}),
    ...(repository ? { repository } : {}),
    ...(link ? { link } : {}),
    ...(pullRequest ? { pullRequest } : {}),
  };
}

/**
 * Observes Devin cloud sessions through the documented public v3 API. Devin
 * lists an organization's sessions rather than a credential owner's, so this
 * first asks Devin who the credential belongs to and then reads only that
 * person's sessions. Observation issues no request that can change provider
 * state, reports nothing at all without a credential, and reports nothing for
 * a service-user credential, which names an organization rather than a person.
 * The one write it supports is a user-typed message, through Devin's own
 * message endpoint, to a session it advertised as taking one.
 */
export class DevinSessionAdapter extends CloudSessionAdapter {
  readonly #maximumObservedSessions: number;

  /** The identity, or `null` once Devin has named one Luke cannot observe as. */
  #principal: DevinIdentity | null | undefined;

  constructor(options: DevinAdapterOptions) {
    super(
      {
        provider: DEVIN_PROVIDER,
        defaultBaseUrl: DEVIN_DEFAULT_API_URL,
        baseUrlEnvironmentVariable: DEVIN_ENVIRONMENT.API_URL,
      },
      options,
    );
    this.#maximumObservedSessions = positiveInteger(
      options.maximumObservedSessions,
      DEVIN_ADAPTER_DEFAULTS.MAXIMUM_OBSERVED_SESSIONS,
    );
  }

  protected override forgetCachedIdentity(): void {
    this.#principal = undefined;
  }

  protected async collect(
    request: CloudRequest,
    now: number,
  ): Promise<readonly ProviderSessionObservation[]> {
    const identity = await this.#identity(request);
    // A credential Luke cannot attribute to a person reads an organization's
    // work. It reports nothing rather than a teammate's.
    if (!identity) return [];

    return (await this.#listSessions(request, identity, now))
      .sort((first, second) => second.observedAt - first.observedAt)
      .slice(0, this.#maximumObservedSessions)
      .map((session) => this.#observationFor(session, now));
  }

  /**
   * Devin names the principal behind a credential, so unlike the email a v1
   * adapter would have had to be told, this is read from the credential itself
   * and cannot disagree with it.
   *
   * The answer is cached either way, so a credential Luke cannot observe as
   * costs one request rather than one every refresh for as long as it is
   * stored. The base clears the cache the moment the credential changes.
   */
  async #identity(request: CloudRequest): Promise<DevinIdentity | undefined> {
    if (this.#principal !== undefined) return this.#principal ?? undefined;
    const body = await request([DEVIN_ROUTE_SEGMENT.V3, DEVIN_ROUTE_SEGMENT.SELF]);
    const userId = textFromRecord(body, DEVIN_FIELD.USER_ID);
    // Devin leaves `org_id` off a token it places in no organization, and every
    // v3 session list is org-scoped — the only route that could name an
    // organization for a token is enterprise-admin. So a token like that has
    // nothing Luke can read, and asking again would not change that.
    const orgId = textFromRecord(body, DEVIN_FIELD.ORG_ID);
    const principal = textFromRecord(body, DEVIN_FIELD.PRINCIPAL_TYPE);
    this.#principal =
      principal === DEVIN_PRINCIPAL.PAT_USER && userId && orgId ? { userId, orgId } : null;
    return this.#principal ?? undefined;
  }

  /**
   * The whole pass after identity, in one request: a session record carries its
   * own state and timestamp, so unlike the other cloud providers Luke needs no
   * second request per session, and asking for one person's sessions inside the
   * observation window leaves a full page far past anything it would report.
   */
  async #listSessions(
    request: CloudRequest,
    identity: DevinIdentity,
    now: number,
  ): Promise<DevinSession[]> {
    const openedAt = now - CLOUD_ADAPTER_DEFAULTS.MAXIMUM_SESSION_AGE_MS;
    const body = await request(
      [
        DEVIN_ROUTE_SEGMENT.V3,
        DEVIN_ROUTE_SEGMENT.ORGANIZATIONS,
        identity.orgId,
        DEVIN_ROUTE_SEGMENT.SESSIONS,
      ],
      {
        [DEVIN_QUERY.FIRST]: String(DEVIN_ADAPTER_DEFAULTS.SESSION_PAGE_SIZE),
        [DEVIN_QUERY.USER_IDS]: identity.userId,
        // Seconds rather than milliseconds, and deliberately so: Devin types
        // this as an integer without naming the unit, and of the two ways to be
        // wrong, a value read as milliseconds only asks for more than the window
        // — which the filter below discards anyway — while one read as seconds
        // would sit in the far future and match nothing at all.
        [DEVIN_QUERY.UPDATED_AFTER]: String(Math.floor(openedAt / 1000)),
      },
    );

    return recordsFromPage(body, DEVIN_FIELD.ITEMS)
      .map((record) => sessionFromRecord(record, identity))
      .filter(isDefined)
      .filter((session) => session.observedAt >= openedAt);
  }

  /**
   * Devin's message endpoint takes a message for an active session and itself
   * resumes a suspended one, so both advertise it. A session that exited or
   * failed is documented for no writer, and an archived one the user has
   * already filed away — neither is offered a control Devin has not promised
   * to honour.
   */
  #sessionTakesMessages(session: DevinSession): boolean {
    return (
      !session.archived &&
      (session.status === DEVIN_SESSION_STATUS.RUNNING ||
        session.status === DEVIN_SESSION_STATUS.SUSPENDED)
    );
  }

  protected override messageRoute(
    providerSessionId: string,
    text: string,
  ): CloudWriteRoute | undefined {
    // The identity was learned when the session was observed, and only a
    // session that was observed can be messaged; no identity, no route.
    const identity = this.#principal;
    if (!identity) return undefined;
    return {
      segments: [
        DEVIN_ROUTE_SEGMENT.V3,
        DEVIN_ROUTE_SEGMENT.ORGANIZATIONS,
        identity.orgId,
        DEVIN_ROUTE_SEGMENT.SESSIONS,
        providerSessionId,
        DEVIN_ROUTE_SEGMENT.MESSAGES,
      ],
      body: { [DEVIN_MESSAGE_FIELD.MESSAGE]: text },
    };
  }

  #observationFor(session: DevinSession, now: number): ProviderSessionObservation {
    const status = this.#statusFor(session, now);
    return {
      providerSessionId: session.id,
      // What Devin named it, then where the work landed. The adapter reports
      // the fields and leaves the wording to the surface that draws them.
      title: session.name ?? session.repository ?? UNKNOWN_SESSION_LABEL,
      status,
      observedAt: session.observedAt,
      canReceiveMessage: this.#sessionTakesMessages(session),
      detail: {
        ...(session.repository ? { repository: session.repository } : {}),
        ...(status === SESSION_STATUS.ERROR ? { error: DEVIN_SESSION_FAILED_MESSAGE } : {}),
        ...(session.link ? { link: session.link } : {}),
        ...(session.pullRequest ? { change: session.pullRequest } : {}),
      },
    };
  }

  #statusFor(session: DevinSession, now: number): SessionStatus {
    // A session the user filed away is settled whatever it was doing.
    if (session.archived) return SESSION_STATUS.COMPLETE;
    // A state this build does not know is not guessed at.
    if (!session.status) return SESSION_STATUS.UNKNOWN;
    // The detail is what a live session is actually doing, and it is only
    // meaningful while one is running: for a suspended session Devin puts the
    // reason for the suspension there instead, which this build knows none of.
    const status =
      (session.status === DEVIN_SESSION_STATUS.RUNNING && session.detail
        ? SESSION_STATUS_BY_RUNNING_DETAIL[session.detail]
        : undefined) ?? SESSION_STATUS_BY_DEVIN_STATUS[session.status];
    // Devin reports live state, and its timestamp marks when that state was
    // entered rather than a heartbeat, so a long turn is still working and a
    // session that ended stays ended however long ago it did. Only a session
    // holding for the user decays: once it is stale Luke cannot tell a question
    // just asked from one the user walked away from hours ago.
    return status === SESSION_STATUS.WAITING
      ? this.statusWhileRecent(status, session.observedAt, now)
      : status;
  }
}
