/**
 * The seams the host is handed, each as a `Context.Tag`. Everything of the
 * machine still arrives rather than being read here: what changes is that a
 * seam is asked for by name out of the context the composition was built with,
 * so a composer states the seams it reaches in its own requirements instead of
 * taking a kernel that holds all of them.
 */
import type { Worker } from "node:worker_threads";
import { type ConfigProvider, Context, Layer, Logger } from "effect";
import type { MachinePresence } from "../device-presence.js";
import type { RunMode as RunModeFacts } from "../run-mode.js";
import type { SecretCipher as SecretCipherSeam } from "../settings-store.js";

/** Luke's own application-state root, given explicitly. */
export class StateRoot extends Context.Tag("@sidecar/host/StateRoot")<StateRoot, string>() {}

/** What this launch is allowed to do. */
export class RunMode extends Context.Tag("@sidecar/host/RunMode")<RunMode, RunModeFacts>() {}

/** What this build is, and whose machine it runs on. */
export interface AppIdentityFacts {
  readonly appVersion: string;
  readonly packaged: boolean;
}

export class AppIdentity extends Context.Tag("@sidecar/host/AppIdentity")<
  AppIdentity,
  AppIdentityFacts
>() {}

/**
 * The environment the host reads its development overrides from, as a
 * `ConfigProvider` rather than a record, so every override is a `Config` read
 * with the variable's own name and a packaged build can be handed a provider
 * that holds none.
 */
export class Environment extends Context.Tag("@sidecar/host/Environment")<
  Environment,
  ConfigProvider.ConfigProvider
>() {}

/** The Keychain-backed cipher the settings store encrypts its secrets with. */
export class SecretCipher extends Context.Tag("@sidecar/host/SecretCipher")<
  SecretCipher,
  SecretCipherSeam
>() {}

/** Spawns the brain store's worker thread; the host's store wiring connects its client to it. */
export interface StoreWorkerSource {
  readonly create: () => Worker;
}

export class StoreWorker extends Context.Tag("@sidecar/host/StoreWorker")<
  StoreWorker,
  StoreWorkerSource
>() {}

/** The ids the host mints for its own records. */
export interface IdSourceSeam {
  readonly create: () => string;
}

export class IdSource extends Context.Tag("@sidecar/host/IdSource")<IdSource, IdSourceSeam>() {}

/**
 * Where a line about the host's own running goes. The service answers the
 * `report(line)` seam every unconverted caller holds, and `reporterLayer`
 * routes the runtime's own `Logger` to the same sink, so an `Effect.log*` and a
 * reported line land in one place rather than two.
 */
export interface HostReporter {
  readonly report: (message: string) => void;
}

export class Reporter extends Context.Tag("@sidecar/host/Reporter")<Reporter, HostReporter>() {}

export const reporterLayer = (report: (message: string) => void): Layer.Layer<Reporter> =>
  Layer.merge(
    Layer.succeed(Reporter, { report }),
    Logger.replace(
      Logger.defaultLogger,
      // The message alone: a reported line is a sentence about the host's own
      // running, and a logfmt envelope around it would be a new shape on a sink
      // that already has one.
      Logger.make((options) => {
        report(String(options.message));
      }),
    ),
  );

/**
 * The machine's own idle time and lock state, read by the client that runs
 * on it, for the presence this installation's device row reports. A host
 * with no client on the machine (`read` undefined) reports no presence.
 */
export interface MachinePresenceSeam {
  readonly read: (() => MachinePresence) | undefined;
}

export class MachinePresenceReader extends Context.Tag("@sidecar/host/MachinePresenceReader")<
  MachinePresenceReader,
  MachinePresenceSeam
>() {}

/**
 * Hears the protocol's shutdown method: the client's explicit Quit, or a
 * newer build draining this one. The process hosting the runtime leaves in
 * the coordinator's order; a host with no process to leave (a fixture run,
 * `notify` undefined) hears nothing.
 */
export interface ShutdownSignalSeam {
  readonly notify: (() => void) | undefined;
}

export class ShutdownSignal extends Context.Tag("@sidecar/host/ShutdownSignal")<
  ShutdownSignal,
  ShutdownSignalSeam
>() {}

/** Every seam tag a host composition stands on. */
export type HostSeamTags =
  | StateRoot
  | RunMode
  | AppIdentity
  | Environment
  | SecretCipher
  | StoreWorker
  | IdSource
  | Reporter
  | MachinePresenceReader
  | ShutdownSignal;
