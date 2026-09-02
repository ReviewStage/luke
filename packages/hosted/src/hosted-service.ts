import {
  type AttentionDecision,
  attentionDecisionFromWire,
  boundedText,
  CONVERSATION_MESSAGE_AUTHOR,
  type ConversationMessageAuthor,
  maximumSessionSubjectLength,
  normalizeSessionDetail,
  type ProviderId,
  SESSION_CONTROL_KIND,
  WORKSPACE_TASK_SUPPORT,
  type WorkspaceAgentModels,
  type WorkspaceTaskSupport,
} from "@sidecar/session";
import {
  isRecord,
  isWireBoolean,
  isWireNumber,
  isWireString,
  text,
  type UnparsedWireValue,
  wholeNumber,
} from "@sidecar/wire";
import {
  REALTIME_CALLS_PATH,
  type RealtimeConnection,
  realtimeCredentialIsUsable,
} from "./realtime-contract.js";

/**
 * The wire contract between Luke's hosted service and the desktop. The web
 * endpoints answer with these shapes and the desktop's hosted clients validate
 * against them, both importing from here, so the two sides cannot drift — the
 * same standing the attention request construction has.
 */

/** The hosted endpoints, rooted at the service origin. */
export const HOSTED_SERVICE_PATH = {
  VOICE_MINT: "/api/voice/mint",
  /**
   * Mints one ephemeral Realtime credential for the signed-in iPhone and
   * answers with the user's cloud session roster pre-serialized as a context
   * item (POST). Same quota meter as VOICE_MINT; narrowed to the tool set the
   * mobile act endpoints serve.
   */
  REMOTE_VOICE_MINT: "/api/voice/remote-mint",
  /** Send a message to a cloud session (POST). */
  ACT_MESSAGE: "/api/acts/message",
  /** Create a workspace in a cloud project (POST). */
  ACT_WORKSPACE: "/api/acts/workspace",
  /** Run a control the session's latest observation advertised (POST). */
  ACT_CONTROL: "/api/acts/control",
  /** Start another agent in the workspace an observed session runs in (POST). */
  ACT_AGENT: "/api/acts/agent",
  /** Rename an observed session itself — the chat (POST). */
  ACT_RENAME_SESSION: "/api/acts/rename-session",
  /** Rename the workspace an observed session runs in (POST). */
  ACT_RENAME_WORKSPACE: "/api/acts/rename-workspace",
  /**
   * List the projects a new workspace can be created in (GET): each entry is
   * one a provider itself reported on a fresh observation pass, so a creation
   * ask can only ever name a reported project. Stateless like observe.
   */
  PROJECTS: "/api/projects",
  /**
   * The one endpoint a fresh install may call before any account exists: it
   * mints a single short-lived credential for the spoken onboarding
   * introduction, takes no bearer, and answers with the same mint shape the
   * ordinary endpoint does, so `hostedMintAnswerFromWire` validates both.
   */
  INTRODUCTION_MINT: "/api/voice/introduction-mint",
  ATTENTION_REVIEW: "/api/attention/review",
  /**
   * Derive one local session's subject from its bounded transcript rendering (POST),
   * on Luke's key, for a developer with none of their own. The slice is read
   * for the one phrase and stored nowhere.
   */
  SUBJECT_DERIVE: "/api/subject/derive",
  ACCOUNT_DELETE: "/api/account/delete",
  USAGE: "/api/usage",
  EVENTS: "/api/events",
  /** Store or replace a provider key (POST) or delete one (DELETE). */
  VAULT_KEY: "/api/vault/key",
  /** List stored provider keys — ids and timestamps, never keys. */
  VAULT_KEYS: "/api/vault/keys",
  /**
   * Observe cloud sessions on demand for the signed-in user. GET: decrypts the
   * caller's vault keys, runs each provider's cloud adapter once, and returns a
   * bounded roster. Stateless: no session state is stored between requests.
   */
  OBSERVE: "/api/observe",
  /**
   * Read one observed session's conversation on demand (GET): a fresh
   * observation pass validates the session, the provider's own documented
   * transcript read answers in bounded attributed pages, and the server
   * stores nothing after serving the response. Only a caller's own opened
   * conversation screen asks; no observation pass ever issues this read.
   */
  SESSION_MESSAGES: "/api/sessions/messages",
} as const;

