import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import { NodeFileSystem } from "@effect/platform-node";
import { type HostSeams, storeWorkerPath } from "@sidecar/host";
import {
  AppIdentity,
  type DuplicateGatewayMethod,
  Environment,
  type HostAssemblyTag,
  hostAssemblyLayer,
  hostKernelLayer,
  IdSource,
  MachinePresenceReader,
  RunMode,
  reporterLayer,
  SecretCipher,
  ShutdownSignal,
  StateRoot,
  StoreWorker,
} from "@sidecar/host/effect";
import { ConfigProvider, Layer } from "effect";
import type { DesktopConfig } from "./desktop-config";

export interface HostSeamDependencies {
  config: DesktopConfig;
  /** The client's own credential protection; the host encrypts nothing without it. */
  cipher: HostSeams["cipher"];
  /** This machine's idle time and lock state, for the presence its device row reports; a test host reports none. */
  machinePresence?: HostSeams["machinePresence"];
}

/** Every seam tag this process answers for, each stood up from what the launch already established. */
function hostSeamLayersFor(dependencies: HostSeamDependencies) {
  const { config, cipher, machinePresence } = dependencies;
  const { runMode } = config;
  return Layer.mergeAll(
    Layer.succeed(StateRoot, config.stateRoot),
    Layer.succeed(RunMode, runMode),
    Layer.succeed(AppIdentity, { appVersion: config.appVersion, packaged: config.packaged }),
    Layer.succeed(
      Environment,
      ConfigProvider.fromMap(
        new Map(
          Object.entries(config.environment).filter(
            (entry): entry is [string, string] => entry[1] !== undefined,
          ),
        ),
      ),
    ),
    Layer.succeed(SecretCipher, cipher),
    Layer.succeed(StoreWorker, {
      create: () => {
        if (!runMode.observesProviders) {
          throw new Error("a fixture run keeps nothing on disk and starts no store worker");
        }
        return new Worker(storeWorkerPath(config.resourceDirectory), { name: "brain-store" });
      },
    }),
    Layer.succeed(IdSource, { create: () => randomUUID() }),
    reporterLayer(config.report),
    Layer.succeed(MachinePresenceReader, { read: machinePresence }),
    // The protocol's shutdown answers accepted at once; the quit that follows
    // is the one drain, which the entry's `before-quit` asks for.
    Layer.succeed(ShutdownSignal, { notify: () => config.quit() }),
  );
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
  const seams = hostSeamLayersFor(dependencies);
  return Layer.provide(
    hostAssemblyLayer,
    Layer.merge(Layer.provideMerge(hostKernelLayer, seams), NodeFileSystem.layer),
  );
}
