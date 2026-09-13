/**
 * The kernel as a `Layer` over the seam tags, and the late service as a
 * `Deferred`.
 *
 * What the merge composes late is read by awaiting it rather than by a getter
 * that throws: a caller that asks for the service before the merge has
 * composed it suspends until it stands, which is what a late reference was
 * always for. The write is a set-once — a second write answers `false` and the
 * first service stands — so which service a concern holds cannot depend on the
 * order the merge folded it in.
 */
import type { GatewayEventKind } from "@sidecar/gateway";
import type { WireValue } from "@sidecar/wire";
import { Config, Context, Deferred, Effect, Layer, Option } from "effect";
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
          Deferred.unsafeDone(deferred, Effect.succeed(value));
          return true;
        }),
      peek: Effect.sync(() => held),
    };
  });

/**
 * The event door, built once over the late service rather than read from it:
 * a socket's phase change, a store's subscription callback, publishes from a
 * synchronous statement with no fiber to suspend on, so this is the one
 * synchronous face left standing over the `Deferred` above. A call that
 * lands before the merge composed the service is held rather than thrown —
 * several composers wire callbacks of exactly that shape before
 * `compose-host.ts` supplies the service — and reaches it the moment the
 * fork below resumes; every call after the service stands reaches it
 * directly. The fork itself and the closure it returns never run an Effect
 * from outside an edge, so this needs no entry on the run allowlist:
 * the queue is plain state a synchronous callback reads and writes, held for
 * the kernel's own life rather than a scope's.
 *
 * The fork is marked interruptible on top of being a daemon: `kernelLayer`
 * builds inside `Layer.build`'s own `uninterruptibleMask`, and a fork made
 * from an uninterruptible region inherits that status forever, which no
 * `Fiber.interrupt` could then end. It is deliberately not tied to this
 * kernel's own scope — `Layer.effect` has none of its own — because the
 * `Deferred` it awaits settles at most once, ever: once the merge sets the
 * service, this fork drains what queued ahead of it and finishes on its
 * own. A build that never reaches the merge leaves it suspended holding
 * the queue, which is bounded because the kernel is built exactly once per
 * process life; the one runtime edge disposing is what ends it then.
 */
const kernelEmit = (service: LateService<GatewayService>): Effect.Effect<HostKernel["emit"]> =>
  Effect.gen(function* () {
    let standing: GatewayService | undefined;
    const pending: Array<{ readonly kind: GatewayEventKind; readonly payload: WireValue }> = [];

    yield* Effect.forkDaemon(
      Effect.interruptible(
        Effect.map(service.value, (resolved) => {
          standing = resolved;
          for (const queued of pending) resolved.emit(queued.kind, queued.payload);
          pending.length = 0;
        }),
      ),
    );

    return (kind, payload) => {
      if (standing) {
        standing.emit(kind, payload);
      } else {
        pending.push({ kind, payload });
      }
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
    const stateRoot = yield* StateRoot;
    const runMode = yield* RunMode;
    const identity = yield* AppIdentity;
    const idSource = yield* IdSource;
    const reporter = yield* Reporter;
    const service = yield* HostService;
    const override = yield* accountBaseUrlOverride;
    const clock = yield* Effect.clock;
    const emit = yield* kernelEmit(service);

    return hostKernelOver({
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
      emit,
    });
  }),
);

/**
 * The kernel over the seams, with the late service beside it. Every seam is a
 * requirement, so a composition that did not state one cannot build.
 */
export const hostKernelLayer: Layer.Layer<HostKernelTag | HostService, never, HostSeamTags> =
  Layer.provideMerge(kernelLayer, hostServiceLayer);
