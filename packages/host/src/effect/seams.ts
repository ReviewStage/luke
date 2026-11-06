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

export class StateRoot extends Context.Service<StateRoot, string>()("@repo/host/StateRoot") {}

export class RunMode extends Context.Service<RunMode, RunModeFacts>()("@repo/host/RunMode") {}

export interface AppIdentityFacts {
  readonly appVersion: string;
  readonly packaged: boolean;
  readonly platform: ProductClientPlatform;
}

export class AppIdentity extends Context.Service<AppIdentity, AppIdentityFacts>()(
  "@repo/host/AppIdentity",
) {}

export class Environment extends Context.Service<Environment, ConfigProvider.ConfigProvider>()(
  "@repo/host/Environment",
) {}

export class SecretCipher extends Context.Service<SecretCipher, SecretCipherSeam>()(
  "@repo/host/SecretCipher",
) {}

export interface IdSourceSeam {
  readonly create: () => string;
}

export class IdSource extends Context.Service<IdSource, IdSourceSeam>()("@repo/host/IdSource") {}

export class ServiceOrigin extends Context.Service<ServiceOrigin, string>()(
  "@repo/host/ServiceOrigin",
) {}

export class SettingsChangedElsewhere extends Context.Service<
  SettingsChangedElsewhere,
  Stream.Stream<void>
>()("@repo/host/SettingsChangedElsewhere") {}

export class TerminalSocket extends Context.Service<TerminalSocket, OpenTerminalSocket>()(
  "@repo/host/TerminalSocket",
) {}

export class LoopbackListener extends Context.Service<LoopbackListener, ListenOnLoopback>()(
  "@repo/host/LoopbackListener",
) {}

export interface MirrorPlatformSeam {
  readonly folder: string;
  readonly worktreeScript: (input: {
    readonly repository: string;
    readonly worktree: string;
    readonly base: string;
  }) => string;
  readonly listScript: (worktree: string) => string;
  readonly removeScript: (worktree: string) => string;
}

export class MirrorPlatform extends Context.Service<MirrorPlatform, MirrorPlatformSeam>()(
  "@repo/host/MirrorPlatform",
) {}

export interface SignInConsentSeam {
  readonly open: OpenConsent;
}

export class SignInConsent extends Context.Service<SignInConsent, SignInConsentSeam>()(
  "@repo/host/SignInConsent",
) {}

export interface LocalAgentRunner {
  readonly agentId: string;
  readonly folder: string;
  readonly checkout: string;
  readonly node: string;
  readonly bundle: string;
  readonly env: Readonly<Record<string, string>>;
}

export interface LocalAgentCommand {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

export interface LocalAgentClis {
  readonly paths: { readonly claude: string; readonly codex: string; readonly gh: string };
  readonly ready: (
    preparing: Effect.Effect<void>,
  ) => Effect.Effect<
    void,
    LocalAgentClisUnavailable,
    ChildProcessSpawner.ChildProcessSpawner | FileSystem | Path.Path | HttpClient
  >;
}

export class LocalAgentClisUnavailable extends Data.TaggedError("LocalAgentClisUnavailable")<{
  readonly detail: string;
}> {}

export interface LocalAgentPlatformSeam {
  readonly launch: (runner: LocalAgentRunner) => LocalAgentCommand;
  readonly tools: { readonly node: string; readonly claude: string; readonly codex: string };
  readonly runnerBundle: string;
  readonly runnerEnv: Readonly<Record<string, string>>;
  readonly deviceName: string;
  readonly deviceMachine: DeviceMachine;
  readonly devicePlatform: DevicePlatform;
  readonly deviceArch: DeviceArch;
  readonly deviceCapabilities: readonly DeviceCapability[];
  readonly worktreeScript: (input: {
    readonly home: string;
    readonly repository: string;
    readonly worktree: string;
    readonly branch: string | null;
  }) => string;
  readonly repositoryReachedScript: (repository: string) => string;
  readonly clis: LocalAgentClis;
}

export class LocalAgentPlatform extends Context.Service<
  LocalAgentPlatform,
  LocalAgentPlatformSeam
>()("@repo/host/LocalAgentPlatform") {}

export interface ThisMacHostSeam {
  readonly stateRoot: string;
  readonly runsHost: boolean;
  readonly machine: Effect.Effect<
    {
      readonly name: string;
      readonly platform: DevicePlatform;
      readonly arch: DeviceArch;
    } & DeviceMachine
  >;
  readonly loaded: Effect.Effect<boolean, never, ChildProcessSpawner.ChildProcessSpawner>;
  readonly install: (
    script: string,
  ) => Effect.Effect<Result.Result<void, string>, never, ChildProcessSpawner.ChildProcessSpawner>;
  readonly stop: Effect.Effect<
    Result.Result<void, string>,
    never,
    ChildProcessSpawner.ChildProcessSpawner
  >;
  readonly uninstall: Effect.Effect<
    Result.Result<void, string>,
    never,
    ChildProcessSpawner.ChildProcessSpawner
  >;
}

export class ThisMacHost extends Context.Service<ThisMacHost, ThisMacHostSeam>()(
  "@repo/host/ThisMacHost",
) {}

export class AccountSource extends Context.Service<AccountSource, AccountSourceSeam>()(
  "@repo/host/AccountSource",
) {}

export interface HostReporter {
  readonly report: (message: string) => void;
}

export class Reporter extends Context.Service<Reporter, HostReporter>()("@repo/host/Reporter") {}

export const reporterLayer = (report: (message: string) => void): Layer.Layer<Reporter> =>
  Layer.merge(
    Layer.succeed(Reporter, { report }),
    Logger.layer([
      Logger.make((options) => {
        report(String(options.message));
      }),
      Logger.tracerLogger,
    ]),
  );

export interface ShutdownSignalSeam {
  readonly notify: (() => void) | undefined;
}

export class ShutdownSignal extends Context.Service<ShutdownSignal, ShutdownSignalSeam>()(
  "@repo/host/ShutdownSignal",
) {}

export type HostSeamTags =
  | StateRoot
  | RunMode
  | AppIdentity
  | Environment
  | IdSource
  | Reporter
  | ShutdownSignal;
