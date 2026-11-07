/**
 * automation-run-consumer.ts -- the automation-runs queue's consumer: a firing delivered, recorded once under its dedupe key, and its run started.
 *
 * Two kinds of message come on `AUTOMATION_RUNS.TOPIC`: a schedule's, which
 * Vercel Schedules publishes each time an automation's cron is due
 * (`automation-cadence.ts` keeps the schedule), and a firing a webhook's
 * call, a GitHub delivery, or an integration's event published. A
 * schedule's is read as a firing of the automation it names, keyed by the
 * occurrence's `executionId`, which every delivery of it carries. Every
 * firing is recorded under its dedupe key, so a delivery sent again finds
 * it recorded, and a run still queued is acted on (`automation-runs.ts`).
 * A handler that throws leaves the delivery unacknowledged, and the queue
 * delivers it again.
 *
 * The queue's SDK awaits a promise handler, so the consumer's effect is run
 * here, on the services the function's runtime handed over, never on a
 * runtime of this file's own: this is the consumer's one promise door,
 * listed as a permanent adaptor in `tools/anti-slop/effect-edges.json` and
 * root AGENTS.md; what would end it is an Effect consumer in the queue's SDK.
 */

import {
  advanceAutomationSchedule,
  automationRunToAct,
} from "@repo/database/models/automation-store";
import { nextScheduledRun } from "@repo/features/automation-schedule";
import {
  AUTOMATION_FIRING,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_TRIGGER,
} from "@repo/features/automation-wire";
import { failureKind } from "@repo/runtime/effect";
import { handleCallback } from "@vercel/queue";
import { Cause, Clock, type Context, Effect, Exit, Option, Schema } from "effect";
import { routedSessions } from "../agents/coder-host/runtime-sessions.js";
import type { StartServices } from "../agents/coder-host/start.js";
import {
  type AutomationFiringMessage,
  automationFiringMessageSchema,
  recordFiring,
} from "./automation-cadence.js";
import { actOnAutomationRun, type SessionsForAccount } from "./automation-runs.js";

/** A schedule's message as Vercel Schedules publishes it: the occurrence, and the schedule by its automation's id. */
const scheduleMessageSchema = Schema.Struct({
  executionId: Schema.String,
  name: Schema.String,
  scheduledAt: Schema.String,
});

type ScheduleMessage = typeof scheduleMessageSchema.Type;

const decodeDelivered = Schema.decodeUnknownEffect(
  Schema.Union([automationFiringMessageSchema, scheduleMessageSchema]),
);

/** The schedule's occurrence as a firing of the automation it names. */
function scheduledFiring(message: ScheduleMessage, now: number): AutomationFiringMessage {
  return {
    automationId: message.name,
    dedupeKey: message.executionId,
    firing: { kind: AUTOMATION_FIRING.SCHEDULE, dueAt: Date.parse(message.scheduledAt) },
    firedAt: now,
  };
}

/**
 * One delivery acted on: the firing it carries recorded under its dedupe
 * key, a schedule's next instant written for the list to show, and the run
 * started where it is still queued; nothing for an automation gone.
 */
export const consumeAutomationRunMessage = /* @__PURE__ */ Effect.fn(
  "web/consumeAutomationRunMessage",
)(function* (
  sessionsFor: SessionsForAccount,
  message: unknown,
): Effect.fn.Return<void, unknown, StartServices> {
  const now = yield* Clock.currentTimeMillis;
  const delivered = yield* Effect.option(decodeDelivered(message));
  if (Option.isNone(delivered)) {
    return yield* Effect.logError("an automation-runs message did not decode; it is dropped");
  }
  const firing =
    "executionId" in delivered.value ? scheduledFiring(delivered.value, now) : delivered.value;
  const automation = yield* recordFiring(firing);
  if (Option.isNone(automation)) return;
  const { trigger } = automation.value;
  if (
    firing.firing.kind === AUTOMATION_FIRING.SCHEDULE &&
    trigger.kind === AUTOMATION_TRIGGER.SCHEDULE
  ) {
    yield* advanceAutomationSchedule(
      firing.automationId,
      nextScheduledRun(trigger, new Date(now)) ?? null,
    );
  }
  const run = yield* automationRunToAct(firing.automationId, firing.dedupeKey);
  if (Option.isSome(run) && run.value.status === AUTOMATION_RUN_STATUS.QUEUED) {
    yield* actOnAutomationRun(sessionsFor, run.value);
  }
});

/**
 * The consumer's route handler over the services the function's runtime
 * handed it: each delivery's effect run there, a failure logged and thrown
 * so the queue's SDK leaves the delivery unacknowledged.
 */
export function automationRunsHandler(
  services: Context.Context<StartServices>,
): (request: Request) => Promise<Response> {
  return handleCallback(async (message) => {
    const consumed = consumeAutomationRunMessage(routedSessions, message).pipe(
      Effect.tapCause((cause) =>
        Effect.logWarning(`an automation run's delivery will come again: ${failureKind(cause)}`),
      ),
    );
    const exit = await Effect.runPromiseExitWith(services)(consumed);
    if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
  });
}
