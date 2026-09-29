import { type PlanHeader, planBody, planUpdateSchema } from "@sidecar/hosted/plan-template";
import { PLAN_BOUNDS, type PlanDocument } from "@sidecar/hosted/plan-wire";
import type { UnparsedWireValue } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Effect, Option, Result } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import { savePlanDocument } from "./plan-store.js";
import { logStoreFailure } from "./store-failure.js";

/**
 * update-plan-tool.ts -- the planning model's one write: replace the open plan's document and read back what was saved.
 *
 * The call's arguments are the plan's fixed template, every section and every
 * field (`@sidecar/hosted/plan-template`), and the assumptions list. The
 * typed answers are formatted into the canonical Markdown body here, under
 * the header the service supplies from the plan it loaded, and the body and
 * the list are saved as the one `{ body, assumptions }` document; a body
 * past its bound once formatted is refused like a malformed call, before
 * anything is written.
 *
 * Note that the call's arguments are the plan's content and nothing else. Which
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

/** The binding `update_plan` writes under, with the header its body names, both as the service loaded the plan. */
export interface PlanDocumentBinding extends PlanToolBinding {
  readonly header: PlanHeader;
}

export const UPDATE_PLAN_STATUS = {
  SAVED: "saved",
  NOT_SAVED: "not-saved",
} as const;

/** Why a call saved nothing, in words the model can act on. */
export const UPDATE_PLAN_REFUSAL = {
  UNREADABLE:
    "Not saved: the arguments must be exactly the template's sections and fields, each " +
    "field null or nonblank text of its type, and `assumptions` (each `text` and " +
    "`confirmed`), within their bounds. The saved document is unchanged.",
  TOO_LONG:
    "Not saved: the formatted plan is longer than a plan may be. Shorten the longest " +
    "answers; the saved document is unchanged.",
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

const readInput = readEither(planUpdateSchema);

/** The tool as a planning model is offered it: its name, its words, and its input schema. */
export const UPDATE_PLAN_TOOL = {
  name: "update_plan",
  description:
    "Save the plan: every section and field of the fixed template, and the complete " +
    "assumptions list. Every key is required on every call; an unanswered field is null. " +
    "Each call replaces the whole saved document, so send everything that should stand, " +
    "including what did not change. Answers the document as saved, or why nothing was saved.",
  inputSchema: planUpdateSchema,
} as const;

/** One call of `update_plan` under the plan the service bound, answered as the result the model reads. */
export function runUpdatePlan(
  binding: PlanDocumentBinding,
  input: UnparsedWireValue,
): Effect.Effect<UpdatePlanResult, never, SqlClient.SqlClient> {
  return Effect.suspend(() => {
    const update = readInput(input);
    if (Result.isFailure(update)) {
      const field = update.failure.path.join(".");
      return Effect.succeed<UpdatePlanResult>({
        status: UPDATE_PLAN_STATUS.NOT_SAVED,
        reason: UPDATE_PLAN_REFUSAL.UNREADABLE,
        ...(field ? { field } : undefined),
      });
    }
    const body = planBody(binding.header, update.success);
    if (body.length > PLAN_BOUNDS.MAX_BODY_CHARS) {
      return Effect.succeed<UpdatePlanResult>({
        status: UPDATE_PLAN_STATUS.NOT_SAVED,
        reason: UPDATE_PLAN_REFUSAL.TOO_LONG,
      });
    }
    const document = { body, assumptions: update.success.assumptions };
    return savePlanDocument(binding.userId, binding.planId, document).pipe(
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
