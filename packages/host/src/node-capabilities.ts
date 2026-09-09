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
export const HOST_OPERATOR_CLIENT_ID = "desktop-operator";
export const HOST_NATIVE_NODE_ID = "desktop-native";

export const HOST_NODE_CAPABILITY = {
  /** Hands an address to the operating system, as a row press does. */
  OPEN_EXTERNAL: "os.openExternal",
  /** Carries an app act only the panel can perform and answers what became of it. */
  PANEL_APP_ACT: "panel.performAppAct",
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
