/**
 * The seams the host is handed, each as a `Context.Service`. Everything of the
 * machine still arrives rather than being read here: what changes is that a
 * seam is asked for by name out of the context the composition was built with,
 * so a composer states the seams it reaches in its own requirements instead of
 * taking a kernel that holds all of them.
 */
import type { OpenConsent } from "@luke/credentials";
import type { ProductClientPlatform } from "@luke/features/analytics";
import type {
  DeviceArch,
  DeviceCapability,
  DeviceIsolation,
  DevicePlatform,
} from "@luke/features/device-agent-wire";
import {
  type ConfigProvider,
  Context,
  Data,
  type Effect,
  Layer,
  Logger,
  type Option,
  type Path,
  type Result,
  type Stream,
} from "effect";
import type { FileSystem } from "effect/FileSystem";
import type { HttpClient } from "effect/http/HttpClient";
import type { PlatformError } from "effect/PlatformError";
import type { ChildProcessSpawner } from "effect/process";
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
  readonly platform: ProductClientPlatform;
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
 * cross-origin. Every hosted address the host builds — the account service
 * and the hosted routes — then stands on it, and no development
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
 * A terminal's relay WebSocket. It arrives rather than being built here,
 * because the desktop's is opened over `ws` (`@luke/host/node`), and a host
 * that imported it could not load where `ws` does not. Only the terminals
 * concern asks for it, so an assembly that leaves terminals out is handed
 * none.
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

