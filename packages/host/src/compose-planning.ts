import { isDeepStrictEqual } from "node:util";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  invalid,
} from "@sidecar/gateway";
import type { HostedPlanClient } from "@sidecar/hosted";
import { planCreateRequestSchema } from "@sidecar/hosted/plan-wire";
import {
  IDLE_PLANNING_VIEW,
  PLAN_CALL_FAILURE,
  PLANNING_READ,
  type PlanningDocument,
  type PlanningRepositoriesAnswer,
  type PlanningStartAnswer,
  type PlanningView,
} from "@sidecar/hosted/planning-view";
import { cadenceGate } from "@sidecar/runtime/effect";
import { unparsedWire } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Duration, Effect, Result, Schedule, Schema, type Scope, Semaphore } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import type { HostKernel } from "./host-kernel.js";
import type { RunMode } from "./run-mode.js";

/**
 * compose-planning.ts -- the planning window's named plans, read from the service: the list, the one active plan, and its saved document, followed while the window stands.
 *
 * Nothing here writes a document: the planning model's `update_plan` is the
 * one writer, on the service. What this concern owes the window is to show
 * that write soon after it lands, so while the window stands it reads the
 * plan list on a short cadence and reads the active plan again whenever the
 * list says its document was saved since the copy held. The list read is a
 * read and nothing else; opening a plan moves it to the head of the list, so
 * the document is read only when it moved.
 */

/**
 * How often the list is read while the planning window stands. A save the
 * model makes mid-conversation is drawn within one of these; the window is
 * open only while someone is planning, so the cadence costs nothing the rest
 * of the time.
 */
const PLANNING_POLL_INTERVAL_MS = 3_000;

/** Opening a plan names it and nothing else. */
const planningOpenParamsSchema = Schema.Struct({ planId: Schema.NonEmptyString });

/** The service's side of the plans, as this concern asks it. */
export type PlanningClient = Pick<HostedPlanClient, "list" | "open" | "create" | "repositories">;

export interface PlanningDependencies {
  kernel: Pick<HostKernel, "emit"> & { runMode: Pick<RunMode, "sendsNetwork"> };
  account: Pick<AccountComposer, "capabilitiesActive">;
  client: PlanningClient;
  /**
   * Ends the planning call standing about any plan but `keep`, and waits for
   * it to end; a desk session and the call about `keep` are left standing.
   */
  endPlanCall: (keep: string | undefined) => Effect.Effect<void>;
  /** A test's cadence in place of the production one. */
  pollIntervalMs?: number;
}

export interface PlanningComposer extends Composer {
  /** The view as this Mac holds it now. */
  snapshot: () => PlanningView;
  /** The one active plan, which a voice session binds to; nothing while the window has none open. */
  activePlanId: () => string | undefined;
  /** Drops everything held, for a sign-out, and tells every client the window has nothing. */
  reset: Effect.Effect<void>;
}

/**
 * The planning window's plans as one concern. The view is told to every
 * client whole whenever it moves, and exactly one plan is active at a time:
 * opening or starting one replaces whichever was, and a read still out for
 * the replaced plan is dropped when it lands. Only one plan is ever the
 * spoken conversation, so opening another plan, starting one, closing the
 * window, or a sign-out ends the call about the plan that was open before
 * anything else moves. Behind a closed account gate, or on a run that sends
 * nothing, nothing is read and nothing is followed.
 */