/** Selects the judgment-only attention response understood by current desktops. */
export const HOSTED_ATTENTION_CONTRACT_HEADER = "x-luke-attention-contract";
export const HOSTED_ATTENTION_CONTRACT_VERSION = "2";

/**
 * The cloud providers whose API keys the vault accepts. Only providers that
 * Luke's service can observe on the user's behalf belong here; local-only
 * providers supply their credentials directly on the user's machine.
 *
 * The values are a subset of `PROVIDER_ID` from `@sidecar/session`; the
 * `satisfies` constraint enforces that membership. A new entry must be a
 * known provider id and requires a matching server-side observation strategy,
 * which ships in a separate PR.
 *
 * This set must stay in sync with `CLOUD_AGENT_PROVIDER_LIST` in
 * `@sidecar/credentials`. That package is not importable here (it sits above
 * `@sidecar/hosted` in the dependency graph), so drift is caught by a
 * parity test in `apps/web/tests/hosted-vault.test.ts` instead.
 */
export const VAULT_PROVIDER_ID = {
  CONDUCTOR: "conductor",
} as const satisfies Record<string, ProviderId>;

export type VaultProviderId = (typeof VAULT_PROVIDER_ID)[keyof typeof VAULT_PROVIDER_ID];

const VAULT_PROVIDER_ID_SET: ReadonlySet<string> = new Set(Object.values(VAULT_PROVIDER_ID));

/** Whether an untrusted value names a provider the vault accepts keys for. */
export function isVaultProviderId(value: UnparsedWireValue): value is VaultProviderId {
  return isWireString(value) && VAULT_PROVIDER_ID_SET.has(value);
}

/** Maximum length the vault accepts for a provider API key. */
export const VAULT_KEY_MAX_LENGTH = 512;

/**
 * The shape a provider key must have before the vault stores it: non-empty,
 * no whitespace anywhere, bounded length. Loose by design — shape validation
 * only, never provider-specific format. Living on the wire contract, the
 * desktop refuses the same keys the service would, before one travels.
 */
export function vaultKeyIsStorable(key: string): boolean {
  return key.length > 0 && key.length <= VAULT_KEY_MAX_LENGTH && !/\s/u.test(key);
}

/** Every refusal a hosted endpoint answers with, by its reason. */
export const HOSTED_API_ERROR = {
  /** The bearer token is missing, expired, or revoked. */
  INVALID_TOKEN: "invalid-token",
  /** The request body is not what this endpoint takes. */
  INVALID_REQUEST: "invalid-request",
  /**
   * Today's free allowance for this meter is spent, or — on the recording
   * endpoint, which meters nothing — this account has sent more counts this
   * minute than the brake allows.
   */
  QUOTA_EXHAUSTED: "quota-exhausted",
  /**
   * The deployment holds no key for what was asked — OpenAI's for the hosted
   * tier, the analytics processor's for recording — so that endpoint is off.
   */
  UNAVAILABLE: "unavailable",
  /** The upstream refused or failed; the status travels, the bodies never do. */
  UPSTREAM_ERROR: "upstream-error",
  METHOD_NOT_ALLOWED: "method-not-allowed",
} as const;

export type HostedApiError = (typeof HOSTED_API_ERROR)[keyof typeof HOSTED_API_ERROR];

/** What one day's allowance looked like when the service last answered. */
export interface HostedQuota {
  used: number;
  limit: number;
  remaining: number;
  /** When the day's counters reset, as epoch milliseconds. */
  resetsAt: number;
}

function nonNegativeWholeNumber(value: UnparsedWireValue): number | undefined {
  const parsed = wholeNumber(value);
  return parsed !== undefined && parsed >= 0 ? parsed : undefined;
}

/** Reads a quota out of an untrusted hosted answer, or nothing. */
export function hostedQuotaFromWire(value: UnparsedWireValue): HostedQuota | undefined {
  if (!isRecord(value)) return undefined;
  const used = nonNegativeWholeNumber(value.used);
  const limit = nonNegativeWholeNumber(value.limit);
  const remaining = nonNegativeWholeNumber(value.remaining);
  const resetsAt = nonNegativeWholeNumber(value.resetsAt);
  if (used === undefined || limit === undefined || remaining === undefined) return undefined;
  if (resetsAt === undefined) return undefined;
  return { used, limit, remaining, resetsAt };
}

