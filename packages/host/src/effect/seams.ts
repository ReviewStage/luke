/**
 * The seams the host is handed, each as a `Context.Service`. Everything of the
 * machine still arrives rather than being read here: what changes is that a
 * seam is asked for by name out of the context the composition was built with,
 * so a composer states the seams it reaches in its own requirements instead of
 * taking a kernel that holds all of them.
 */
import type { OpenConsent } from "@repo/credentials";
import type { ProductClientPlatform } from "@repo/features/analytics";
import type {
  DeviceArch,
  DeviceCapability,
  DeviceMachine,
  DevicePlatform,
} from "@repo/features/device-agent-wire";
import {
  type ConfigProvider,
  Context,
  Data,
  type Effect,
  Layer,
  Logger,
  type Path,
  type Result,
  type Stream,
} from "effect";
import type { FileSystem } from "effect/FileSystem";
import type { HttpClient } from "effect/http/HttpClient";
import type { ChildProcessSpawner } from "effect/process";
import type { AccountSourceSeam } from "../account-source.js";
import type { ListenOnLoopback } from "../compose-port-forwards.js";
import type { OpenTerminalSocket } from "../compose-terminals.js";
import type { RunMode as RunModeFacts } from "../run-mode.js";
import type { SecretCipher as SecretCipherSeam } from "../settings-store.js";

/** The app's own application-state root, given explicitly. */
export class StateRoot extends Context.Service<StateRoot, string>()("@repo/host/StateRoot") {}

/** What this launch is allowed to do. */
export class RunMode extends Context.Service<RunMode, RunModeFacts>()("@repo/host/RunMode") {}

/** What this build is, and whose machine it runs on. */
export interface AppIdentityFacts {
  readonly appVersion: string;
  readonly packaged: boolean;
  readonly platform: ProductClientPlatform;
}

export class AppIdentity extends Context.Service<AppIdentity, AppIdentityFacts>()(
  "@repo/host/AppIdentity",
) {}

/**
 * The environment the host reads its development overrides from, as a
 * `ConfigProvider` rather than a record, so every override is a `Config` read
 * with the variable's own name and a packaged build can be handed a provider
 * that holds none.
 */
export class Environment extends Context.Service<Environment, ConfigProvider.ConfigProvider>()(
  "@repo/host/Environment",
) {}

/**
 * The Keychain-backed cipher the desktop's account source seals its tokens
 * with. Only that source asks for it (`oauthAccountSourceLayer`), and hands
 * it to the settings store as its `tokenCipher`.
 */
export class SecretCipher extends Context.Service<SecretCipher, SecretCipherSeam>()(
  "@repo/host/SecretCipher",
) {}

/** The ids the host mints for its own records. */
export interface IdSourceSeam {
  readonly create: () => string;
}

export class IdSource extends Context.Service<IdSource, IdSourceSeam>()("@repo/host/IdSource") {}

/**
 * The origin of the service this host talks to, such as
 * `https://preview.example.test`, for a shell that knows it: a host in a
 * browser tab calls the origin that served it rather than production
 * cross-origin. Every hosted address the host builds — the account service
 * and the hosted routes — then stands on it, and no development
 * override redirects any of them. It is optional: a host handed none derives
 * its addresses as a desktop build does, so the desktop provides none.
 */
