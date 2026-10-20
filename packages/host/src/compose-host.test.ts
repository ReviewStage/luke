import assert from "node:assert/strict";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { describe, it } from "@effect/vitest";
import { loopbackConsent } from "@luke/credentials/node";
import { ACCOUNT_PROVIDER, ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { GATEWAY_ERROR, GATEWAY_METHOD } from "@luke/gateway";
import { temporaryDirectoryScoped } from "@luke/runtime/testing";
import { HOST_CAPABILITY } from "@luke/settings";
import { scriptedOpenSocket } from "@luke/voice/testing";
import { noNetwork } from "@luke/wire/testing";
import { ConfigProvider, Effect, Layer } from "effect";
import { hostAssemblyLayer } from "./compose-host.js";
import { HostAssemblyTag, HostTag, hostStandingLayer } from "./effect/host.js";
import { hostKernelLayer } from "./effect/kernel.js";
import {
  AppIdentity,
  Environment,
  IdSource,
  RunMode,
  reporterLayer,
  SecretCipher,
  ShutdownSignal,
  SignInConsent,
  StateRoot,
  TerminalSocket,
  VoiceSocket,
} from "./effect/seams.js";
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

/**
 * The host assembled with a chosen set of platform concerns, on a fixture
 * run over a state root of the test's own: a host built without them stands
 * with none of their seams provided and refuses their methods, where the
 * desktop's, built with all of them, answers.
 */

/**
 * Every seam a host stands on whatever it was built with, the kernel over
 * them. The account source is each test's own, so none of the desktop's
 * source's seams are here.
 */
const machineOver = (stateRoot: string) =>
  Layer.provideMerge(
    hostKernelLayer,
    Layer.mergeAll(
      Layer.succeed(StateRoot, stateRoot),
      Layer.succeed(RunMode, runModeFor({ capture: false, fixture: true })),
      Layer.succeed(AppIdentity, { appVersion: "0.0.0-test", packaged: false }),
      Layer.succeed(Environment, ConfigProvider.fromEnvRecord({})),
      Layer.succeed(IdSource, { create: () => "id" }),
      reporterLayer(() => undefined),
      Layer.succeed(ShutdownSignal, { notify: undefined }),
      Layer.succeed(VoiceSocket, scriptedOpenSocket([]).openSocket),
      NodeFileSystem.layer,
      NodePath.layer,
      noNetwork,
    ),
  );

/** The desktop's own account source, over its cipher and its loopback consent. */
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

/** A client offering one capability of its own, as a browser might. */
const CLIENT: readonly ClientCapability[] = [HOST_CAPABILITY.NOTIFICATIONS];

/** What a standing host answers for a Mac's repositories and an agent's terminals, and which concerns it says it runs. */
const askedOfStandingHost = Effect.gen(function* () {
  const { concerns } = yield* HostAssemblyTag;
  const { gateway } = yield* HostTag;
  const repositories = yield* gateway.call(GATEWAY_METHOD.MAC_REPOSITORIES_READ);
  const terminals = yield* gateway.call(GATEWAY_METHOD.TERMINALS_LIST, { agentId: "agent" });
  return { concerns, repositories, terminals };
});

describe("the host's platform concerns", () => {
  it.effect("left out, need no spawner or terminal socket, and refuse their methods", () =>
    Effect.gen(function* () {
      const stateRoot = yield* temporaryDirectoryScoped("luke-host-browser-");
      // Note that nothing here provides a `ChildProcessSpawner` or a
      // `TerminalSocket`. The layer's type, narrowed to the concerns chosen,
      // asks for neither, and a build that reached for one anyway would die
      // here on the missing service.
      const browser = hostStandingLayer.pipe(
        Layer.provideMerge(hostAssemblyLayer([])),
        Layer.provide(Layer.merge(machineOver(stateRoot), fixedAccountSource())),
      );

      const asked = yield* Effect.provide(askedOfStandingHost, browser);

      const notHere = {
        ok: false,
        error: { code: GATEWAY_ERROR.REFUSED, message: NOT_ON_THIS_PLATFORM },
      };
      assert.deepEqual(asked.repositories, notHere);
      assert.deepEqual(asked.terminals, notHere);
      assert.equal(asked.concerns.has(HOST_CONCERN.MAC_COMMANDS), false);
      assert.equal(asked.concerns.has(HOST_CONCERN.MAC_TERMINAL), false);
      assert.equal(asked.concerns.has(HOST_CONCERN.TERMINALS), false);
      assert.equal(asked.concerns.has(HOST_CONCERN.TASKS), true);
      assert.deepEqual(hostCapabilities(asked.concerns, CLIENT), [HOST_CAPABILITY.NOTIFICATIONS]);
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("all chosen, as the desktop chooses them, answer", () =>
    Effect.gen(function* () {
      const stateRoot = yield* temporaryDirectoryScoped("luke-host-desktop-");
      const desktop = hostStandingLayer.pipe(
        Layer.provideMerge(hostAssemblyLayer(ALL_HOST_PLATFORM_CONCERNS)),
        Layer.provide(
          Layer.mergeAll(
            machineOver(stateRoot),
            desktopAccountSource,
            scriptedSpawner(() => ({ exitCode: 0 })).layer,
            Layer.succeed(TerminalSocket, () => Effect.succeed({ unreachable: true as const })),
          ),
        ),
      );

      const asked = yield* Effect.provide(askedOfStandingHost, desktop);

      assert.deepEqual(asked.repositories, { ok: true, result: { repositories: [] } });
      // A fixture run signs no account in, so the terminals concern itself answers, and refuses as signed out.
      assert.deepEqual(asked.terminals, {
        ok: false,
        error: { code: GATEWAY_ERROR.REFUSED, message: "signed out" },
      });
      for (const concern of ALL_HOST_PLATFORM_CONCERNS)
        assert.equal(asked.concerns.has(concern), true);
      assert.deepEqual(hostCapabilities(asked.concerns, CLIENT), [
        HOST_CAPABILITY.NOTIFICATIONS,
        HOST_CAPABILITY.MAC_COMMANDS,
        HOST_CAPABILITY.MAC_TERMINAL,
        HOST_CAPABILITY.TERMINALS,
      ]);
      // The desktop answers every client capability too: its Zoom, login item and Keyboard shortcuts page stand on DESKTOP_APP.
      assert.deepEqual(hostCapabilities(asked.concerns, ALL_CLIENT_CAPABILITIES), [
        HOST_CAPABILITY.VOICE,
        HOST_CAPABILITY.UPDATES,
        HOST_CAPABILITY.MICROPHONE,
        HOST_CAPABILITY.NOTIFICATIONS,
        HOST_CAPABILITY.MAC_COMMANDS,
        HOST_CAPABILITY.MAC_TERMINAL,
        HOST_CAPABILITY.TERMINALS,
        HOST_CAPABILITY.BROWSER,
        HOST_CAPABILITY.DESKTOP_APP,
      ]);
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );
});

describe("the host's account source", () => {
  it.effect("another source than the desktop's stands with no sign-in consent or cipher", () =>
    Effect.gen(function* () {
      const stateRoot = yield* temporaryDirectoryScoped("luke-host-account-source-");
      const account = {
        status: ACCOUNT_STATUS.SIGNED_IN,
        email: "dev@example.com",
        provider: ACCOUNT_PROVIDER.GITHUB,
      } as const;
      // Note that nothing here provides a `SignInConsent` or a `SecretCipher`:
      // they are the desktop's source's own requirements, so the assembly's
      // type asks for neither, and a build that reached for one would die here.
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
