import { CREDENTIAL_PROVIDER_ID, CREDENTIAL_PROVIDERS } from "@sidecar/credentials";
import {
  type ProviderSessionObservation,
  SESSION_STATUS,
  type SessionProvider,
  type SessionStatus,
} from "@sidecar/session";
import { isRecord, type WireRecord } from "@sidecar/wire";
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
} from "../shared/cloud-session-adapter.js";

// Shared with the credential registry so the key the user saves and the
// provider Luke observes with it can never name different things.
const REPLICAS_PROVIDER_ID = CREDENTIAL_PROVIDER_ID.REPLICAS;
const REPLICAS_PROVIDER_NAME = CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.REPLICAS].displayName;

/**
 * The one thing the list projection says about an errored workspace: setup or
 * wake failed and can be retried. There is no reason of its own to report, so
 * the state is the message.
 */
const REPLICAS_WORKSPACE_ERROR_MESSAGE = "The workspace failed to start or wake";

const REPLICAS_ENVIRONMENT = {
  API_URL: "REPLICAS_API_URL",
} as const;

const REPLICAS_DEFAULT_API_URL = "https://api.tryreplicas.com";

const REPLICAS_ROUTE_SEGMENT = {
  MESSAGES: "messages",
  REPLICA: "replica",
  V1: "v1",
} as const;

/**
 * The one read-only route Luke calls: the workspace list, which answers from
 * Replicas' own records without touching a workspace. The per-workspace reads
 * (`GET /v1/replica/{id}`, its chats, its history) are documented to *wake* a
 * sleeping or archived workspace — compute the user is billed for — so an
 * observation pass, which must be able to change nothing, never issues one,
 * and the roster carries only what the list projection reports.
 */
const REPLICAS_ROUTE = {
  REPLICAS: [REPLICAS_ROUTE_SEGMENT.V1, REPLICAS_ROUTE_SEGMENT.REPLICA],
} as const;

const REPLICAS_QUERY = {
  LIMIT: "limit",
} as const;

const REPLICAS_FIELD = {
  CREATED_AT: "created_at",
  ID: "id",
  LAST_ACTIVITY_AT: "last_activity_at",
  MESSAGE: "message",
  NAME: "name",
  REPLICAS: "replicas",
  REPOSITORIES: "repositories",
  STATUS: "status",
  URL: "url",
} as const;

const REPLICAS_STATUS = {
  PREPARING: "preparing",
  ACTIVE: "active",
  SLEEPING: "sleeping",
  ARCHIVED: "archived",
  ERROR: "error",
} as const;

type ReplicasStatus = (typeof REPLICAS_STATUS)[keyof typeof REPLICAS_STATUS];

/**
 * Replicas reports a workspace's compute lifecycle rather than a turn's state.
 * Preparing and active are the platform working on the user's behalf — setup,
 * a wake, or an agent mid-task — and Replicas itself retires a workspace that
 * has gone quiet, so active ends when the platform says the work stopped
 * rather than by a clock on this side. Sleeping and archived are both settled:
 * the work reached a pause nobody has come back from, which is what Copilot's
 * archived tasks report too. An errored workspace stopped on something it
 * cannot get past on its own. The projection never says a chat is holding for
 * the user, so no status maps to waiting rather than one pretending to.
 */
const SESSION_STATUS_BY_REPLICAS_STATUS = {
  [REPLICAS_STATUS.PREPARING]: SESSION_STATUS.WORKING,
  [REPLICAS_STATUS.ACTIVE]: SESSION_STATUS.WORKING,
  [REPLICAS_STATUS.SLEEPING]: SESSION_STATUS.COMPLETE,
  [REPLICAS_STATUS.ARCHIVED]: SESSION_STATUS.COMPLETE,
  [REPLICAS_STATUS.ERROR]: SESSION_STATUS.ERROR,
};

const REPLICAS_ADAPTER_DEFAULTS = {
  /** The documented maximum, so one call reaches as deep into the history as it can. */
  WORKSPACE_PAGE_SIZE: 100,
} as const;

export const REPLICAS_PROVIDER: SessionProvider = {
  id: REPLICAS_PROVIDER_ID,
  displayName: REPLICAS_PROVIDER_NAME,
};

export type ReplicasAdapterOptions = CloudAdapterOptions;

interface ReplicasWorkspace {
  id: string;
  repositoryLabel: string;
  status: ReplicasStatus | undefined;
  observedAt: number;
}

/**
 * A workspace binds every repository its environment holds; the first is the
 * label, the same one the dashboard leads with.
 */
function repositoryLabelFromRecord(record: WireRecord): string {
  const repositories = record[REPLICAS_FIELD.REPOSITORIES];
  const first = Array.isArray(repositories) ? repositories.filter(isRecord)[0] : undefined;
  return repositoryLabel(
    first ? textFromRecord(first, REPLICAS_FIELD.URL) : undefined,
    first ? textFromRecord(first, REPLICAS_FIELD.NAME) : undefined,
  );
}

