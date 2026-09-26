import { type PlanDocument, planDocumentSchema } from "@sidecar/hosted";
import type { UnparsedWireValue } from "@sidecar/wire";
import { describeWire, readEither } from "@sidecar/wire/effect";
import { Effect, Option, Result, Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import { savePlanDocument } from "./plan-store.js";
import { logStoreFailure } from "./store-failure.js";

/**
 * update-plan-tool.ts -- the planning model's one write: replace the open plan's document and read back what was saved.
 *
 * Note that the call's arguments are the document and nothing else. Which
 * account and which plan it writes are the binding the service built from
 * the authenticated session and the plan it opened, never a field the model
 * supplies, and an argument naming either is refused with the rest of a
 * malformed call, so a model cannot steer a save at another account or
 * another plan. The save is `savePlanDocument`'s single update over the row
 * that stands, so a plan deleted meanwhile answers as gone and is not
 * written back into being, and a save that fails answers as not saved with
 * the prior document standing. Every outcome is a result the model reads,
 * never a failure of the call: an unsaved change is the model's to say aloud
 * and try again (`docs/PLANNING.md`, "Failures the developer sees").
 */

/** The account and plan a planning conversation writes, fixed by the service before the model runs. */
export interface PlanToolBinding {
  readonly userId: string;
  readonly planId: string;
}

export const UPDATE_PLAN_STATUS = {
  SAVED: "saved",
  NOT_SAVED: "not-saved",
} as const;

/** Why a call saved nothing, in words the model can act on. */
export const UPDATE_PLAN_REFUSAL = {
  UNREADABLE:
    "Not saved: the arguments must be exactly `body` (Markdown) and `assumptions` " +
    "(each `text` and `confirmed`), within their bounds. The saved document is unchanged.",
  NO_PLAN: "Not saved: this plan no longer exists, so there is nothing to update.",
  UNAVAILABLE:
    "Not saved: the service could not reach its store. The saved document is unchanged; " +
    "the call may be made again.",
} as const;

export type UpdatePlanResult =
  | {
      readonly status: typeof UPDATE_PLAN_STATUS.SAVED;
      /** The document exactly as it now stands saved. */
      readonly document: PlanDocument;
      /** Epoch milliseconds of the save. */
      readonly savedAt: number;
    }
  | {
      readonly status: typeof UPDATE_PLAN_STATUS.NOT_SAVED;
      readonly reason: string;
      /** Where a malformed call went wrong, as the dotted path of the field refused. */
      readonly field?: string;
    };

const UPDATE_PLAN_INPUT = Schema.Struct({
  body: describeWire(
    planDocumentSchema.fields.body,
    "The plan's complete Markdown body. It replaces the saved body whole.",
  ),
  assumptions: describeWire(
    planDocumentSchema.fields.assumptions,
    "Every assumption the plan holds, in order, each its text and whether the developer " +
      "confirmed it. It replaces the saved list whole.",
  ),
});

const readInput = readEither(UPDATE_PLAN_INPUT);

/** The tool as a planning model is offered it: its name, its words, and its input schema. */
export const UPDATE_PLAN_TOOL = {
  name: "update_plan",
  description:
    "Save the plan's document: the complete Markdown body and the complete assumptions list. " +
    "Each call replaces the whole saved document, so send everything that should stand, " +
    "including what did not change. Answers the document as saved, or why nothing was saved.",
  inputSchema: UPDATE_PLAN_INPUT,
} as const;

/** One call of `update_plan` under the plan the service bound, answered as the result the model reads. */
export function runUpdatePlan(
  binding: PlanToolBinding,
  input: UnparsedWireValue,
): Effect.Effect<UpdatePlanResult, never, SqlClient.SqlClient> {
  return Effect.suspend(() => {
    const document = readInput(input);
    if (Result.isFailure(document)) {
      const field = document.failure.path.join(".");
      return Effect.succeed<UpdatePlanResult>({
        status: UPDATE_PLAN_STATUS.NOT_SAVED,
        reason: UPDATE_PLAN_REFUSAL.UNREADABLE,
        ...(field ? { field } : undefined),
      });
    }
    return savePlanDocument(binding.userId, binding.planId, document.success).pipe(
      Effect.map(
        Option.match({
          onNone: (): UpdatePlanResult => ({
            status: UPDATE_PLAN_STATUS.NOT_SAVED,
            reason: UPDATE_PLAN_REFUSAL.NO_PLAN,
          }),
          onSome: (saved): UpdatePlanResult => ({
            status: UPDATE_PLAN_STATUS.SAVED,
            document: saved.document,
            savedAt: saved.updatedAt,
          }),
        }),
      ),
      Effect.tapError(logStoreFailure),
      Effect.catch(() =>
        Effect.succeed<UpdatePlanResult>({
          status: UPDATE_PLAN_STATUS.NOT_SAVED,
          reason: UPDATE_PLAN_REFUSAL.UNAVAILABLE,
        }),
      ),
    );
  });
}
