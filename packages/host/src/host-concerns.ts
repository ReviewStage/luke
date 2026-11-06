import {
  GATEWAY_METHOD,
  type GatewayMethod,
  type GatewayMethodHandler,
  RefusedRefusal,
} from "@repo/gateway";
import { HOST_CAPABILITY, type HostCapability } from "@repo/settings";
import { Effect } from "effect";
import type { Composer } from "./composer.js";
import type { HostMethodTable } from "./gateway-door.js";

export const HOST_CONCERN = {
  SETTINGS: "settings",
  ACCOUNT: "account",
  TASKS: "tasks",
  AGENTS: "agents",
  AUTOMATIONS: "automations",
  INTEGRATIONS: "integrations",
  INSTALLED_SKILLS: "installedSkills",
  MAC_COMMANDS: "macCommands",
  THIS_MAC_HOST: "thisMacHost",
  TERMINALS: "terminals",
  PORT_FORWARDS: "portForwards",
  MIRRORS: "mirrors",
} as const;

export type HostConcern = (typeof HOST_CONCERN)[keyof typeof HOST_CONCERN];

export const HOST_PLATFORM_CONCERN = {
  MAC_COMMANDS: HOST_CONCERN.MAC_COMMANDS,
  THIS_MAC_HOST: HOST_CONCERN.THIS_MAC_HOST,
  TERMINALS: HOST_CONCERN.TERMINALS,
  PORT_FORWARDS: HOST_CONCERN.PORT_FORWARDS,
  MIRRORS: HOST_CONCERN.MIRRORS,
} as const;

export type HostPlatformConcern =
  (typeof HOST_PLATFORM_CONCERN)[keyof typeof HOST_PLATFORM_CONCERN];

export const ALL_HOST_PLATFORM_CONCERNS: readonly HostPlatformConcern[] =
  Object.values(HOST_PLATFORM_CONCERN);

const PLATFORM_CONCERNS: ReadonlySet<HostConcern> = new Set(ALL_HOST_PLATFORM_CONCERNS);

export const isPlatformConcern = (concern: HostConcern): concern is HostPlatformConcern =>
  PLATFORM_CONCERNS.has(concern);

const CAPABILITY_OF_CONCERN = {
  [HOST_PLATFORM_CONCERN.MAC_COMMANDS]: HOST_CAPABILITY.MAC_COMMANDS,
  [HOST_PLATFORM_CONCERN.TERMINALS]: HOST_CAPABILITY.TERMINALS,
  [HOST_PLATFORM_CONCERN.PORT_FORWARDS]: HOST_CAPABILITY.PORT_FORWARDS,
  [HOST_PLATFORM_CONCERN.MIRRORS]: HOST_CAPABILITY.LOCAL_TERMINALS,
} as const satisfies Readonly<Partial<Record<HostPlatformConcern, HostCapability>>>;

const capabilityOf: Readonly<Partial<Record<HostPlatformConcern, HostCapability>>> =
  CAPABILITY_OF_CONCERN;

export type ClientCapability = Exclude<
  HostCapability,
  (typeof CAPABILITY_OF_CONCERN)[keyof typeof CAPABILITY_OF_CONCERN]
>;

const CONCERN_CAPABILITIES: ReadonlySet<HostCapability> = new Set(
  Object.values(CAPABILITY_OF_CONCERN),
);

const isClientCapability = (capability: HostCapability): capability is ClientCapability =>
  !CONCERN_CAPABILITIES.has(capability);

export const ALL_CLIENT_CAPABILITIES: readonly ClientCapability[] =
  Object.values(HOST_CAPABILITY).filter(isClientCapability);

export function hostCapabilities(
  concerns: ReadonlySet<HostConcern>,
  client: readonly ClientCapability[],
): readonly HostCapability[] {
  const offered = new Set<HostCapability>(client);
  for (const concern of ALL_HOST_PLATFORM_CONCERNS) {
    const capability = capabilityOf[concern];
    if (concerns.has(concern) && capability !== undefined) offered.add(capability);
  }
  return Object.values(HOST_CAPABILITY).filter((capability) => offered.has(capability));
}

const PLATFORM_CONCERN_METHODS = {
  [HOST_PLATFORM_CONCERN.MAC_COMMANDS]: [GATEWAY_METHOD.MAC_COMMAND_ANSWER],
  [HOST_PLATFORM_CONCERN.THIS_MAC_HOST]: [GATEWAY_METHOD.HOSTS_THIS_MAC_SET],
  [HOST_PLATFORM_CONCERN.TERMINALS]: [
    GATEWAY_METHOD.TERMINALS_LIST,
    GATEWAY_METHOD.TERMINALS_CREATE,
    GATEWAY_METHOD.TERMINALS_RENAME,
    GATEWAY_METHOD.TERMINALS_KILL,
    GATEWAY_METHOD.TERMINALS_RESUME,
    GATEWAY_METHOD.TERMINALS_CONNECT,
    GATEWAY_METHOD.TERMINALS_INPUT,
    GATEWAY_METHOD.TERMINALS_RESIZE,
    GATEWAY_METHOD.TERMINALS_ACK,
    GATEWAY_METHOD.TERMINALS_DISCONNECT,
    GATEWAY_METHOD.TERMINALS_WAKE,
    GATEWAY_METHOD.BROWSER_LIVE_CONNECT,
    GATEWAY_METHOD.BROWSER_LIVE_SEND,
    GATEWAY_METHOD.BROWSER_LIVE_DISCONNECT,
  ],
  [HOST_PLATFORM_CONCERN.PORT_FORWARDS]: [GATEWAY_METHOD.PORT_FORWARDS_SET],
  [HOST_PLATFORM_CONCERN.MIRRORS]: [GATEWAY_METHOD.MIRRORS_ENSURE],
} as const satisfies Readonly<Record<HostPlatformConcern, readonly GatewayMethod[]>>;

export type PlatformConcernMethods<Concern extends HostPlatformConcern> = Readonly<
  Record<(typeof PLATFORM_CONCERN_METHODS)[Concern][number], GatewayMethodHandler>
>;

export const NOT_ON_THIS_PLATFORM = "not available on this platform";

export function unavailableConcern(concern: HostPlatformConcern): Composer {
  const methods: HostMethodTable = {};
  for (const method of PLATFORM_CONCERN_METHODS[concern]) {
    methods[method] = () => Effect.fail(new RefusedRefusal({ message: NOT_ON_THIS_PLATFORM }));
  }
  return { methods, lifetime: Effect.void };
}
