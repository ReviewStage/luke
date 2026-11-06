import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { PRODUCT_PLATFORM } from "@repo/features/analytics";
import { noNetwork } from "@repo/wire/testing";
import { ConfigProvider, Layer } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { hostKernelLayer } from "../effect/kernel.js";
import {
  AppIdentity,
  Environment,
  IdSource,
  RunMode,
  reporterLayer,
  ShutdownSignal,
  StateRoot,
} from "../effect/seams.js";
import { runModeFor } from "../run-mode.js";

/**
 * host-machine.ts -- every seam a host stands on whatever it was built with, the kernel over them, for a test that assembles the host.
 *
 * The account source is each test's own, so none of the desktop's source's
 * seams are here. A fixture run sends nothing and reaches no network; a run
 * that sends asks the service a test answers.
 */
export function machineOver(
  stateRoot: string,
  options: {
    /** Where the run sends, the service a test answers it from; a fixture run, which sends nothing, where none is given. */
    readonly service?: Layer.Layer<HttpClient.HttpClient>;
  } = {},
) {
  return Layer.provideMerge(
    hostKernelLayer,
    Layer.mergeAll(
      Layer.succeed(StateRoot, stateRoot),
      Layer.succeed(
        RunMode,
        runModeFor({ capture: false, fixture: options.service === undefined }),
      ),
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
      options.service ?? noNetwork,
    ),
  );
}
