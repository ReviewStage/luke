import { CREDENTIAL_PROVIDER_ID, CREDENTIAL_PROVIDERS } from "@sidecar/credentials";
import {
  agedStatus,
  HOSTED_AGENT_ID,
  maximumSessionRecapLength,
  OBSERVATION_WINDOW,
  PROVIDER_ID,
  type ProviderSessionObservation,
  type ProviderWorkspaceAgentRequest,
  SESSION_APPLICATION_ID,
  SESSION_APPLICATION_SCOPE,
  SESSION_STATUS,
  type SessionApplication,
  type SessionDetail,
  type SessionProvider,
  type SessionStatus,
  type SessionWorkspace,
  WORKSPACE_TASK_SUPPORT,
  type WorkspaceAgentSelection,
  type WorkspaceProject,
} from "@sidecar/session";
import { isRecord, isWireBoolean, type WireRecord } from "@sidecar/wire";
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
 * The dated API version this adapter was written against, pinned on every
 * request the way the Copilot adapter pins GitHub's, because Replicas' own
 * guide says to pin one so future changes do not alter an integration
 * unexpectedly. It is also what makes a creation answer with its preparing
 * workspace immediately instead of holding the request while the machine
 * boots — a hold that would outlive the write deadline and read as a send
 * that may not have landed.
 */
const REPLICAS_REQUEST_HEADERS = {
  Accept: "application/json",
  "X-Replicas-Api-Version": "2026-05-17",
};

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
  CHATS: "chats",
  ENVIRONMENTS: "environments",
  HISTORY: "history",
  MESSAGES: "messages",
  REPLICA: "replica",
  REPOSITORIES: "repositories",
  V1: "v1",
} as const;

/**
 * The reads Luke makes, and why each one cannot change provider state.
 * `GET /v1/replica` is the organization list the API guide itself walks
 * programmatic use through, answered from Replicas' own records without
 * touching a workspace, and `GET /v1/environments` with
 * `GET /v1/replica/repositories` are the same kind of record read — they are
 * where a creation ask's projects come from.
 * `GET /v1/replica/{id}` is documented to wake a sleeping or archived
 * workspace, so it is issued only for a workspace the same pass's list just
 * reported awake, where there is nothing to wake; `GET /v1/replica/{id}/history`
 * answers from retention without waking and refuses with a conflict when it
 * cannot. The engine-backed chats list under `/v1/replica/{id}/chats` wakes
 * and is never read. Nothing under `/v1/workspaces` is used at all, spec
 * notwithstanding: verified live, that whole family — the chat registry,
 * the sleep and archive acts, the dashboard list — answers an API key
 * "Invalid token" (with the organization header) or "Missing Replicas-Org-Id
 * header" (without), because it serves the dashboard's own session tokens.
 * The chats a sleeping workspace keeps on the roster are the ones its awake
 * detail last listed, and a fresh launch draws it as one workspace row until
 * it wakes.
 */
const REPLICAS_ROUTE = {
  REPLICAS: [REPLICAS_ROUTE_SEGMENT.V1, REPLICAS_ROUTE_SEGMENT.REPLICA],
  ENVIRONMENTS: [REPLICAS_ROUTE_SEGMENT.V1, REPLICAS_ROUTE_SEGMENT.ENVIRONMENTS],
  REPOSITORIES: [
    REPLICAS_ROUTE_SEGMENT.V1,
    REPLICAS_ROUTE_SEGMENT.REPLICA,
    REPLICAS_ROUTE_SEGMENT.REPOSITORIES,
  ],
} as const;

const REPLICAS_QUERY = {
  CHAT_ID: "chat_id",
  LIMIT: "limit",
} as const;

