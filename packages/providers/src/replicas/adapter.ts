import { CREDENTIAL_PROVIDER_ID, CREDENTIAL_PROVIDERS } from "@sidecar/credentials";
import {
  maximumSessionRecapLength,
  PROVIDER_ID,
  type ProviderSessionObservation,
  SESSION_APPLICATION_ID,
  SESSION_APPLICATION_SCOPE,
  SESSION_STATUS,
  type SessionApplication,
  type SessionDetail,
  type SessionProvider,
  type SessionStatus,
  type SessionWorkspace,
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
 * lands on the exact workspace the row is. A chat row carries the same
 * address, because the workspace page is where Replicas itself opens every
 * chat the workspace holds, and Replicas documents no narrower address.
 */
const REPLICAS_WORKSPACE_LINK_BASE = "https://tryreplicas.com/home/workspace/";

function replicasWorkspaceLink(workspaceId: string): string {
  return `${REPLICAS_WORKSPACE_LINK_BASE}${encodeURIComponent(workspaceId)}`;
}

const REPLICAS_ROUTE_SEGMENT = {
  CONVERSATIONS: "conversations",
  HISTORY: "history",
  MESSAGES: "messages",
  ORGANIZATION: "organization",
  REPLICA: "replica",
  V1: "v1",
} as const;

/**
 * The reads Luke makes, and why each one cannot change provider state.
 * `GET /v1/replica` is the organization list the API guide itself walks
 * programmatic use through, answered from Replicas' own records without
 * touching a workspace. `GET /v1/organization/conversations` is documented
 * outright as answering "without waking workspaces", from the same records.
 * `GET /v1/replica/{id}/history` reads the retained conversation from the
 * end: its own documentation says a sleeping or archived workspace answers
 * from retention without waking, and the API guide's engine-backed rule says
 * the same read refuses with a conflict when it cannot — an answer or a
 * refusal, never a wake. The reads that *can* wake a workspace
 * (`GET /v1/replica/{id}` and its chats list) are never issued, and the
 * dashboard's own `GET /v1/workspaces` is not read either: it is shaped
 * around a signed-in viewer, and a key stands for the organization rather
 * than for a viewer, so what it answers a key is not the roster the user
 * sees.
 */
const REPLICAS_ROUTE = {
  REPLICAS: [REPLICAS_ROUTE_SEGMENT.V1, REPLICAS_ROUTE_SEGMENT.REPLICA],
  CONVERSATIONS: [
    REPLICAS_ROUTE_SEGMENT.V1,
    REPLICAS_ROUTE_SEGMENT.ORGANIZATION,
    REPLICAS_ROUTE_SEGMENT.CONVERSATIONS,
  ],
} as const;

const REPLICAS_QUERY = {
  CHAT_ID: "chat_id",
  LIMIT: "limit",
  WORKSPACE_ID: "workspace_id",
} as const;

const REPLICAS_FIELD = {
  CHAT_ID: "chat_id",
  CODING_AGENT: "coding_agent",
  CONTENT: "content",
  CONVERSATIONS: "conversations",
  CREATED_AT: "created_at",
  EVENTS: "events",
  ID: "id",
  LAST_ACTIVITY_AT: "last_activity_at",
  MESSAGE: "message",
  NAME: "name",
  PARENT_CHAT_ID: "parent_chat_id",
  PROVIDER: "provider",
  PULL_REQUESTS: "pull_requests",
  REPLICAS: "replicas",
  REPOSITORIES: "repositories",
  ROLE: "role",
  STATUS: "status",
  TEXT: "text",
  TITLE: "title",
  TYPE: "type",
  UPDATED_AT: "updated_at",
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

/**
 * Every event family Replicas documents wears its agent on the event type
 * itself: each family's types are documented as prefixed with the agent's
 * own word, and Codex's two types are the only unprefixed ones. So even when
 * `coding_agent` answers null — it names the *currently active* agent, and a
 * settled workspace may have none — the newest retained event still says
 * whose conversation this is, read from the documented discriminator rather
 * than guessed.
 */
const REPLICAS_EVENT_KIND_PREFIXES = [
  ["claude-", REPLICAS_AGENT_KIND.CLAUDE],
  ["codex-", REPLICAS_AGENT_KIND.CODEX],
  ["cursor-", REPLICAS_AGENT_KIND.CURSOR],
  ["deepseek-", "deepseek"],
  ["fx-", "fx"],
  ["opencode-", REPLICAS_AGENT_KIND.OPENCODE],
  ["pi-", "pi"],
] as const satisfies readonly (readonly [string, string])[];

/** Codex streams the only unprefixed event types Replicas documents. */
const REPLICAS_CODEX_EVENT_TYPES: ReadonlySet<string> = new Set([
  "event_msg",
  REPLICAS_EVENT_TYPE.CODEX_RESPONSE_ITEM,
]);

/**
 * ACP events are the one family whose agent is not in the type: fx and Kimi
 * Code both stream `acp-*` events, and the payload's own `provider` field is
 * documented to say which.
 */
const REPLICAS_ACP_EVENT_PREFIX = "acp-";
const REPLICAS_ACP_PROVIDER_FIELD = "provider";

const REPLICAS_ADAPTER_DEFAULTS = {
  /** The documented maximum, so one call reaches as deep into the history as it can. */
  WORKSPACE_PAGE_SIZE: 100,
  /**
   * How many workspaces one pass will read chats and retained history for:
   * the newest that could still say something. The caches below mean a
   * steady pass re-reads only workspaces whose activity moved, so this
   * bounds the burst, not the steady state.
   */
  ENRICHED_WORKSPACE_LIMIT: 12,
  /** How many chats one workspace's rows will carry. */
  CHAT_LIMIT: 20,
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

/** One chat the conversations read listed inside a workspace. */
interface ReplicasChat {
  id: string;
  agentKind?: string;
  title?: string;
  observedAt: number;
}

/** The chats one workspace held when its activity last moved. */
interface ReplicasChatSnapshot {
  observedAt: number;
  /** Newest first, which is what seats the workspace's status on the right chat. */
  chats: readonly ReplicasChat[];
}

/**
 * What one history read taught about a workspace, held until its activity
 * moves. `recapSettled` records whether the turn behind the parting words
 * actually completed — Claude's own result event says so — because whether
 * the words may be shown is decided per pass, where a workspace that has
 * since gone to sleep is settled however its turn ended. An entry with
 * nothing in it is a read that was refused, kept so the same refusal is not
 * asked for again until the workspace moves.
 */
interface ReplicasHistoryEnrichment {
  observedAt: number;
  agent?: SessionProvider;
  agentKind?: string;
  recap?: string;
  recapSettled?: boolean;
}

/** The statuses whose chats and retained history are worth a read at all. */
const REPLICAS_ENRICHABLE_STATUSES: ReadonlySet<ReplicasStatus> = new Set([
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
 * One chat from the conversations read. A spawned sub-agent's chat is skipped
 * the way the local adapters skip subagent sessions: its work is the parent
 * chat's, and a row for it would double what one conversation did.
 */
function chatFromRecord(record: WireRecord): ReplicasChat | undefined {
  const id = textFromRecord(record, REPLICAS_FIELD.CHAT_ID);
  const observedAt =
    timestampFromRecord(record, REPLICAS_FIELD.UPDATED_AT) ??
    timestampFromRecord(record, REPLICAS_FIELD.CREATED_AT);
  if (!id || observedAt === undefined) return undefined;
  if (textFromRecord(record, REPLICAS_FIELD.PARENT_CHAT_ID)) return undefined;

  const agentKind = textFromRecord(record, REPLICAS_FIELD.PROVIDER)?.slice(
    0,
    REPLICAS_ADAPTER_DEFAULTS.MAXIMUM_AGENT_KIND_LENGTH,
  );
  const title = textFromRecord(record, REPLICAS_FIELD.TITLE);
  return {
    id,
    observedAt,
    ...(agentKind ? { agentKind } : undefined),
    ...(title ? { title } : undefined),
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
 * The agent family of one retained event, from the documented discriminator:
 * the type's own agent prefix, Codex's two unprefixed types, or the provider
 * an ACP event's payload names. An event this build cannot place answers
 * nothing rather than a guess.
 */
function agentKindFromEvent(event: WireRecord): string | undefined {
  const type = textFromRecord(event, REPLICAS_FIELD.TYPE);
  if (!type) return undefined;
  if (REPLICAS_CODEX_EVENT_TYPES.has(type)) return REPLICAS_AGENT_KIND.CODEX;
  if (type.startsWith(REPLICAS_ACP_EVENT_PREFIX)) {
    const payload = event.payload;
    return isRecord(payload)
      ? textFromRecord(payload, REPLICAS_ACP_PROVIDER_FIELD)?.slice(
          0,
          REPLICAS_ADAPTER_DEFAULTS.MAXIMUM_AGENT_KIND_LENGTH,
        )
      : undefined;
  }
  return REPLICAS_EVENT_KIND_PREFIXES.find(([prefix]) => type.startsWith(prefix))?.[1];
}

function enrichmentFromHistory(body: WireRecord, observedAt: number): ReplicasHistoryEnrichment {
  const events = recordsFromPage(body, REPLICAS_FIELD.EVENTS);
  // The provider's own word wins when it gives one; `coding_agent` names the
  // *currently active* agent, so a settled workspace answers null, and the
  // newest placeable event says whose conversation this is instead.
  const agentKind =
    textFromRecord(body, REPLICAS_FIELD.CODING_AGENT)?.slice(
      0,
      REPLICAS_ADAPTER_DEFAULTS.MAXIMUM_AGENT_KIND_LENGTH,
    ) ?? events.map(agentKindFromEvent).filter(isDefined).at(-1);
  const mappedKind = knownValue(REPLICAS_AGENT_KIND, agentKind);

  let recap: string | undefined;
  let recapSettled = false;
  for (const event of events) {
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
 * reads only what the supplied key can see, observation issues no request
 * that can change provider state — the reads that can wake a sleeping
 * workspace are never issued, and the chats and retained-history reads
 * answer or refuse without waking — and it reports nothing at all without a
 * credential. The one write it supports is a user-typed message, through the
 * documented message endpoint, for a chat or workspace whose status Replicas
 * documents taking one.
 *
 * Replicas is a workspace app hosting agents rather than an agent: a
 * workspace holds chats running Claude Code, Codex, Cursor, and others, the
 * way Conductor's does. With an organization key, the documented
 * conversations read lists those chats without waking anything, and the rows
 * are the chats — each led by its own agent, grouped under the workspace,
 * with the Replicas mark riding as the app. The conversations read answers
 * organization keys alone, so under a personal key the workspace itself is
 * the row, its agent read from the retained history's own events, and the
 * honest coarseness stands rather than a guessed chat list.
 */
export class ReplicasSessionAdapter extends CloudSessionAdapter {
  /**
   * The chats each workspace held, keyed to the activity timestamp they were
   * read at: a workspace that has not moved is not re-read, so a steady pass
   * costs the list call alone.
   */
  #chatsByWorkspace = new Map<string, ReplicasChatSnapshot>();

  /**
   * What the last history read said, per workspace, on the same key. An
   * unauthorized answer leaves an empty entry — that workspace's history is
   * not this key's to read, and asking again before it moves would get the
   * same refusal — while a transient failure leaves no entry, so the next
   * pass simply asks again. Contained per workspace on purpose: the list
   * already answered under this credential, so no history refusal is a
   * judgment on the key, and none may clear the roster the list just served.
   */
  #historyByWorkspace = new Map<string, ReplicasHistoryEnrichment>();

  /**
   * Whether the conversations read refused this credential. It is documented
   * for organization keys alone, so under a personal key it answers the same
   * refusal every time; the chat listing stands down for the credential's
   * lifetime instead of asking a refused question every pass, and the
   * workspace-level rows stand.
   */
  #conversationsRefused = false;

  /**
   * Which workspace each observed chat row belongs to, rebuilt every pass. A
   * message to a chat travels through its workspace's documented message
   * endpoint with the chat named in the body, so the route needs the pair —
   * and only ids the latest pass actually emitted are ever in it.
   */
  #workspaceByChat = new Map<string, string>();

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
    this.#chatsByWorkspace.clear();
    this.#historyByWorkspace.clear();
    this.#conversationsRefused = false;
    this.#workspaceByChat.clear();
  }

  protected async collect(
    request: CloudRequest,
    _now: number,
  ): Promise<readonly ProviderSessionObservation[]> {
    // One list call, then bounded chats and history reads per workspace whose
    // activity moved. The list projection carries the status, the timestamps,
    // the repositories, and the pull requests; the conversations read adds
    // the chats and their agents; the retained history adds the parting
    // words. Workspaces are never capped — one page of the documented maximum
    // is the request's only bound — and the page arrives ordered by creation,
    // so the sort below is what puts the latest activity first.
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

    const stale = workspaces
      .filter((workspace) => workspace.status && REPLICAS_ENRICHABLE_STATUSES.has(workspace.status))
      .slice(0, REPLICAS_ADAPTER_DEFAULTS.ENRICHED_WORKSPACE_LIMIT);
    this.#pruneCaches(workspaces);
    await this.#refreshChats(request, stale);
    await this.#refreshHistories(request, stale);

    this.#workspaceByChat.clear();
    return workspaces.flatMap((workspace) => this.#observationsFor(workspace));
  }

  protected override messageRoute(
    providerSessionId: string,
    text: string,
  ): CloudWriteRoute | undefined {
    // A chat row's message travels through its workspace's documented
    // endpoint with the chat named in the body; a workspace row's names none
    // and lands on the workspace's own default chat.
    const chatWorkspaceId = this.#workspaceByChat.get(providerSessionId);
    return {
      segments: [
        ...REPLICAS_ROUTE.REPLICAS,
        chatWorkspaceId ?? providerSessionId,
        REPLICAS_ROUTE_SEGMENT.MESSAGES,
      ],
      body: {
        [REPLICAS_FIELD.MESSAGE]: text,
        ...(chatWorkspaceId ? { [REPLICAS_FIELD.CHAT_ID]: providerSessionId } : undefined),
      },
    };
  }

  #pruneCaches(workspaces: readonly ReplicasWorkspace[]): void {
    const listed = new Set(workspaces.map((workspace) => workspace.id));
    for (const id of this.#historyByWorkspace.keys()) {
      if (!listed.has(id)) this.#historyByWorkspace.delete(id);
    }
    for (const id of this.#chatsByWorkspace.keys()) {
      if (!listed.has(id)) this.#chatsByWorkspace.delete(id);
    }
  }

  /**
   * Lists the chats of the workspaces whose activity moved, through the
   * documented conversations read — "without waking workspaces", in its own
   * words. A refusal stands the listing down for the credential's lifetime:
   * the read answers organization keys alone, and a personal key would be
   * refused identically every pass.
   */
  async #refreshChats(request: CloudRequest, stale: readonly ReplicasWorkspace[]): Promise<void> {
    if (this.#conversationsRefused) return;
    await Promise.all(
      stale
        .filter(
          (workspace) =>
            this.#chatsByWorkspace.get(workspace.id)?.observedAt !== workspace.observedAt,
        )
        .map(async (workspace) => {
          let body: WireRecord;
          try {
            body = await request(REPLICAS_ROUTE.CONVERSATIONS, {
              [REPLICAS_QUERY.WORKSPACE_ID]: workspace.id,
              [REPLICAS_QUERY.LIMIT]: String(REPLICAS_ADAPTER_DEFAULTS.CHAT_LIMIT),
            });
          } catch (error) {
            // A parsing bug is not a provider answer and must not hide here.
            if (!(error instanceof CloudRequestError)) throw error;
            if (error.failure === CLOUD_FAILURE.UNAUTHORIZED) this.#conversationsRefused = true;
            return;
          }
          const chats = recordsFromPage(body, REPLICAS_FIELD.CONVERSATIONS)
            .map(chatFromRecord)
            .filter(isDefined)
            .sort((first, second) => second.observedAt - first.observedAt)
            .slice(0, REPLICAS_ADAPTER_DEFAULTS.CHAT_LIMIT);
          this.#chatsByWorkspace.set(workspace.id, { observedAt: workspace.observedAt, chats });
        }),
    );
  }

  /**
   * Reads the retained history of the workspaces whose activity moved since
   * it was last read — pinned to the newest chat when the chats are known,
   * so the parting words are attributably that chat's. Every failure is
   * contained here: a workspace whose history is refused (not this key's to
   * read, or sleeping on an engine from before retention) costs its own
   * enrichment and nothing else's, and is not asked again until it moves.
   */
  async #refreshHistories(
    request: CloudRequest,
    stale: readonly ReplicasWorkspace[],
  ): Promise<void> {
    await Promise.all(
      stale
        .filter(
          (workspace) =>
            this.#historyByWorkspace.get(workspace.id)?.observedAt !== workspace.observedAt,
        )
        .map(async (workspace) => {
          const newestChat = this.#chatsByWorkspace.get(workspace.id)?.chats[0];
          let body: WireRecord;
          try {
            body = await request(
              [...REPLICAS_ROUTE.REPLICAS, workspace.id, REPLICAS_ROUTE_SEGMENT.HISTORY],
              {
                ...(newestChat ? { [REPLICAS_QUERY.CHAT_ID]: newestChat.id } : undefined),
                [REPLICAS_QUERY.LIMIT]: String(REPLICAS_ADAPTER_DEFAULTS.HISTORY_EVENT_LIMIT),
              },
            );
          } catch (error) {
            // A parsing bug is not a provider answer and must not hide here.
            if (!(error instanceof CloudRequestError)) throw error;
            if (error.failure === CLOUD_FAILURE.UNAUTHORIZED) {
              this.#historyByWorkspace.set(workspace.id, { observedAt: workspace.observedAt });
            }
            return;
          }
          this.#historyByWorkspace.set(
            workspace.id,
            enrichmentFromHistory(body, workspace.observedAt),
          );
        }),
    );
  }

  /**
   * The rows one workspace stands behind: its chats when the conversations
   * read listed any, the workspace itself otherwise — a workspace with no
   * readable chats still holds work, and a roster that dropped it would
   * report less than the list said.
   */
  #observationsFor(workspace: ReplicasWorkspace): ProviderSessionObservation[] {
    const chats = this.#chatsByWorkspace.get(workspace.id)?.chats ?? [];
    if (chats.length === 0) return [this.#workspaceObservation(workspace)];
    for (const chat of chats) this.#workspaceByChat.set(chat.id, workspace.id);
    return chats.map((chat, index) => this.#chatObservation(workspace, chat, index === 0));
  }

  #workspaceObservation(workspace: ReplicasWorkspace): ProviderSessionObservation {
    const status = this.#statusFor(workspace);
    const history = this.#historyByWorkspace.get(workspace.id);
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
      canReceiveMessage: this.#canReceiveMessage(workspace),
      ...(history?.agent ? { agent: history.agent } : undefined),
      ...this.#recapFor(workspace),
      applications: this.#applicationsFor(workspace),
      detail: {
        repository: workspace.repositoryLabel,
        // An agent kind this build has no identity for rides the model slot
        // in the provider's own word, the way Conductor's unmapped kinds do,
        // so it is not lost for lacking a mark.
        ...(history?.agentKind ? { model: history.agentKind } : undefined),
        ...this.#sharedDetail(workspace, status),
      },
    };
  }

  /**
   * One chat's row. The workspace's compute lifecycle is the newest chat's
   * status — the activity the platform reports is wherever the latest words
   * landed — while an older chat's turn ended back at its own timestamp, so
   * it reads as settled rather than borrowing work that is not its own.
   */
  #chatObservation(
    workspace: ReplicasWorkspace,
    chat: ReplicasChat,
    newest: boolean,
  ): ProviderSessionObservation {
    const status = newest ? this.#statusFor(workspace) : SESSION_STATUS.COMPLETE;
    const history = newest ? this.#historyByWorkspace.get(workspace.id) : undefined;
    // The chat's own agent is the conversations read's word — a stored fact,
    // not the engine's "currently active" answer. The history's derived kind
    // stands in only where the listing gave none, and only on the newest
    // chat, whose conversation the history read was pinned to: another
    // chat's agent must never bleed onto this row.
    const mappedListed = knownValue(REPLICAS_AGENT_KIND, chat.agentKind);
    const agent = chat.agentKind
      ? mappedListed && REPLICAS_AGENT_BY_KIND[mappedListed]
      : history?.agent;
    const unmappedKind = chat.agentKind
      ? mappedListed
        ? undefined
        : chat.agentKind
      : history?.agentKind;
    return {
      providerSessionId: chat.id,
      // The chat's own title leads, the way a Conductor chat's name does;
      // the workspace's name rides the grouping below and names all of its
      // chats at once.
      title: chat.title ?? workspace.name ?? workspace.repositoryLabel,
      status,
      observedAt: chat.observedAt,
      canReceiveMessage: this.#canReceiveMessage(workspace),
      ...(agent ? { agent } : undefined),
      ...(newest ? this.#recapFor(workspace) : undefined),
      // The workspace this chat is one voice of, so several chats gather
      // under one tray carrying the Replicas mark once, the way Conductor's
      // and Superset's workspaces gather theirs.
      workspace: this.#workspaceGrouping(workspace),
      applications: this.#applicationsFor(workspace),
      detail: {
        repository: workspace.repositoryLabel,
        ...(unmappedKind ? { model: unmappedKind } : undefined),
        // The pull request and a wake failure are the workspace's facts, so
        // they ride its newest chat once rather than every row repeating
        // them; the address is every chat's, because the workspace page is
        // where each one is read.
        ...(newest ? this.#sharedDetail(workspace, status) : undefined),
        link: replicasWorkspaceLink(workspace.id),
      },
    };
  }

  /** The recap fields a row may carry, or nothing while the words are mid-turn. */
  #recapFor(workspace: ReplicasWorkspace): { recap: string } | undefined {
    const history = this.#historyByWorkspace.get(workspace.id);
    // The parting words are a recap only once the turn has actually parted:
    // Claude's own result event says a turn completed, and a workspace asleep
    // is settled however its turn ended. Words without either are mid-turn,
    // and a half sentence posing as an outcome is worse than none.
    return history?.recap && (history.recapSettled || workspace.status === REPLICAS_STATUS.SLEEPING)
      ? { recap: history.recap }
      : undefined;
  }

  #canReceiveMessage(workspace: ReplicasWorkspace): boolean {
    return workspace.status !== undefined && REPLICAS_MESSAGEABLE_STATUSES.has(workspace.status);
  }

  #workspaceGrouping(workspace: ReplicasWorkspace): SessionWorkspace {
    return {
      providerWorkspaceId: workspace.id,
      name: workspace.name ?? workspace.repositoryLabel,
      scopeId: REPLICAS_PROVIDER_ID,
      managerName: REPLICAS_PROVIDER_NAME,
    };
  }

  /**
   * The Replicas mark rides as an app association like every other app
   * holding a chat — the row leads with the agent, and the app chip says
   * where it runs — carrying the same exact address the row opens with, so
   * the one glyph means the same thing here and on a Conductor row.
   */
  #applicationsFor(workspace: ReplicasWorkspace): SessionApplication[] {
    return [
      {
        id: SESSION_APPLICATION_ID.REPLICAS,
        displayName: REPLICAS_PROVIDER_NAME,
        scope: SESSION_APPLICATION_SCOPE.SESSION,
        link: replicasWorkspaceLink(workspace.id),
      },
    ];
  }

  /** The workspace-level facts every kind of row reports the same way. */
  #sharedDetail(workspace: ReplicasWorkspace, status: SessionStatus): Partial<SessionDetail> {
    return {
      // The work the workspace has published, exactly as Devin and Cursor
      // report theirs: the pull request's own address.
      ...(workspace.pullRequestUrl ? { change: workspace.pullRequestUrl } : undefined),
      ...(status === SESSION_STATUS.ERROR
        ? { error: REPLICAS_WORKSPACE_ERROR_MESSAGE }
        : undefined),
      link: replicasWorkspaceLink(workspace.id),
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
