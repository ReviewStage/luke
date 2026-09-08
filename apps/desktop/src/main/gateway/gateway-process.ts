import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import * as Sentry from "@sentry/electron/main";
import {
  acquireGatewayInstanceLock,
  createGatewayToken,
  GATEWAY_LOOPBACK_HOST,
  processIsAlive,
  publishGatewayDiscovery,
  shutdownGateway,
  withdrawGatewayDiscovery,
} from "@sidecar/runtime";
import { LocalGatewayHost } from "@sidecar/runtime/local-gateway";
import type { GatewayBuildIdentity } from "@sidecar/runtime-contracts";
import { app, safeStorage } from "electron";
import { buildCarriesDeveloperIdSigning, resolveAppName } from "../app-identity";
import { composeRuntimeHost } from "../host/runtime-host";
import { runModeFor, sentryReportingEnabled } from "../run-mode";
import { runtimeStoreWorkerPath } from "../runtime-store-path";
import {
  gatewayBuildIdentity,
  gatewayDiscoveryPath,
  gatewayLockPath,
  gatewayProfilePath,
  gatewayStateRootArgument,
  registersProviderHooks,
} from "./process-mode";

/**
 * The Gateway entry mode of the executable. It draws nothing, takes the
 * Gateway's own single-instance lock under a profile of its own, then the
 * portable lock under the state root, composes Luke's runtime over that
 * state root — the databases, the notebook, the credentials, the
 * observation, the scheduler, the accounts — binds the loopback host, and
 * only then publishes the discovery record a desktop client reads. It leaves
 * on the protocol's own shutdown (the desktop's explicit Quit, or a newer
 * build draining it) and on a termination signal, in the coordinator's
 * order: admissions closed, work cancelled, a bounded wait, and unresolved
 * state left for recovery rather than finished on paper. Nothing restarts
 * it: a Gateway that was quit stays quit until the desktop next launches.
 *
 * The state root is the one the desktop always kept; the profile under it is
 * the Gateway's alone, and nothing of the runtime derives a path from it.
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

declare const PACKAGED_SENTRY_DSN: string;

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
  // The Gateway is always a live run: a fixture or capture run composes its
  // host in the desktop process and starts no Gateway at all.
  const runMode = runModeFor({ capture: false, fixture: false });
  Sentry.init({
    dsn: PACKAGED_SENTRY_DSN,
    enabled: sentryReportingEnabled(runMode.sendsNetwork, PACKAGED_SENTRY_DSN),
  });

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
          closeAdmissions: () => {
            host.closeAdmissions();
            runtime.shutdownSteps.closeAdmissions();
          },
          cancelActive: runtime.shutdownSteps.cancelActive,
          awaitSettled: runtime.shutdownSteps.awaitSettled,
          persistUnresolved: runtime.shutdownSteps.persistUnresolved,
        });
        report(
          `shutting down: ${outcome.settled ? "settled" : "unsettled"}, ${outcome.cancelled.length} cancelled, ${outcome.unresolved} unresolved`,
        );
        await withdrawGatewayDiscovery(gatewayDiscoveryPath(stateRoot), process.pid);
        await host.close();
        await runtime.close().catch((error: Error) => {
          report(`the runtime did not close cleanly: ${error.message}`);
        });
        await lock.release();
        app.exit(0);
      })();
      return leaving;
    };
    const runtime = composeRuntimeHost({
      stateRoot,
      runMode,
      appVersion: app.getVersion(),
      packaged: app.isPackaged,
      homeDirectory: app.getPath("home"),
      environment: process.env,
      cipher: {
        isAvailable: () => safeStorage.isEncryptionAvailable(),
        encrypt: (plainText) => safeStorage.encryptString(plainText),
        decrypt: (cipherText) => safeStorage.decryptString(cipherText),
      },
      createWorker: () => new Worker(runtimeStoreWorkerPath(__dirname), { name: "runtime-store" }),
      registerProviderHooks: registersProviderHooks(argv),
      now: Date.now,
      createId: () => crypto.randomUUID(),
      report,
      // The protocol's shutdown answers accepted at once and leaves in the
      // coordinator's order after.
      onShutdownRequested: () => void leave(),
    });
    const build = currentBuildIdentity(appName);
    const token = createGatewayToken();
    const host = new LocalGatewayHost({ server: runtime.service.server, token, build, report });
    try {
      await runtime.start();
    } catch (error) {
      report(
        `the runtime could not start: ${error instanceof Error ? error.message : String(error)}`,
      );
      await lock.release();
      app.exit(1);
      return;
    }
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
