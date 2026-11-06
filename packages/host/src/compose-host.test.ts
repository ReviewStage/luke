import assert from "node:assert/strict";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { describe, it } from "@effect/vitest";
import { loopbackConsent } from "@repo/credentials/node";
import { ACCOUNT_PROVIDER, ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { PRODUCT_PLATFORM } from "@repo/features/analytics";
import { DEVICE_ARCH, DEVICE_PLATFORM } from "@repo/features/device-agent-wire";
import { GATEWAY_ERROR, GATEWAY_METHOD } from "@repo/gateway";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import { HOST_CAPABILITY } from "@repo/settings";
import { noNetwork } from "@repo/wire/testing";
import { ConfigProvider, Effect, Layer, Path, Result } from "effect";
import * as FileSystem from "effect/FileSystem";
import type { AccountSourceHost } from "./account-source.js";
import { hostAssemblyLayer } from "./compose-host.js";
import { HostAssemblyTag, HostTag, hostStandingLayer } from "./effect/host.js";
import { hostKernelLayer } from "./effect/kernel.js";
import {
  AppIdentity,
  Environment,
  IdSource,
  LoopbackListener,
  MirrorPlatform,
  RunMode,
  reporterLayer,
  SecretCipher,
  ShutdownSignal,
  SignInConsent,
  StateRoot,
  TerminalSocket,
  ThisMacHost,
} from "./effect/seams.js";
import { ENTITY_STORE_FILE_NAME } from "./entity-store.js";
import {
  ALL_CLIENT_CAPABILITIES,
  ALL_HOST_PLATFORM_CONCERNS,
  type ClientCapability,
  HOST_CONCERN,
  hostCapabilities,
  NOT_ON_THIS_PLATFORM,
} from "./host-concerns.js";
import { oauthAccountSourceLayer } from "./oauth-account-source.js";
import { runModeFor } from "./run-mode.js";
import { fixedAccountSource } from "./testing/fixed-account-source.js";
import { scriptedSpawner } from "./testing/scripted-spawner.js";

const machineOver = (stateRoot: string) =>
  Layer.provideMerge(
    hostKernelLayer,
    Layer.mergeAll(
      Layer.succeed(StateRoot, stateRoot),
      Layer.succeed(RunMode, runModeFor({ capture: false, fixture: true })),
      Layer.succeed(AppIdentity, {
        appVersion: "0.0.0-test",
        packaged: false,
        platform: PRODUCT_PLATFORM.DESKTOP,
      }),
      Layer.succeed(Environment, ConfigProvider.fromEnvRecord({})),
      Layer.succeed(IdSource, { create: () => "id" }),
      reporterLayer(() => undefined),
      Layer.succeed(ShutdownSignal, { notify: undefined }),
      NodeFileSystem.layer,
      NodePath.layer,
      noNetwork,
    ),
  );

const desktopAccountSource = Layer.provide(
  oauthAccountSourceLayer,
  Layer.merge(
    Layer.succeed(SecretCipher, {
      isAvailable: () => false,
      encrypt: (plainText) => new TextEncoder().encode(plainText),
      decrypt: (cipherText) => new TextDecoder().decode(cipherText),
    }),
    Layer.succeed(SignInConsent, { open: loopbackConsent }),
  ),
);

const CLIENT: readonly ClientCapability[] = [HOST_CAPABILITY.MICROPHONE];

const askedOfStandingHost = Effect.gen(function* () {
  const { concerns } = yield* HostAssemblyTag;
  const { gateway } = yield* HostTag;
  const terminals = yield* gateway.call(GATEWAY_METHOD.TERMINALS_LIST, { agentId: "agent" });
  return { concerns, terminals };
});

describe("the host's platform concerns", () => {
  it.effect("left out, need no spawner or terminal socket, and refuse their methods", () =>
    Effect.gen(function* () {
      const stateRoot = yield* temporaryDirectoryScoped("host-browser-");
      const browser = hostStandingLayer.pipe(
        Layer.provideMerge(hostAssemblyLayer([])),
        Layer.provide(Layer.merge(machineOver(stateRoot), fixedAccountSource())),
      );

      const asked = yield* Effect.provide(askedOfStandingHost, browser);

      const notHere = {
        ok: false,
        error: { code: GATEWAY_ERROR.REFUSED, message: NOT_ON_THIS_PLATFORM },
      };
      assert.deepEqual(asked.terminals, notHere);
      assert.equal(asked.concerns.has(HOST_CONCERN.MAC_COMMANDS), false);
      assert.equal(asked.concerns.has(HOST_CONCERN.TERMINALS), false);
      assert.equal(asked.concerns.has(HOST_CONCERN.TASKS), true);
      assert.deepEqual(hostCapabilities(asked.concerns, CLIENT), [HOST_CAPABILITY.MICROPHONE]);
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("all chosen, as the desktop chooses them, answer", () =>
    Effect.gen(function* () {
      const stateRoot = yield* temporaryDirectoryScoped("host-desktop-");
      const desktop = hostStandingLayer.pipe(
        Layer.provideMerge(hostAssemblyLayer(ALL_HOST_PLATFORM_CONCERNS)),
        Layer.provide(
          Layer.mergeAll(
            machineOver(stateRoot),
            desktopAccountSource,
            scriptedSpawner(() => ({ exitCode: 0 })).layer,
            Layer.succeed(TerminalSocket, () => Effect.succeed({ unreachable: true as const })),
            Layer.succeed(LoopbackListener, () => Effect.succeed(undefined)),
            Layer.succeed(MirrorPlatform, {
              folder: stateRoot,
              worktreeScript: () => "exit 1",
              listScript: () => "exit 1",
              removeScript: () => "exit 1",
            }),
            Layer.succeed(ThisMacHost, {
              stateRoot,
              runsHost: false,
              loaded: Effect.succeed(false),
              install: () => Effect.succeed(Result.fail("no install in a fixture")),
              stop: Effect.succeed(Result.fail("no launchd in a fixture")),
              uninstall: Effect.succeed(Result.fail("no install in a fixture")),
              machine: Effect.succeed({
                name: "Studio",
                platform: DEVICE_PLATFORM.DARWIN,
                arch: DEVICE_ARCH.ARM64,
              }),
            }),
          ),
        ),
      );

      const asked = yield* Effect.provide(askedOfStandingHost, desktop);

      assert.deepEqual(asked.terminals, {
        ok: false,
        error: { code: GATEWAY_ERROR.REFUSED, message: "signed out" },
      });
      for (const concern of ALL_HOST_PLATFORM_CONCERNS)
        assert.equal(asked.concerns.has(concern), true);
      assert.deepEqual(hostCapabilities(asked.concerns, CLIENT), [
        HOST_CAPABILITY.MICROPHONE,
        HOST_CAPABILITY.MAC_COMMANDS,
        HOST_CAPABILITY.TERMINALS,
        HOST_CAPABILITY.LOCAL_TERMINALS,
        HOST_CAPABILITY.PORT_FORWARDS,
      ]);
      assert.deepEqual(hostCapabilities(asked.concerns, ALL_CLIENT_CAPABILITIES), [
        HOST_CAPABILITY.UPDATES,
        HOST_CAPABILITY.MICROPHONE,
        HOST_CAPABILITY.MAC_COMMANDS,
        HOST_CAPABILITY.MAC_TERMINAL,
        HOST_CAPABILITY.TERMINALS,
        HOST_CAPABILITY.LOCAL_TERMINALS,
        HOST_CAPABILITY.PORT_FORWARDS,
        HOST_CAPABILITY.CLI_INSTALL,
        HOST_CAPABILITY.DESKTOP_APP,
      ]);
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );
});

describe("the host's account source", () => {
  it.effect("another source than the desktop's stands with no sign-in consent or cipher", () =>
    Effect.gen(function* () {
      const stateRoot = yield* temporaryDirectoryScoped("host-account-source-");
      const account = {
        status: ACCOUNT_STATUS.SIGNED_IN,
        email: "dev@example.com",
        provider: ACCOUNT_PROVIDER.GITHUB,
      } as const;
      const host = hostStandingLayer.pipe(
        Layer.provideMerge(hostAssemblyLayer([])),
        Layer.provide(Layer.merge(machineOver(stateRoot), fixedAccountSource({ account }))),
      );

      const answered = yield* Effect.provide(
        Effect.flatMap(HostTag, ({ gateway }) => gateway.call(GATEWAY_METHOD.ACCOUNT_SNAPSHOT)),
        host,
      );

      assert.deepEqual(answered, { ok: true, result: { account } });
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );
});

describe("the account's lists kept on disk", () => {
  it.effect("are deleted as the account gate closes at a sign-out", () =>
    Effect.gen(function* () {
      const stateRoot = yield* temporaryDirectoryScoped("host-entities-");
      const fileSystem = yield* FileSystem.FileSystem;
      const file = (yield* Path.Path).join(stateRoot, ENTITY_STORE_FILE_NAME);
      yield* fileSystem.writeFileString(file, "sealed lists");
      const account = {
        status: ACCOUNT_STATUS.SIGNED_IN,
        email: "dev@example.com",
        provider: ACCOUNT_PROVIDER.GITHUB,
      } as const;
      let gate: AccountSourceHost | undefined;
      const host = hostStandingLayer.pipe(
        Layer.provideMerge(hostAssemblyLayer([])),
        Layer.provide(
          Layer.merge(
            machineOver(stateRoot),
            fixedAccountSource({
              account,
              opened: (opened) => {
                gate = opened;
              },
            }),
          ),
        ),
      );

      yield* Effect.provide(
        Effect.suspend(() => gate?.stopCapabilities ?? Effect.die("the source was never opened")),
        host,
      );

      assert.equal(yield* fileSystem.exists(file), false);
    }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer))),
  );
});
