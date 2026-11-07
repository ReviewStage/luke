import type { DatabaseServices } from "@repo/database/core/query";
import {
  type Automation,
  readAutomationToRun,
  recordAutomationRun,
  type ScheduledAutomation,
} from "@repo/database/models/automation-store";
import type { TaskStoreFailure } from "@repo/database/models/task-store";
import { AUTOMATION_TRIGGER, automationFiringSchema } from "@repo/features/automation-wire";
import { send } from "@vercel/queue";
import { type Schedule, Schedules, SchedulesApiError } from "@vercel/schedules";
import { Config, ConfigProvider, Context, Data, Effect, Layer, Option, Schema } from "effect";
import { AUTH_DEPLOYMENT_ENVIRONMENT, DEPLOYMENT_ENVIRONMENT } from "../auth/auth-deployment.js";
import { HOSTED_REFUSAL, type HostedRefusal } from "../http/http-effect.js";
import { logStoreFailure } from "../http/store-failure.js";
import { AUTOMATION_RUNS } from "./automation-run-bounds.js";

/**
 * automation-cadence.ts -- where an automation's firings come from and where they go: its schedule kept in Vercel Schedules, and every firing published to the one queue topic whose consumer records and starts its run.
 *
 * A scheduled automation is one Vercel schedule, named by the automation's
 * id in a namespace of its workspace's id, its cron and IANA zone the
 * trigger's own, since a trigger is five-field cron read in a named zone
 * already (`@repo/features/automation-schedule`). Saving an automation
 * keeps its schedule as the automation then stands: made where it is
 * missing, its cron and zone written where it stands, enabled or disabled
 * as the automation is, and deleted once the automation is gone or fires
 * on something else. The schedule publishes to `AUTOMATION_RUNS.TOPIC`, and
 * a webhook's call, a GitHub delivery, and an integration's event publish
 * their firings there too, so every firing is recorded and started by the
 * one consumer (`automation-run-consumer.ts`) and retried by the queue
 * until it is.
 *
 * Note that this is production's alone. Vercel keeps a Preview's dynamic
 * schedules apart from production's, but a Preview's database is a branch
 * of production's, its automations among it, so a Preview that kept their
 * schedules would start production's automations a second time from a
 * copy. Off production the cadence keeps no schedule and publishes
 * nothing: a firing is recorded queued and nothing starts it, as a Preview
 * behaved when the minute sweep ran on production alone.
 */

/** A firing published for its run: the automation, the firing's dedupe key, what fired it and when, and the body a webhook or an integration hands its agent. */
export const automationFiringMessageSchema = Schema.Struct({
  automationId: Schema.String,
  dedupeKey: Schema.String,
  firing: automationFiringSchema,
  /** When it fired, in epoch milliseconds. */
  firedAt: Schema.Number,
  payload: Schema.optionalKey(Schema.String),
});

export type AutomationFiringMessage = typeof automationFiringMessageSchema.Type;

/** What the cadence was asked to do when Vercel did not take it. */
const CADENCE_OPERATION = {
  KEEP: "keep",
  FORGET: "forget",
  PUBLISH: "publish",
} as const;

type CadenceOperation = (typeof CADENCE_OPERATION)[keyof typeof CADENCE_OPERATION];

/** Vercel Schedules or Queues refused or could not be reached; the code is the API's own where it named one. */
export class AutomationCadenceUnavailable extends Data.TaggedError("AutomationCadenceUnavailable")<{
  readonly operation: CadenceOperation;
  readonly code: string | undefined;
}> {}

/**
 * The effect with a refusal of Vercel's, or a store it could not read,
 * logged by its kind and refused as unavailable, an outage the caller may
 * send again.
 */
export function cadenceOrUnavailable<A, R>(
  effect: Effect.Effect<A, AutomationCadenceUnavailable | TaskStoreFailure, R>,
): Effect.Effect<A, HostedRefusal, R> {
  return effect.pipe(
    Effect.tapError((failure) =>
      failure instanceof AutomationCadenceUnavailable
        ? Effect.logWarning(
            `Vercel did not take an automation's ${failure.operation}: ${failure.code ?? "unreachable"}`,
          )
        : logStoreFailure(failure),
    ),
    Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE),
  );
}

/** An automation as its schedule is kept for it. */
type CadencedAutomation = Pick<
  ScheduledAutomation,
  "id" | "organizationId" | "enabled" | "trigger"
>;

export interface AutomationCadenceShape {
  /** The automation's schedule kept as the automation stands: made, written, enabled or disabled, or deleted where it fires on no schedule. */
  readonly keep: (
    automation: CadencedAutomation,
  ) => Effect.Effect<void, AutomationCadenceUnavailable>;
  /** The automation's schedule deleted, once the automation is; none standing is no failure. */
  readonly forget: (
    automation: Pick<CadencedAutomation, "id" | "organizationId">,
  ) => Effect.Effect<void, AutomationCadenceUnavailable>;
  /** The firing handed on to be recorded and started. */
  readonly publish: (
    firing: AutomationFiringMessage,
  ) => Effect.Effect<void, AutomationCadenceUnavailable | TaskStoreFailure, DatabaseServices>;
}

