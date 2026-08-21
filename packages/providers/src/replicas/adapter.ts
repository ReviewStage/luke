import { CREDENTIAL_PROVIDER_ID, CREDENTIAL_PROVIDERS } from "@sidecar/credentials";
import {
  maximumSessionRecapLength,
  PROVIDER_ID,
  type ProviderSessionObservation,
  SESSION_APPLICATION_ID,
  SESSION_APPLICATION_SCOPE,
  SESSION_STATUS,
  type SessionProvider,
  type SessionStatus,
} from "@sidecar/session";
import { isRecord, type WireRecord } from "@sidecar/wire";
import {
  CLOUD_FAILURE,
  type CloudAdapterOptions,
  type CloudRequest,
  CloudRequestError,
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

/**
 * The dashboard's own address for one workspace, composed from the observed
 * id the way Conductor's deep link is: opening stays what every open is — an
 * address handed to the operating system, reaching no provider — and it
 * lands on the exact workspace the row is, never near it.
 */
const REPLICAS_WORKSPACE_LINK_BASE = "https://tryreplicas.com/home/workspace/";

function replicasWorkspaceLink(workspaceId: string): string {
  return `${REPLICAS_WORKSPACE_LINK_BASE}${encodeURIComponent(workspaceId)}`;
}

const REPLICAS_ROUTE_SEGMENT = {
  HISTORY: "history",
  MESSAGES: "messages",
  REPLICA: "replica",
  V1: "v1",
} as const;

/**
 * The reads Luke makes, and why each one cannot change provider state.
 * `GET /v1/replica` is the organization list the API guide itself walks
 * programmatic use through, answered from Replicas' own records without
 * touching a workspace. `GET /v1/replica/{id}/history` reads the retained
 * conversation from the end: its own documentation says a sleeping or
 * archived workspace answers from retention without waking, and the API
 * guide's engine-backed rule says the same read refuses with a conflict when
 * it cannot — an answer or a refusal, never a wake. The reads that *can*
 * wake a workspace (`GET /v1/replica/{id}` and its chats list) are never
 * issued, and the dashboard's own `GET /v1/workspaces` is not read either:
 * it is shaped around a signed-in viewer, and a key stands for the
 * organization rather than for a viewer, so what it answers a key is not the
 * roster the user sees.
 */
const REPLICAS_ROUTE = {
  REPLICAS: [REPLICAS_ROUTE_SEGMENT.V1, REPLICAS_ROUTE_SEGMENT.REPLICA],
} as const;

const REPLICAS_QUERY = {
  LIMIT: "limit",
} as const;

const REPLICAS_FIELD = {
  CODING_AGENT: "coding_agent",
  CONTENT: "content",
  CREATED_AT: "created_at",
  EVENTS: "events",
  ID: "id",
  LAST_ACTIVITY_AT: "last_activity_at",
  MESSAGE: "message",
  NAME: "name",
  PULL_REQUESTS: "pull_requests",
  REPLICAS: "replicas",
  REPOSITORIES: "repositories",
  ROLE: "role",
  STATUS: "status",
  TEXT: "text",
  TYPE: "type",
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
 * rather than by a clock on this side. Sleeping is settled: the work reached
 * a pause nobody has come back from. An errored workspace stopped on
 * something it cannot get past on its own. The projection never says a chat
 * is holding for the user, so no status maps to waiting rather than one
 * pretending to. Archived workspaces never reach this map: Replicas' own
 * dashboard hides them from the active list, so they stand behind no row.
 */
const SESSION_STATUS_BY_REPLICAS_STATUS = {
  [REPLICAS_STATUS.PREPARING]: SESSION_STATUS.WORKING,
  [REPLICAS_STATUS.ACTIVE]: SESSION_STATUS.WORKING,
  [REPLICAS_STATUS.SLEEPING]: SESSION_STATUS.COMPLETE,
  [REPLICAS_STATUS.ARCHIVED]: SESSION_STATUS.COMPLETE,
  [REPLICAS_STATUS.ERROR]: SESSION_STATUS.ERROR,
};

/**
 * The agent kinds Replicas names in its own vocabulary, each mapped to the
 * identity Luke already draws that agent's sessions under — the same four
 * words and identities Conductor's chats map, so an agent reports the same
 * whichever app hosts it. A kind outside this table (Replicas also runs
 * DeepSeek Harness, fx, Kimi Code, and Pi) rides the row's model slot in the
 * provider's own word instead, so it is not lost for lacking a mark.
 */
const REPLICAS_AGENT_KIND = {
  CLAUDE: "claude",
  CODEX: "codex",
  CURSOR: "cursor",
  OPENCODE: "opencode",
} as const;

type ReplicasAgentKind = (typeof REPLICAS_AGENT_KIND)[keyof typeof REPLICAS_AGENT_KIND];

const REPLICAS_AGENT_BY_KIND = {
  [REPLICAS_AGENT_KIND.CLAUDE]: { id: PROVIDER_ID.CLAUDE_CODE, displayName: "Claude Code" },
  [REPLICAS_AGENT_KIND.CODEX]: { id: PROVIDER_ID.CODEX, displayName: "Codex" },
  [REPLICAS_AGENT_KIND.CURSOR]: { id: PROVIDER_ID.CURSOR, displayName: "Cursor" },
  [REPLICAS_AGENT_KIND.OPENCODE]: { id: PROVIDER_ID.OPENCODE, displayName: "OpenCode" },
} as const satisfies Readonly<Record<ReplicasAgentKind, SessionProvider>>;

/**
 * The history event types this build can read a message out of. Replicas
 * streams each agent's events in that agent's own shape, and only the Claude
 * and Codex payloads are formally specified — the other families' documents
 * say their sub-shapes are not yet specified — so a recap is drawn from
 * these two and honestly refused for the rest rather than guessed at.
 */
const REPLICAS_EVENT_TYPE = {
  CLAUDE_ASSISTANT: "claude-assistant",
  /** Signals a Claude turn's completion: the parting words have parted. */
  CLAUDE_RESULT: "claude-result",
  CODEX_RESPONSE_ITEM: "response_item",
} as const;

/** The discriminants inside a Codex `response_item` that mark a text message. */
const REPLICAS_CODEX_ITEM = {
  MESSAGE: "message",
  ASSISTANT: "assistant",
  OUTPUT_TEXT: "output_text",
} as const;

/** The block type carrying prose inside a Claude SDK message. */
const REPLICAS_CLAUDE_BLOCK_TEXT = "text";

const REPLICAS_ADAPTER_DEFAULTS = {
  /** The documented maximum, so one call reaches as deep into the history as it can. */
  WORKSPACE_PAGE_SIZE: 100,
  /**
   * How many workspaces one pass will read retained history for: the newest
   * that could still say something. The cache below means a steady pass
   * re-reads only workspaces whose activity moved, so this bounds the burst,
   * not the steady state.
   */
  HISTORY_WORKSPACE_LIMIT: 12,
  /**
   * How far into the retained tail one read looks: enough to span the tool
   * chatter after the last message and reach the message itself.
   */
  HISTORY_EVENT_LIMIT: 40,
  MAXIMUM_AGENT_KIND_LENGTH: 40,
} as const;

export const REPLICAS_PROVIDER: SessionProvider = {
  id: REPLICAS_PROVIDER_ID,
  displayName: REPLICAS_PROVIDER_NAME,
};

export type ReplicasAdapterOptions = CloudAdapterOptions;

interface ReplicasWorkspace {
  id: string;
  name?: string;
  repositoryLabel: string;
  status: ReplicasStatus | undefined;
  observedAt: number;
  pullRequestUrl?: string;
}

/**
 * What one history read taught about a workspace, held until its activity
 * moves. `recapSettled` records whether the turn behind the parting words
 * actually completed — Claude's own result event says so — because whether
 * the words may be shown is decided per pass, where a workspace that has
 * since gone to sleep is settled however its turn ended.
 */
interface ReplicasHistoryEnrichment {
  observedAt: number;
  agent?: SessionProvider;
  agentKind?: string;
  recap?: string;
  recapSettled?: boolean;
}

/** The statuses whose retained history is worth a read at all. */
const REPLICAS_HISTORY_STATUSES: ReadonlySet<ReplicasStatus> = new Set([
  REPLICAS_STATUS.ACTIVE,
  REPLICAS_STATUS.SLEEPING,
]);

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

/**
 * The address of the newest pull request the workspace has opened. The list
 * reports every one; the last entry is reported here, and with one open — the
 * common case — there is no choice to make.
 */
function pullRequestUrlFromRecord(record: WireRecord): string | undefined {
  const pullRequests = record[REPLICAS_FIELD.PULL_REQUESTS];
  const last = Array.isArray(pullRequests) ? pullRequests.filter(isRecord).at(-1) : undefined;
  return last ? textFromRecord(last, REPLICAS_FIELD.URL) : undefined;
}

function workspaceFromRecord(record: WireRecord): ReplicasWorkspace | undefined {
  const id = textFromRecord(record, REPLICAS_FIELD.ID);
  const observedAt =
    timestampFromRecord(record, REPLICAS_FIELD.LAST_ACTIVITY_AT) ??
    timestampFromRecord(record, REPLICAS_FIELD.CREATED_AT);
  if (!id || observedAt === undefined) return undefined;

  const name = textFromRecord(record, REPLICAS_FIELD.NAME);
  const pullRequestUrl = pullRequestUrlFromRecord(record);
  return {
    id,
    observedAt,
    ...(name ? { name } : undefined),
    repositoryLabel: repositoryLabelFromRecord(record),
    status: knownValue(REPLICAS_STATUS, textFromRecord(record, REPLICAS_FIELD.STATUS)),
    ...(pullRequestUrl ? { pullRequestUrl } : undefined),
  };
}

/**
 * The prose of one assistant message, for the two agent families whose event
 * payloads Replicas formally specifies: a Claude assistant event carries the
 * SDK message's content blocks, and a Codex response item carries output
 * text. Every other family answers nothing here, so its chats keep the
 * honest absence of a recap rather than words guessed out of an unspecified
 * shape.
 */
function assistantTextFromEvent(event: WireRecord): string | undefined {
  const type = textFromRecord(event, REPLICAS_FIELD.TYPE);
  const payload = event.payload;
  if (!isRecord(payload)) return undefined;
  if (type === REPLICAS_EVENT_TYPE.CLAUDE_ASSISTANT) {
    const message = payload[REPLICAS_FIELD.MESSAGE];
    const content = isRecord(message) ? message[REPLICAS_FIELD.CONTENT] : undefined;
    if (!Array.isArray(content)) return undefined;
    const text = content
      .filter(isRecord)
      .filter((block) => textFromRecord(block, REPLICAS_FIELD.TYPE) === REPLICAS_CLAUDE_BLOCK_TEXT)
      .map((block) => textFromRecord(block, REPLICAS_FIELD.TEXT))
      .filter(isDefined)
      .join(" ");
    return text || undefined;
  }
  if (
    type === REPLICAS_EVENT_TYPE.CODEX_RESPONSE_ITEM &&
    textFromRecord(payload, REPLICAS_FIELD.TYPE) === REPLICAS_CODEX_ITEM.MESSAGE &&
    textFromRecord(payload, REPLICAS_FIELD.ROLE) === REPLICAS_CODEX_ITEM.ASSISTANT
  ) {
    const content = payload[REPLICAS_FIELD.CONTENT];
    if (!Array.isArray(content)) return undefined;
    const text = content
      .filter(isRecord)
      .filter(
        (item) => textFromRecord(item, REPLICAS_FIELD.TYPE) === REPLICAS_CODEX_ITEM.OUTPUT_TEXT,
      )
      .map((item) => textFromRecord(item, REPLICAS_FIELD.TEXT))
      .filter(isDefined)
      .join(" ");
    return text || undefined;
  }
  return undefined;
}

/** One line of bounded parting words, flattened the way every recap is drawn. */
function recapText(text: string): string | undefined {
  const flattened = text.replace(/\s+/g, " ").trim();
  return flattened ? flattened.slice(0, maximumSessionRecapLength) : undefined;
}

/**
 * What one retained-history read says about a workspace: which agent runs it,
 * and the last assistant message's parting words. The words are kept with
 * whether their turn actually completed — a Claude result event after them
 * says it did — because words read mid-turn are half a sentence posing as an
 * outcome, and only a settled workspace may show unclosed ones.
 */
function enrichmentFromHistory(body: WireRecord, observedAt: number): ReplicasHistoryEnrichment {
  const agentKind = textFromRecord(body, REPLICAS_FIELD.CODING_AGENT)?.slice(
    0,
    REPLICAS_ADAPTER_DEFAULTS.MAXIMUM_AGENT_KIND_LENGTH,
  );
  const mappedKind = knownValue(REPLICAS_AGENT_KIND, agentKind);

  let recap: string | undefined;
  let recapSettled = false;
  for (const event of recordsFromPage(body, REPLICAS_FIELD.EVENTS)) {
    const text = assistantTextFromEvent(event);
    if (text !== undefined) {
      recap = recapText(text);
      recapSettled = false;
      continue;
    }
    // The result closes the turn whose words are in hand — and only while it
    // stays the tail's last word: any event after it is the next turn already
    // moving, which makes the words in hand the previous turn's, not the
    // parting ones an active row may show.
    recapSettled =
      recap !== undefined &&
      textFromRecord(event, REPLICAS_FIELD.TYPE) === REPLICAS_EVENT_TYPE.CLAUDE_RESULT;
  }

  return {
    observedAt,
    ...(mappedKind ? { agent: REPLICAS_AGENT_BY_KIND[mappedKind] } : undefined),
    ...(agentKind && !mappedKind ? { agentKind } : undefined),
    ...(recap ? { recap, recapSettled } : undefined),
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
 * issues no request that can change provider state — the reads that can wake
 * a sleeping workspace are never issued, and the retained-history read
 * answers or refuses without waking — and it reports nothing at all without
 * a credential. The one write it supports is a user-typed message, through
 * the documented message endpoint, for a workspace whose status Replicas
 * documents taking one.
 *
 * Replicas is a workspace app hosting agents rather than an agent: a
 * workspace's chats run Claude Code, Codex, Cursor, and others, the way
 * Conductor's do. The row is the workspace all the same — the thing Replicas
 * itself lists, statuses, sleeps, and bills — titled by the workspace's own
 * name, the standing identity its dashboard, Slack, and Linear all reference,
 * and marked with the agent the retained history names as running it.
 */
export class ReplicasSessionAdapter extends CloudSessionAdapter {
  /**
   * What the last history read said, per workspace, keyed to the activity
   * timestamp it was read at: a workspace that has not moved is not re-read,
   * so a steady pass costs the list call alone. A failed read leaves the
   * previous entry standing and is simply asked again next pass — a refusal
   * says nothing about the conversation.
   */
  #historyByWorkspace = new Map<string, ReplicasHistoryEnrichment>();

  /**
   * Whether the history endpoint refused this credential outright. The list
   * already answered under the same key, so the refusal is that endpoint's
   * answer about itself, never a judgment on the key — but it will answer the
   * same way next pass, so the enrichment stands down for the credential's
   * lifetime instead of asking a dozen refused questions every fifteen
   * seconds. The rows keep everything the list carries.
   */
  #historyRefused = false;

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

  protected override forgetCachedIdentity(): void {
    this.#historyByWorkspace.clear();
    this.#historyRefused = false;
  }

  protected async collect(
    request: CloudRequest,
    _now: number,
  ): Promise<readonly ProviderSessionObservation[]> {
    // One list call, then one bounded history read per workspace whose
    // activity moved. The list projection carries the status, the timestamps,
    // the repositories, and the pull requests; the retained history adds the
    // agent and the parting words. Workspaces are never capped — one page of
    // the documented maximum is the request's only bound — and the page
    // arrives ordered by creation, so the sort below is what puts the latest
    // activity first.
    const body = await request(REPLICAS_ROUTE.REPLICAS, {
      [REPLICAS_QUERY.LIMIT]: String(REPLICAS_ADAPTER_DEFAULTS.WORKSPACE_PAGE_SIZE),
    });

    const workspaces = recordsFromPage(body, REPLICAS_FIELD.REPLICAS)
      .map(workspaceFromRecord)
      .filter(isDefined)
      // An archived workspace is one the user (or their own retention policy)
      // filed away, and Replicas' own dashboard hides it from the active
      // list, so it stands behind no row here either.
      .filter((workspace) => workspace.status !== REPLICAS_STATUS.ARCHIVED)
      .sort((first, second) => second.observedAt - first.observedAt);

    await this.#refreshHistories(request, workspaces);
    return workspaces.map((workspace) => this.#observationFor(workspace));
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

  /**
   * Reads the retained history of the newest workspaces whose activity moved
   * since it was last read. Bounded twice — how many workspaces one pass will
   * read, and how far into each tail — and every failure is contained here,
   * the unauthorized one included: the list already answered under this
   * credential, so a history refusal is that endpoint's answer about itself,
   * and an enrichment must never be able to clear the roster the list just
   * served. A workspace whose history is refused (sleeping on an engine from
   * before retention) costs its own enrichment and nothing else's.
   */
  async #refreshHistories(
    request: CloudRequest,
    workspaces: readonly ReplicasWorkspace[],
  ): Promise<void> {
    if (this.#historyRefused) return;
    const listed = new Set(workspaces.map((workspace) => workspace.id));
    for (const id of this.#historyByWorkspace.keys()) {
      if (!listed.has(id)) this.#historyByWorkspace.delete(id);
    }

    const stale = workspaces
      .filter((workspace) => workspace.status && REPLICAS_HISTORY_STATUSES.has(workspace.status))
      .filter(
        (workspace) =>
          this.#historyByWorkspace.get(workspace.id)?.observedAt !== workspace.observedAt,
      )
      .slice(0, REPLICAS_ADAPTER_DEFAULTS.HISTORY_WORKSPACE_LIMIT);

    await Promise.all(
      stale.map(async (workspace) => {
        let body: WireRecord;
        try {
          body = await request(
            [...REPLICAS_ROUTE.REPLICAS, workspace.id, REPLICAS_ROUTE_SEGMENT.HISTORY],
            { [REPLICAS_QUERY.LIMIT]: String(REPLICAS_ADAPTER_DEFAULTS.HISTORY_EVENT_LIMIT) },
          );
        } catch (error) {
          // A parsing bug is not a provider answer and must not hide here.
          if (!(error instanceof CloudRequestError)) throw error;
          if (error.failure === CLOUD_FAILURE.UNAUTHORIZED) this.#historyRefused = true;
          return;
        }
        this.#historyByWorkspace.set(
          workspace.id,
          enrichmentFromHistory(body, workspace.observedAt),
        );
      }),
    );
  }

  #observationFor(workspace: ReplicasWorkspace): ProviderSessionObservation {
    const status = this.#statusFor(workspace);
    const history = this.#historyByWorkspace.get(workspace.id);
    // The parting words are a recap only once the turn has actually parted:
    // Claude's own result event says a turn completed, and a workspace asleep
    // is settled however its turn ended. Words without either are mid-turn,
    // and a half sentence posing as an outcome is worse than none.
    const recap =
      history?.recap && (history.recapSettled || workspace.status === REPLICAS_STATUS.SLEEPING)
        ? history.recap
        : undefined;
    return {
      providerSessionId: workspace.id,
      // The workspace's own name titles the row — the identity the dashboard
      // lists and Slack and Linear reference — with the repository for a
      // name the list did not carry. The opening task itself still never
      // travels: a generated name is the same slug identity a Conductor
      // workspace wears, not the task's own words.
      title: workspace.name ?? workspace.repositoryLabel,
      status,
      observedAt: workspace.observedAt,
      canReceiveMessage:
        workspace.status !== undefined && REPLICAS_MESSAGEABLE_STATUSES.has(workspace.status),
      ...(history?.agent ? { agent: history.agent } : undefined),
      ...(recap ? { recap } : undefined),
      // The Replicas mark rides as an app association like every other app
      // holding a chat — the row leads with the agent the history names, and
      // the app chip says where it runs — carrying the same exact address the
      // row opens with, so the one glyph means the same thing here and on a
      // Conductor row.
      applications: [
        {
          id: SESSION_APPLICATION_ID.REPLICAS,
          displayName: REPLICAS_PROVIDER_NAME,
          scope: SESSION_APPLICATION_SCOPE.SESSION,
          link: replicasWorkspaceLink(workspace.id),
        },
      ],
      detail: {
        repository: workspace.repositoryLabel,
        // An agent kind this build has no identity for rides the model slot
        // in the provider's own word, the way Conductor's unmapped kinds do,
        // so it is not lost for lacking a mark.
        ...(history?.agentKind ? { model: history.agentKind } : undefined),
        // The work the workspace has published, exactly as Devin and Cursor
        // report theirs: the pull request's own address.
        ...(workspace.pullRequestUrl ? { change: workspace.pullRequestUrl } : undefined),
        ...(status === SESSION_STATUS.ERROR
          ? { error: REPLICAS_WORKSPACE_ERROR_MESSAGE }
          : undefined),
        link: replicasWorkspaceLink(workspace.id),
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
