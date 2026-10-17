/**
 * host-concerns.ts -- the host's concerns by name, which of them a platform may leave out, what a left-out one answers, and what the platform offers for it.
 *
 * Every concern but the platform ones runs wherever the host does. A
 * platform concern reaches something only some hosts have: a process
 * spawner, a terminal's relay socket, this Mac's own repositories. The
 * assembly is built with the platform concerns its host chose; one left out
 * is never started, asks for nothing, and answers each of its methods with a
 * refusal, so a client that asks anyway is told no rather than crashing.
 */
import {
  GATEWAY_METHOD,
  type GatewayMethod,
  type GatewayMethodHandler,
  type GatewayMethodTable,
  RefusedRefusal,
} from "@luke/gateway";
import { HOST_CAPABILITY, type HostCapability } from "@luke/settings";
import { Effect } from "effect";
import type { Composer } from "./composer.js";

/** The concerns, by the name each is built under. */
export const HOST_CONCERN = {
  SETTINGS: "settings",
  ACCOUNT: "account",
  LIVE: "live",
  TASKS: "planning",
  CODING_AGENTS: "codingAgents",
  AUTOMATIONS: "automations",
  ISSUES: "issues",
  INTEGRATIONS: "integrations",
  MAC_COMMANDS: "macCommands",
  MAC_TERMINAL: "macTerminal",
  TERMINALS: "terminals",
} as const;

export type HostConcern = (typeof HOST_CONCERN)[keyof typeof HOST_CONCERN];

/** The concerns a host may leave out, for want of what they reach on its platform. */
export const HOST_PLATFORM_CONCERN = {
  MAC_COMMANDS: HOST_CONCERN.MAC_COMMANDS,
  MAC_TERMINAL: HOST_CONCERN.MAC_TERMINAL,
  TERMINALS: HOST_CONCERN.TERMINALS,
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

/** What each platform concern offers the client, which a host that left it out does not. */
const CAPABILITY_OF_CONCERN = {
  [HOST_PLATFORM_CONCERN.MAC_COMMANDS]: HOST_CAPABILITY.MAC_COMMANDS,
  [HOST_PLATFORM_CONCERN.MAC_TERMINAL]: HOST_CAPABILITY.MAC_TERMINAL,
  [HOST_PLATFORM_CONCERN.TERMINALS]: HOST_CAPABILITY.TERMINALS,
} as const satisfies Readonly<Record<HostPlatformConcern, HostCapability>>;

/** A capability the client answers for itself, rather than a concern of the host it runs. */
export type ClientCapability = Exclude<
  HostCapability,
  (typeof CAPABILITY_OF_CONCERN)[HostPlatformConcern]
>;

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
    if (concerns.has(concern)) offered.add(CAPABILITY_OF_CONCERN[concern]);
  }
  return Object.values(HOST_CAPABILITY).filter((capability) => offered.has(capability));
}

/** The methods each platform concern answers, which a host that left it out refuses. */
const PLATFORM_CONCERN_METHODS = {
  [HOST_PLATFORM_CONCERN.MAC_COMMANDS]: [],
  [HOST_PLATFORM_CONCERN.MAC_TERMINAL]: [
    GATEWAY_METHOD.MAC_REPOSITORIES_READ,
    GATEWAY_METHOD.MAC_REPOSITORY_SET,
  ],
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
  ],
} as const satisfies Readonly<Record<HostPlatformConcern, readonly GatewayMethod[]>>;

/** The table a platform concern's composer answers: every method it names, and no other. */
export type PlatformConcernMethods<Concern extends HostPlatformConcern> = Readonly<
  Record<(typeof PLATFORM_CONCERN_METHODS)[Concern][number], GatewayMethodHandler>
>;

/** What a method of a concern this host left out answers. */
export const NOT_ON_THIS_PLATFORM = "not available on this platform";

/** A platform concern this host left out: nothing begun, and each of its methods refused. */
export function unavailableConcern(concern: HostPlatformConcern): Composer {
  const methods: GatewayMethodTable = {};
  for (const method of PLATFORM_CONCERN_METHODS[concern]) {
    methods[method] = () => Effect.fail(new RefusedRefusal({ message: NOT_ON_THIS_PLATFORM }));
  }
  return { methods, lifetime: Effect.void };
}
