/**
 * The seams the host is handed, each as a `Context.Service`. Everything of the
 * machine still arrives rather than being read here: what changes is that a
 * seam is asked for by name out of the context the composition was built with,
 * so a composer states the seams it reaches in its own requirements instead of
 * taking a kernel that holds all of them.
 */
import type { OpenConsent } from "@luke/credentials";
import type { OpenSocket } from "@luke/voice";
import { type ConfigProvider, Context, Layer, Logger } from "effect";
import type { OpenTerminalSocket } from "../compose-terminals.js";
import type { RunMode as RunModeFacts } from "../run-mode.js";
import type { SecretCipher as SecretCipherSeam } from "../settings-store.js";

/** Luke's own application-state root, given explicitly. */
export class StateRoot extends Context.Service<StateRoot, string>()("@luke/host/StateRoot") {}

/** What this launch is allowed to do. */
export class RunMode extends Context.Service<RunMode, RunModeFacts>()("@luke/host/RunMode") {}

/** What this build is, and whose machine it runs on. */
export interface AppIdentityFacts {
  readonly appVersion: string;
  readonly packaged: boolean;
}

export class AppIdentity extends Context.Service<AppIdentity, AppIdentityFacts>()(
  "@luke/host/AppIdentity",
) {}

/**
 * The environment the host reads its development overrides from, as a
 * `ConfigProvider` rather than a record, so every override is a `Config` read
 * with the variable's own name and a packaged build can be handed a provider
 * that holds none.
 */
export class Environment extends Context.Service<Environment, ConfigProvider.ConfigProvider>()(
  "@luke/host/Environment",
) {}

/** The Keychain-backed cipher the settings store encrypts its secrets with. */
export class SecretCipher extends Context.Service<SecretCipher, SecretCipherSeam>()(
  "@luke/host/SecretCipher",
) {}

/** The ids the host mints for its own records. */
export interface IdSourceSeam {
  readonly create: () => string;
}

export class IdSource extends Context.Service<IdSource, IdSourceSeam>()("@luke/host/IdSource") {}

/**
 * The WebSockets the host opens to the service: the voice sideband and a
 * terminal's relay. They arrive rather than being built here, because the
 * only implementation so far is over `ws` (`@luke/host/node`), and a host
 * that imported it could not load where `ws` does not.
 */
export interface HostSocketsSeam {
  readonly openVoice: OpenSocket;
  readonly openTerminal: OpenTerminalSocket;
}

export class HostSockets extends Context.Service<HostSockets, HostSocketsSeam>()(
  "@luke/host/HostSockets",
) {}

/**
 * How the account's sign-in asks the developer's consent: each trip the
 * session manager words — the sign-in and the session hand-off — is stood up
 * by `open`. It arrives rather than being built here, because the only
 * implementation so far is the desktop's loopback over `node:http`
 * (`@luke/credentials/node`), and a host that imported it could not load in a
 * browser, which would sign in its own way.
 */
export interface SignInConsentSeam {
  readonly open: OpenConsent;
}

export class SignInConsent extends Context.Service<SignInConsent, SignInConsentSeam>()(
  "@luke/host/SignInConsent",
) {}

/**
 * Where a line about the host's own running goes. The service answers the
 * `report(line)` seam every unconverted caller holds, and `reporterLayer`
 * routes the runtime's own `Logger` to the same sink, so an `Effect.log*` and a
 * reported line land in one place rather than two.
 */
export interface HostReporter {
  readonly report: (message: string) => void;
}

export class Reporter extends Context.Service<Reporter, HostReporter>()("@luke/host/Reporter") {}

export const reporterLayer = (report: (message: string) => void): Layer.Layer<Reporter> =>
  Layer.merge(
    Layer.succeed(Reporter, { report }),
    // v4 states the whole active set rather than swapping one logger out of
    // it, so the tracer's own logger is named here beside this one: it is what
    // puts a log line on the span it was written under, and the default
    // logger's console line is what this set leaves behind.
    Logger.layer([
      // The message alone: a reported line is a sentence about the host's own
      // running, and a logfmt envelope around it would be a new shape on a sink
      // that already has one.
      Logger.make((options) => {
        report(String(options.message));
      }),
      Logger.tracerLogger,
    ]),
  );

/**
 * Hears the protocol's shutdown method: the client's explicit Quit, or a
 * newer build draining this one. The process hosting the runtime leaves in
 * the coordinator's order; a host with no process to leave (a fixture run,
 * `notify` undefined) hears nothing.
 */
export interface ShutdownSignalSeam {
  readonly notify: (() => void) | undefined;
}

export class ShutdownSignal extends Context.Service<ShutdownSignal, ShutdownSignalSeam>()(
  "@luke/host/ShutdownSignal",
) {}

/** Every seam tag the host's kernel stands on; the assembly adds `HostSockets` and `SignInConsent`. */
export type HostSeamTags =
  | StateRoot
  | RunMode
  | AppIdentity
  | Environment
  | SecretCipher
  | IdSource
  | Reporter
  | ShutdownSignal;