/**
 * The firing recorded queued for its automation, answering the automation;
 * nothing where the automation is gone. Note that a firing recorded before
 * under its dedupe key records nothing again and still answers the
 * automation, because a delivery sent again acts on the run the first made.
 */
export const recordFiring = Effect.fnUntraced(function* (firing: AutomationFiringMessage) {
  const automation = yield* readAutomationToRun(firing.automationId);
  if (Option.isNone(automation)) return Option.none<Automation>();
  yield* recordAutomationRun(automation.value, {
    dedupeKey: firing.dedupeKey,
    firing: firing.firing,
    firedAt: new Date(firing.firedAt),
    ...(firing.payload === undefined ? undefined : { payload: firing.payload }),
  });
  return automation;
});

/** Off production: no schedule kept, and a firing recorded queued for nothing to start. */
const RECORDED_ONLY: AutomationCadenceShape = {
  keep: () => Effect.void,
  forget: () => Effect.void,
  publish: (firing) => Effect.asVoid(recordFiring(firing)),
};

/** The API's code for a failure, where it was one of the API's own. */
function codeOf(failure: unknown): string | undefined {
  return failure instanceof SchedulesApiError ? failure.code : undefined;
}

/** One call to Vercel, its failure carried with the API's code. */
function vercelCall<A>(
  operation: CadenceOperation,
  call: () => Promise<A>,
): Effect.Effect<A, AutomationCadenceUnavailable> {
  return Effect.tryPromise({
    try: call,
    catch: (failure) => new AutomationCadenceUnavailable({ operation, code: codeOf(failure) }),
  });
}

const NOT_FOUND = "not_found";

/** The schedule deleted; one already gone is what was asked. */
const forgetSchedule = (automation: Pick<CadencedAutomation, "id" | "organizationId">) =>
  vercelCall(CADENCE_OPERATION.FORGET, () =>
    Schedules.delete({ name: automation.id, namespace: automation.organizationId }),
  ).pipe(
    Effect.catchIf(
      (failure) => failure.code === NOT_FOUND,
      () => Effect.void,
    ),
  );

/**
 * The schedule written as the automation stands, made where none stands,
 * then switched on or off to match it. Note that it is written before it
 * is made, because every save after the first finds it standing.
 */
const keepSchedule = Effect.fnUntraced(function* (automation: CadencedAutomation) {
  const { trigger } = automation;
  if (trigger.kind !== AUTOMATION_TRIGGER.SCHEDULE) return yield* forgetSchedule(automation);
  const identity = { name: automation.id, namespace: automation.organizationId };
  const cadence = {
    expression: { type: "cron", cron: trigger.cron },
    timezone: trigger.timezone,
    target: { topic: AUTOMATION_RUNS.TOPIC },
  } as const;
  const kept: Schedule = yield* vercelCall(CADENCE_OPERATION.KEEP, () =>
    Schedules.update({ ...identity, ...cadence }),
  ).pipe(
    Effect.catchIf(
      (failure) => failure.code === NOT_FOUND,
      () => vercelCall(CADENCE_OPERATION.KEEP, () => Schedules.create({ ...identity, ...cadence })),
    ),
  );
  const active = kept.state === "active";
  if (automation.enabled && !active) {
    yield* vercelCall(CADENCE_OPERATION.KEEP, () => Schedules.enable(identity));
  }
  if (!automation.enabled && active) {
    yield* vercelCall(CADENCE_OPERATION.KEEP, () => Schedules.disable(identity));
  }
});

/** On production: schedules kept in Vercel Schedules under the deployment's own token, and firings sent to the topic. */
const VERCEL_CADENCE: AutomationCadenceShape = {
  keep: keepSchedule,
  forget: forgetSchedule,
  publish: (firing) =>
    Effect.asVoid(vercelCall(CADENCE_OPERATION.PUBLISH, () => send(AUTOMATION_RUNS.TOPIC, firing))),
};

/** The cadence one runtime has: Vercel's where the runtime provides it, a queued record and nothing more otherwise. */
export const AutomationCadence = Context.Reference<AutomationCadenceShape>(
  "@repo/service/AutomationCadence",
  { defaultValue: () => RECORDED_ONLY },
);

/** The cadence as the deployment's environment names it: Vercel's on production, and the default anywhere else. */
export const automationCadenceFromEnvironment = Layer.effect(
  AutomationCadence,
  Effect.map(Config.option(Config.String(AUTH_DEPLOYMENT_ENVIRONMENT.ENVIRONMENT)), (deployment) =>
    Option.contains(deployment, DEPLOYMENT_ENVIRONMENT.PRODUCTION) ? VERCEL_CADENCE : RECORDED_ONLY,
  ).pipe(
    Effect.provideServiceEffect(
      ConfigProvider.ConfigProvider,
      Effect.sync(() => ConfigProvider.fromEnv()),
    ),
  ),
);