/** A command run inside an agent's VM: the agent it is for and its folder, the folder it runs in there, its program and arguments, and the variables it is handed. */
export interface LocalAgentSandboxCommand {
  readonly agentId: string;
  readonly folder: string;
  readonly cwd: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

/**
 * The VM each of a sandboxed device's agents runs a turn in
 * (`@luke/host/node`'s `smolvmSandbox`), beside the launch that starts the
 * runner in it. A VM lives for one turn: it is made fresh and started
 * before a runner starts, each of the agent's processes in it is signalled
 * before the runner's process is killed, since killing a command run in a
 * VM ends what it runs at once with no signal, and it is deleted once its
 * runner has ended; a check of the agent's folder between turns makes one
 * of its own and deletes it after. The agent's GitHub token is kept on the
 * device for the turn alone, outside every folder the VM mounts, where the
 * VM's credential bindings read it on every request, so the VM only ever
 * holds a placeholder. Only the local agents concern asks for it.
 */
export interface LocalAgentSandbox {
  /** Where the VM's own image keeps what a runner runs on, which the device registers in place of any copy of its own. */
  readonly tools: { readonly node: string; readonly claude: string; readonly codex: string };
  /**
   * The device's VMs given what they run on, had now where it can be: a
   * host's `smolvm` is its service's own, so it always has; a Mac fetches and
   * checks its pinned `smolvm` the first time, and pulls the image once. It
   * runs `preparing` once, just before a fetch or pull begins, and never
   * where it has everything already, so the device says it is getting ready
   * only while it is. It fails, in words naming no secret, with what could
   * not be had. The device registers as ready to take an agent only once it
   * succeeds.
   */
  readonly ready: (
    preparing: Effect.Effect<void>,
  ) => Effect.Effect<
    void,
    LocalAgentSandboxUnavailable,
    ChildProcessSpawner.ChildProcessSpawner | FileSystem | Path.Path | HttpClient
  >;
  /**
   * The agent's VM made fresh from the pinned image, its folder mounted at
   * the same path, and started, once any VM of the agent's a run that died
   * left standing is deleted; it fails where it could not be, leaving no VM
   * it made standing.
   */
  readonly started: (agent: {
    readonly agentId: string;
    readonly folder: string;
    /** Whether the VM sends the agent's GitHub token to GitHub, from the files `githubToken` writes. */
    readonly github: boolean;
  }) => Effect.Effect<
    void,
    LocalAgentSandboxUnavailable,
    ChildProcessSpawner.ChildProcessSpawner | FileSystem
  >;
  /** The process a command run inside the agent's VM is, its variables handed by name and never as arguments. */
  readonly exec: (command: LocalAgentSandboxCommand) => LocalAgentCommand;
  /** Every process of the agent's in its VM asked to end (SIGTERM), so the runner ends as it would on a signal of its own. */
  readonly signalled: (
    agentId: string,
  ) => Effect.Effect<void, never, ChildProcessSpawner.ChildProcessSpawner>;
  /**
   * The agent's VM deleted, stopped first where it still runs, and the
   * token kept for it beside it: every turn's end, and a discard's. Its
   * folder is the follower's. Whether the VM is gone, since one left
   * standing is deleted again before its launch is settled, and stays in
   * the record an uninstall deletes by.
   */
  readonly deleted: (
    agentId: string,
  ) => Effect.Effect<boolean, never, ChildProcessSpawner.ChildProcessSpawner | FileSystem>;
  /**
   * The agents smolvm keeps a machine for, by id, whoever made it; none
   * where it could not list its machines, so no agent is taken as holding
   * none where it may.
   */
  readonly machines: Effect.Effect<
    Option.Option<ReadonlySet<string>>,
    never,
    ChildProcessSpawner.ChildProcessSpawner
  >;
  /** The agent's GitHub token written where its VM's bindings read it, replacing the last, so a renewal needs no restart. */
  readonly githubToken: (
    agentId: string,
    token: string,
  ) => Effect.Effect<void, PlatformError, FileSystem>;
  /** What a git run on the device itself, as the worktree's script runs, adds to its environment to read the same token, never naming it. */
  readonly deviceGit: (agentId: string) => Readonly<Record<string, string>>;
}

/**
 * The agent CLIs a device keeps of its own (`local-agent-setup.ts`'s
 * `localAgentClis`): Claude Code, Codex, and GitHub's CLI, each the pinned
 * build for the box, fetched under its state and checked before it is kept.
 * The device has them before it registers ready, as its readiness step
 * asks, while its agents still run in VMs on the image's own; once they run
 * on the box itself, `paths` is what it registers and launches from.
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

/** Why an agent's VM could not be made or started. */
export class LocalAgentSandboxUnavailable extends Data.TaggedError("LocalAgentSandboxUnavailable")<{
  readonly detail: string;
}> {}

/** Why an agent's packed state could not be sealed, in words naming no path, key, or byte of it. */
export class LocalAgentStateUnsealed extends Data.TaggedError("LocalAgentStateUnsealed")<{
  readonly detail: string;
}> {}

/** Why a bundle of an agent's saved state could not be opened into its pack, in words naming no path, key, or byte of it. */
export class LocalAgentStateUnopened extends Data.TaggedError("LocalAgentStateUnopened")<{
  readonly detail: string;
}> {}

/**
 * What a local agent's runner is started with on this device
 * (`compose-local-agents.ts`): the VM each agent runs in (`sandbox`), how
 * every runner is started in it (`launch`), the runner's bundle, and what
 * the start adds to its environment; the name, platform, and architecture
 * the device is offered under at Start; and the scripts that make an
 * agent's own repository and check it for unsaved work
 * (`node/open-on-mac.ts`'s `agentWorktreeScript` and `agentUnsavedWorkScript`).
 * It arrives rather than being built here, because each is the shell's own,
 * a path into its bundle or a script `node:path` builds, and a host that
 * built them could not load in a browser. Only the follower asks for it, as
 * `luke-host` runs it (`@luke/host/daemon`'s `hostPlatform`).
 */
export interface LocalAgentPlatformSeam {
  /** The process a runner is started as, given what it runs and the environment made for it: `smolvm machine exec` into the agent's VM. */
  readonly launch: (runner: LocalAgentRunner) => LocalAgentCommand;
  readonly runnerBundle: string;
  readonly runnerEnv: Readonly<Record<string, string>>;
  readonly deviceName: string;
  /** The platform and architecture the device registers as. */
  readonly devicePlatform: DevicePlatform;
  readonly deviceArch: DeviceArch;
  /** How the launcher runs each agent, which the device registers as: in a VM of its own. */
  readonly deviceIsolation: DeviceIsolation;
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
    /** The commit the repository is made at, where a launch restores the agent's saved state onto it; none for the head of `branch`. */
    readonly base?: string | undefined;
  }) => string;
  /**
   * The script that says what a discard would lose from the agent's worktree
   * (`node/open-on-mac.ts`'s `agentUnsavedWorkScript`): it prints a line naming
   * the work at risk, nothing where there is none, and exits non-zero where it
   * could not tell, which keeps the folder. A discard on a device that names
   * none removes the folder unconditionally, as a host's does, whose folder
   * never holds the only copy of the developer's work.
   */
  readonly unsavedWorkScript?: ((input: { readonly worktree: string }) => string) | undefined;
  /**
   * The VM each agent runs a turn in: `launch` starts the runner inside it,
   * and the follower makes it fresh for each turn and deletes it as the
   * turn ends, keeps the agent's GitHub token out of its folder, and checks
   * the folder for unsaved work in a VM made for the check rather than on
   * the device.
   */
  readonly sandbox: LocalAgentSandbox;
  /** The agent CLIs the device keeps of its own, had before it registers ready (`LocalAgentClis`). */
  readonly clis: LocalAgentClis;
  /**
   * The agent's packed state at `from`, which must be a plain file standing
   * in the folder `within` by its real path, sealed under the agent's state
   * key (standard base64 of its 32 bytes) into a bundle at `to`, outside
   * every folder a VM mounts (`node/agent-state-seal.ts`): its size and
   * SHA-256 in hex, which the save's commit names.
   */
  readonly stateSealed: (input: {
    readonly from: string;
    readonly within: string;
    readonly to: string;
    readonly key: string;
  }) => Effect.Effect<{ readonly bytes: number; readonly sha256: string }, LocalAgentStateUnsealed>;
  /**
   * A bundle of the agent's saved state at `from`, as Luke's store answered
   * it, opened under the agent's state key into its pack at `to`, which
   * must stand in the folder `within` by its real path
   * (`node/agent-state-seal.ts`): its size and SHA-256 checked against the
   * ones its save committed before a byte of it is decrypted, and the pack
   * kept only once GCM's tag checks.
   */
  readonly stateOpened: (input: {
    readonly from: string;
    readonly to: string;
    readonly within: string;
    readonly key: string;
    readonly bytes: number;
    readonly sha256: string;
  }) => Effect.Effect<void, LocalAgentStateUnopened>;
  /**
   * The share of the disk holding the folder given that stands free, from 0
   * to 1; none where it could not be read. A sweep lets a saved agent's
   * folder go before its warm window ends where it runs low.
   */
  readonly diskFree: (folder: string) => Effect.Effect<Option.Option<number>>;
  /**
   * Whether agents on this device may have run directly on it, before every
   * agent ran in a VM: This Mac's did, a host's never. On such a device the
   * follower keeps how each agent ran, takes an agent from before that
   * record with a checkout as one that ran directly, never starts it in a
   * VM, and checks its folder on the device before a discard.
   */
  readonly formerlyDirect: boolean;
  /**
   * Whether the agents' folders under the device's home and its smolvm
   * store are this install's alone: a Linux host's are, its `luke-host`
   * user's own, and a Mac's never, since This Mac and a standalone
   * `luke-host` share the member's. On such a device the follower takes
   * every agent with a folder or a machine there as one it made as its gate
   * opens, beside those its own state names.
   */
  readonly storesOwned: boolean;
}

