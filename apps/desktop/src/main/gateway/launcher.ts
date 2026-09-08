import { spawn } from "node:child_process";
import {
  type GatewayAttachResult,
  GatewaySupervisor,
  type GatewayTransport,
  processIsAlive,
  readGatewayDiscovery,
} from "@sidecar/runtime";
import { connectLocalGateway } from "@sidecar/runtime/local-gateway";
import {
  GATEWAY_CLIENT_ROLE,
  type GatewayBuildIdentity,
  type GatewayClientIdentity,
} from "@sidecar/runtime-contracts";
import { app } from "electron";
import { DESKTOP_OPERATOR_CLIENT_ID } from "./desktop-node";
import { gatewayDiscoveryPath, gatewayProcessArguments } from "./process-mode";

/**
 * The desktop's side of the process split: the supervisor's ports filled with
 * this machine's realities. Discovery is the owner-only file under the state
 * root; connecting is the loopback handshake with this build's identity; and
 * spawning runs the same executable in Gateway mode, detached, so the Gateway
 * outlives a desktop client that crashes and is found again by the next. The
 * token the discovery record carries goes from the file to the handshake and
 * nowhere else in this process.
 */
export interface GatewayLauncherOptions {
  stateRoot: string;
  build: GatewayBuildIdentity;
  report: (message: string) => void;
}

export interface GatewayLauncher {
  readonly transport: GatewayTransport;
  attach: () => Promise<GatewayAttachResult>;
  /** The explicit quit: the Gateway is asked to leave and waited for. */
  stop: () => Promise<void>;
  supervisor: GatewaySupervisor;
}

export function createGatewayLauncher(options: GatewayLauncherOptions): GatewayLauncher {
  const client: GatewayClientIdentity = {
    clientId: DESKTOP_OPERATOR_CLIENT_ID,
    role: GATEWAY_CLIENT_ROLE.OPERATOR,
  };
  const supervisor = new GatewaySupervisor({
    build: options.build,
    createId: () => crypto.randomUUID(),
    discover: () => readGatewayDiscovery(gatewayDiscoveryPath(options.stateRoot)),
    connect: (record) => connectLocalGateway({ record, client, build: options.build }),
    isAlive: processIsAlive,
    spawn: async () => {
      // An unpackaged run is the Electron binary given the app directory; a
      // packaged one is the bundle's own executable and takes no path.
      const child = spawn(
        process.execPath,
        [
          ...(app.isPackaged ? [] : [app.getAppPath()]),
          ...gatewayProcessArguments(options.stateRoot),
        ],
        {
          detached: true,
          stdio: "ignore",
          env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
        },
      );
      child.unref();
      const pid = child.pid;
      if (pid === undefined) throw new Error("the Gateway process could not be started");
      return {
        pid,
        exited: new Promise((resolve) => {
          child.once("exit", (code) => resolve(code ?? undefined));
          child.once("error", () => resolve(undefined));
        }),
        kill: () => {
          try {
            process.kill(pid);
          } catch {
            // Already gone.
          }
        },
      };
    },
    report: options.report,
  });
  return {
    transport: supervisor.transport,
    attach: () => supervisor.attach(),
    stop: () => supervisor.stop(),
    supervisor,
  };
}
