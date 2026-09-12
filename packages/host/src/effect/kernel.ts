/**
 * The kernel as a `Layer` over the seam tags, and the late service as a
 * `Deferred`.
 *
 * What the merge composes late is read by awaiting it rather than by a getter
 * that throws: a caller that asks for the service before the merge has
 * composed it suspends until it stands, which is what a late reference was
 * always for. The write is a set-once — a second write answers `false` and the
 * first service stands — so which service a concern holds cannot depend on the
 * order the merge folded it in. The sync faces beside it are the shim the
 * unconverted composers read through, and they answer from the same `Deferred`.
 */
import { Config, Context, Deferred, Effect, Layer, Option } from "effect";
import {
  ACCOUNT_BASE_URL_VARIABLE,
  accountBaseUrlFor,
  type HostKernel,
  type HostSeams,
  hostKernelOver,
  SERVICE_READ_BEFORE_MERGE,
} from "../host-kernel.js";
import type { GatewayService } from "../service.js";
import {
  AppIdentity,
  Environment,
  HostSeamsObject,
  type HostSeamTags,
  hostSeamLayers,
  IdSource,
  Reporter,
  RunMode,
  StateRoot,
} from "./seams.js";

/** One value the composition supplies once and every reader awaits. */
export interface LateService<A> {
  /** Suspends until the value stands, then answers it. */
  readonly value: Effect.Effect<A>;
  /** Supplies the value, answering whether this call is the one that supplied it. */
  readonly set: (value: A) => Effect.Effect<boolean>;
  /** What stands now, for a reader that must not suspend. */
  readonly peek: Effect.Effect<Option.Option<A>>;
  /**
   * @deprecated The sync faces the unconverted callers hold; P12-05 deletes
   * them with `createHostKernel`.
   */
  readonly unsafeSet: (value: A) => boolean;
  /** @deprecated The sync read; P12-05 deletes it with `createHostKernel`. */
  readonly unsafePeek: () => Option.Option<A>;
}

export const lateService = <A>(): Effect.Effect<LateService<A>> =>
  Effect.map(Deferred.make<A>(), (deferred) => {
    let held: Option.Option<A> = Option.none();
    const unsafeSet = (value: A): boolean => {
      if (Option.isSome(held)) return false;
      held = Option.some(value);
      Deferred.unsafeDone(deferred, Effect.succeed(value));
      return true;
    };
    return {
      value: Deferred.await(deferred),
      set: (value) => Effect.sync(() => unsafeSet(value)),
      peek: Effect.sync(() => held),
      unsafeSet,
      unsafePeek: () => held,
    };
  });

/** The service the merge composes, awaited by every concern that reads it. */
export class HostService extends Context.Tag("@sidecar/host/HostService")<
  HostService,
  LateService<GatewayService>
>() {}

/** The seams as one value, for as long as the composers are handed one. */
export class HostKernelTag extends Context.Tag("@sidecar/host/HostKernel")<
  HostKernelTag,
  HostKernel
>() {}

/**
 * The account service override, read by the variable's own name out of the
 * environment seam. A packaged build is handed a provider that holds none, so
 * the packaging boundary is a fact about the provider as well as about the
 * derivation.
 */
const accountBaseUrlOverride: Effect.Effect<
  Option.Option<string>,
  never,
  Environment
> = Effect.flatMap(Environment, (environment) =>
  Effect.orDie(environment.load(Config.option(Config.string(ACCOUNT_BASE_URL_VARIABLE)))),
);

const hostServiceLayer = Layer.effect(HostService, lateService<GatewayService>());

const kernelLayer = Layer.effect(
  HostKernelTag,
  Effect.gen(function* () {
    const options = yield* HostSeamsObject;
    const stateRoot = yield* StateRoot;
    const runMode = yield* RunMode;
    const identity = yield* AppIdentity;
    const idSource = yield* IdSource;
    const reporter = yield* Reporter;
    const service = yield* HostService;
    const override = yield* accountBaseUrlOverride;
    const clock = yield* Effect.clock;

    return hostKernelOver({
      options,
      stateRoot,
      runMode,
      accountBaseUrl: accountBaseUrlFor({
        packaged: identity.packaged,
        override: Option.getOrUndefined(override),
      }),
      // Effect's own `Clock`: the real one at every edge, and a `TestClock`
      // under `it.effect`, so a test drives `kernel.now()` the same way it
      // drives every other Effect timer rather than through an injected
      // closure of its own.
      now: () => clock.unsafeCurrentTimeMillis(),
      createId: idSource.create,
      report: reporter.report,
      service: {
        read: () => {
          const standing = service.unsafePeek();
          if (Option.isNone(standing)) throw new Error(SERVICE_READ_BEFORE_MERGE);
          return standing.value;
        },
        set: (next) => {
          service.unsafeSet(next);
        },
      },
    });
  }),
);

/**
 * The kernel over the seams, with the late service beside it. Every seam is a
 * requirement, so a composition that did not state one cannot build.
 */
export const hostKernelLayer: Layer.Layer<HostKernelTag | HostService, never, HostSeamTags> =
  Layer.provideMerge(kernelLayer, hostServiceLayer);

/**
 * The kernel and every seam beneath it, from the one object the desktop builds
 * today.
 *
 * @deprecated The `Layer.succeed(oldObject)` shim; P12-05 deletes it with
 * `createHostKernel`.
 */
export const hostKernelLayerFromSeams = (
  options: HostSeams,
): Layer.Layer<HostKernelTag | HostService | HostSeamTags> =>
  Layer.provideMerge(hostKernelLayer, hostSeamLayers(options));