export class LocalAgentPlatform extends Context.Service<
  LocalAgentPlatform,
  LocalAgentPlatformSeam
>()("@luke/host/LocalAgentPlatform") {}

/** What may be asked of This Mac's `luke-host` login item. */
export const HOST_LOGIN_ITEM_ACT = {
  REGISTER: "register",
  UNREGISTER: "unregister",
  STATUS: "status",
} as const;

export type HostLoginItemAct = (typeof HOST_LOGIN_ITEM_ACT)[keyof typeof HOST_LOGIN_ITEM_ACT];

/** Where This Mac's `luke-host` login item stands (`SMAppService.Status`). */
export const HOST_LOGIN_ITEM_STATUS = {
  ENABLED: "enabled",
  NOT_REGISTERED: "not-registered",
  /** Registered, and waiting on the member in System Settings › General › Login Items. */
  REQUIRES_APPROVAL: "requires-approval",
  /** The app carries no such item. */
  NOT_FOUND: "not-found",
} as const;

export type HostLoginItemStatus =
  (typeof HOST_LOGIN_ITEM_STATUS)[keyof typeof HOST_LOGIN_ITEM_STATUS];

/**
 * This Mac's `luke-host` as the desktop runs it (`compose-this-mac-host.ts`):
 * its login item asked an act, and the version of the `luke-host` the app
 * carries, which its enroll names. Each answers, never fails: what it
 * answered, or the words it could not with. A development build carries no
 * login item, so its shell answers the same acts by running the same
 * `luke-host` as a child of the app. Only the local agents concern asks for
 * it.
 */
export interface ThisMacHostSeam {
  readonly loginItem: (
    act: HostLoginItemAct,
  ) => Effect.Effect<
    Result.Result<HostLoginItemStatus, string>,
    never,
    ChildProcessSpawner.ChildProcessSpawner
  >;
  readonly version: Effect.Effect<
    Result.Result<string, string>,
    never,
    ChildProcessSpawner.ChildProcessSpawner
  >;
  /** The Mac as its `luke-host` registers it, which its enroll names so Luke creates the device where it never saw this Mac. */
  readonly machine: Effect.Effect<{
    readonly name: string;
    readonly platform: DevicePlatform;
    readonly arch: DeviceArch;
  }>;
}

export class ThisMacHost extends Context.Service<ThisMacHost, ThisMacHostSeam>()(
  "@luke/host/ThisMacHost",
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

/** Every seam tag the host's kernel stands on; the assembly adds `AccountSource`, and each platform concern it was built with adds its own. */
export type HostSeamTags =
  | StateRoot
  | RunMode
  | AppIdentity
  | Environment
  | IdSource
  | Reporter
  | ShutdownSignal;
