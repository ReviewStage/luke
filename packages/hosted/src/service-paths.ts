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
   * ask can only ever name a reported project. Stored nowhere: a projects
   * request is its own pass.
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
   * memory from the latest fold onward, the standing context, and
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
   * names, and the bounds before sending anything; POST the two Responses
   * operations with a prepared prompt and tool names, and the same admitted
   * input array.
   */
  BRAIN_CAPABILITIES: "/api/brain/capabilities",
  BRAIN_RESPOND_V2: "/api/brain/v2/respond",
  BRAIN_COUNT_TOKENS: "/api/brain/v2/count-tokens",
  /** Embeddings for the notebook index on Luke's key (POST), the third operation of the second contract. */
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
   * The signed-in user's cloud sessions (GET): the bounded roster the
   * service's own scheduled pass last stored for them, run every minute for
   * accounts seen within the week, or a live pass where no snapshot stands
   * yet. `OBSERVE_QUERY.FRESH` asks the provider again right now, under the
   * endpoint's per-user rate brake.
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

/**
 * Where the hosted voice service answers: two Vercel Functions of the same
 * service, reached at `HOSTED_VOICE_SERVICE_ORIGIN`, the socket form of the
 * service's own origin. Each path is a WebSocket upgrade; one connection
 * carries one session, or one attachment to a session that stands.
 */
export const VOICE_SERVICE_PATH = {
  /** A signed-in desktop's voice session; the account bearer travels on the handshake. */
  SESSIONS: "/api/voice/sessions",
  /** The accountless introduction session, metered by the function itself; no bearer. */
  INTRODUCTION: "/api/voice/introduction",
} as const;

/** Rate one of Luke's stored messages (PUT): the one hosted path with a row's id inside it rather than in a body. */
export function conversationMessageRatingPath(messageId: string): string {
  return `/api/conversation/messages/${encodeURIComponent(messageId)}/rating`;
}