/**
 * The one address a hosted credential may point a WebRTC call at. The
 * renderer's content-security policy only permits the canonical OpenAI host,
 * so a credential aimed anywhere else could not work — validating it here
 * means a mis-answering service reads as a malformed response rather than as
 * a call that dies mid-handshake.
 */
export const HOSTED_CALLS_URL = `https://api.openai.com/v1${REALTIME_CALLS_PATH}`;

/**
 * The build-pinned WebSocket base URL for OpenAI Realtime. The full endpoint
 * appends ?model=<model> and is validated field-by-field in the wire reader
 * the same way callsUrl is, so a mis-answering service cannot redirect a
 * mobile client's connection.
 */
export const HOSTED_WS_BASE_URL = "wss://api.openai.com/v1/realtime";

export interface HostedMintAnswer {
  connection: RealtimeConnection;
  quota?: HostedQuota;
}

/**
 * Validates a hosted mint answer. Anything without a usable, canonically
 * addressed credential is discarded rather than repaired, the same posture as
 * the OpenAI mint response reader.
 */
export function hostedMintAnswerFromWire(
  value: UnparsedWireValue,
  now: number,
): HostedMintAnswer | undefined {
  if (!isRecord(value) || !isRecord(value.connection)) return undefined;
  const connection = value.connection;
  const secret = text(connection.value);
  const expiresAt = wholeNumber(connection.expiresAt);
  const model = text(connection.model);
  if (!secret || !model) return undefined;
  if (expiresAt === undefined) return undefined;
  if (connection.callsUrl !== HOSTED_CALLS_URL) return undefined;
  const wsUrlFromWire = text(connection.wsUrl);
  if (wsUrlFromWire !== undefined && wsUrlFromWire !== `${HOSTED_WS_BASE_URL}?model=${model}`) {
    return undefined;
  }
  const credential: RealtimeConnection = {
    value: secret,
    expiresAt,
    model,
    callsUrl: HOSTED_CALLS_URL,
  };
  if (wsUrlFromWire !== undefined) credential.wsUrl = wsUrlFromWire;
  if (!realtimeCredentialIsUsable(credential, now)) return undefined;
  const quota = hostedQuotaFromWire(value.quota);
  const answer: HostedMintAnswer = { connection: credential };
  if (quota !== undefined) answer.quota = quota;
  return answer;
}

/**
 * One pre-serialized context item returned by the mobile mint endpoint. The
 * phone wraps `text` verbatim in a `conversation.item.create` event keyed by
 * `itemId` — it does not re-serialize, re-label, or re-validate the content.
 */
export interface RemoteVoiceContextItem {
  /** The item id the phone names the `conversation.item.create` event with. */
  itemId: string;
  /** The labeled context text, ready to drop into `content[0].text`. */
  text: string;
}

/** The pre-serialized context the mobile mint endpoint answers with. */
export interface RemoteVoiceContext {
  sessions: RemoteVoiceContextItem;
}

/** What the mobile mint endpoint returns on success. */
export interface RemoteMintAnswer extends HostedMintAnswer {
  context: RemoteVoiceContext;
}

/**
 * Validates a mobile mint answer. Inherits the credential checks from
 * `hostedMintAnswerFromWire` and additionally requires a non-empty context
 * with a sessions item. A malformed context is not repaired — the phone has
 * no fallback for context it cannot forward.
 */
export function remoteMintAnswerFromWire(
  value: UnparsedWireValue,
  now: number,
): RemoteMintAnswer | undefined {
  const base = hostedMintAnswerFromWire(value, now);
  if (!base || !isRecord(value)) return undefined;
  if (!isRecord(value.context)) return undefined;
  const ctx = value.context;
  if (!isRecord(ctx.sessions)) return undefined;
  const sessions = ctx.sessions;
  const itemId = text(sessions.itemId);
  const itemText = text(sessions.text);
  if (!itemId || !itemText) return undefined;
  return {
    ...base,
    context: { sessions: { itemId, text: itemText } },
  };
}

