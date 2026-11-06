import type { GatewayEventKind } from "@repo/gateway";
import type { WireValue } from "@repo/wire";
import { Clock, Config, Context, Deferred, Effect, Layer, Option } from "effect";
import {
  ACCOUNT_BASE_URL_VARIABLE,
  accountBaseUrlFor,
  type HostKernel,
  hostKernelOver,
} from "../host-kernel.js";
import type { GatewayService } from "../service.js";
import {
  AppIdentity,
  Environment,
  type HostSeamTags,
  IdSource,
  Reporter,
  RunMode,
  ServiceOrigin,
  StateRoot,
} from "./seams.js";

export interface LateService<A> {
  readonly value: Effect.Effect<A>;
  readonly set: (value: A) => Effect.Effect<boolean>;
  readonly peek: Effect.Effect<Option.Option<A>>;
}

export const lateService = <A>(): Effect.Effect<LateService<A>> =>
  Effect.map(Deferred.make<A>(), (deferred) => {
    let held: Option.Option<A> = Option.none();
    return {
      value: Deferred.await(deferred),
      set: (value) =>
        Effect.sync(() => {
          if (Option.isSome(held)) return false;
          held = Option.some(value);
          Deferred.doneUnsafe(deferred, Effect.succeed(value));
          return true;
        }),
      peek: Effect.sync(() => held),
    };
  });

const kernelEmit = Effect.fnUntraced(function* (
  service: LateService<GatewayService>,
): Effect.fn.Return<HostKernel["emit"]> {
  let standing: GatewayService | undefined;
  const pending: Array<{ readonly kind: GatewayEventKind; readonly payload: WireValue }> = [];

  yield* Effect.forkDetach(
    Effect.map(service.value, (resolved) => {
      standing = resolved;
      for (const queued of pending) resolved.emit(queued.kind, queued.payload);
      pending.length = 0;
    }),
  );

  return (kind, payload) => {
    if (standing) {
      standing.emit(kind, payload);
    } else {
      pending.push({ kind, payload });
    }
  };
});

export class HostService extends Context.Service<HostService, LateService<GatewayService>>()(
  "@repo/host/HostService",
) {}

export class HostKernelTag extends Context.Service<HostKernelTag, HostKernel>()(
  "@repo/host/HostKernel",
) {}

const accountBaseUrlOverride: Effect.Effect<
  Option.Option<string>,
  never,
  Environment
> = Effect.flatMap(Environment, (environment) =>
  Effect.orDie(Config.option(Config.String(ACCOUNT_BASE_URL_VARIABLE)).parse(environment)),
);

const hostServiceLayer = Layer.effect(HostService, lateService<GatewayService>());

const kernelLayer = Layer.effect(
  HostKernelTag,
  Effect.gen(function* () {
    const stateRoot = yield* StateRoot;
    const runMode = yield* RunMode;
    const identity = yield* AppIdentity;
    const idSource = yield* IdSource;
    const reporter = yield* Reporter;
    const service = yield* HostService;
    const override = yield* accountBaseUrlOverride;
    const serviceOrigin = yield* Effect.serviceOption(ServiceOrigin);
    const clock = yield* Clock.Clock;
    const emit = yield* kernelEmit(service);

    return hostKernelOver({
      stateRoot,
      runMode,
      accountBaseUrl: accountBaseUrlFor({
        packaged: identity.packaged,
        override: Option.getOrUndefined(override),
        serviceOrigin: Option.getOrUndefined(serviceOrigin),
      }),
      now: () => clock.currentTimeMillisUnsafe(),
      createId: idSource.create,
      report: reporter.report,
      emit,
    });
  }),
);

export const hostKernelLayer: Layer.Layer<HostKernelTag | HostService, never, HostSeamTags> =
  Layer.provideMerge(kernelLayer, hostServiceLayer);
