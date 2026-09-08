/**
 * The desktop process as the Gateway's clients see it: one operator client,
 * and one node offering this machine's native capabilities. The names are
 * fixed by the build; a capability the host asks for by any other name
 * answers unavailable. Every invocation travels on the node's own
 * authenticated connection and is answered there alone; none is ever an
 * event, so no reconnection can replay an ask to act.
 */
export const DESKTOP_OPERATOR_CLIENT_ID = "desktop-operator";
export const DESKTOP_NATIVE_NODE_ID = "desktop-native";

export const NODE_CAPABILITY = {
  /** Hands an address to the operating system, as a row press does. */
  OPEN_EXTERNAL: "os.openExternal",
  /** Carries an app act only the panel can perform and answers what became of it. */
  PANEL_APP_ACT: "panel.performAppAct",
  /**
   * Runs one invocation of this Mac's EventKit helper — a command fixed by
   * the build with the window's instants and calendar ids — and answers its
   * stdout. The helper is a native device capability, so it runs where the
   * device is: the desktop. The calendar policy that decides what to ask it,
   * and what to keep of the answer, stays the host's.
   */
  APPLE_CALENDAR_HELPER: "appleCalendar.runHelper",
} as const;

export type NodeCapability = (typeof NODE_CAPABILITY)[keyof typeof NODE_CAPABILITY];

export const NODE_CAPABILITY_LIST: readonly NodeCapability[] = Object.values(NODE_CAPABILITY);
