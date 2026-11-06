import { NodeFileSystem } from "@effect/platform-node";
import type { AccountSnapshot } from "@repo/credentials/snapshot";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import { type RecordedRequest, recordingHttpClient } from "@repo/wire/testing";
import { Context, Effect, Layer, type Scope } from "effect";
import { declaredActProcedures } from "../act-port/declared-acts.js";
import { type TestActPort, testActPort } from "../act-port/testing.js";
import { hostAssemblyLayer } from "../compose-host.js";
import { HOST_ACTS } from "../contract/index.js";
import { HostAssemblyTag, hostStandingLayer } from "../effect/host.js";
import { fixedAccountSource } from "./fixed-account-source.js";
import { machineOver } from "./host-machine.js";

/**
 * host-act-port.ts -- a window's act port served over the whole host standing: every declared act answered by its own composer, over a service the test answers.
 *
 * Nothing between the port and the composer is faked: the port reads the
 * input, the composer asks the service through the host's own client, and
 * the window hears what the port answers. The service is the one fake, a
 * route table over the requests the host sends, each kept in the order sent.
 */

/** The service no route of a test's answers: unavailable, so a read the host opens on its own asks nothing a test reads. */
const UNAVAILABLE = 503;

export interface HostActPort {
  /** The window's port, every declared act served over the standing host. */
  readonly port: TestActPort<unknown>;
  /** Every request the host sent the service, in order. */
  readonly requests: readonly RecordedRequest[];
}

/**
 * The host stood up over a state root of the test's own, signed in to
 * `account` where one is given, its service answered by `respond`, and a
 * window's act port served over it. The host and the port close with the
 * scope.
 */
export const hostActPort = /* @__PURE__ */ Effect.fn("testing/hostActPort")(function* (
  options: {
    readonly account?: AccountSnapshot;
    readonly respond?: (request: RecordedRequest) => Response | Promise<Response>;
  } = {},
): Effect.fn.Return<HostActPort, never, Scope.Scope> {
  const stateRoot = yield* Effect.orDie(
    Effect.provide(temporaryDirectoryScoped("host-act-port-"), NodeFileSystem.layer),
  );
  const service = recordingHttpClient(
    options.respond ?? (() => new Response(null, { status: UNAVAILABLE })),
  );
  const standing = hostStandingLayer.pipe(
    Layer.provideMerge(hostAssemblyLayer([])),
    Layer.provide(
      Layer.merge(
        machineOver(stateRoot, { service: service.layer }),
        fixedAccountSource(options.account === undefined ? {} : { account: options.account }),
      ),
    ),
  );
  const host = yield* Effect.orDie(Layer.build(standing));
  const port = testActPort(
    declaredActProcedures(HOST_ACTS, Context.get(host, HostAssemblyTag).acts),
  );
  yield* Effect.addFinalizer(() => Effect.sync(() => port.close()));
  return { port, requests: service.requests };
});