const REPLICAS_FIELD = {
  BRANCH: "branch",
  CHAT_ID: "chat_id",
  CHATS: "chats",
  CODING_AGENT: "coding_agent",
  CONTENT: "content",
  CREATED_AT: "created_at",
  ENVIRONMENT_ID: "environment_id",
  ENVIRONMENTS: "environments",
  EVENTS: "events",
  ID: "id",
  IS_GLOBAL: "is_global",
  LAST_ACTIVITY_AT: "last_activity_at",
  MESSAGE: "message",
  NAME: "name",
  PROCESSING: "processing",
  PROVIDER: "provider",
  PULL_REQUESTS: "pull_requests",
  REPLICA: "replica",
  REPLICAS: "replicas",
  REPOSITORIES: "repositories",
  REPOSITORY_ID: "repository_id",
  REPOSITORY_STATUSES: "repository_statuses",
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
 * Replicas reports a workspace's compute lifecycle rather than a turn's
 * state, so the map carries the lifecycle and the awake detail read sharpens
 * it per chat (see `#chatStatus`). Preparing and active are the platform
 * working on the user's behalf, sleeping is settled — the work reached a
 * pause nobody has come back from — and an errored workspace stopped on
 * something it cannot get past on its own. Archived workspaces never reach
 * this map: Replicas' own dashboard hides them from the active list, so they
 * stand behind no row.
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
 * identity Luke already draws that agent's sessions under: the same four
 * identities Conductor's chats map, so an agent reports the same whichever
 * app hosts it, plus the hosted-agent identities DeepSeek Harness and Pi
 * carry their own marks as. A kind outside this table (fx and Kimi Code)
 * rides the row's model slot in the provider's own word instead, so it is
 * not lost for lacking a mark.
 */
const REPLICAS_AGENT_KIND = {
  CLAUDE: "claude",
  CODEX: "codex",
  CURSOR: "cursor",
  DEEPSEEK: "deepseek",
  OPENCODE: "opencode",
  PI: "pi",
} as const;

type ReplicasAgentKind = (typeof REPLICAS_AGENT_KIND)[keyof typeof REPLICAS_AGENT_KIND];

const REPLICAS_AGENT_BY_KIND = {
  [REPLICAS_AGENT_KIND.CLAUDE]: { id: PROVIDER_ID.CLAUDE_CODE, displayName: "Claude Code" },
  [REPLICAS_AGENT_KIND.CODEX]: { id: PROVIDER_ID.CODEX, displayName: "Codex" },
  [REPLICAS_AGENT_KIND.CURSOR]: { id: PROVIDER_ID.CURSOR, displayName: "Cursor" },
  [REPLICAS_AGENT_KIND.DEEPSEEK]: {
    id: HOSTED_AGENT_ID.DEEPSEEK,
    // Replicas' own name for its DeepSeek-backed harness, not DeepSeek the
    // model vendor: the mark is the vendor's, the word is the agent's.
    displayName: "DeepSeek Harness",
  },
  [REPLICAS_AGENT_KIND.OPENCODE]: { id: PROVIDER_ID.OPENCODE, displayName: "OpenCode" },
  [REPLICAS_AGENT_KIND.PI]: { id: HOSTED_AGENT_ID.PI, displayName: "Pi" },
} as const satisfies Readonly<Record<ReplicasAgentKind, SessionProvider>>;

/**
 * Every agent kind the creation and chat endpoints document taking, exactly
 * as the OpenAPI enumerates them. This is what a row advertises as
 * spawnable, so an ask can only ever name a kind the provider itself takes.
 */
const REPLICAS_DOCUMENTED_AGENT_KINDS: readonly string[] = [
  "claude",
  "codex",
  "cursor",
  "deepseek",
  "fx",
  "kimi",
  "opencode",
  "pi",
];

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
   * How many workspaces one pass will enrich — the newest that could still
   * say something. The awake ones are re-read every pass, because a turn
   * ending is exactly the change worth noticing; the sleeping ones are
   * cached by their activity timestamp, so a settled workspace costs
   * nothing until it moves.
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
  MAXIMUM_BRANCH_LABEL_LENGTH: 60,
  MAXIMUM_WORKSPACE_NAME_LENGTH: 60,
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

/** One chat a non-waking read listed inside a workspace. */
interface ReplicasChat {
  id: string;
  agentKind?: string;
  title?: string;
  observedAt: number;
  /**
   * Whether the chat is doing work right now, as the registry reported it.
   * Optional only for a snapshot read by an earlier build of this pass; the
   * registry always says.
   */
  processing?: boolean;
}

/** The chats one workspace held when they were last read, newest first. */
interface ReplicasChatSnapshot {
  observedAt: number;
  chats: readonly ReplicasChat[];
}

/** What the awake detail read said beyond the chats: the workspace's own facts. */
interface ReplicasWorkspaceDetail {
  branch?: string;
  agentKind?: string;
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
 * One chat from the awake detail read, which spells its chat fields in
 * snake_case and carries the same turn state. It is the fallback chat source
 * for a workspace the registry did not answer for — the registry's routes
 * demand the organization header, and the first pass may not have learned
 * one yet.
 */
function chatFromDetailRecord(record: WireRecord): ReplicasChat | undefined {
  const id = textFromRecord(record, REPLICAS_FIELD.ID);
  const createdAt = timestampFromRecord(record, REPLICAS_FIELD.CREATED_AT);
  const updatedAt = timestampFromRecord(record, REPLICAS_FIELD.UPDATED_AT);
  const observedAt = updatedAt ?? createdAt;
  if (!id || observedAt === undefined) return undefined;

  const agentKind = textFromRecord(record, REPLICAS_FIELD.PROVIDER)?.slice(
    0,
    REPLICAS_ADAPTER_DEFAULTS.MAXIMUM_AGENT_KIND_LENGTH,
  );
  const title = textFromRecord(record, REPLICAS_FIELD.TITLE);
  const processing = record[REPLICAS_FIELD.PROCESSING];
  // The engine pre-creates one chat slot per agent harness, so a workspace's
  // detail lists eight chats where the user opened three — observed live,
  // each slot wearing its harness's own name as a default title, so the
  // title says nothing. A slot is told from a conversation by the one fact a
  // conversation cannot avoid: something happened after creation. Verified
  // against live slots, an untouched one's update timestamp equals its
  // creation to the millisecond, and a chat's first use moves it; a turn
  // mid-flight counts as touched even before the timestamps do.
  const untouched = updatedAt === undefined || (createdAt !== undefined && updatedAt <= createdAt);
  if (processing !== true && untouched) return undefined;
  return {
    id,
    observedAt,
    ...(agentKind ? { agentKind } : undefined),
    ...(title ? { title } : undefined),
    ...(isWireBoolean(processing) ? { processing } : undefined),
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
 * The name a creation request carries, from the developer's own words: their
 * chosen name when they gave one, the opening of their task otherwise —
 * Replicas requires one and refuses whitespace, so the words are slugged the
 * way its own dashboard slugs a generated name, and the same bounded
 * generated-name allowance Superset's branch has.
 */
function replicasWorkspaceName(source: string): string {
  const slug = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, REPLICAS_ADAPTER_DEFAULTS.MAXIMUM_WORKSPACE_NAME_LENGTH)
    .replace(/-+$/, "");
  return slug || "luke-workspace";
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

/** The statuses whose chats and retained history are worth a read at all. */
const REPLICAS_ENRICHABLE_STATUSES: ReadonlySet<ReplicasStatus> = new Set([
  REPLICAS_STATUS.ACTIVE,
  REPLICAS_STATUS.SLEEPING,
]);

/**
 * Observes Replicas cloud workspaces through the documented Replica API. It
 * reads only what the supplied key can see, observation issues no request
 * that can wake a sleeping workspace, and it reports nothing at all without
 * a credential. The writes it supports are each the direct product of a
 * user's ask through a documented endpoint: a message to a chat or
 * workspace, another agent started in a workspace, a workspace created in an
 * environment the latest pass reported, and the two acts the dashboard's own
 * sidebar offers — sleeping an idle workspace and archiving a settled one —
 * each advertised only on a row positively seen in the state the act is for.
 *
 * Replicas is a workspace app hosting agents rather than an agent: a
 * workspace holds chats running Claude Code, Codex, Cursor, and others, the
 * way Conductor's does. The rows are the chats, read with their turn state
 * from the awake detail read — each led by its own agent, grouped under the
 * workspace, with the Replicas mark riding as the app. A workspace that
 * goes to sleep keeps the chats last seen while it was awake, and one whose
 * chats were never readable is its own row, so nothing the list reported
 * ever drops.
 */
export class ReplicasSessionAdapter extends CloudSessionAdapter {
  /**
   * The chats each workspace held when its awake detail was last read. An
   * awake workspace is re-read every pass, because a turn ending is exactly
   * the change worth noticing; a workspace that goes to sleep keeps the
   * chats last seen while it was awake, since no key-answerable read lists a
   * sleeping workspace's chats without waking it.
   */
  #chatsByWorkspace = new Map<string, ReplicasChatSnapshot>();

  /** What the awake detail read said about the workspace itself. */
  #detailByWorkspace = new Map<string, ReplicasWorkspaceDetail>();

  /**
   * What the last history read said, per workspace, on the activity key. An
   * unauthorized answer leaves an empty entry — that workspace's history is
   * not this key's to read, and asking again before it moves would get the
   * same refusal — while a transient failure leaves no entry, so the next
   * pass simply asks again. Contained per workspace on purpose: the list
   * already answered under this credential, so no history refusal is a
   * judgment on the key, and none may clear the roster the list just served.
   */
  #historyByWorkspace = new Map<string, ReplicasHistoryEnrichment>();

  /** A stand-down for the awake detail read, should a key be refused it. */
  #detailsRefused = false;

  /**
   * Which workspace each observed chat row belongs to, rebuilt every pass. A
   * message to a chat travels through its workspace's documented message
   * endpoint with the chat named in the body, so the route needs the pair —
   * and only ids the latest pass actually emitted are ever in it.
   */
  #workspaceByChat = new Map<string, string>();

  /** The environments the latest pass reported, offered as creation projects. */
  #projects: readonly WorkspaceProject[] = [];

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

  protected override requestHeaders() {
    return REPLICAS_REQUEST_HEADERS satisfies Readonly<Record<string, string>>;
  }

  protected override forgetCachedIdentity(): void {
    this.#chatsByWorkspace.clear();
    this.#detailByWorkspace.clear();
    this.#historyByWorkspace.clear();
    this.#detailsRefused = false;
    this.#workspaceByChat.clear();
    this.#projects = [];
  }

  protected async collect(
    request: CloudRequest,
    now: number,
  ): Promise<readonly ProviderSessionObservation[]> {
    // One list call, then bounded per-workspace reads for the newest
    // workspaces. The list carries the status, the timestamps, the
    // repositories, and the pull requests; the chat registry lists each
    // workspace's chats with their turn state; the awake detail read adds
    // the working branch; the retained history adds the parting words.
    // Workspaces are never capped — one page of the documented maximum is
    // the request's only bound — and the page arrives ordered by creation,
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

    const enrichable = workspaces
      .filter((workspace) => workspace.status && REPLICAS_ENRICHABLE_STATUSES.has(workspace.status))
      .slice(0, REPLICAS_ADAPTER_DEFAULTS.ENRICHED_WORKSPACE_LIMIT);
    this.#pruneCaches(workspaces);
    await Promise.all([
      this.#refreshProjects(request),
      this.#refreshDetails(
        request,
        enrichable.filter((workspace) => workspace.status === REPLICAS_STATUS.ACTIVE),
      ),
    ]);
    await this.#refreshHistories(request, enrichable);

    this.#workspaceByChat.clear();
    return workspaces.flatMap((workspace) => this.#observationsFor(workspace, now));
  }

  override workspaceProjects(): readonly WorkspaceProject[] {
    return this.#projects;
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

  /**
   * Starts another agent in the workspace behind an observed row. With an
   * opening task the whole ask is one documented message send — the endpoint
   * takes the agent kind beside the words and answers with the chat that
   * took them — and without one it is the documented chat creation, which
   * takes the agent kind and an optional title and nothing else.
   */
  protected override workspaceAgentRoute(
    spawnTarget: string,
    request: ProviderWorkspaceAgentRequest,
  ): CloudWriteRoute {
    if (request.task) {
      return {
        segments: [...REPLICAS_ROUTE.REPLICAS, spawnTarget, REPLICAS_ROUTE_SEGMENT.MESSAGES],
        body: {
          [REPLICAS_FIELD.MESSAGE]: request.task,
          [REPLICAS_FIELD.CODING_AGENT]: request.agent,
        },
      };
    }
    return {
      segments: [...REPLICAS_ROUTE.REPLICAS, spawnTarget, REPLICAS_ROUTE_SEGMENT.CHATS],
      body: {
        [REPLICAS_FIELD.PROVIDER]: request.agent,
        ...(request.name ? { [REPLICAS_FIELD.TITLE]: request.name } : undefined),
      },
    };
  }

  /**
   * Creates one workspace in an environment the latest pass reported,
   * through the documented creation endpoint. The name is required and
   * refuses whitespace, so the developer's own words are slugged; the task
   * is the initial message the endpoint requires; the agent choice is left
   * to the environment's own default, because this build fixes no
   * agent-and-model table for Replicas and a choice not offered is not sent.
   */
  protected override workspaceCreationRoute(
    project: WorkspaceProject,
    name: string | undefined,
    task: string | undefined,
    _agentSelection: WorkspaceAgentSelection | undefined,
  ): CloudWriteRoute | undefined {
    // The base holds a REQUIRED project's ask to carrying a task before the
    // route is built, so its absence here is a shape this build does not
    // know rather than a request to improvise.
    if (!task) return undefined;
    return {
      segments: REPLICAS_ROUTE.REPLICAS,
      body: {
        [REPLICAS_FIELD.NAME]: replicasWorkspaceName(name ?? task),
        [REPLICAS_FIELD.MESSAGE]: task,
        [REPLICAS_FIELD.ENVIRONMENT_ID]: project.providerProjectId,
      },
    };
  }

  protected override createdWorkspaceSessionId(creationBody: WireRecord): string | undefined {
    // The created workspace's first pass reports it preparing — a workspace
    // row under exactly this id — so the surface can open it the moment it
    // appears.
    const replica = creationBody[REPLICAS_FIELD.REPLICA];
    return isRecord(replica) ? textFromRecord(replica, REPLICAS_FIELD.ID) : undefined;
  }

  #pruneCaches(workspaces: readonly ReplicasWorkspace[]): void {
    const listed = new Set(workspaces.map((workspace) => workspace.id));
    for (const cache of [
      this.#chatsByWorkspace,
      this.#detailByWorkspace,
      this.#historyByWorkspace,
    ]) {
      for (const id of cache.keys()) {
        if (!listed.has(id)) cache.delete(id);
      }
    }
  }

  /**
   * The environments a creation ask can land in, read from the same records
   * the list is — and the one place the organization the key stands for is
   * named, so the header the chat registry demands is learned here. Both
   * reads are tolerated apart from the pass — a roster must not fail because
   * the creation offer could not refresh — and the offer is replaced only by
   * a complete answer, so a transient failure keeps the last one rather than
   * withdrawing it.
   */
  async #refreshProjects(request: CloudRequest): Promise<void> {
    let environments: WireRecord;
    let repositories: WireRecord;
    try {
      [environments, repositories] = await Promise.all([
        request(REPLICAS_ROUTE.ENVIRONMENTS),
        request(REPLICAS_ROUTE.REPOSITORIES),
      ]);
    } catch (error) {
      if (!(error instanceof CloudRequestError)) throw error;
      return;
    }
    const repositoryNameById = new Map<string, string>();
    for (const record of recordsFromPage(repositories, REPLICAS_FIELD.REPOSITORIES)) {
      const id = textFromRecord(record, REPLICAS_FIELD.ID);
      const label = repositoryLabel(
        textFromRecord(record, REPLICAS_FIELD.URL),
        textFromRecord(record, REPLICAS_FIELD.NAME),
      );
      if (id) repositoryNameById.set(id, label);
    }
    this.#projects = recordsFromPage(environments, REPLICAS_FIELD.ENVIRONMENTS)
      // The Global environment is the organization's defaults layered onto
      // every other one, with no repository binding of its own; the dashboard
      // offers no creation in it and neither does this.
      .filter((record) => record[REPLICAS_FIELD.IS_GLOBAL] !== true)
      .map((record): WorkspaceProject | undefined => {
        const id = textFromRecord(record, REPLICAS_FIELD.ID);
        if (!id) return undefined;
        const environmentName = textFromRecord(record, REPLICAS_FIELD.NAME);
        const repositoryId = textFromRecord(record, REPLICAS_FIELD.REPOSITORY_ID);
        const repository =
          (repositoryId ? repositoryNameById.get(repositoryId) : undefined) ?? environmentName;
        if (!repository) return undefined;
        return {
          providerProjectId: id,
          repository,
          // The environment's own name tells two environments on one
          // repository apart, the way a host name would.
          ...(environmentName && environmentName !== repository
            ? { targetName: environmentName }
            : undefined),
          // The creation endpoint requires the initial message, so a
          // task-less ask is refused rather than a workspace created idle.
          taskSupport: WORKSPACE_TASK_SUPPORT.REQUIRED,
        };
      })
      .filter(isDefined);
  }

  /**
   * Reads each awake workspace's detail for the two facts the chat registry
   * does not carry: the working branch, and the workspace's currently active
   * agent for a row with no chats to say so. The read is documented to wake
   * a sleeping or archived workspace, so it is issued only for a workspace
   * the same pass's list just reported awake, where there is nothing to
   * wake; a workspace that fell asleep in the second between the two reads
   * would be woken back, which Replicas prices at nothing and the next pass
   * reports honestly, but the window is a second against a lifecycle
   * measured in hours. Failures are contained the way every enrichment's
   * are. It is also the fallback chat source: a workspace the registry did
   * not answer for this pass still lists its chats here, turn state
   * included, so an awake workspace's rows survive the registry's
   * organization-header demands.
   */
  async #refreshDetails(request: CloudRequest, awake: readonly ReplicasWorkspace[]): Promise<void> {
    if (this.#detailsRefused) return;
    await Promise.all(
      awake.map(async (workspace) => {
        let body: WireRecord;
        try {
          body = await request([...REPLICAS_ROUTE.REPLICAS, workspace.id]);
        } catch (error) {
          // A parsing bug is not a provider answer and must not hide here.
          if (!(error instanceof CloudRequestError)) throw error;
          if (error.failure === CLOUD_FAILURE.UNAUTHORIZED) this.#detailsRefused = true;
          return;
        }
        const replica = body[REPLICAS_FIELD.REPLICA];
        if (!isRecord(replica)) return;
        const chats = recordsFromPage(replica, REPLICAS_FIELD.CHATS)
          .map(chatFromDetailRecord)
          .filter(isDefined)
          .sort((first, second) => second.observedAt - first.observedAt)
          .slice(0, REPLICAS_ADAPTER_DEFAULTS.CHAT_LIMIT);
        this.#chatsByWorkspace.set(workspace.id, { observedAt: workspace.observedAt, chats });
        const statuses = replica[REPLICAS_FIELD.REPOSITORY_STATUSES];
        const firstStatus = Array.isArray(statuses) ? statuses.filter(isRecord)[0] : undefined;
        const branch = firstStatus
          ? textFromRecord(firstStatus, REPLICAS_FIELD.BRANCH)?.slice(
              0,
              REPLICAS_ADAPTER_DEFAULTS.MAXIMUM_BRANCH_LABEL_LENGTH,
            )
          : undefined;
        const agentKind = textFromRecord(replica, REPLICAS_FIELD.CODING_AGENT)?.slice(
          0,
          REPLICAS_ADAPTER_DEFAULTS.MAXIMUM_AGENT_KIND_LENGTH,
        );
        this.#detailByWorkspace.set(workspace.id, {
          ...(branch ? { branch } : undefined),
          ...(agentKind ? { agentKind } : undefined),
        });
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
   * The rows one workspace stands behind: its chats when a non-waking read
   * listed any, the workspace itself otherwise — a workspace with no
   * readable chats still holds work, and a roster that dropped it would
   * report less than the list said.
   */
  #observationsFor(workspace: ReplicasWorkspace, now: number): ProviderSessionObservation[] {
    const chats = this.#chatsByWorkspace.get(workspace.id)?.chats ?? [];
    if (chats.length === 0) return [this.#workspaceObservation(workspace)];
    for (const chat of chats) this.#workspaceByChat.set(chat.id, workspace.id);
    return chats.map((chat, index) => this.#chatObservation(workspace, chat, index === 0, now));
  }

  #workspaceObservation(workspace: ReplicasWorkspace): ProviderSessionObservation {
    const status = this.#statusFor(workspace);
    const history = this.#historyByWorkspace.get(workspace.id);
    const detail = this.#detailByWorkspace.get(workspace.id);
    const agentKind = detail?.agentKind ?? history?.agentKind;
    const mappedKind = knownValue(REPLICAS_AGENT_KIND, agentKind);
    const agent = mappedKind ? REPLICAS_AGENT_BY_KIND[mappedKind] : history?.agent;
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
      ...(agent ? { agent } : undefined),
      ...this.#recapFor(workspace, undefined),
      ...this.#spawnAdvertisement(workspace),
      applications: this.#applicationsFor(workspace),
      detail: {
        repository: workspace.repositoryLabel,
        ...(detail?.branch ? { branch: detail.branch } : undefined),
        // An agent kind this build has no identity for rides the model slot
        // in the provider's own word, the way Conductor's unmapped kinds do,
        // so it is not lost for lacking a mark.
        ...(agent === undefined && agentKind ? { model: agentKind } : undefined),
        ...this.#sharedDetail(workspace, status),
      },
    };
  }

  /**
   * One chat's row. Its status is the chat's own turn wherever the awake
   * detail read reported one — a processing chat works, an idle one is
   * holding for the user the way an idle Conductor chat is, aged so a chat
   * walked away from stops calling — and the workspace's lifecycle otherwise:
   * a sleeping workspace's chats are settled, and a chat the export listed
   * without turn state borrows the workspace's only while it is the newest,
   * since the platform's activity is wherever the latest words landed.
   */
  #chatObservation(
    workspace: ReplicasWorkspace,
    chat: ReplicasChat,
    newest: boolean,
    now: number,
  ): ProviderSessionObservation {
    const status = this.#chatStatus(workspace, chat, newest, now);
    const history = newest ? this.#historyByWorkspace.get(workspace.id) : undefined;
    const detail = this.#detailByWorkspace.get(workspace.id);
    // The chat's own agent is the listing's word — a stored fact, not the
    // engine's "currently active" answer. The history's derived kind stands
    // in only where the listing gave none, and only on the newest chat,
    // whose conversation the history read was pinned to: another chat's
    // agent must never bleed onto this row.
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
      ...(status === SESSION_STATUS.WAITING ? { holdingForDeveloper: true } : undefined),
      ...(newest ? this.#recapFor(workspace, chat) : undefined),
      ...this.#spawnAdvertisement(workspace),
      // The workspace this chat is one voice of, so several chats gather
      // under one tray carrying the Replicas mark once, the way Conductor's
      // and Superset's workspaces gather theirs.
      workspace: this.#workspaceGrouping(workspace),
      applications: this.#applicationsFor(workspace),
      detail: {
        repository: workspace.repositoryLabel,
        ...(detail?.branch ? { branch: detail.branch } : undefined),
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

  #chatStatus(
    workspace: ReplicasWorkspace,
    chat: ReplicasChat,
    newest: boolean,
    now: number,
  ): SessionStatus {
    if (workspace.status === REPLICAS_STATUS.SLEEPING) return SESSION_STATUS.COMPLETE;
    if (chat.processing === true) return SESSION_STATUS.WORKING;
    if (chat.processing === false) {
      // An idle chat in an awake workspace has finished its turn and is
      // holding for the user, which is what an idle Conductor chat reports;
      // once the ask goes stale it stops calling, because a stale waiting
      // cannot be told from a chat walked away from.
      return agedStatus(
        SESSION_STATUS.WAITING,
        chat.observedAt,
        now,
        OBSERVATION_WINDOW.ACTIVE_SESSION_FRESHNESS_MS,
      );
    }
    return newest ? this.#statusFor(workspace) : SESSION_STATUS.COMPLETE;
  }

  /** The recap fields a row may carry, or nothing while the words are mid-turn. */
  #recapFor(
    workspace: ReplicasWorkspace,
    chat: ReplicasChat | undefined,
  ): { recap: string } | undefined {
    const history = this.#historyByWorkspace.get(workspace.id);
    // The parting words are a recap only once the turn has actually parted:
    // Claude's own result event says a turn completed, a chat positively
    // seen idle has finished its turn, and a workspace asleep is settled
    // however its turn ended. Words without any of those are mid-turn, and
    // a half sentence posing as an outcome is worse than none.
    const settled =
      history?.recapSettled ||
      workspace.status === REPLICAS_STATUS.SLEEPING ||
      chat?.processing === false;
    return history?.recap && settled ? { recap: history.recap } : undefined;
  }

  /**
   * Another agent lands in the workspace around this row, whatever state the
   * row's own chat is in, as one of the kinds the endpoints document. The
   * workspace id rides the advertisement — like a control's target — so it
   * can never outlive the snapshot that promised it.
   */
  #spawnAdvertisement(
    workspace: ReplicasWorkspace,
  ): Pick<ProviderSessionObservation, "spawnableAgents" | "spawnTarget"> | undefined {
    if (!this.#canReceiveMessage(workspace)) return undefined;
    return {
      spawnableAgents: REPLICAS_DOCUMENTED_AGENT_KINDS,
      spawnTarget: workspace.id,
    };
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
    // A status this build does not know is not guessed at.
    if (!workspace.status) return SESSION_STATUS.UNKNOWN;
    return SESSION_STATUS_BY_REPLICAS_STATUS[workspace.status];
  }
}
