export const HOST_OPERATOR_CLIENT_ID = "operator";
export const HOST_NATIVE_NODE_ID = "native";

export const HOST_NODE_CAPABILITY = {
  OPEN_EXTERNAL: "os.openExternal",
} as const;

export type HostNodeCapability = (typeof HOST_NODE_CAPABILITY)[keyof typeof HOST_NODE_CAPABILITY];

export const HOST_NODE_CAPABILITY_LIST: readonly HostNodeCapability[] =
  Object.values(HOST_NODE_CAPABILITY);
