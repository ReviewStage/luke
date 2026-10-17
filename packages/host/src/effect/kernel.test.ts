import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { ConfigProvider, Effect, Layer } from "effect";
import { ACCOUNT_BASE_URL_VARIABLE } from "../host-kernel.js";
import { runModeFor } from "../run-mode.js";
import type { SecretCipher } from "../settings-store.js";
import { HostKernelTag, hostKernelLayer } from "./kernel.js";
import {
  AppIdentity,
  Environment,
  IdSource,
  RunMode,
  reporterLayer,
  SecretCipher as SecretCipherTag,
  ShutdownSignal,
  StateRoot,
} from "./seams.js";

const CIPHER: SecretCipher = {
  isAvailable: () => false,
  encrypt: (plainText) => new TextEncoder().encode(plainText),
  decrypt: (cipherText) => new TextDecoder().decode(cipherText),
};

interface TestSeams {
  readonly stateRoot: string;
  readonly runMode: ReturnType<typeof runModeFor>;
  readonly appVersion: string;
  readonly packaged: boolean;
  readonly environment: Record<string, string>;
  readonly cipher: SecretCipher;
  readonly createId: () => string;
  readonly report: (message: string) => void;
}

const seams = (overrides: Partial<TestSeams> = {}): TestSeams => ({
  stateRoot: "/nowhere",
  runMode: runModeFor({ capture: false, fixture: true }),
  appVersion: "0.0.0-test",
  packaged: false,
  environment: {},
  cipher: CIPHER,
  createId: () => "id",
  report: () => undefined,
  ...overrides,
});

/** The kernel layer over one test's own seam values, built the way a real composition builds it. */
const kernelLayerOver = (input: TestSeams) =>
  Layer.provideMerge(
    hostKernelLayer,
    Layer.mergeAll(
      Layer.succeed(StateRoot, input.stateRoot),
      Layer.succeed(RunMode, input.runMode),
      Layer.succeed(AppIdentity, { appVersion: input.appVersion, packaged: input.packaged }),
      Layer.succeed(Environment, ConfigProvider.fromEnvRecord(input.environment)),
      Layer.succeed(SecretCipherTag, input.cipher),
      Layer.succeed(IdSource, { create: input.createId }),
      reporterLayer(input.report),
      Layer.succeed(ShutdownSignal, { notify: undefined }),
    ),
  );

describe("the seam tags", () => {
  it.effect("read the account override out of that provider, and never in a packaged build", () =>
    Effect.gen(function* () {
      const override = "http://127.0.0.1:3000/api/auth";
      const development = yield* Effect.provide(
        HostKernelTag,
        kernelLayerOver(seams({ environment: { [ACCOUNT_BASE_URL_VARIABLE]: override } })),
      );
      const packaged = yield* Effect.provide(
        HostKernelTag,
        kernelLayerOver(
          seams({ packaged: true, environment: { [ACCOUNT_BASE_URL_VARIABLE]: override } }),
        ),
      );
      const none = yield* Effect.provide(HostKernelTag, kernelLayerOver(seams()));

      assert.equal(development.accountBaseUrl, override);
      assert.equal(development.hostedServiceBaseUrl, "http://127.0.0.1:3000");
      assert.equal(packaged.accountBaseUrl, none.accountBaseUrl);
      assert.equal(packaged.hostedServiceBaseUrl, none.hostedServiceBaseUrl);
    }),
  );
});
