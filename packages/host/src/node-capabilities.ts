/**
 * The host's two clients as the Gateway sees them: one operator, and one node
 * offering the capability only the machine the client runs on can perform.
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
  /** Hands an address to the operating system, as a row press does: the pressing panel has stood itself down already. */
  OPEN_EXTERNAL: "os.openExternal",
  /** Draws a plan's board as the Plans panel shows it, answered as a look's result: a PNG, or why there is none. */
  RENDER_BOARD: "board.render",
} as const;

export type HostNodeCapability = (typeof HOST_NODE_CAPABILITY)[keyof typeof HOST_NODE_CAPABILITY];

export const HOST_NODE_CAPABILITY_LIST: readonly HostNodeCapability[] =
  Object.values(HOST_NODE_CAPABILITY);
