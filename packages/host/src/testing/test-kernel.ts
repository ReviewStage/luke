/**
 * A fixture composition of every seam tag `hostAssemblyLayer` and
 * `hostStandingLayer` need, standing over the state root a test hands in and
 * defaults for the rest. Its clock is not a seam of its own: `HostKernelTag`
 * reads Effect's ambient `Clock`, so a test that builds `testKernelLayer`
 * under `@effect/vitest`'s `it.effect` drives `kernel.now()` with `TestClock`
 * the same way it drives every other Effect timer.
 */

import type * as FileSystem from "@effect/platform/FileSystem";
import { NodeFileSystem } from "@effect/platform-node";
import { ConfigProvider, Layer } from "effect";
import { type HostKernelTag, type HostService, hostKernelLayer } from "../effect/kernel.js";
import {
  AppIdentity,
  Environment,
  type HostSeamTags,
  IdSource,
  MachinePresenceReader,
  RunMode,
  reporterLayer,
  SecretCipher,
  ShutdownSignal,
  StateRoot,
  StoreWorker,
} from "../effect/seams.js";
import type { HostSeams } from "../host-kernel.js";
import { runModeFor } from "../run-mode.js";
import type { SecretCipher as SecretCipherSeam } from "../settings-store.js";

const NO_CIPHER: SecretCipherSeam = {
  isAvailable: () => false,
  encrypt: (plainText) => Buffer.from(plainText, "utf8"),
  decrypt: (cipherText) => cipherText.toString("utf8"),
};

export interface TestKernelOptions extends Partial<Omit<HostSeams, "stateRoot">> {
  readonly stateRoot: string;
}

/** The seams a fixture host stands on: the state root a test hands in, and a fixture default for everything else. */
const testKernelSeams = (options: TestKernelOptions): HostSeams => ({
  runMode: runModeFor({ capture: false, fixture: true }),
  appVersion: "0.0.0-test",
  packaged: false,
  environment: {},
  cipher: NO_CIPHER,
  createWorker: () => {
    throw new Error("a fixture host keeps nothing on disk");
  },
  createId: () => "id",
  report: () => undefined,
  ...options,
});

/** Every seam tag `hostAssemblyLayer`/`hostStandingLayer` need, from the fixture seams above. */
const testSeamLayers = (seams: HostSeams) =>
  Layer.mergeAll(
    Layer.succeed(StateRoot, seams.stateRoot),
    Layer.succeed(RunMode, seams.runMode),
    Layer.succeed(AppIdentity, { appVersion: seams.appVersion, packaged: seams.packaged }),
    Layer.succeed(
      Environment,
      ConfigProvider.fromMap(
        new Map(
          Object.entries(seams.environment).filter(
            (entry): entry is [string, string] => entry[1] !== undefined,
          ),
        ),
      ),
    ),
    Layer.succeed(SecretCipher, seams.cipher),
    Layer.succeed(StoreWorker, { create: seams.createWorker }),
    Layer.succeed(IdSource, { create: seams.createId }),
    reporterLayer(seams.report),
    Layer.succeed(MachinePresenceReader, { read: seams.machinePresence }),
    Layer.succeed(ShutdownSignal, { notify: seams.onShutdownRequested }),
  );

/** Every seam `hostAssemblyLayer`/`hostStandingLayer` need, over a fixture state root. */
export const testKernelLayer = (
  options: TestKernelOptions,
): Layer.Layer<HostKernelTag | HostService | HostSeamTags | FileSystem.FileSystem> =>
  Layer.merge(
    Layer.provideMerge(hostKernelLayer, testSeamLayers(testKernelSeams(options))),
    NodeFileSystem.layer,
  );
