import { applyNotes, type PlanNote, planBody } from "@sidecar/hosted/plan-template";
import { PLAN_BOUNDS, type PlanDocument } from "@sidecar/hosted/plan-wire";
import { Effect, Option } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { readPlanForUpdate, savePlanDocument } from "./plan-store.js";
import { logStoreFailure } from "./store-failure.js";

/**
 * plan-notes.ts -- the plan's one write: take the notetaker's notes into a plan and read back what was saved.
 *
 * Its one caller is a planning call's notetaker (`voice/plan-scribe.ts`),
 * whose model answers with notes (`@sidecar/hosted/plan-template`): a point
 * added under a field, an example added to a rule, a phrase corrected, or a
 * line struck. They are taken in order over the fields the plan holds, the
 * fields are formatted into the canonical Markdown body under the plan's
 * name as it stands at the save, and the body, the list, and the
 * fields are saved together. A note that names a phrase the plan does not
 * hold is passed over and the rest are saved; a body past its bound once
 * formatted is refused before anything is written.
 *
 * Note that the notes are the plan's content and nothing else. Which account
 * and which plan they land in are the binding the service built from the
 * authenticated session and the plan it opened, never a field the model
 * supplies. The plan is read and saved under its row's lock, because a
 * rename is the document's other writer: its heading is the plan's name, and
 * a save formatted under a name read before a rename would put the old one
 * back. The save is `savePlanDocument`'s single update over the row that
 * stands, so a plan deleted meanwhile answers as gone and is not written back
 * into being, and a save that fails answers as not saved with the prior
 * document standing. Every outcome is a result, never a failure: an unsaved
 * change leaves the notetaker's lines for its next run.
 */

/** The account and plan a planning call writes, as the service bound them. */
export interface PlanDocumentBinding {
  readonly userId: string;
  readonly planId: string;
}

export const PLAN_SAVE_STATUS = {
  SAVED: "saved",
  NOT_SAVED: "not-saved",
} as const;

/** Why notes saved nothing. */
export const PLAN_SAVE_REFUSAL = {
  TOO_LONG: "Not saved: the formatted plan is longer than a plan may be.",
  NO_PLAN: "Not saved: this plan no longer exists.",
  UNAVAILABLE: "Not saved: the service could not reach its store.",
} as const;

export type PlanSaveResult =
  | {
      readonly status: typeof PLAN_SAVE_STATUS.SAVED;
      /** The document exactly as it now stands saved. */
      readonly document: PlanDocument;
      /** Epoch milliseconds of the save. */
      readonly savedAt: number;
    }
  | {
      readonly status: typeof PLAN_SAVE_STATUS.NOT_SAVED;
      readonly reason: string;
    };

const NO_PLAN_RESULT: PlanSaveResult = {
  status: PLAN_SAVE_STATUS.NOT_SAVED,
  reason: PLAN_SAVE_REFUSAL.NO_PLAN,
};

/** The notes taken over what the plan holds, formatted, and saved; a refusal where the plan is gone or the body too long. */
function savedNotes(binding: PlanDocumentBinding, notes: readonly PlanNote[]) {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(savedUnderLock(binding, notes)),
  );
}

/** The read and the save of `savedNotes`, run inside the transaction that holds the row. */
function savedUnderLock(binding: PlanDocumentBinding, notes: readonly PlanNote[]) {
  return Effect.gen(function* () {
    const stored = yield* readPlanForUpdate(binding.userId, binding.planId);
    if (Option.isNone(stored)) return NO_PLAN_RESULT;
    const { fields, plan } = stored.value;
    const { content } = applyNotes({ fields, assumptions: plan.document.assumptions }, notes);
    const body = planBody({ name: plan.name }, content.fields);
    if (body.length > PLAN_BOUNDS.MAX_BODY_CHARS) {
      return { status: PLAN_SAVE_STATUS.NOT_SAVED, reason: PLAN_SAVE_REFUSAL.TOO_LONG } as const;
    }
    const saved = yield* savePlanDocument(
      binding.userId,
      binding.planId,
      { body, assumptions: content.assumptions },
      content.fields,
    );
    return Option.match(saved, {
      onNone: () => NO_PLAN_RESULT,
      onSome: (savedPlan): PlanSaveResult => ({
        status: PLAN_SAVE_STATUS.SAVED,
        document: savedPlan.document,
        savedAt: savedPlan.updatedAt,
      }),
    });
  });
}

/** Notes already read under the template's schema, taken into the plan the service bound. */
export function saveNotes(
  binding: PlanDocumentBinding,
  notes: readonly PlanNote[],
): Effect.Effect<PlanSaveResult, never, SqlClient.SqlClient> {
  return savedNotes(binding, notes).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() =>
      Effect.succeed<PlanSaveResult>({
        status: PLAN_SAVE_STATUS.NOT_SAVED,
        reason: PLAN_SAVE_REFUSAL.UNAVAILABLE,
      }),
    ),
  );
}