export interface HostedSubjectAnswer {
  /** The derived phrase, or null when the transcript supported none. */
  subject: string | null;
  quota?: HostedQuota;
}

/**
 * Validates a hosted subject answer: a bounded string or an honest null, and
 * nothing else, cut to the same bound the registry keeps a subject at.
 */
export function hostedSubjectAnswerFromWire(
  value: UnparsedWireValue,
): HostedSubjectAnswer | undefined {
  if (!isRecord(value)) return undefined;
  if (value.subject !== null && !isWireString(value.subject)) return undefined;
  const subject =
    value.subject === null
      ? null
      : (boundedText(value.subject.replace(/\s+/g, " "), maximumSessionSubjectLength) ?? null);
  const quota = hostedQuotaFromWire(value.quota);
  const answer: HostedSubjectAnswer = { subject };
  if (quota !== undefined) answer.quota = quota;
  return answer;
}

export interface HostedReviewAnswer {
  decision: AttentionDecision;
  quota?: HostedQuota;
}

/**
 * Validates a hosted attention answer through the same contract a model's own
 * decision passes, and stamps it with the reader's clock: `decidedAt` feeds
 * local dedup windows, so the service's clock has no business in it.
 */
export function hostedReviewAnswerFromWire(
  value: UnparsedWireValue,
  decidedAt: number,
): HostedReviewAnswer | undefined {
  if (!isRecord(value) || !isRecord(value.decision)) return undefined;
  const decision = attentionDecisionFromWire(value.decision, decidedAt);
  if (!decision) return undefined;
  const quota = hostedQuotaFromWire(value.quota);
  const answer: HostedReviewAnswer = { decision };
  if (quota !== undefined) answer.quota = quota;
  return answer;
}

/**
 * Where today's allowance stands on both meters, read without spending
 * either: what the usage endpoint answers, and what the panel shows.
 */
export interface HostedUsageAnswer {
  voice: HostedQuota;
  attention: HostedQuota;
}

/** Validates a usage answer; a malformed one reads as no answer at all. */
export function hostedUsageAnswerFromWire(value: UnparsedWireValue): HostedUsageAnswer | undefined {
  if (!isRecord(value)) return undefined;
  const voice = hostedQuotaFromWire(value.voice);
  const attention = hostedQuotaFromWire(value.attention);
  return voice && attention ? { voice, attention } : undefined;
}

const HOSTED_API_ERROR_LIST: readonly HostedApiError[] = Object.values(HOSTED_API_ERROR);

/** Reads the error reason out of a refused hosted answer, or nothing. */
export function hostedErrorFromWire(value: UnparsedWireValue): HostedApiError | undefined {
  if (!isRecord(value)) return undefined;
  const error = text(value.error);
  if (!error) return undefined;
  // SAFETY: error is a string; membership in HOSTED_API_ERROR_LIST is the wire contract check.
  return HOSTED_API_ERROR_LIST.includes(error as HostedApiError)
    ? (error as HostedApiError)
    : undefined;
}

// --- Vault wire contract ---

/** Confirms that a store operation landed. */
export interface VaultKeyStoreAnswer {
  stored: true;
}

/** Reads a vault store answer; anything other than `{ stored: true }` is invalid. */
export function vaultKeyStoreAnswerFromWire(
  value: UnparsedWireValue,
): VaultKeyStoreAnswer | undefined {
  if (!isRecord(value) || value.stored !== true) return undefined;
  return { stored: true };
}

/** One key entry as returned by the list endpoint — never contains the key. */
export interface VaultKeyListEntry {
  providerId: VaultProviderId;
  updatedAt: number;
}

/** The list endpoint answer. */
export interface VaultKeysListAnswer {
  keys: VaultKeyListEntry[];
}

/** Reads a vault keys-list answer; any malformed entry drops the whole answer. */
export function vaultKeysListAnswerFromWire(
  value: UnparsedWireValue,
): VaultKeysListAnswer | undefined {
  if (!isRecord(value) || !Array.isArray(value.keys)) return undefined;
  const keys: VaultKeyListEntry[] = [];
  for (const item of value.keys) {
    if (!isRecord(item)) return undefined;
    const providerId = text(item.providerId);
    if (!isVaultProviderId(providerId)) return undefined;
    const updatedAt = wholeNumber(item.updatedAt);
    if (updatedAt === undefined || !isWireNumber(updatedAt) || updatedAt < 0) return undefined;
    keys.push({ providerId, updatedAt });
  }
  return { keys };
}

