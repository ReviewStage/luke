/**
 * host-concerns.ts -- the host's concerns by name, which of them a platform may leave out, what a left-out one answers, and what the platform offers for it.
 *
 * Every concern but the platform ones runs wherever the host does. A
 * platform concern reaches something only some hosts have: a process
 * spawner, This Mac's host, a terminal's relay socket, a listener on the
 * machine's own loopback, a loopback the browser hands a sign-in back to. The
 * assembly is built with the platform concerns its host chose; one left out
 * is never started, asks for nothing, and answers each of its methods with a
 * refusal, so a client that asks anyway is told no rather than crashing.
 */
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

/** The concerns, by the name each is built under. */
export const HOST_CONCERN = {
  SETTINGS: "settings",
  ACCOUNT: "account",
  TASKS: "tasks",
  WORKSPACES: "workspaces",
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

/** The concerns a host may leave out, for want of what they reach on its platform. */
export const HOST_PLATFORM_CONCERN = {
  MAC_COMMANDS: HOST_CONCERN.MAC_COMMANDS,
  THIS_MAC_HOST: HOST_CONCERN.THIS_MAC_HOST,
  TERMINALS: HOST_CONCERN.TERMINALS,
  PORT_FORWARDS: HOST_CONCERN.PORT_FORWARDS,
  MIRRORS: HOST_CONCERN.MIRRORS,
} as const;

export type HostPlatformConcern =
  (typeof HOST_PLATFORM_CONCERN)[keyof typeof HOST_PLATFORM_CONCERN];

/** Every platform concern: what a host that can run all of them, the desktop, chooses. */
export const ALL_HOST_PLATFORM_CONCERNS: readonly HostPlatformConcern[] =
  Object.values(HOST_PLATFORM_CONCERN);

const PLATFORM_CONCERNS: ReadonlySet<HostConcern> = new Set(ALL_HOST_PLATFORM_CONCERNS);

/** Whether a host may leave this concern out. */
export const isPlatformConcern = (concern: HostConcern): concern is HostPlatformConcern =>
  PLATFORM_CONCERNS.has(concern);

/** What each platform concern offers the client, which a host that left it out does not; This Mac's host offers nothing the panel draws by. */
const CAPABILITY_OF_CONCERN = {
  [HOST_PLATFORM_CONCERN.MAC_COMMANDS]: HOST_CAPABILITY.MAC_COMMANDS,
  [HOST_PLATFORM_CONCERN.TERMINALS]: HOST_CAPABILITY.TERMINALS,
  [HOST_PLATFORM_CONCERN.PORT_FORWARDS]: HOST_CAPABILITY.PORT_FORWARDS,
  [HOST_PLATFORM_CONCERN.MIRRORS]: HOST_CAPABILITY.LOCAL_TERMINALS,
} as const satisfies Readonly<Partial<Record<HostPlatformConcern, HostCapability>>>;

/** `CAPABILITY_OF_CONCERN` read by any platform concern, one that offers none among them. */
const capabilityOf: Readonly<Partial<Record<HostPlatformConcern, HostCapability>>> =
  CAPABILITY_OF_CONCERN;

/** A capability the client answers for itself, rather than a concern of the host it runs. */
export type ClientCapability = Exclude<
  HostCapability,
  (typeof CAPABILITY_OF_CONCERN)[keyof typeof CAPABILITY_OF_CONCERN]
>;

const CONCERN_CAPABILITIES: ReadonlySet<HostCapability> = new Set(
  Object.values(CAPABILITY_OF_CONCERN),
);

/** Whether a capability is one a client answers for itself. */
const isClientCapability = (capability: HostCapability): capability is ClientCapability =>
  !CONCERN_CAPABILITIES.has(capability);

/**
 * Every capability a client may answer for itself: what the desktop, which
 * answers them all, offers. Derived rather than listed, so a capability added
 * to `HOST_CAPABILITY` stands on the desktop without a second list to forget
 * it in.
 */
export const ALL_CLIENT_CAPABILITIES: readonly ClientCapability[] =
  Object.values(HOST_CAPABILITY).filter(isClientCapability);

/**
 * What the platform offers: the client's own capabilities and the one each
 * platform concern this host runs stands for, in `HOST_CAPABILITY`'s order.
 */
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

/** The methods each platform concern answers, which a host that left it out refuses. */
const PLATFORM_CONCERN_METHODS = {
  // Note that the Mac commands are answered only as a declared act (`MAC_COMMAND_ANSWER`), as This Mac's host is.
  [HOST_PLATFORM_CONCERN.MAC_COMMANDS]: [],
  // Note that This Mac's host tells the windows itself, and is asked only to turn on or off, a declared act (`HOSTS_THIS_MAC_SET`).
  [HOST_PLATFORM_CONCERN.THIS_MAC_HOST]: [],
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
    GATEWAY_METHOD.TERMINALS_SHOWN,
    GATEWAY_METHOD.TERMINALS_DISCONNECT,
    GATEWAY_METHOD.TERMINALS_WAKE,
    GATEWAY_METHOD.BROWSER_LIVE_CONNECT,
    GATEWAY_METHOD.BROWSER_LIVE_SEND,
    GATEWAY_METHOD.BROWSER_LIVE_DISCONNECT,
  ],
  // Note that forwarding is turned on or off only as a declared act (`PORT_FORWARD_SET`).
  [HOST_PLATFORM_CONCERN.PORT_FORWARDS]: [],
  [HOST_PLATFORM_CONCERN.MIRRORS]: [GATEWAY_METHOD.MIRRORS_ENSURE],
} as const satisfies Readonly<Record<HostPlatformConcern, readonly GatewayMethod[]>>;

/** The table a platform concern's composer answers: every method it names, and no other. */
export type PlatformConcernMethods<Concern extends HostPlatformConcern> = Readonly<
  Record<(typeof PLATFORM_CONCERN_METHODS)[Concern][number], GatewayMethodHandler>
>;

/** What a method of a concern this host left out answers. */
export const NOT_ON_THIS_PLATFORM = "not available on this platform";

/** A platform concern this host left out: nothing begun, and each of its methods refused. */
export function unavailableConcern(concern: HostPlatformConcern): Composer {
  const methods: HostMethodTable = {};
  for (const method of PLATFORM_CONCERN_METHODS[concern]) {
    methods[method] = () => Effect.fail(new RefusedRefusal({ message: NOT_ON_THIS_PLATFORM }));
  }
  return { methods, lifetime: Effect.void };
}