export const composePlanning = /* @__PURE__ */ Effect.fn("host/composePlanning")(function* (
  dependencies: PlanningDependencies,
): Effect.fn.Return<PlanningComposer, never, Scope.Scope> {
  const { kernel, account, client, endPlanCall } = dependencies;
  const intervalMs = dependencies.pollIntervalMs ?? PLANNING_POLL_INTERVAL_MS;
  const gate = () => kernel.runMode.sendsNetwork && account.capabilitiesActive();

  /**
   * One read of the service at a time, beats and asks alike. Note that the
   * answers are applied in the order the reads were made, because a list
   * that left before a plan started, or a document read that left before a
   * newer one, would otherwise land last and roll the view back.
   */
  const serial = (yield* Semaphore.make(1)).withPermits(1);

  let view: PlanningView = IDLE_PLANNING_VIEW;
  let published: PlanningView = view;

  function publish(): void {
    if (isDeepStrictEqual(view, published)) return;
    published = view;
    kernel.emit(GATEWAY_EVENT.PLANNING_CHANGED, carried(view));
  }

  function write(next: Partial<PlanningView>): void {
    view = { ...view, ...next };
    publish();
  }

  /** The document of `planId` as held now, if the held one is that plan's. */
  function heldPlanOf(planId: string): PlanningDocument["plan"] {
    const held = view.document.plan;
    return held?.id === planId ? held : undefined;
  }

  const readList = Effect.gen(function* () {
    const listed = yield* Effect.provide(client.list(), FetchHttpClient.layer);
    // A failed read keeps the list it last read: the window says the read
    // failed beside the plans it already drew rather than emptying them.
    write(
      listed.ok
        ? { plans: listed.answer, listStatus: PLANNING_READ.READY }
        : { listStatus: PLANNING_READ.FAILED },
    );
  });

  /**
   * Reads the active plan's document. A copy of the same plan already held
   * stays drawn while the read is out, and stays drawn through a read that
   * failed, so a save redraws in place and a moment offline blanks nothing;
   * with no copy held, the failure is what the window draws.
   */
  function readDocument(planId: string) {
    return Effect.gen(function* () {
      const held = heldPlanOf(planId);
      if (held === undefined) write({ document: { status: PLANNING_READ.READING } });
      const opened = yield* Effect.provide(client.open(planId), FetchHttpClient.layer);
      // Another plan opened while this read was out: its answer is not this window's any more.
      if (view.activePlanId !== planId) return;
      if (opened.ok) {
        write({ document: { status: PLANNING_READ.READY, plan: opened.answer } });
        return;
      }
      if (opened.failure === PLAN_CALL_FAILURE.NOT_FOUND) {
        write({ document: { status: PLANNING_READ.MISSING } });
        return;
      }
      write({
        document:
          held === undefined
            ? { status: PLANNING_READ.FAILED }
            : { status: PLANNING_READ.READY, plan: held },
      });
    });
  }

  /**
   * One beat of the cadence: the list read, and the active document read
   * again only where the list says it was saved since the copy held. A plan
   * a landed list no longer names was deleted, which the window draws as
   * missing rather than as the last copy it read.
   */
  const follow = serial(
    Effect.gen(function* () {
      if (!gate()) return;
      yield* readList;
      const planId = view.activePlanId;
      if (planId === undefined || view.listStatus !== PLANNING_READ.READY) return;
      const listed = view.plans.find((plan) => plan.id === planId);
      if (listed === undefined) {
        write({ document: { status: PLANNING_READ.MISSING } });
        return;
      }
      if (heldPlanOf(planId)?.updatedAt !== listed.updatedAt) yield* readDocument(planId);
    }),
  );

  // The cadence stands while a window does: armed by the window's refresh,
  // disarmed by its close and by a sign-out. `Effect.schedule` rather than a
  // repeat, since the refresh that arms it has just read everything itself.
  const cadence = yield* cadenceGate(
    Effect.asVoid(
      Effect.forkScoped(Effect.schedule(follow, Schedule.spaced(Duration.millis(intervalMs)))),
    ),
  );

  const methods: GatewayMethodTable = {
    [GATEWAY_METHOD.PLANNING_REFRESH]: () =>
      Effect.gen(function* () {
        if (!gate()) return {};
        yield* cadence.arm;
        yield* serial(
          Effect.gen(function* () {
            yield* readList;
            const planId = view.activePlanId;
            if (planId !== undefined) yield* readDocument(planId);
          }),
        );
        return {};
      }),
    [GATEWAY_METHOD.PLANNING_OPEN]: (params) =>
      Effect.gen(function* () {
        const read = readEither(planningOpenParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) return yield* invalid("opening a plan names one plan");
        if (!gate()) return { opened: false };
        const { planId } = read.success;
        yield* endPlanCall(planId);
        yield* serial(
          Effect.gen(function* () {
            if (view.activePlanId !== planId) {
              write({ activePlanId: planId, document: { status: PLANNING_READ.READING } });
            }
            yield* readDocument(planId);
            // Opening moved the plan to the head of the list.
            yield* readList;
          }),
        );
        return { opened: true };
      }),
    [GATEWAY_METHOD.PLANNING_CLOSE]: () =>
      Effect.gen(function* () {
        yield* endPlanCall(undefined);
        yield* cadence.disarm;
        yield* serial(
          Effect.sync(() => {
            const { activePlanId: _closed, ...rest } = view;
            view = { ...rest, document: { status: PLANNING_READ.IDLE } };
            publish();
          }),
        );
        return {};
      }),
    [GATEWAY_METHOD.PLANNING_START]: (params) =>
      Effect.gen(function* () {
        const read = readEither(planCreateRequestSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("starting a plan names it and its repository");
        }
        if (!gate()) return carried<PlanningStartAnswer>({ failure: PLAN_CALL_FAILURE.UNANSWERED });
        const request = read.success;
        return yield* serial(
          Effect.gen(function* () {
            const started = yield* Effect.provide(client.create(request), FetchHttpClient.layer);
            if (!started.ok) return carried<PlanningStartAnswer>({ failure: started.failure });
            const plan = started.answer;
            yield* endPlanCall(plan.id);
            write({ activePlanId: plan.id, document: { status: PLANNING_READ.READY, plan } });
            yield* readList;
            return carried<PlanningStartAnswer>({ planId: plan.id });
          }),
        );
      }),
    [GATEWAY_METHOD.PLANNING_REPOSITORIES]: () =>
      Effect.gen(function* () {
        if (!gate()) {
          return carried<PlanningRepositoriesAnswer>({ failure: PLAN_CALL_FAILURE.UNANSWERED });
        }
        const listed = yield* Effect.provide(client.repositories(), FetchHttpClient.layer);
        return carried<PlanningRepositoriesAnswer>(
          listed.ok ? listed.answer : { failure: listed.failure },
        );
      }),
  };

  return {
    methods,
    snapshot: () => view,
    activePlanId: () => view.activePlanId,
    reset: Effect.gen(function* () {
      yield* endPlanCall(undefined);
      yield* cadence.disarm;
      yield* serial(
        Effect.sync(() => {
          view = IDLE_PLANNING_VIEW;
          publish();
        }),
      );
    }),
    // The cadence is the gate's, and the gate's own finalizer disarms it when
    // the scope this concern was built in closes.
    lifetime: Effect.void,
  };
});