/** Confirms whether a delete operation found and removed a key. */
export interface VaultKeyDeleteAnswer {
  deleted: boolean;
}

/** Reads a vault delete answer. */
export function vaultKeyDeleteAnswerFromWire(
  value: UnparsedWireValue,
): VaultKeyDeleteAnswer | undefined {
  if (!isRecord(value) || !isWireBoolean(value.deleted)) return undefined;
  return { deleted: value.deleted };
}

// --- Observe wire contract ---

/**
 * One control a session's provider advertised for it, as the observe endpoint
 * reports it: the id an act names, and the label and kind the row draws. What
 * the control targets never travels — the act endpoint re-observes and builds
 * the write from its own fresh advertisement, so the wire copy can gate a
 * button but can never redirect a write.
 */
export interface ObservedSessionControl {
  id: string;
  label: string;
  /** One of the SESSION_CONTROL_KIND string values, when the provider named one. */
  kind?: string;
}

/**
 * One cloud session as reported by the observe endpoint. The fields are a
 * bounded subset of `ProviderSessionObservation`: what mobile can show in a
 * roster row, and which acts that row may offer. The service maps the
 * adapter's observation onto this shape and stores nothing — a new request is
 * a new observation pass, and every act endpoint re-observes for itself
 * rather than trusting these advertisements.
 */
export interface ObservedSession {
  /** The vault provider id for this session (conductor today). */
  providerId: string;
  /** The provider's own id for this session. */
  sessionId: string;
  /** Bounded session title. */
  title: string;
  /** One of the SESSION_STATUS string values. */
  status: string;
  /** Repository label or workspace name, when the provider reported one. */
  workspace?: string;
  /** Current branch, when the provider reported one. */
  branch?: string;
  /** HTTPS address of the work the session published, when it reported one. */
  change?: string;
  /** Bounded recap of where the work stands, when the provider reported one. */
  recap?: string;
  /** Error description, when the session stopped on something it cannot pass. */
  error?: string;
  /** Unix milliseconds of the last observed activity, when the provider reported one. */
  observedAt?: number;
  /** Whether the session's latest observation advertised taking a message. */
  canReceiveMessage?: boolean;
  /** The controls the session's latest observation advertised, if any. */
  controls?: ObservedSessionControl[];
  /** Agent kinds the latest observation listed as spawnable in this session's workspace. */
  spawnableAgents?: string[];
  /** Whether the latest observation advertised renaming the session itself. */
  canRename?: boolean;
  /** Whether the latest observation advertised renaming the session's workspace. */
  canRenameWorkspace?: boolean;
  /**
   * Whether the messages endpoint can read this session's conversation — a
   * capability of the provider's documented transcript read, not a per-turn
   * state, so a screen that sees it absent falls back to the recap alone.
   */
  canReadConversation?: boolean;
}

/** The observe endpoint answer: the caller's cloud sessions across all providers. */
export interface ObserveAnswer {
  sessions: ObservedSession[];
}

const OBSERVED_SESSION_STATUS_SET = new Set(["working", "waiting", "error", "complete", "unknown"]);

const OBSERVED_CONTROL_KIND_SET: ReadonlySet<string> = new Set(Object.values(SESSION_CONTROL_KIND));

function observedSessionControlFromWire(
  value: UnparsedWireValue,
): ObservedSessionControl | undefined {
  if (!isRecord(value)) return undefined;
  const id = text(value.id);
  if (!id) return undefined;
  const label = text(value.label);
  if (!label) return undefined;
  const kind = text(value.kind);
  const control: ObservedSessionControl = { id, label };
  if (kind && OBSERVED_CONTROL_KIND_SET.has(kind)) control.kind = kind;
  return control;
}

function observedSessionControlsFromWire(
  value: UnparsedWireValue,
): ObservedSessionControl[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const controls = value
    .map(observedSessionControlFromWire)
    .filter((control): control is ObservedSessionControl => control !== undefined);
  return controls.length > 0 ? controls : undefined;
}

