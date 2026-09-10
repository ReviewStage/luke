/**
 * Where Luke's hosted service answers, rooted at the service origin. The
 * addresses alone: what each endpoint takes and answers with is declared in
 * the wire module for its own domain, and a client that only needs to know
 * where to knock imports nothing else.
 */

export const HOSTED_SERVICE_PATH = {
  VOICE_MINT: "/api/voice/mint",
  /**
   * Mints one ephemeral Realtime credential for the signed-in iPhone and
   * answers with the user's cloud session roster pre-serialized as a context
   * item (POST). Same quota meter as VOICE_MINT; narrowed to the tool set the
   * mobile action endpoints serve.
   */
  REMOTE_VOICE_MINT: "/api/voice/remote-mint",
  /** Send a message to a cloud session (POST). */
  ACTION_MESSAGE: "/api/actions/message",
  /** Create a workspace in a cloud project (POST). */
  ACTION_WORKSPACE: "/api/actions/workspace",
  /** Run a control the session's latest observation advertised (POST). */
  ACTION_CONTROL: "/api/actions/control",
  /** Start another agent in the workspace an observed session runs in (POST). */
  ACTION_AGENT: "/api/actions/agent",
  /** Rename an observed session itself — the chat (POST). */
  ACTION_RENAME_SESSION: "/api/actions/rename-session",
  /** Rename the workspace an observed session runs in (POST). */
  ACTION_RENAME_WORKSPACE: "/api/actions/rename-workspace",
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
   * ordinary endpoint does, so `hostedMintAnswerSchema` validates both.
   */
  INTRODUCTION_MINT: "/api/voice/introduction-mint",
  /**
   * Run one turn of Luke's brain on Luke's key (POST), for a developer with
   * none of their own. The desktop sends the brain's own input array — its
   * memory from the latest compaction item onward, the standing context, and
   * the turn's new items — and the service holds the instructions, the tool
   * schemas, and the model fixed by its own build, answering with the raw
   * Responses payload for the desktop to append and act on. Kept for the
   * installed desktops through 0.5.0 that speak only this contract; retire it
   * once none remain.
   */
  BRAIN_RESPOND: "/api/brain/respond",
  /**
   * The second brain contract (see `brain-contract.ts`). GET the
   * capabilities to learn the model, the operations, the registered tool
   * names, and the bounds before sending anything; POST the three operations
   * with a prepared prompt and tool names, and the same admitted input array.
   */
  BRAIN_CAPABILITIES: "/api/brain/capabilities",
  BRAIN_RESPOND_V2: "/api/brain/v2/respond",
  BRAIN_COUNT_TOKENS: "/api/brain/v2/count-tokens",
  BRAIN_COMPACT: "/api/brain/v2/compact",
  /** Embeddings for the notebook index on Luke's key (POST), the fourth operation of the second contract. */
  BRAIN_EMBED: "/api/brain/v2/embed",
  ACCOUNT_DELETE: "/api/account/delete",
  USAGE: "/api/usage",
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
   * The signed-in installation's device row: register it (POST), move its
   * last-seen instant and carry a presence or push token change (PUT), or
   * forget it at sign-out (DELETE). One row per installation on every
   * platform, keyed by the id the client minted, and it moves to whichever
   * account the device last signed in under.
   */
  DEVICES: "/api/devices",
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
  /**
   * The two routes only the hosted voice service calls, under
   * {@link VOICE_SERVICE_SECRET_HEADER} rather than an account bearer: before
   * creating a Live session, authorize the account whose bearer opened the
   * socket and spend its voice allowance (POST); after `session.closed`,
   * record the billed seconds once (POST). No desktop calls either.
   */
  VOICE_AUTHORIZE: "/api/internal/voice/authorize",
  VOICE_USAGE: "/api/internal/voice/usage",
} as const;

/**
 * Where the hosted voice service answers, rooted at
 * `HOSTED_VOICE_SERVICE_ORIGIN` rather than the account service's origin,
 * because the service is its own long-running process. Each path is a
 * WebSocket upgrade: one session per socket.
 */
export const VOICE_SERVICE_PATH = {
  /** A signed-in desktop's voice session; the account bearer travels on the handshake. */
  SESSIONS: "/sessions",
  /** The accountless introduction session, metered by the service itself; no bearer. */
  INTRODUCTION: "/introduction",
} as const;

/**
 * The header the voice service authenticates its internal calls with. The
 * value is a shared secret both deployments hold, compared on the account
 * service in constant time, and it is the whole of the identity those two
 * routes accept: an account bearer on them is refused.
 */
export const VOICE_SERVICE_SECRET_HEADER = "x-luke-voice-service-secret";
