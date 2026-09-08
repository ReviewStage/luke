/**
 * The desktop process as the Gateway's clients see it: one operator client,
 * and one node offering this machine's native capabilities. The names are
 * fixed by the build; a capability the host asks for by any other name
 * answers unavailable.
 */
export const DESKTOP_OPERATOR_CLIENT_ID = "desktop-operator";
export const DESKTOP_NATIVE_NODE_ID = "desktop-native";

export const NODE_CAPABILITY = {
  /** Hands an address to the operating system, as a row press does. */
  OPEN_EXTERNAL: "os.openExternal",
  /** Carries an app act only the panel can perform and answers what became of it. */
  PANEL_APP_ACT: "panel.performAppAct",
} as const;

export type NodeCapability = (typeof NODE_CAPABILITY)[keyof typeof NODE_CAPABILITY];
