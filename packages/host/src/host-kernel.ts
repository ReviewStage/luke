import path from "node:path";
import { type GatewayEventKind, NODE_CAPABILITY_STATUS, NodeRegistry } from "@sidecar/gateway";
import { type AgentId, DEFAULT_AGENT_ID } from "@sidecar/runtime/vocabulary";
import type { WireValue } from "@sidecar/wire";
import { Effect } from "effect";
import type { MachinePresence } from "./device-presence.js";
import {
  HOST_NODE_CAPABILITY,
  HOST_NODE_OPEN_KIND,
  type HostNodeOpenKind,
} from "./node-capabilities.js";
import type { RunMode } from "./run-mode.js";
import { NodeAnswerLostError } from "./session-opens.js";
import type { SecretCipher } from "./settings-store.js";

export interface HostSeams {
  /** Luke's own application-state root, given explicitly: never derived from the hosting process's profile. */
  stateRoot: string;
  runMode: RunMode;
  appVersion: string;
  packaged: boolean;
  /** The environment the host reads its development overrides from. */
  environment: NodeJS.ProcessEnv;
  cipher: SecretCipher;
  createId: () => string;
  report: (message: string) => void;
  /**
   * The machine's own idle time and lock state, read by the client that runs
   * on it, for the presence this installation's device row reports. A host
   * with no client on the machine reports no presence.
   */
  machinePresence?: () => MachinePresence;
  /**
   * Hears the protocol's shutdown method: the client's explicit Quit, or a
   * newer build draining this one. The process hosting the runtime leaves in
   * the coordinator's order; a host with no process to leave (a fixture run)
   * hears nothing.
   */
  onShutdownRequested?: () => void;
}

/**
 * The agent's own directory under Luke's application data, one per agent:
 * where earlier builds kept the local brain's store and workspace, and what a
 * launch still looks under to remove the retired store.
 */
const AGENTS_DIRECTORY = "agents";

function agentRootPath(stateRoot: string, agentId: AgentId = DEFAULT_AGENT_ID): string {
  return path.join(stateRoot, AGENTS_DIRECTORY, agentId);
}

/**
 * What every composer of the host is handed: the seams the host was given,
 * the two derived base URLs, the node registry, the one event door, and the
 * agent's own directory. It holds no concern of its own, so
 * nothing a composer owns can be reached through it by another.
 */
export interface HostKernel {
  readonly runMode: RunMode;
  readonly stateRoot: string;
  readonly now: () => number;
  readonly createId: () => string;
  readonly report: (message: string) => void;
  readonly accountBaseUrl: string;
  readonly hostedServiceBaseUrl: string;
  readonly nodes: NodeRegistry;
  /** One host event, numbered into the log every client follows. */
  emit: (kind: GatewayEventKind, payload: WireValue) => void;
  /**
   * An address a host-owned flow needs opened: the native node's. No node
   * connected is a refusal the action reports as not done; a node that took the
   * ask and vanished before answering is the lost-answer error, which every
   * caller that journals an action records as unknown rather than failed.
   * The kind is what the address is, an address unless a caller says
   * otherwise; the node decides from it what its own windows owe the open.
   *
   * A promise and not an effect: the three composers that hand this on hand it
   * to seams outside this package — the account session manager's consent, the
   * calendar sign-in's page, the roster subscriber's created-workspace open —
   * each of which is a synchronous or promise-shaped callback owned by
   * `@sidecar/credentials` and `@sidecar/calendar`, and what would end that is
   * a decision about those seams rather than anything this kernel holds.
   */
  openExternalThroughNode: (url: string, kind?: HostNodeOpenKind) => Promise<void>;
  reportOpenFailure: (error: Error) => void;
  /** The agent's own directory under the state root. */
  agentRootPath: () => string;
}

/**
 * The account service this build may be pointed at. A development build may be
 * pointed at a local one; a packaged one may not. The override redirects the
 * whole sign-in — including the identity request that carries the access token
 * — so it stops at the packaging boundary rather than shipping inside a signed
 * binary.
 */
export const ACCOUNT_BASE_URL_VARIABLE = "LUKE_ACCOUNT_BASE_URL";

const ACCOUNT_BASE_URL = "https://tryluke.dev/api/auth";

export function accountBaseUrlFor(input: {
  readonly packaged: boolean;
  readonly override: string | undefined;
}): string {
  return (input.packaged ? undefined : input.override) ?? ACCOUNT_BASE_URL;
}

/**
 * The hosted voice endpoints live on the same origin as the account service, so
 * the one development override redirects both together.
 */
function hostedServiceBaseUrlFor(accountBaseUrl: string): string {
  return accountBaseUrl.replace(/\/api\/auth\/?$/, "");
}

/** Everything the kernel is built over, once each seam has been read for itself. */
export interface HostKernelParts {
  readonly stateRoot: string;
  readonly runMode: RunMode;
  readonly accountBaseUrl: string;
  readonly now: () => number;
  readonly createId: () => string;
  readonly report: (message: string) => void;
  /**
   * The event door itself, already resolved against the late service: the
   * merge composes the service after several composers have begun wiring
   * their callbacks, so this is built to hold what it cannot yet deliver
   * rather than to read a service that may not stand.
   */
  readonly emit: (kind: GatewayEventKind, payload: WireValue) => void;
}

export function hostKernelOver(parts: HostKernelParts): HostKernel {
  const { stateRoot, runMode, accountBaseUrl, now, createId, report, emit } = parts;
  const nodes = new NodeRegistry();

  return {
    runMode,
    stateRoot,
    now,
    createId,
    report,
    accountBaseUrl,
    hostedServiceBaseUrl: hostedServiceBaseUrlFor(accountBaseUrl),
    nodes,
    emit,
    openExternalThroughNode: async (url, kind = HOST_NODE_OPEN_KIND.ADDRESS) => {
      const result = await Effect.runPromise(
        nodes.invoke(HOST_NODE_CAPABILITY.OPEN_EXTERNAL, { url, kind }),
      );
      if (result.status === NODE_CAPABILITY_STATUS.OK) return;
      if (result.status === NODE_CAPABILITY_STATUS.UNKNOWN) {
        throw new NodeAnswerLostError(result.reason);
      }
      throw new Error(result.reason);
    },
    reportOpenFailure: (error) => {
      report(`An address could not be opened: ${error.message}`);
    },
    agentRootPath: () => agentRootPath(stateRoot),
  };
}
