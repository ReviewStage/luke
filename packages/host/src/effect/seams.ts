/**
 * The seams the host is handed, each as a `Context.Service`. Everything of the
 * machine still arrives rather than being read here: what changes is that a
 * seam is asked for by name out of the context the composition was built with,
 * so a composer states the seams it reaches in its own requirements instead of
 * taking a kernel that holds all of them.
 */
import type { OpenConsent } from "@luke/credentials";
import type { OpenSocket } from "@luke/voice";
import { type ConfigProvider, Context, Layer, Logger, type Stream } from "effect";
import type { AccountSourceSeam } from "../account-source.js";
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

/**
 * The Keychain-backed cipher the desktop's account source seals its tokens
 * with. Only that source asks for it (`oauthAccountSourceLayer`), and hands
 * it to the settings store as its `tokenCipher`.
 */
export class SecretCipher extends Context.Service<SecretCipher, SecretCipherSeam>()(
  "@luke/host/SecretCipher",
) {}

/** The ids the host mints for its own records. */
export interface IdSourceSeam {
  readonly create: () => string;
}

export class IdSource extends Context.Service<IdSource, IdSourceSeam>()("@luke/host/IdSource") {}

/**
 * The origin of the service this host talks to, such as
 * `https://preview.example.test`, for a shell that knows it: a host in a
 * browser tab calls the origin that served it rather than production
 * cross-origin. Every hosted address the host builds — the account service,
 * the hosted routes, the voice socket — then stands on it, and no development
 * override redirects any of them. It is optional: a host handed none derives
 * its addresses as a desktop build does, so the desktop provides none.
 */
export class ServiceOrigin extends Context.Service<ServiceOrigin, string>()(
  "@luke/host/ServiceOrigin",
) {}

/**
 * Each time the settings file was written by someone other than this host,
 * for a shell where that can happen: a browser tab's file lives in storage
 * every tab of the origin shares, and the tab hears another tab's write as a
 * `storage` event. On each, the settings store reads the file again and the
 * panel is sent the settings as they now stand, as after any update. It is
 * optional: the desktop is the file's one writer and provides none.
 */
export class SettingsChangedElsewhere extends Context.Service<
  SettingsChangedElsewhere,
  Stream.Stream<void>
>()("@luke/host/SettingsChangedElsewhere") {}

/**
 * Each time the page the host runs in came back: shown again after it was
 * hidden, restored from the browser's back-forward cache, or back online,
 * for a shell whose sockets may drop while it is away, as a phone drops a
 * page's in the background. On each, the account inbox's live follow, where
 * it is not answering, starts again at once rather than waiting out
 * Realtime's backoff. It is optional: the desktop keeps its sockets and
 * provides none.
 */
export class PageReturns extends Context.Service<PageReturns, Stream.Stream<void>>()(
  "@luke/host/PageReturns",
) {}

/**
 * The voice sideband's WebSocket to the service. It arrives rather than being
 * built here, because the only implementation so far is over `ws`
 * (`@luke/host/node`), and a host that imported it could not load where `ws`
 * does not.
 */
export class VoiceSocket extends Context.Service<VoiceSocket, OpenSocket>()(
  "@luke/host/VoiceSocket",
) {}

/**
 * A terminal's relay WebSocket, on the same terms as the voice socket. Only
 * the terminals concern asks for it, so an assembly that leaves terminals out
 * is handed none.
 */
export class TerminalSocket extends Context.Service<TerminalSocket, OpenTerminalSocket>()(
  "@luke/host/TerminalSocket",
) {}

/**
 * How the account's sign-in asks the developer's consent: each trip the
 * session manager words — the sign-in and the session hand-off — is stood up
 * by `open`. It arrives rather than being built here, because the only
 * implementation so far is the desktop's loopback over `node:http`
 * (`@luke/credentials/node`), and a host that imported it could not load in a
 * browser, which would sign in its own way. Only the desktop's account source
 * asks for it.
 */
export interface SignInConsentSeam {
  readonly open: OpenConsent;
}

export class SignInConsent extends Context.Service<SignInConsent, SignInConsentSeam>()(
  "@luke/host/SignInConsent",
) {}

/**
 * Where the account's identity and credentials come from, as the shell
 * chooses it (`account-source.ts`): the desktop's OAuth source, which needs
 * `SecretCipher` and `SignInConsent` of its own, or a browser's cookie
 * session, which needs neither.
 */
export class AccountSource extends Context.Service<AccountSource, AccountSourceSeam>()(
  "@luke/host/AccountSource",
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

/** Every seam tag the host's kernel stands on; the assembly adds `VoiceSocket` and `AccountSource`, and each platform concern it was built with adds its own. */
export type HostSeamTags =
  | StateRoot
  | RunMode
  | AppIdentity
  | Environment
  | IdSource
  | Reporter
  | ShutdownSignal;
