import { type PlanSectionWriter, planSectionWriterSchema } from "@sidecar/hosted/plan-document";
import {
  EMPTY_PLAN_FIELDS,
  PLAN_FIELD_HEADING,
  type PlanFieldWriter,
  planDocumentOf,
  planFieldWriterSchema,
} from "@sidecar/hosted/plan-template";
import { PLAN_BOUNDS, planAssumptionSchema, planFieldsSchema } from "@sidecar/hosted/plan-wire";
import { and, eq, isNull } from "drizzle-orm";
import { Effect, Option, type Redacted, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import { planRevision } from "../db/plan-revision-schema.js";
import { plan } from "../db/plan-schema.js";
import { db } from "../db/query.js";
import {
  bearerMatchesSecret,
  errorResponse,
  HOSTED_API_ERROR,
  HOSTED_HTTP_STATUS,
  jsonResponse,
} from "./http.js";
import type { PlanStoreEffect } from "./plan-store.js";

/**
 * plan-backfill.ts -- every plan still kept as the fixed template's fields carried over to one document, its history with it.
 *
 * A plan started since the switch is one document from the start, and a plan
 * from before it is carried over here: its text is its fields as one
 * document (`planDocumentOf`), and who last changed each field becomes who
 * last changed the section under that field's heading. Carrying a plan over
 * is no save, so it records no revision and leaves the instant it was last
 * saved, which the list's order and the unread marks read, where it stood.
 * Every revision kept as fields gets its text beside them the same way, so
 * the history reads as text throughout. A plan or a revision whose text
 * would pass the plan's bound is left as it is and counted, since a body past
 * it is one no desktop reads. Each plan is carried over under its row's
 * lock, only while it is still kept as fields, so a save landing meanwhile
 * is never written over and a second pass carries nothing.
 *
 * It is asked by hand, `POST /api/maintenance/plan-documents` under the
 * deployment's own `CRON_SECRET` (`scripts/backfill-plan-documents.sh`), and
 * answers counts alone: no account, plan, or word of one is named.
 */

/** What one pass did, in counts alone. */
export interface PlanBackfill {
  /** Plans carried over to one document. */
  readonly plans: number;
  /** Revisions given their text. */
  readonly revisions: number;
  /** Plans and revisions left as fields because their text would pass the plan's bound. */
  readonly overBound: number;
}

/** What the endpoint is handed: the request, and the deployment's secret as its environment holds it. */
export interface PlanBackfillOptions {
  readonly request: Request;
  readonly cronSecret: Redacted.Redacted | undefined;
}

const PlanKeySchema = Schema.Struct({ id: Schema.String });

/** The plans still kept as fields, by id. */
const findFieldsPlans = SqlSchema.findAll({
  Request: Schema.Void,
  Result: PlanKeySchema,
  execute: () => db.select({ id: plan.id }).from(plan).where(isNull(plan.document)),
});

const FieldsPlanRowSchema = Schema.Struct({
  fields: Schema.NullOr(planFieldsSchema),
  assumptions: Schema.Array(planAssumptionSchema),
  fieldWriters: Schema.Array(planFieldWriterSchema),
});

/** One plan under its row's lock, while it is still kept as fields. */
const lockFieldsPlan = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: FieldsPlanRowSchema,
  execute: (planId) =>
    db
      .select({
        fields: plan.fields,
        assumptions: plan.assumptions,
        fieldWriters: plan.fieldWriters,
      })
      .from(plan)
      .where(and(eq(plan.id, planId), isNull(plan.document)))
      .for("update"),
});

/** The plan's text and its sections' writers set, its last save left where it stood. */
const setPlanDocument = SqlSchema.void({
  Request: Schema.Struct({
    id: Schema.String,
    document: Schema.String,
    sectionWriters: Schema.Array(planSectionWriterSchema),
  }),
  execute: ({ id, document, sectionWriters }) =>
    db
      .update(plan)
      .set({ document, sectionWriters })
      .where(and(eq(plan.id, id), isNull(plan.document))),
});

