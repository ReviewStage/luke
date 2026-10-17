import assert from "node:assert/strict";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { describe, it } from "@effect/vitest";
import { loopbackConsent } from "@luke/credentials/node";
import { GATEWAY_ERROR, GATEWAY_METHOD } from "@luke/gateway";
import { temporaryDirectoryScoped } from "@luke/runtime/testing";
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
import { ALL_HOST_PLATFORM_CONCERNS, HOST_CONCERN, NOT_ON_THIS_PLATFORM } from "./host-concerns.js";
import { runModeFor } from "./run-mode.js";
import { scriptedSpawner } from "./testing/scripted-spawner.js";

/**
 * The host assembled with a chosen set of platform concerns, on a fixture
 * run over a state root of the test's own: a host built without them stands
 * with none of their seams provided and refuses their methods, where the
 * desktop's, built with all of them, answers.
 */

/** Every seam a host stands on whatever it was built with, the kernel over them. */
const machineOver = (stateRoot: string) =>
  Layer.provideMerge(
    hostKernelLayer,
    Layer.mergeAll(
      Layer.succeed(StateRoot, stateRoot),
      Layer.succeed(RunMode, runModeFor({ capture: false, fixture: true })),
      Layer.succeed(AppIdentity, { appVersion: "0.0.0-test", packaged: false }),
      Layer.succeed(Environment, ConfigProvider.fromEnvRecord({})),
      Layer.succeed(SecretCipher, {
        isAvailable: () => false,
        encrypt: (plainText) => new TextEncoder().encode(plainText),
        decrypt: (cipherText) => new TextDecoder().decode(cipherText),
      }),
      Layer.succeed(IdSource, { create: () => "id" }),
      reporterLayer(() => undefined),
      Layer.succeed(ShutdownSignal, { notify: undefined }),
      Layer.succeed(VoiceSocket, scriptedOpenSocket([]).openSocket),
      Layer.succeed(SignInConsent, { open: loopbackConsent }),
      NodeFileSystem.layer,
      NodePath.layer,
      noNetwork,
    ),
  );

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
        Layer.provide(machineOver(stateRoot)),
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
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );
});
