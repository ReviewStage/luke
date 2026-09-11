import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import { type HostSeams, storeWorkerPath } from "@sidecar/host";
import {
  type DuplicateGatewayMethod,
  type HostAssemblyTag,
  hostAssemblyLayer,
  hostKernelLayerFromSeams,
} from "@sidecar/host/effect";
import { Layer } from "effect";
import type { DesktopConfig } from "./desktop-config";

export interface HostSeamDependencies {
  config: DesktopConfig;
  /** The client's own credential protection; the host encrypts nothing without it. */
  cipher: HostSeams["cipher"];
  /** This machine's idle time and lock state, for the presence its device row reports; a test host reports none. */
  machinePresence?: HostSeams["machinePresence"];
}

/** Everything of this process the host is told, given explicitly so it reads no Electron global of its own. */
function hostSeamsFor(dependencies: HostSeamDependencies): HostSeams {
  const { config, cipher, machinePresence } = dependencies;
  const { runMode } = config;
  const seams: HostSeams = {
    stateRoot: config.stateRoot,
    runMode,
    appVersion: config.appVersion,
    packaged: config.packaged,
    homeDirectory: config.homeDirectory,
    environment: config.environment,
    cipher,
    createWorker: () => {
      if (!runMode.observesProviders) {
        throw new Error("a fixture run keeps nothing on disk and starts no store worker");
      }
      return new Worker(storeWorkerPath(config.resourceDirectory), { name: "brain-store" });
    },
    now: Date.now,
    createId: () => randomUUID(),
    report: config.report,
    // The protocol's shutdown answers accepted at once; the quit that follows
    // is the one drain, which the entry's `before-quit` asks for.
    onShutdownRequested: () => config.quit(),
  };
  if (machinePresence) {
    seams.machinePresence = machinePresence;
  }
  return seams;
}

/**
 * The host this client operates, constructed and linked with nothing yet
 * begun: the assembly is where the server the operator reaches comes from, so
 * it stands before any start, and `hostStandingLayer` over it is what begins
 * the composers, arms the loops, and registers the drain — which is why the
 * standing layer is a step of the desktop's own launch rather than something
 * this module builds.
 *
 * A live run keeps its state on disk under Luke's own application data; a
 * fixture or capture run keeps nothing, is network-silent, and is never asked
 * for a store worker. Either way this process is one operator over one
 * transport, and one node.
 */
export function hostAssemblyLayerFor(
  dependencies: HostSeamDependencies,
): Layer.Layer<HostAssemblyTag, DuplicateGatewayMethod> {
  return Layer.provide(hostAssemblyLayer, hostKernelLayerFromSeams(hostSeamsFor(dependencies)));
}
