/**
 * The host's two clients as the Gateway sees them: one operator, and one node
 * offering the capabilities only the machine the client runs on can perform.
 * The names are fixed by the build; a capability the host asks for by any
 * other name answers unavailable. Every invocation travels on the node's own
 * authenticated connection and is answered there alone; none is ever an
 * event, so no reconnection can replay an ask to act.
 *
 * The names live behind their own door so a client can register a node
 * without resolving the host it is registering with.
 */
export const HOST_OPERATOR_CLIENT_ID = "operator";
export const HOST_NATIVE_NODE_ID = "native";

export const HOST_NODE_CAPABILITY = {
  /**
   * Hands an address to the operating system, as a row press does. The
   * invocation says what the address is, in `HOST_NODE_OPEN_KIND`'s words.
   */
  OPEN_EXTERNAL: "os.openExternal",
  /** Carries an app action only the panel can perform and answers what became of it. */
  PANEL_APP_ACTION: "panel.performAppAction",
  /**
   * Runs one invocation of this Mac's EventKit helper — a command fixed by
   * the build with the window's instants and calendar ids — and answers its
   * stdout. The helper is a native device capability, so it runs where the
   * device is: the client that holds it. The calendar policy that decides
   * what to ask it, and what to keep of the answer, stays the host's.
   */
  APPLE_CALENDAR_HELPER: "appleCalendar.runHelper",
} as const;

export type HostNodeCapability = (typeof HOST_NODE_CAPABILITY)[keyof typeof HOST_NODE_CAPABILITY];

export const HOST_NODE_CAPABILITY_LIST: readonly HostNodeCapability[] =
  Object.values(HOST_NODE_CAPABILITY);

/**
 * What the address handed to `OPEN_EXTERNAL` is. The host says only that; the
 * windows are the client's, so what the client does with its own behind the
 * open is decided where the windows are.
 */
export const HOST_NODE_OPEN_KIND = {
  /**
   * An address with nothing owed behind it: a row's own press, whose panel
   * stood itself down at the press; a consent page; a manager's link.
   */
  ADDRESS: "address",
  /**
   * A session's address, or one of its app routes, opened at an ask of Luke
   * in conversation. No row was pressed, so no panel stood itself down, and
   * Luke floats above the very chat he was asked to bring forward until the
   * client stands its panels down behind the open.
   */
  ASKED_SESSION: "askedSession",
} as const;

export type HostNodeOpenKind = (typeof HOST_NODE_OPEN_KIND)[keyof typeof HOST_NODE_OPEN_KIND];

const HOST_NODE_OPEN_KIND_SET: ReadonlySet<string> = new Set(Object.values(HOST_NODE_OPEN_KIND));

export function isHostNodeOpenKind(value: string): value is HostNodeOpenKind {
  return HOST_NODE_OPEN_KIND_SET.has(value);
}