function wireStringList(value: UnparsedWireValue): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = value.filter((entry): entry is string => isWireString(entry) && entry.length > 0);
  return entries.length > 0 ? entries : undefined;
}

function observedSessionFromWire(value: UnparsedWireValue): ObservedSession | undefined {
  if (!isRecord(value)) return undefined;
  const providerId = text(value.providerId);
  if (!providerId) return undefined;
  const sessionId = text(value.sessionId);
  if (!sessionId) return undefined;
  const title = text(value.title);
  if (!title) return undefined;
  const status = text(value.status);
  if (!status || !OBSERVED_SESSION_STATUS_SET.has(status)) return undefined;
  const workspace = text(value.workspace);
  const branch = text(value.branch);
  const changeValue = text(value.change);
  const change = changeValue ? normalizeSessionDetail({ change: changeValue }).change : undefined;
  const recap = text(value.recap);
  const error = text(value.error);
  const observedAt = wholeNumber(value.observedAt);
  const session: ObservedSession = { providerId, sessionId, title, status };
  if (workspace) session.workspace = workspace;
  if (branch) session.branch = branch;
  if (change) session.change = change;
  if (recap) session.recap = recap;
  if (error) session.error = error;
  if (observedAt !== undefined) session.observedAt = observedAt;
  if (value.canReceiveMessage === true) session.canReceiveMessage = true;
  const controls = observedSessionControlsFromWire(value.controls);
  if (controls) session.controls = controls;
  const spawnableAgents = wireStringList(value.spawnableAgents);
  if (spawnableAgents) session.spawnableAgents = spawnableAgents;
  if (value.canRename === true) session.canRename = true;
  if (value.canRenameWorkspace === true) session.canRenameWorkspace = true;
  if (value.canReadConversation === true) session.canReadConversation = true;
  return session;
}

/** Validates an observe answer; a malformed entry is skipped, not fatal. */
export function observeAnswerFromWire(value: UnparsedWireValue): ObserveAnswer | undefined {
  if (!isRecord(value) || !Array.isArray(value.sessions)) return undefined;
  const sessions: ObservedSession[] = [];
  for (const item of value.sessions) {
    const session = observedSessionFromWire(item);
    if (session) sessions.push(session);
  }
  return { sessions };
}

// --- Conversation wire contract ---

// Who wrote one message of a conversation reading is `@sidecar/session`'s own
// vocabulary, imported rather than mirrored the way `HOSTED_ACT_RESULT`
// mirrors `@sidecar/acts`: that package sits above this one, where session
// sits below, so nothing stops the wire from sharing the adapters' set.
const CONVERSATION_AUTHOR_SET: ReadonlySet<string> = new Set(
  Object.values(CONVERSATION_MESSAGE_AUTHOR),
);

/**
 * One attributed message of a session's conversation, as the messages
 * endpoint relays it: the provider's own id, who wrote it, and the words
 * whole — the read's bounds live on the page, never on the message. Only the
 * two voices a chat screen draws exist on the wire, because a message the
 * provider's store did not attribute never left the adapter at all.
 */
export interface HostedConversationMessage {
  id: string;
  author: ConversationMessageAuthor;
  text: string;
  /** Unix ms the provider recorded the message at, when it reported one. */
  receivedAt?: number;
}

/**
 * The messages endpoint answer: one bounded page of attributed messages and
 * the positions to continue from. `lastMessageId` is where a poll resumes —
 * absent on an older-history page, which must never move a poll backward —
 * and `firstOffset`/`hasOlder` are where a scroll to the top continues,
 * absent on a poll, which never looks backward. The server assembled it from
 * a fresh read and stored nothing — a new request is a new read.
 */
export interface HostedConversationAnswer {
  messages: HostedConversationMessage[];
  lastMessageId?: string;
  hasMore: boolean;
  firstOffset?: number;
  hasOlder?: boolean;
}