function workspaceFromRecord(record: WireRecord): ReplicasWorkspace | undefined {
  const id = textFromRecord(record, REPLICAS_FIELD.ID);
  const observedAt =
    timestampFromRecord(record, REPLICAS_FIELD.LAST_ACTIVITY_AT) ??
    timestampFromRecord(record, REPLICAS_FIELD.CREATED_AT);
  if (!id || observedAt === undefined) return undefined;

  return {
    id,
    observedAt,
    // A workspace's `name` is derived from the opening task whenever the user
    // did not type one, so it is transcript content and there is deliberately
    // no fallback to it.
    repositoryLabel: repositoryLabelFromRecord(record),
    status: knownValue(REPLICAS_STATUS, textFromRecord(record, REPLICAS_FIELD.STATUS)),
  };
}

/**
 * Which statuses Replicas documents its message endpoint for: an active
 * workspace processes messages, and a sleeping one is documented to wake
 * automatically when interacted with — an act the user's own send performs
 * knowingly. An archived workspace would wake the same way, but archiving is
 * the user's own filing, and a message that silently unfiles a workspace is a
 * bigger act than the one asked for; a preparing or errored workspace's
 * message handling is documented nowhere. None of those is promised one.
 */
const REPLICAS_MESSAGEABLE_STATUSES: ReadonlySet<ReplicasStatus> = new Set([
  REPLICAS_STATUS.ACTIVE,
  REPLICAS_STATUS.SLEEPING,
]);

/**
 * Observes Replicas cloud workspaces through the documented Replica API. It
 * reads only the workspaces the supplied key's organization owns, observation
 * issues no request that can change provider state — including the
 * per-workspace reads Replicas documents as waking a sleeping workspace — and
 * it reports nothing at all without a credential. The one write it supports
 * is a user-typed message, through the documented message endpoint, for a
 * workspace whose status Replicas documents taking one.
 */
export class ReplicasSessionAdapter extends CloudSessionAdapter {
  constructor(options: ReplicasAdapterOptions) {
    super(
      {
        provider: REPLICAS_PROVIDER,
        defaultBaseUrl: REPLICAS_DEFAULT_API_URL,
        baseUrlEnvironmentVariable: REPLICAS_ENVIRONMENT.API_URL,
      },
      options,
    );
  }

  protected async collect(
    request: CloudRequest,
    _now: number,
  ): Promise<readonly ProviderSessionObservation[]> {
    // One call per pass. The list projection already carries the status, the
    // timestamps, and the repositories, so there is nothing a per-workspace
    // read would add that is worth waking a workspace for. Workspaces are
    // never capped — one page of the documented maximum is the request's only
    // bound — and the page arrives ordered by creation, so the sort below is
    // what puts the latest activity first.
    const body = await request(REPLICAS_ROUTE.REPLICAS, {
      [REPLICAS_QUERY.LIMIT]: String(REPLICAS_ADAPTER_DEFAULTS.WORKSPACE_PAGE_SIZE),
    });

    return recordsFromPage(body, REPLICAS_FIELD.REPLICAS)
      .map(workspaceFromRecord)
      .filter(isDefined)
      .sort((first, second) => second.observedAt - first.observedAt)
      .map((workspace) => this.#observationFor(workspace));
  }

  protected override messageRoute(
    providerSessionId: string,
    text: string,
  ): CloudWriteRoute | undefined {
    return {
      segments: [...REPLICAS_ROUTE.REPLICAS, providerSessionId, REPLICAS_ROUTE_SEGMENT.MESSAGES],
      body: { [REPLICAS_FIELD.MESSAGE]: text },
    };
  }

  #observationFor(workspace: ReplicasWorkspace): ProviderSessionObservation {
    const status = this.#statusFor(workspace);
    return {
      providerSessionId: workspace.id,
      // The provider is already on the row as its mark and in the context line,
      // so the title carries only what tells one Replicas workspace from
      // another.
      title: workspace.repositoryLabel,
      status,
      observedAt: workspace.observedAt,
      canReceiveMessage:
        workspace.status !== undefined && REPLICAS_MESSAGEABLE_STATUSES.has(workspace.status),
      detail: {
        repository: workspace.repositoryLabel,
        ...(status === SESSION_STATUS.ERROR
          ? { error: REPLICAS_WORKSPACE_ERROR_MESSAGE }
          : undefined),
        // Deliberately no link: the list projection reports no address of the
        // workspace's own, and an address composed here would not be one the
        // provider reported.
      },
    };
  }

  #statusFor(workspace: ReplicasWorkspace): SessionStatus {
    // A status this build does not know is not guessed at. Nothing here ages:
    // only waiting decays, and Replicas never reports a workspace as holding
    // for the user.
    if (!workspace.status) return SESSION_STATUS.UNKNOWN;
    return SESSION_STATUS_BY_REPLICAS_STATUS[workspace.status];
  }
}