export class ServiceOrigin extends Context.Service<ServiceOrigin, string>()(
  "@repo/host/ServiceOrigin",
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
>()("@repo/host/SettingsChangedElsewhere") {}

/**
 * A terminal's relay WebSocket. It arrives rather than being built here,
 * because the desktop's is opened over `ws` (`@repo/host/node`), and a host
 * that imported it could not load where `ws` does not. Only the terminals
 * concern asks for it, so an assembly that leaves terminals out is handed
 * none.
 */
export class TerminalSocket extends Context.Service<TerminalSocket, OpenTerminalSocket>()(
  "@repo/host/TerminalSocket",
) {}

/**
 * A listener on this machine's `127.0.0.1`, which a forwarded cloud port is
 * reached at. It arrives rather than being built here, because the
 * desktop's listens over `node:net` (`@repo/host/node`), and a host that
 * imported it could not load in a browser, which forwards nothing. Only the
 * port forwards concern asks for it.
 */
export class LoopbackListener extends Context.Service<LoopbackListener, ListenOnLoopback>()(
  "@repo/host/LoopbackListener",
) {}

/**
 * How the account's sign-in asks the developer's consent: each trip the
 * session manager words — the sign-in and the session hand-off — is stood up
 * by `open`. It arrives rather than being built here, because the only
 * implementation so far is the desktop's loopback over `node:http`
 * (`@repo/credentials/node`), and a host that imported it could not load in a
 * browser, which would sign in its own way. Only the desktop's account source
 * asks for it.
 */
export interface SignInConsentSeam {
  readonly open: OpenConsent;
}

export class SignInConsent extends Context.Service<SignInConsent, SignInConsentSeam>()(
  "@repo/host/SignInConsent",
) {}

/**
 * One runner as the follower starts it (`compose-local-agents.ts`): the
 * agent it runs for, the agent's own folder and the worktree in it, the Node
 * and the bundle it runs, and the environment the follower made for it, the
 * claim's secrets among it.
 */
export interface LocalAgentRunner {
  readonly agentId: string;
  /** The agent's own folder (`deviceAgentLayout`), which holds its worktree and its temp folder. */
  readonly folder: string;
  readonly checkout: string;
  readonly node: string;
  readonly bundle: string;
  readonly env: Readonly<Record<string, string>>;
}

/** The process the follower spawns for a runner: its program, its arguments, and its whole environment. */
export interface LocalAgentCommand {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

/**
 * The agent CLIs a device keeps of its own (`local-agent-setup.ts`'s
 * `localAgentClis`): Claude Code, Codex, and GitHub's CLI, each the pinned
 * build for the box, fetched under its state and checked before it is kept.
 * The device has them before it registers ready, as its readiness step
 * asks, and its agents run on them straight on the box: `paths` is what it
 * registers and launches from.
 */
export interface LocalAgentClis {
  /** Where each is kept under the device's state, named before it is fetched. */
  readonly paths: { readonly claude: string; readonly codex: string; readonly gh: string };
  /**
   * Each had now where it can be: the build kept where it still stands as
   * checked, and otherwise the pinned build fetched and checked. It runs
   * `preparing` once, just before the first fetch begins, and never where
   * every one is kept, so the device says it is getting ready only while it
   * is. It fails, in words naming no secret, with the one it could not have.
   */
  readonly ready: (
    preparing: Effect.Effect<void>,
  ) => Effect.Effect<
    void,
    LocalAgentClisUnavailable,
    ChildProcessSpawner.ChildProcessSpawner | FileSystem | Path.Path | HttpClient
  >;
}

/** Which of a device's agent CLIs could not be had. */
export class LocalAgentClisUnavailable extends Data.TaggedError("LocalAgentClisUnavailable")<{
  readonly detail: string;
}> {}

/**
 * What a local agent's runner is started with on this device
 * (`compose-local-agents.ts`): how every runner is started (`launch`),
 * straight on the box as a host's are, on what (`tools`), the runner's
 * bundle, and what the start adds to its environment; the name, platform,
 * and architecture the device is offered under at Start; and the script that makes an
 * agent's worktree (`node/open-on-mac.ts`'s `agentWorktreeScript`).
 * It arrives rather than being built here, because each is the shell's own,
 * a path into its bundle or a script `node:path` builds, and a host that
 * built them could not load in a browser. Only the follower asks for it, as
 * `vespin-host` runs it (`@repo/host/daemon`'s `hostPlatform`).
 */
export interface LocalAgentPlatformSeam {
  /** The process a runner is started as, given what it runs and the environment made for it: straight on the box in the agent's folder (`local-agent-box.ts`'s `agentOnBox`). */
  readonly launch: (runner: LocalAgentRunner) => LocalAgentCommand;
  /** What every runner runs on, which the device registers: the host's own Node and the CLIs it keeps (`clis.paths`). */
  readonly tools: { readonly node: string; readonly claude: string; readonly codex: string };
  readonly runnerBundle: string;
  readonly runnerEnv: Readonly<Record<string, string>>;
  readonly deviceName: string;
  /** Which machine the device runs on, as it registers (`DeviceMachine`), each part absent where it could not be read. */
  readonly deviceMachine: DeviceMachine;
  /** The platform and architecture the device registers as. */
  readonly devicePlatform: DevicePlatform;
  readonly deviceArch: DeviceArch;
  /**
   * The lines beyond the first the device registers it takes
   * (`DEVICE_CAPABILITY`). The follower takes every one, but a device names
   * one only once every service it may reach knows the field, since one
   * from before it refuses a register naming any.
   */
  readonly deviceCapabilities: readonly DeviceCapability[];
  readonly worktreeScript: (input: {
    readonly home: string;
    readonly repository: string;
    readonly worktree: string;
    readonly branch: string | null;
  }) => string;
  /** The script that exits 0 only where the Git it runs as reaches the repository given, as `owner/name`, prompting for nothing: the check of the box's own GitHub sign-in an agent on its starter's own token launches on. */
  readonly repositoryReachedScript: (repository: string) => string;
  /** The agent CLIs the device keeps of its own, had before it registers ready (`LocalAgentClis`). */
  readonly clis: LocalAgentClis;
}

export class LocalAgentPlatform extends Context.Service<
  LocalAgentPlatform,
  LocalAgentPlatformSeam
>()("@repo/host/LocalAgentPlatform") {}

/**
 * This Mac's host as the desktop keeps it (`compose-this-mac-host.ts`): the
 * account install the install command puts on a Mac, under the member's own
 * home, whose LaunchAgent launchd runs at login, which every build of the
 * app reads and controls alike. Each act answers, never fails: what it
 * answered, or the words it could not with. Only the This Mac host concern
 * asks for it.
 */
export interface ThisMacHostSeam {
  /** The install's state folder, `~/.local/state/vespin-host`, holding the record its host runs on. */
  readonly stateRoot: string;
  /** Whether this Mac can run the host: Apple silicon, on the oldest macOS the install script takes or later. */
  readonly runsHost: boolean;
  /** The Mac as its host registers it, which its enroll names so the service creates the device where it never saw this Mac, and which machine it is where it was read. */
  readonly machine: Effect.Effect<
    {
      readonly name: string;
      readonly platform: DevicePlatform;
      readonly arch: DeviceArch;
    } & DeviceMachine
  >;
  /** Whether launchd holds the host's LaunchAgent now. */
  readonly loaded: Effect.Effect<boolean, never, ChildProcessSpawner.ChildProcessSpawner>;
  /** The install script given run with `/bin/sh`, the LaunchAgent let start first: the release installed or upgraded, and the host started. */
  readonly install: (
    script: string,
  ) => Effect.Effect<Result.Result<void, string>, never, ChildProcessSpawner.ChildProcessSpawner>;
  /** The host stopped and kept from starting at the next login, its files kept. */
  readonly stop: Effect.Effect<
    Result.Result<void, string>,
    never,
    ChildProcessSpawner.ChildProcessSpawner
  >;
  /** The install's own `vespin-host uninstall` run: the host leaves the account and is removed from this Mac, its LaunchAgent, agents' folders, state and releases with it. */
  readonly uninstall: Effect.Effect<
    Result.Result<void, string>,
    never,
    ChildProcessSpawner.ChildProcessSpawner
  >;
}

export class ThisMacHost extends Context.Service<ThisMacHost, ThisMacHostSeam>()(
  "@repo/host/ThisMacHost",
) {}

/**
 * Where the account's identity and credentials come from, as the shell
 * chooses it (`account-source.ts`): the desktop's OAuth source, which needs
 * `SecretCipher` and `SignInConsent` of its own, or a browser's cookie
 * session, which needs neither.
 */
export class AccountSource extends Context.Service<AccountSource, AccountSourceSeam>()(
  "@repo/host/AccountSource",
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

export class Reporter extends Context.Service<Reporter, HostReporter>()("@repo/host/Reporter") {}

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
  "@repo/host/ShutdownSignal",
) {}

/** Every seam tag the host's kernel stands on; the assembly adds `AccountSource`, and each platform concern it was built with adds its own. */
export type HostSeamTags =
  | StateRoot
  | RunMode
  | AppIdentity
  | Environment
  | IdSource
  | Reporter
  | ShutdownSignal;
