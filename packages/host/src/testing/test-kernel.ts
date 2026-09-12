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
import { Layer } from "effect";
import {
  type HostKernelTag,
  type HostService,
  hostKernelLayerFromSeams,
} from "../effect/kernel.js";
import type { HostSeamTags } from "../effect/seams.js";
import type { HostSeams } from "../host-kernel.js";
import { runModeFor } from "../run-mode.js";
import type { SecretCipher } from "../settings-store.js";

const NO_CIPHER: SecretCipher = {
  isAvailable: () => false,
  encrypt: (plainText) => Buffer.from(plainText, "utf8"),
  decrypt: (cipherText) => cipherText.toString("utf8"),
};

export interface TestKernelOptions extends Partial<Omit<HostSeams, "stateRoot">> {
  readonly stateRoot: string;
}

/** The seams a fixture host stands on: the state root a test hands in, and a fixture default for everything else. */
export const testKernelSeams = (options: TestKernelOptions): HostSeams => ({
  runMode: runModeFor({ capture: false, fixture: true }),
  appVersion: "0.0.0-test",
  packaged: false,
  environment: {},
  cipher: NO_CIPHER,
  createWorker: () => {
    throw new Error("a fixture host keeps nothing on disk");
  },
  // Unread by the kernel, which reads Effect's own `Clock`; kept only because
  // `HostSeams` still carries it for `createHostKernel`'s non-Effect adaptor.
  now: () => 0,
  createId: () => "id",
  report: () => undefined,
  ...options,
});

/** Every seam `hostAssemblyLayer`/`hostStandingLayer` need, over a fixture state root. */
export const testKernelLayer = (
  options: TestKernelOptions,
): Layer.Layer<HostKernelTag | HostService | HostSeamTags | FileSystem.FileSystem> =>
  Layer.merge(hostKernelLayerFromSeams(testKernelSeams(options)), NodeFileSystem.layer);
