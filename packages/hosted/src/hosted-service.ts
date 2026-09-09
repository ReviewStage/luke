import {
  type CloudAgentProviderId,
  CONVERSATION_MESSAGE_AUTHOR,
  type ConversationMessageAuthor,
  isCloudAgentProviderId,
  normalizeSessionDetail,
  SESSION_CONTROL_KIND,
  SESSION_STATUS,
  type SessionDetail,
  WORKSPACE_TASK_SUPPORT,
  type WorkspaceAgentModels,
  type WorkspaceProject,
  type WorkspaceTaskSupport,
} from "@sidecar/session";
import {
  type ActResultStatus,
  isActResultStatus,
  isRecord,
  isWireBoolean,
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
 * against them, both importing from here, so the two sides cannot drift.
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
  /**
   * The brain contract (see `brain-contract.ts`). GET the capabilities to
   * learn the model, the operations, the registered tool names, and the
   * bounds before sending anything; POST the three operations with a prepared
   * prompt and tool names, and the same admitted input array.
   */
  BRAIN_CAPABILITIES: "/api/brain/capabilities",
  BRAIN_RESPOND_V2: "/api/brain/v2/respond",
  BRAIN_COUNT_TOKENS: "/api/brain/v2/count-tokens",
  BRAIN_COMPACT: "/api/brain/v2/compact",
  /** Embeddings for the notebook index on Luke's key (POST), the fourth operation of that contract. */
  BRAIN_EMBED: "/api/brain/v2/embed",
  ACCOUNT_DELETE: "/api/account/delete",
  EVENTS: "/api/events",
  /**
   * Store and read account preferences (GET, PUT). Only settings named by
   * `@sidecar/settings` as cross-device preferences belong here.
   */
  ACCOUNT_PREFERENCES: "/api/account/preferences",
  /** Store or replace a provider key (POST) or delete one (DELETE). */
  VAULT_KEY: "/api/vault/key",
  /** List stored provider keys — ids and timestamps, never keys. */
  VAULT_KEYS: "/api/vault/keys",
  /**
   * Register the signed-in phone's push token (POST) or forget it at sign-out
   * (DELETE). The token addresses one app installation and moves to whichever
   * account the phone last signed in under.
   */
  DEVICE_TOKEN: "/api/devices/token",
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

/** The platforms whose push tokens the service registers. */
export const DEVICE_PLATFORM = {
  IOS: "ios",
} as const;

export type DevicePlatform = (typeof DEVICE_PLATFORM)[keyof typeof DEVICE_PLATFORM];

const DEVICE_PLATFORM_SET: ReadonlySet<string> = new Set(Object.values(DEVICE_PLATFORM));

export function isDevicePlatform(value: UnparsedWireValue): value is DevicePlatform {
  return isWireString(value) && DEVICE_PLATFORM_SET.has(value);
}

/**
 * Which of Apple's two push gateways a token belongs to. A build run from
 * Xcode registers with the sandbox gateway and one from TestFlight or the App
 * Store with production; the phone knows which it is, and a token sent to the
 * wrong gateway is refused, so the registration says.
 */
export const PUSH_ENVIRONMENT = {
  SANDBOX: "sandbox",
  PRODUCTION: "production",
} as const;

export type PushEnvironment = (typeof PUSH_ENVIRONMENT)[keyof typeof PUSH_ENVIRONMENT];

const PUSH_ENVIRONMENT_SET: ReadonlySet<string> = new Set(Object.values(PUSH_ENVIRONMENT));

export function isPushEnvironment(value: UnparsedWireValue): value is PushEnvironment {
  return isWireString(value) && PUSH_ENVIRONMENT_SET.has(value);
}

/**
 * The bounds a device token must sit inside before the service stores it.
 * Apple hands the app the token as bytes, and the phone sends its hex; Apple
 * documents no fixed length, so the bound is generous on both sides and the
 * check is only that it is hex at all.
 */
export const DEVICE_TOKEN_BOUNDS = {
  MIN_LENGTH: 32,
  MAX_LENGTH: 512,
} as const;

export function deviceTokenIsStorable(token: string): boolean {
  return (
    token.length >= DEVICE_TOKEN_BOUNDS.MIN_LENGTH &&
    token.length <= DEVICE_TOKEN_BOUNDS.MAX_LENGTH &&
    /^[0-9a-f]+$/u.test(token)
  );
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
  /**
   * The upstream itself is rate limiting; nothing was answered. Distinct from
   * a spent allowance: the caller cools down for the bounded wait the
   * `Retry-After` header names rather than for the day.
   */
  UPSTREAM_THROTTLED: "upstream-throttled",
  /** The request body weighs more than the endpoint's fixed byte bound; nothing of it was read. */
  REQUEST_TOO_LARGE: "request-too-large",
  /** The prepared prompt is longer than the contract's own prompt envelope; nothing was sent upstream. */
  PROMPT_TOO_LARGE: "prompt-too-large",
  /** A tool name the service's catalog does not register; no schema was selected. */
  UNKNOWN_TOOL: "unknown-tool",
  METHOD_NOT_ALLOWED: "method-not-allowed",
} as const;

export type HostedApiError = (typeof HOSTED_API_ERROR)[keyof typeof HOSTED_API_ERROR];

/** What one day's allowance looked like when the service last answered. */
export interface HostedQuota {
  used: number;
  limit: number;
  /** When the day's counter resets, as epoch milliseconds. */
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
  const resetsAt = nonNegativeWholeNumber(value.resetsAt);
  if (used === undefined || limit === undefined || resetsAt === undefined) return undefined;
  return { used, limit, resetsAt };
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
  const wsUrl = text(connection.wsUrl);
  if (wsUrl !== `${HOSTED_WS_BASE_URL}?model=${model}`) return undefined;
  const credential: RealtimeConnection = {
    value: secret,
    expiresAt,
    model,
    callsUrl: HOSTED_CALLS_URL,
    wsUrl,
  };
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
  providerId: CloudAgentProviderId;
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
    if (!isCloudAgentProviderId(providerId)) return undefined;
    const updatedAt = wholeNumber(item.updatedAt);
    if (updatedAt === undefined || updatedAt < 0) return undefined;
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

// --- Device wire contract ---

/** Confirms that a push registration landed. */
export interface DeviceTokenStoreAnswer {
  stored: true;
}

export function deviceTokenStoreAnswerFromWire(
  value: UnparsedWireValue,
): DeviceTokenStoreAnswer | undefined {
  if (!isRecord(value) || value.stored !== true) return undefined;
  return { stored: true };
}

/** Confirms whether a sign-out found and removed the phone's registration. */
export interface DeviceTokenDeleteAnswer {
  deleted: boolean;
}

export function deviceTokenDeleteAnswerFromWire(
  value: UnparsedWireValue,
): DeviceTokenDeleteAnswer | undefined {
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
 *
 * The detail fields are the session vocabulary's own, and the reader holds
 * them to that vocabulary's own bounds: `change` to an HTTPS address, `link`
 * to the openable session-link schemes. `link` is the one observed field a
 * surface acts on rather than draws, so an address outside the set never
 * crosses the wire at all.
 */
export interface ObservedSession
  extends Pick<SessionDetail, "branch" | "change" | "error" | "link"> {
  /** The cloud-agent provider id for this session (conductor today). */
  providerId: string;
  /** The provider's own id for this session. */
  sessionId: string;
  /** Bounded session title. */
  title: string;
  /** One of the SESSION_STATUS string values. */
  status: string;
  /** Repository label or workspace name, when the provider reported one. */
  workspace?: string;
  /** Unix milliseconds of the provider's last write about the session, when it reported one. */
  lastActivityAt?: number;
  /**
   * The name `lastActivityAt` traveled under before it was renamed. The
   * service still writes it beside the new name, and a reader still accepts
   * it, so an installed iOS build keeps its age chip and recency sort until
   * it updates; it may go once the first iOS release that reads
   * `lastActivityAt` has shipped. Nothing else reads or writes it.
   */
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
   * state, so a screen that sees it absent has no conversation to draw and
   * says so.
   */
  canReadConversation?: boolean;
}

/** The observe endpoint answer: the caller's cloud sessions across all providers. */
export interface ObserveAnswer {
  sessions: ObservedSession[];
}

const OBSERVED_SESSION_STATUS_SET: ReadonlySet<string> = new Set(Object.values(SESSION_STATUS));

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
  const linkValue = text(value.link);
  const link = linkValue ? normalizeSessionDetail({ link: linkValue }).link : undefined;
  const error = text(value.error);
  const lastActivityAt = wholeNumber(value.lastActivityAt) ?? wholeNumber(value.observedAt);
  const session: ObservedSession = { providerId, sessionId, title, status };
  if (workspace) session.workspace = workspace;
  if (branch) session.branch = branch;
  if (change) session.change = change;
  if (link) session.link = link;
  if (error) session.error = error;
  if (lastActivityAt !== undefined) session.lastActivityAt = lastActivityAt;
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
export interface HostedWorkspaceProject
  extends Pick<
    WorkspaceProject,
    "namesItself" | "providerProjectId" | "repository" | "targetName" | "taskSupport"
  > {
  /** The cloud-agent provider id that reported this project. */
  providerId: string;
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
 * What the message and workspace-creation act endpoints return. The outcome
 * is `ACT_RESULT_STATUS`, the vocabulary every adapter already answers an act
 * in, under the field name the phone reads. It is the status alone and never
 * the adapter's whole `ActResult`: the reason is optional here, and the
 * workspace form carries a field of its own.
 */
export interface HostedActAnswer {
  result: ActResultStatus;
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
  if (!isActResultStatus(result)) return undefined;
  const reason = isWireString(value.reason) ? value.reason : undefined;
  return { result, ...(reason ? { reason } : undefined) };
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
