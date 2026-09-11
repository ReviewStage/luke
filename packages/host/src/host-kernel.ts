import path from "node:path";
import type { StorePort } from "@sidecar/brain/store";
import { type GatewayEventKind, NODE_CAPABILITY_STATUS, NodeRegistry } from "@sidecar/gateway";
import type { WireValue } from "@sidecar/wire";
import type { MachinePresence } from "./device-presence.js";
import {
  HOST_NODE_CAPABILITY,
  HOST_NODE_OPEN_KIND,
  type HostNodeOpenKind,
} from "./node-capabilities.js";
import type { RunMode } from "./run-mode.js";
import type { GatewayService } from "./service.js";
import { NodeAnswerLostError } from "./session-action-performer.js";
import type { SecretCipher } from "./settings-store.js";
import { agentRootPath } from "./store-path.js";

export interface HostSeams {
  /** Luke's own application-state root, given explicitly: never derived from the hosting process's profile. */
  stateRoot: string;
  runMode: RunMode;
  appVersion: string;
  packaged: boolean;
  /** The user's home, for the Superset CLI's own directory. */
  homeDirectory: string;
  /** The environment the host reads its development overrides from. */
  environment: NodeJS.ProcessEnv;
  cipher: SecretCipher;
  createWorker: () => StorePort;
  now: () => number;
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

/** The agent's identity workspace and the skills beside it, under the agent's own directory. */
const AGENT_WORKSPACE_DIRECTORY = "workspace";
const AGENT_SKILLS_DIRECTORY = "skills";

/**
 * What every composer of the host is handed: the seams the host was given,
 * the two derived base URLs, the node registry, the one event door, and the
 * paths under the agent's own directory. It holds no concern of its own, so
 * nothing a composer owns can be reached through it by another.
 */
export interface HostKernel {
  readonly options: HostSeams;
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
  /** The service the merge composed; reading it before the merge has is a named failure, never a silent undefined. */
  service: () => GatewayService;
  setService: (service: GatewayService) => void;
  /**
   * An address a host-owned flow needs opened: the native node's. No node
   * connected is a refusal the action reports as not done; a node that took the
   * ask and vanished before answering is the lost-answer error, which every
   * caller that journals an action records as unknown rather than failed.
   * The kind is what the address is, an address unless a caller says
   * otherwise; the node decides from it what its own windows owe the open.
   */
  openExternalThroughNode: (url: string, kind?: HostNodeOpenKind) => Promise<void>;
  reportOpenFailure: (error: Error) => void;
  agentWorkspacePath: () => string;
  agentSkillsPath: () => string;
}

export function createHostKernel(options: HostSeams): HostKernel {
  const { stateRoot, runMode, report, now, createId } = options;

  // A development build may be pointed at a local account service; a packaged one
  // may not. The override redirects the whole sign-in — including the identity
  // request that carries the access token — so it stops at the packaging boundary
  // rather than shipping inside a signed binary.
  const accountBaseUrl =
    (options.packaged ? undefined : options.environment.LUKE_ACCOUNT_BASE_URL) ??
    "https://tryluke.dev/api/auth";
  // The hosted voice endpoints live on the same origin as the account service,
  // so the one development override redirects both together.
  const hostedServiceBaseUrl = accountBaseUrl.replace(/\/api\/auth\/?$/, "");

  const nodes = new NodeRegistry();
  let service: GatewayService | undefined;
  const agentWorkspacePath = () => path.join(agentRootPath(stateRoot), AGENT_WORKSPACE_DIRECTORY);

  return {
    options,
    runMode,
    stateRoot,
    now,
    createId,
    report,
    accountBaseUrl,
    hostedServiceBaseUrl,
    nodes,
    emit: (kind, payload) => {
      if (!service) throw new Error("the host's service is read before the merge composed it");
      service.server.emit(kind, payload);
    },
    service: () => {
      if (!service) throw new Error("the host's service is read before the merge composed it");
      return service;
    },
    setService: (next) => {
      service = next;
    },
    openExternalThroughNode: async (url, kind = HOST_NODE_OPEN_KIND.ADDRESS) => {
      const result = await nodes.invoke(HOST_NODE_CAPABILITY.OPEN_EXTERNAL, { url, kind });
      if (result.status === NODE_CAPABILITY_STATUS.OK) return;
      if (result.status === NODE_CAPABILITY_STATUS.UNKNOWN) {
        throw new NodeAnswerLostError(result.reason);
      }
      throw new Error(result.reason);
    },
    reportOpenFailure: (error) => {
      report(`An address could not be opened: ${error.message}`);
    },
    agentWorkspacePath,
    agentSkillsPath: () => path.join(agentWorkspacePath(), AGENT_SKILLS_DIRECTORY),
  };
}