function hostedConversationMessageFromWire(
  value: UnparsedWireValue,
): HostedConversationMessage | undefined {
  if (!isRecord(value)) return undefined;
  const id = text(value.id);
  if (!id) return undefined;
  const author = text(value.author);
  if (!author || !CONVERSATION_AUTHOR_SET.has(author)) return undefined;
  // The words are read raw rather than through `text`: a message is rendered
  // as its author wrote it, and trimming is a display decision this wire
  // reader has no business making. Only an empty message is no message.
  const words = isWireString(value.text) && value.text.length > 0 ? value.text : undefined;
  if (!words) return undefined;
  const receivedAt = wholeNumber(value.receivedAt);
  // SAFETY: membership in CONVERSATION_AUTHOR_SET was checked above.
  const message: HostedConversationMessage = {
    id,
    author: author as ConversationMessageAuthor,
    text: words,
  };
  if (receivedAt !== undefined && receivedAt >= 0) message.receivedAt = receivedAt;
  return message;
}

/** Validates a conversation answer; a malformed message is skipped, not fatal. */
export function hostedConversationAnswerFromWire(
  value: UnparsedWireValue,
): HostedConversationAnswer | undefined {
  if (!isRecord(value) || !Array.isArray(value.messages)) return undefined;
  if (!isWireBoolean(value.hasMore)) return undefined;
  const messages: HostedConversationMessage[] = [];
  for (const item of value.messages) {
    const message = hostedConversationMessageFromWire(item);
    if (message) messages.push(message);
  }
  const lastMessageId = text(value.lastMessageId);
  const answer: HostedConversationAnswer = { messages, hasMore: value.hasMore };
  if (lastMessageId) answer.lastMessageId = lastMessageId;
  const firstOffset = wholeNumber(value.firstOffset);
  if (firstOffset !== undefined && firstOffset >= 0) answer.firstOffset = firstOffset;
  if (isWireBoolean(value.hasOlder)) answer.hasOlder = value.hasOlder;
  return answer;
}

// --- Projects wire contract ---

/**
 * One place a new workspace can be created, as the projects endpoint reports
 * it: a project the named provider itself listed on the fresh observation
 * pass that answered the request. The creation act re-observes and validates
 * the id against the provider's own list again, so this entry can offer a
 * project but can never conjure one.
 */
export interface HostedWorkspaceProject {
  /** The vault provider id that reported this project. */
  providerId: string;
  /** The provider-owned identifier a creation request names the project by. */
  providerProjectId: string;
  /** The repository label the project is named by on screen. */
  repository: string;
  /** Whether a new workspace here takes — or needs — an opening task. */
  taskSupport: WorkspaceTaskSupport;
  /** The bounded label of the execution target owning this project, when it has one. */
  targetName?: string;
  /** The provider names a workspace here itself and refuses a name from the ask. */
  namesItself?: boolean;
}

/**
 * One agent kind a provider's creation endpoint takes, with the models and
 * effort levels the build's table lists for it — a `WORKSPACE_AGENT_MODELS`
 * entry from `@sidecar/session`, carried onto the wire with its provider id.
 * Extending the table's own row type means the wire cannot drift from the
 * table it exists to flatten, and the workspace act validates a chosen
 * selection against the same table again server-side.
 */
export interface HostedWorkspaceAgentModels extends WorkspaceAgentModels {
  providerId: string;
}

/** The projects endpoint answer: where the caller's keys can create a workspace. */
export interface HostedProjectsAnswer {
  projects: HostedWorkspaceProject[];
  /** Agent choices for providers in `projects` whose creation takes one. */
  agentModels: HostedWorkspaceAgentModels[];
}

const WORKSPACE_TASK_SUPPORT_SET: ReadonlySet<string> = new Set(
  Object.values(WORKSPACE_TASK_SUPPORT),
);

function hostedWorkspaceProjectFromWire(
  value: UnparsedWireValue,
): HostedWorkspaceProject | undefined {
  if (!isRecord(value)) return undefined;
  const providerId = text(value.providerId);
  if (!providerId) return undefined;
  const providerProjectId = text(value.providerProjectId);
  if (!providerProjectId) return undefined;
  const repository = text(value.repository);
  if (!repository) return undefined;
  const taskSupport = text(value.taskSupport);
  if (!taskSupport || !WORKSPACE_TASK_SUPPORT_SET.has(taskSupport)) return undefined;
  const targetName = text(value.targetName);
  const project: HostedWorkspaceProject = {
    providerId,
    providerProjectId,
    repository,
    // SAFETY: membership in WORKSPACE_TASK_SUPPORT_SET was checked above.
    taskSupport: taskSupport as WorkspaceTaskSupport,
  };
  if (targetName) project.targetName = targetName;
  if (value.namesItself === true) project.namesItself = true;
  return project;
}

