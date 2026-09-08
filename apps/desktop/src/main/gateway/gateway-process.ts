import fs from "node:fs";
import path from "node:path";
import {
  acquireGatewayInstanceLock,
  createGatewayToken,
  GATEWAY_LOOPBACK_HOST,
  GatewayServer,
  gatewayOk,
  processIsAlive,
  publishGatewayDiscovery,
  shutdownGateway,
  withdrawGatewayDiscovery,
} from "@sidecar/runtime";
import { LocalGatewayHost } from "@sidecar/runtime/local-gateway";
import { GATEWAY_METHOD, type GatewayBuildIdentity } from "@sidecar/runtime-contracts";
import { app } from "electron";
import { buildCarriesDeveloperIdSigning, resolveAppName } from "../app-identity";
import {
  gatewayBuildIdentity,
  gatewayDiscoveryPath,
  gatewayLockPath,
  gatewayProfilePath,
  gatewayStateRootArgument,
} from "./process-mode";

/**
 * The Gateway entry mode of the executable. It draws nothing, takes the
 * Gateway's own single-instance lock under a profile of its own, then the
 * portable lock under the state root, binds the loopback host, and only then
 * publishes the discovery record a desktop client reads. It leaves on the
 * protocol's own shutdown (the desktop's explicit Quit, or a newer build
 * draining it) and on a termination signal, in the coordinator's order:
 * admissions closed, work cancelled, a bounded wait, and unresolved state
 * left for recovery rather than finished on paper. Nothing restarts it: a
 * Gateway that was quit stays quit until the desktop next launches.
 *
 * What it hosts today is the protocol's door and the shutdown; the runtime
 * composition the desktop still holds in its own process moves here in the
 * follow-up that relocates the host, and until then the desktop's operator
 * keeps the in-process transport for every other method.
 */
export function developmentBundleStamp(): string | undefined {
  try {
    return String(Math.floor(fs.statSync(__filename).mtimeMs));
  } catch {
    return undefined;
  }
}

export function currentBuildIdentity(appName: string): GatewayBuildIdentity {
  return gatewayBuildIdentity({
    appName,
    version: app.getVersion(),
    packaged: app.isPackaged,
    developmentStamp: developmentBundleStamp(),
  });
}

export function startGatewayProcess(argv: readonly string[]): void {
  const appName = resolveAppName({
    packaged: app.isPackaged,
    developerIdSigned: buildCarriesDeveloperIdSigning(),
  });
  app.setName(appName);
  const stateRoot = gatewayStateRootArgument(argv) ?? path.join(app.getPath("appData"), appName);
  const profile = gatewayProfilePath(stateRoot);
  app.setPath("userData", profile);
  app.setPath("sessionData", profile);
  const report = (message: string) => process.stderr.write(`[gateway] ${message}\n`);

  if (!app.requestSingleInstanceLock()) {
    report("another Gateway holds this state root; leaving");
    app.exit(0);
    return;
  }

  void app.whenReady().then(async () => {
    if (process.platform === "darwin") {
      app.setActivationPolicy("prohibited");
      app.dock?.hide();
    }
    const startedAt = Date.now();
    const lock = await acquireGatewayInstanceLock({
      filePath: gatewayLockPath(stateRoot),
      pid: process.pid,
      startedAt,
      isAlive: processIsAlive,
    });
    if (!lock.acquired) {
      report(`the state root is held by pid ${lock.holder.pid}; leaving`);
      app.exit(0);
      return;
    }
    let leaving: Promise<void> | undefined;
    const leave = () => {
      leaving ??= (async () => {
        const outcome = await shutdownGateway({
          closeAdmissions: () => host.closeAdmissions(),
          cancelActive: async () => [],
          awaitSettled: async () => undefined,
          persistUnresolved: async () => 0,
        });
        report(
          `shutting down: ${outcome.settled ? "settled" : "unsettled"}, ${outcome.unresolved} unresolved`,
        );
        await withdrawGatewayDiscovery(gatewayDiscoveryPath(stateRoot), process.pid);
        await host.close();
        await lock.release();
        app.exit(0);
      })();
      return leaving;
    };
    const server = new GatewayServer({
      methods: {
        [GATEWAY_METHOD.SHUTDOWN]: () => {
          void leave();
          return gatewayOk({ accepted: true });
        },
      },
      configurationRevision: () => 0,
      sessionRevision: () => undefined,
      snapshot: () => ({}),
      now: Date.now,
      createEventId: () => crypto.randomUUID(),
    });
    const build = currentBuildIdentity(appName);
    const token = createGatewayToken();
    const host = new LocalGatewayHost({ server, token, build, report });
    const port = await host.listen();
    await publishGatewayDiscovery(gatewayDiscoveryPath(stateRoot), {
      ...build,
      host: GATEWAY_LOOPBACK_HOST,
      port,
      token,
      pid: process.pid,
      startedAt,
    });
    report(`ready as ${build.buildVersion} on ${GATEWAY_LOOPBACK_HOST}:${port}`);
    for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
      process.on(signal, () => {
        void leave();
      });
    }
  });

  app.on("window-all-closed", () => undefined);
}
