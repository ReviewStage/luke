import {
  mergePlanFields,
  type PlanFields,
  type PlanHeader,
  type PlanUpdate,
  planBody,
  planUpdateSchema,
  withPseudocode,
} from "@sidecar/hosted/plan-template";
import { PLAN_BOUNDS, type PlanAssumption, type PlanDocument } from "@sidecar/hosted/plan-wire";
import type { UnparsedWireValue } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Effect, Option, Result } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import { type PlanStoreEffect, readPlan, type StoredPlan, savePlanDocument } from "./plan-store.js";
import { logStoreFailure } from "./store-failure.js";

/**
 * update-plan-tool.ts -- the plan's one write: change a plan's document and read back what was saved.
 *
 * Its one caller is a planning call's notetaker (`voice/plan-scribe.ts`),
 * whose model answers with an update in this tool's input schema, and which
 * also writes the pseudocode Luke shows through `savePseudocode`. The
 * update is the fields of the plan's fixed template it changes
 * (`@sidecar/hosted/plan-template`), and the assumptions list where it
 * changes; a field sent `null` is one the update has nothing to say about,
 * and keeps what stood. They are merged over the fields the plan holds, the merged fields
 * are formatted into the canonical Markdown body under the header the service
 * supplies from the plan it loaded, and the body, the list, and the fields
 * are saved together; a body past its bound once formatted is refused like a
 * malformed call, before anything is written.
 *
 * Note that the call's arguments are the plan's content and nothing else. Which
 * account and which plan it writes are the binding the service built from
 * the authenticated session and the plan it opened, never a field the model
 * supplies, and an argument naming either is refused with the rest of a
 * malformed call, so a model cannot steer a save at another account or
 * another plan. The plan is read and then saved with no lock between, which
 * is safe because the notetaker is the plan's only writer and its runs never
 * overlap. The save is
 * `savePlanDocument`'s single update over the row that stands, so a plan deleted meanwhile answers as gone and is not
 * written back into being, and a save that fails answers as not saved with
 * the prior document standing. Every outcome is a result, never a failure of
 * the call: an unsaved change leaves the notetaker's lines for its next run.
 */

/** The account and plan a planning conversation writes, fixed by the service before the model runs. */
interface PlanToolBinding {
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
    "Not saved: the arguments may name only the template's sections and fields, each " +
    "field null or nonblank text of its type, and `assumptions` (each `text`), within " +
    "their bounds. The saved document is unchanged.",
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

const NO_PLAN_RESULT: UpdatePlanResult = {
  status: UPDATE_PLAN_STATUS.NOT_SAVED,
  reason: UPDATE_PLAN_REFUSAL.NO_PLAN,
};

/** What one save changes: the fields and the assumptions, each from the plan as stored. */
interface PlanChange {
  readonly fields: PlanFields;
  readonly assumptions: readonly PlanAssumption[];
}

/** The change merged over what the plan holds, formatted, and saved; a refusal where the plan is gone or the body too long. */
function saveChanged(
  binding: PlanDocumentBinding,
  change: (stored: StoredPlan) => PlanChange,
): PlanStoreEffect<UpdatePlanResult> {
  return Effect.gen(function* () {
    const stored = yield* readPlan(binding.userId, binding.planId);
    if (Option.isNone(stored)) return NO_PLAN_RESULT;
    const { fields, assumptions } = change(stored.value);
    const body = planBody(binding.header, fields);
    if (body.length > PLAN_BOUNDS.MAX_BODY_CHARS) {
      return {
        status: UPDATE_PLAN_STATUS.NOT_SAVED,
        reason: UPDATE_PLAN_REFUSAL.TOO_LONG,
      } as const;
    }
    const saved = yield* savePlanDocument(
      binding.userId,
      binding.planId,
      { body, assumptions },
      fields,
    );
    return Option.match(saved, {
      onNone: () => NO_PLAN_RESULT,
      onSome: (plan): UpdatePlanResult => ({
        status: UPDATE_PLAN_STATUS.SAVED,
        document: plan.document,
        savedAt: plan.updatedAt,
      }),
    });
  });
}

/** A store failure answered as a refusal the caller can act on, never as a failure. */
function unavailableOnFailure(
  save: PlanStoreEffect<UpdatePlanResult>,
): Effect.Effect<UpdatePlanResult, never, SqlClient.SqlClient> {
  return save.pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() =>
      Effect.succeed<UpdatePlanResult>({
        status: UPDATE_PLAN_STATUS.NOT_SAVED,
        reason: UPDATE_PLAN_REFUSAL.UNAVAILABLE,
      }),
    ),
  );
}

/** The tool as a planning model is offered it: its name, its words, and its input schema. */
export const UPDATE_PLAN_TOOL = {
  name: "update_plan",
  description:
    "Save changes to the plan: send only the fields of the fixed template that change. A " +
    "field left out or sent null keeps its saved value; nothing erases an answer, and a " +
    "correction rewrites it. A list (rules with their examples, open questions, " +
    "assumptions) is sent whole when any of it changes. Answers the document as saved, " +
    "or why nothing was saved.",
  inputSchema: planUpdateSchema,
} as const;

/** An update already read under the template's schema, saved under the plan the service bound. */
export function saveUpdate(
  binding: PlanDocumentBinding,
  update: PlanUpdate,
): Effect.Effect<UpdatePlanResult, never, SqlClient.SqlClient> {
  return unavailableOnFailure(
    saveChanged(binding, (stored) => ({
      fields: mergePlanFields(stored.fields, update),
      assumptions: update.assumptions ?? stored.plan.document.assumptions,
    })),
  );
}

/**
 * Writes the pseudocode Luke showed into the plan, replacing what the field
 * held, with every other field and the assumptions as they stand.
 */
export function savePseudocode(
  binding: PlanDocumentBinding,
  pseudocode: string,
): Effect.Effect<UpdatePlanResult, never, SqlClient.SqlClient> {
  return unavailableOnFailure(
    saveChanged(binding, (stored) => ({
      fields: withPseudocode(stored.fields, pseudocode),
      assumptions: stored.plan.document.assumptions,
    })),
  );
}

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
    return saveUpdate(binding, update.success);
  });
}
