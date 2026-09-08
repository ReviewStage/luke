/**
 * Where a session's work is actually running. It is not the provider: the same
 * provider can hold a session on this machine and one in a datacentre, and only
 * the session knows which it is. Local is the default, so a session is only
 * reported as remote by an adapter that observed it over the network.
 */
export const SESSION_LOCATION = {
  LOCAL: "local",
  CLOUD: "cloud",
} as const;

export type SessionLocation = (typeof SESSION_LOCATION)[keyof typeof SESSION_LOCATION];

/** A stable provider identity and the label that can be shown in the UI. */
export interface SessionProvider {
  id: string;
  displayName: string;
}

/**
 * Apps that can hold a local agent session without becoming that session's
 * agent provider. A Codex conversation, for example, can be visible in both
 * Conductor and ChatGPT while it remains a Codex conversation.
 */
export const SESSION_APPLICATION_ID = {
  CHATGPT: "chatgpt",
  CLAUDE: "claude",
  CONDUCTOR: "conductor",
  SUPERSET: "superset",
} as const;

export type SessionApplicationId =
  (typeof SESSION_APPLICATION_ID)[keyof typeof SESSION_APPLICATION_ID];

export const SESSION_APPLICATION_ID_LIST: readonly SessionApplicationId[] =
  Object.values(SESSION_APPLICATION_ID);

export function isSessionApplicationId(value: string): value is SessionApplicationId {
  return SESSION_APPLICATION_ID_LIST.some((candidate) => candidate === value);
}

/** Where an app association is drawn when several chats share one workspace. */
export const SESSION_APPLICATION_SCOPE = {
  SESSION: "session",
  WORKSPACE: "workspace",
} as const;

export type SessionApplicationScope =
  (typeof SESSION_APPLICATION_SCOPE)[keyof typeof SESSION_APPLICATION_SCOPE];

/**
 * One app in which an observed local session appears. The optional address is
 * the app's exact route to that chat; absence means Luke can name the
 * association but has no documented way to open it.
 */
export interface SessionApplication {
  id: string;
  displayName: string;
  scope: SessionApplicationScope;
  link?: string;
}

/** Identifies a session without conflating identifiers from different providers. */
export interface SessionIdentity {
  providerId: string;
  providerSessionId: string;
}

/**
 * The schemes Luke will hand a session's address to the operating system with:
 * `https` for a provider that keeps the session in its own cloud, and an app
 * scheme for one that registered a handler for its own windows on this machine.
 *
 * A link is the one observed field the surface does not merely draw — it acts on
 * it — and it arrives from provider-owned data like every other field. So the
 * set is fixed by this build and applied where every other bound is applied:
 * an address outside it never reaches a session at all, rather than being
 * checked again wherever something is about to open one.
 */
export const SESSION_LINK_SCHEME = {
  HTTPS: "https:",
  CLAUDE: "claude:",
  CODEX: "codex:",
  CONDUCTOR: "conductor:",
  SUPERSET: "superset:",
} as const;

const SESSION_LINK_SCHEMES: ReadonlySet<string> = new Set(Object.values(SESSION_LINK_SCHEME));

/** Whether an address is one Luke may ask the system to open. */
export function isOpenableSessionLink(link: string): boolean {
  try {
    return SESSION_LINK_SCHEMES.has(new URL(link).protocol);
  } catch {
    return false;
  }
}
