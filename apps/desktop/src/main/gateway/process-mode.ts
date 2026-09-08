import path from "node:path";
import { GATEWAY_PROTOCOL_VERSION, type GatewayBuildIdentity } from "@sidecar/runtime-contracts";

/**
 * The two modes the one signed executable runs in, decided from its
 * arguments alone: the desktop client, which draws the panels, or the
 * Gateway, which draws nothing and hosts the runtime. The Gateway keeps a
 * distinct Electron profile, so its single-instance lock and caches never
 * collide with the desktop's, while its state root stays Luke's own
 * application data, passed explicitly, so the databases, notebook, and
 * credentials it owns are the ones the desktop always kept.
 */
export const GATEWAY_PROCESS_ARGUMENT = "--gateway";
export const GATEWAY_STATE_ROOT_ARGUMENT = "--state-root";
/**
 * Leaves the developer's own provider configurations untouched: no
 * observation hook is registered with Claude Code or Codex. For a validation
 * run on a temporary state root, whose Gateway must not reach into the real
 * user-level hook surfaces; observation still reads the transcripts.
 */
export const NO_PROVIDER_HOOKS_ARGUMENT = "--no-provider-hooks";

export const GATEWAY_PROFILE_DIRECTORY = "gateway-profile";
export const GATEWAY_STATE_DIRECTORY = "gateway";
export const GATEWAY_DISCOVERY_FILE = "discovery.json";
export const GATEWAY_LOCK_FILE = "instance.lock";

export function isGatewayProcess(argv: readonly string[]): boolean {
  return argv.includes(GATEWAY_PROCESS_ARGUMENT);
}

/** The state root a Gateway was told to own, or nothing when it should derive the default. */
export function gatewayStateRootArgument(argv: readonly string[]): string | undefined {
  const prefix = `${GATEWAY_STATE_ROOT_ARGUMENT}=`;
  const inline = argv.find((argument) => argument.startsWith(prefix));
  return inline?.slice(prefix.length) || undefined;
}

export function gatewayProfilePath(stateRoot: string): string {
  return path.join(stateRoot, GATEWAY_PROFILE_DIRECTORY);
}

export function gatewayDiscoveryPath(stateRoot: string): string {
  return path.join(stateRoot, GATEWAY_STATE_DIRECTORY, GATEWAY_DISCOVERY_FILE);
}

export function gatewayLockPath(stateRoot: string): string {
  return path.join(stateRoot, GATEWAY_STATE_DIRECTORY, GATEWAY_LOCK_FILE);
}

export function registersProviderHooks(argv: readonly string[]): boolean {
  return !argv.includes(NO_PROVIDER_HOOKS_ARGUMENT);
}

/** The arguments that start the Gateway for a state root; the executable and app path are the launcher's. */
export function gatewayProcessArguments(
  stateRoot: string,
  options: { registerProviderHooks?: boolean } = {},
): readonly string[] {
  return [
    GATEWAY_PROCESS_ARGUMENT,
    `${GATEWAY_STATE_ROOT_ARGUMENT}=${stateRoot}`,
    ...(options.registerProviderHooks === false ? [NO_PROVIDER_HOOKS_ARGUMENT] : []),
  ];
}

export interface GatewayBuildContext {
  appName: string;
  version: string;
  packaged: boolean;
  /** For an unpackaged run, something that changes with the code, so a rebuilt development app drains the Gateway the old code left. */
  developmentStamp?: string;
}

/**
 * What one build calls itself on the handshake. A packaged build is its name
 * and version; a development run adds a stamp of its bundle, because two
 * development runs of the same version can be different code, and the one
 * thing the process split must never do is operate a Gateway of other code.
 */
export function gatewayBuildIdentity(context: GatewayBuildContext): GatewayBuildIdentity {
  const stamp =
    !context.packaged && context.developmentStamp ? `+dev.${context.developmentStamp}` : "";
  return {
    protocolVersion: GATEWAY_PROTOCOL_VERSION,
    buildVersion: `${context.appName}@${context.version}${stamp}`,
  };
}

/**
 * The force stop the supervisor reaches only past its waits: the graceful
 * shutdown was asked over the protocol and waited for, so what is left is a
 * Gateway that cannot act on a signal at all (stopped, or stuck in the
 * runtime), and only SIGKILL ends that. A gentler signal here would be a
 * second ask of a process that already failed to answer the first.
 */
export function forceKillGateway(
  pid: number,
  kill: (pid: number, signal: NodeJS.Signals) => void = (target, signal) =>
    process.kill(target, signal),
): void {
  try {
    kill(pid, "SIGKILL");
  } catch {
    // Already gone between the check and the signal.
  }
}