function hostedWorkspaceAgentModelsFromWire(
  value: UnparsedWireValue,
): HostedWorkspaceAgentModels | undefined {
  if (!isRecord(value)) return undefined;
  const providerId = text(value.providerId);
  if (!providerId) return undefined;
  const agent = text(value.agent);
  if (!agent) return undefined;
  if (!Array.isArray(value.models) || !Array.isArray(value.efforts)) return undefined;
  const models: { id: string; label: string }[] = [];
  for (const model of value.models) {
    if (!isRecord(model)) return undefined;
    const id = text(model.id);
    const label = text(model.label);
    if (!id || !label) return undefined;
    models.push({ id, label });
  }
  if (models.length === 0) return undefined;
  const efforts = wireStringList(value.efforts) ?? [];
  return { providerId, agent, models, efforts };
}

/** Validates a projects answer; a malformed entry is skipped, not fatal. */
export function hostedProjectsAnswerFromWire(
  value: UnparsedWireValue,
): HostedProjectsAnswer | undefined {
  if (!isRecord(value) || !Array.isArray(value.projects)) return undefined;
  const projects: HostedWorkspaceProject[] = [];
  for (const item of value.projects) {
    const project = hostedWorkspaceProjectFromWire(item);
    if (project) projects.push(project);
  }
  const agentModels: HostedWorkspaceAgentModels[] = [];
  if (Array.isArray(value.agentModels)) {
    for (const item of value.agentModels) {
      const entry = hostedWorkspaceAgentModelsFromWire(item);
      if (entry) agentModels.push(entry);
    }
  }
  return { projects, agentModels };
}

// --- Act wire contract ---

/**
 * The three outcomes a hosted act endpoint can return. Values match
 * `ACT_RESULT_STATUS` in `@sidecar/acts` so the mobile client and the desktop
 * can share the same vocabulary without a direct dependency on that package.
 */
export const HOSTED_ACT_RESULT = {
  /** The provider accepted the act. */
  ACCEPTED: "accepted",
  /** The provider or server refused the act; `reason` says why. */
  REJECTED: "rejected",
  /** The act is not available for this provider via mobile yet. */
  UNSUPPORTED: "unsupported",
} as const;

export type HostedActResult = (typeof HOSTED_ACT_RESULT)[keyof typeof HOSTED_ACT_RESULT];

const HOSTED_ACT_RESULT_SET: ReadonlySet<string> = new Set(Object.values(HOSTED_ACT_RESULT));

/** What the message and workspace-creation act endpoints return. */
export interface HostedActAnswer {
  result: HostedActResult;
  /** Human-readable reason; present on rejected and unsupported results. */
  reason?: string;
}

/** What the workspace-creation act endpoint returns. */
export interface HostedActWorkspaceAnswer extends HostedActAnswer {
  /** The created session's provider id, when the provider reports one. */
  providerSessionId?: string;
}

/** Reads an act answer from an untrusted hosted response. */
export function hostedActAnswerFromWire(value: UnparsedWireValue): HostedActAnswer | undefined {
  if (!isRecord(value)) return undefined;
  const result = text(value.result);
  if (!result || !HOSTED_ACT_RESULT_SET.has(result)) return undefined;
  const reason = isWireString(value.reason) ? value.reason : undefined;
  // SAFETY: result is a string and a member of HOSTED_ACT_RESULT_SET.
  return { result: result as HostedActResult, ...(reason ? { reason } : undefined) };
}

/** Reads a workspace-creation act answer from an untrusted hosted response. */
export function hostedActWorkspaceAnswerFromWire(
  value: UnparsedWireValue,
): HostedActWorkspaceAnswer | undefined {
  const base = hostedActAnswerFromWire(value);
  if (!base || !isRecord(value)) return base;
  const providerSessionId = isWireString(value.providerSessionId)
    ? value.providerSessionId
    : undefined;
  return { ...base, ...(providerSessionId ? { providerSessionId } : undefined) };
}