const FieldsRevisionRowSchema = Schema.Struct({
  planId: Schema.String,
  seq: Schema.Number,
  fields: planFieldsSchema,
  assumptions: Schema.Array(planAssumptionSchema),
});

/** Every revision still kept as fields alone. */
const findFieldsRevisions = SqlSchema.findAll({
  Request: Schema.Void,
  Result: FieldsRevisionRowSchema,
  execute: () =>
    db
      .select({
        planId: planRevision.planId,
        seq: planRevision.seq,
        fields: planRevision.fields,
        assumptions: planRevision.assumptions,
      })
      .from(planRevision)
      .where(isNull(planRevision.document)),
});

const setRevisionDocument = SqlSchema.void({
  Request: Schema.Struct({ planId: Schema.String, seq: Schema.Number, document: Schema.String }),
  execute: ({ planId, seq, document }) =>
    db
      .update(planRevision)
      .set({ document })
      .where(
        and(
          eq(planRevision.planId, planId),
          eq(planRevision.seq, seq),
          isNull(planRevision.document),
        ),
      ),
});

/** Who last changed a field, as who last changed the section under its heading. */
function sectionWriterOf(writer: PlanFieldWriter): PlanSectionWriter {
  const { field, ...who } = writer;
  return { section: PLAN_FIELD_HEADING[field], ...who };
}

/** What carrying one plan over did: carried it, found it already a document, or left it because its text would pass the bound. */
const CARRIED = {
  CARRIED: "carried",
  STANDING: "standing",
  OVER_BOUND: "over-bound",
} as const;

type Carried = (typeof CARRIED)[keyof typeof CARRIED];

/** One plan carried over under its lock, while it is still kept as fields. */
function carriedOver(planId: string): PlanStoreEffect<Carried> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const locked = yield* lockFieldsPlan(planId);
        if (Option.isNone(locked)) return CARRIED.STANDING;
        const { fields, assumptions, fieldWriters } = locked.value;
        const document = planDocumentOf({ fields: fields ?? EMPTY_PLAN_FIELDS, assumptions });
        if (document.length > PLAN_BOUNDS.MAX_BODY_CHARS) return CARRIED.OVER_BOUND;
        yield* setPlanDocument({
          id: planId,
          document,
          sectionWriters: fieldWriters.map(sectionWriterOf),
        });
        return CARRIED.CARRIED;
      }),
    ),
  );
}

/** One pass over every plan and revision still kept as fields. */
export function backfillPlanDocuments(): PlanStoreEffect<PlanBackfill> {
  return Effect.gen(function* () {
    const counts = { plans: 0, revisions: 0, overBound: 0 };
    for (const { id } of yield* findFieldsPlans(undefined)) {
      const outcome = yield* carriedOver(id);
      if (outcome === CARRIED.CARRIED) counts.plans += 1;
      if (outcome === CARRIED.OVER_BOUND) counts.overBound += 1;
    }
    for (const revision of yield* findFieldsRevisions(undefined)) {
      const document = planDocumentOf(revision);
      if (document.length > PLAN_BOUNDS.MAX_BODY_CHARS) {
        counts.overBound += 1;
        continue;
      }
      yield* setRevisionDocument({ planId: revision.planId, seq: revision.seq, document });
      counts.revisions += 1;
    }
    return counts;
  });
}

/** The backfill as its endpoint answers it: a POST under the deployment's secret, answered with the pass's counts. */
export const handlePlanBackfill = /* @__PURE__ */ Effect.fn("web/handlePlanBackfill")(function* (
  options: PlanBackfillOptions,
): Effect.fn.Return<Response, unknown, SqlClient.SqlClient> {
  const { request } = options;
  if (request.method !== "POST") {
    return errorResponse(
      HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
    );
  }
  if (options.cronSecret === undefined) {
    return errorResponse(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE);
  }
  if (!bearerMatchesSecret(request, options.cronSecret)) {
    return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
  }
  return jsonResponse(HOSTED_HTTP_STATUS.OK, yield* backfillPlanDocuments());
});
