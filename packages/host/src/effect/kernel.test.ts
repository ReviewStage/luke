import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "@effect/vitest";
import { Config, Duration, Effect, Fiber, Option, TestClock } from "effect";
import {
  ACCOUNT_BASE_URL_VARIABLE,
  type HostSeams,
  SERVICE_READ_BEFORE_MERGE,
} from "../host-kernel.js";
import { runModeFor } from "../run-mode.js";
import type { GatewayService } from "../service.js";
import type { SecretCipher } from "../settings-store.js";
import { HostKernelTag, HostService, hostKernelLayerFromSeams, lateService } from "./kernel.js";
import {
  AppIdentity,
  Environment,
  IdSource,
  Reporter,
  RunMode,
  reporterLayer,
  SecretCipher as SecretCipherTag,
  StateRoot,
  StoreWorker,
} from "./seams.js";

const CIPHER: SecretCipher = {
  isAvailable: () => false,
  encrypt: (plainText) => Buffer.from(plainText, "utf8"),
  decrypt: (cipherText) => cipherText.toString("utf8"),
};

const seams = (overrides: Partial<HostSeams> = {}): HostSeams =>
  Object.assign<HostSeams, Partial<HostSeams>>(
    {
      stateRoot: "/nowhere",
      runMode: runModeFor({ capture: false, fixture: true }),
      appVersion: "0.0.0-test",
      packaged: false,
      environment: {},
      cipher: CIPHER,
      createWorker: () => {
        throw new Error("a fixture run keeps nothing on disk");
      },
      now: () => 7,
      createId: () => "id",
      report: () => undefined,
    },
    overrides,
  );

// SAFETY: these tests hold the late service and hand it back; none of them calls a method on it.
const stubService = (): GatewayService => ({}) as GatewayService;

describe("the seam tags", () => {
  it.effect("each resolve from the kernel's own layer", () =>
    Effect.gen(function* () {
      const reported: string[] = [];
      const worker = () => {
        throw new Error("a fixture run keeps nothing on disk");
      };

      const read = yield* Effect.provide(
        Effect.all({
          stateRoot: StateRoot,
          runMode: RunMode,
          identity: AppIdentity,
          cipher: SecretCipherTag,
          storeWorker: StoreWorker,
          idSource: IdSource,
          reporter: Reporter,
        }),
        hostKernelLayerFromSeams(
          seams({
            stateRoot: "/state",
            appVersion: "1.2.3",
            createWorker: worker,
            createId: () => "minted",
            report: (message) => reported.push(message),
          }),
        ),
      );

      assert.equal(read.stateRoot, "/state");
      assert.equal(read.runMode.observesProviders, false);
      assert.deepEqual(read.identity, {
        appVersion: "1.2.3",
        packaged: false,
      });
      assert.equal(read.cipher, CIPHER);
      assert.equal(read.storeWorker.create, worker);
      assert.equal(read.idSource.create(), "minted");
      read.reporter.report("a line");
      assert.deepEqual(reported, ["a line"]);
    }),
  );

  it.effect("carry the environment as a provider a config is read out of", () =>
    Effect.gen(function* () {
      const environment = yield* Effect.provide(
        Environment,
        hostKernelLayerFromSeams(seams({ environment: { LUKE_TRACE_DIR: "/traces" } })),
      );

      assert.equal(yield* environment.load(Config.string("LUKE_TRACE_DIR")), "/traces");
      assert.deepEqual(
        yield* environment.load(Config.option(Config.string(ACCOUNT_BASE_URL_VARIABLE))),
        Option.none(),
      );
    }),
  );

  it.effect("read the account override out of that provider, and never in a packaged build", () =>
    Effect.gen(function* () {
      const override = "http://127.0.0.1:3000/api/auth";
      const development = yield* Effect.provide(
        HostKernelTag,
        hostKernelLayerFromSeams(seams({ environment: { [ACCOUNT_BASE_URL_VARIABLE]: override } })),
      );
      const packaged = yield* Effect.provide(
        HostKernelTag,
        hostKernelLayerFromSeams(
          seams({ packaged: true, environment: { [ACCOUNT_BASE_URL_VARIABLE]: override } }),
        ),
      );
      const none = yield* Effect.provide(HostKernelTag, hostKernelLayerFromSeams(seams()));

      assert.equal(development.accountBaseUrl, override);
      assert.equal(development.hostedServiceBaseUrl, "http://127.0.0.1:3000");
      assert.equal(packaged.accountBaseUrl, none.accountBaseUrl);
      assert.equal(packaged.hostedServiceBaseUrl, none.hostedServiceBaseUrl);
    }),
  );

  it.effect("route the runtime's own logger to the sink the reported line reaches", () =>
    Effect.gen(function* () {
      const reported: string[] = [];

      yield* Effect.provide(
        Effect.logInfo("through the logger"),
        reporterLayer((message) => reported.push(message)),
      );

      assert.deepEqual(reported, ["through the logger"]);
    }),
  );

  it.effect("hand the kernel the seams it was built over", () =>
    Effect.gen(function* () {
      const kernel = yield* Effect.provide(
        HostKernelTag,
        hostKernelLayerFromSeams(seams({ stateRoot: "/state" })),
      );

      assert.equal(kernel.stateRoot, "/state");
      assert.equal(kernel.createId(), "id");
      assert.equal(path.dirname(kernel.agentSkillsPath()), kernel.agentWorkspacePath());
    }),
  );

  it.effect(
    "the kernel's clock is Effect's own, a `TestClock` under this test rather than the seam's own reading",
    () =>
      Effect.gen(function* () {
        const kernel = yield* Effect.provide(HostKernelTag, hostKernelLayerFromSeams(seams()));

        assert.equal(kernel.now(), 0);
        yield* TestClock.adjust(Duration.millis(1_000));
        assert.equal(kernel.now(), 1_000);
      }),
  );
});

describe("the late service", () => {
  it.effect("suspends a read until it is supplied, and answers it after", () =>
    Effect.gen(function* () {
      const late = yield* lateService<number>();

      assert.deepEqual(yield* late.peek, Option.none());
      const waiting = yield* Effect.fork(late.value);
      yield* TestClock.adjust("1 minute");
      assert.deepEqual(yield* Fiber.poll(waiting), Option.none());

      assert.equal(yield* late.set(4), true);
      assert.equal(yield* Fiber.join(waiting), 4);
      assert.deepEqual(yield* late.peek, Option.some(4));
      assert.equal(yield* late.value, 4);
    }),
  );

  it.effect("takes the first value supplied and refuses a second", () =>
    Effect.gen(function* () {
      const late = yield* lateService<number>();

      assert.equal(yield* late.set(1), true);
      assert.equal(yield* late.set(2), false);
      assert.equal(yield* late.value, 1);
    }),
  );

  it.effect("is the one the kernel's sync faces read and write", () =>
    Effect.gen(function* () {
      const held = yield* Effect.provide(
        Effect.all({ kernel: HostKernelTag, late: HostService }),
        hostKernelLayerFromSeams(seams()),
      );
      const service = stubService();

      assert.throws(() => held.kernel.service(), { message: SERVICE_READ_BEFORE_MERGE });
      held.kernel.setService(service);
      assert.equal(held.kernel.service(), service);
      assert.equal(yield* held.late.value, service);
      assert.equal(yield* held.late.set(stubService()), false);
      assert.equal(held.kernel.service(), service);
    }),
  );
});
