import { Schema as EffectSchema } from "effect";
import { countedNumber, wireUuidSchema } from "./service-wire.js";

/**
 * plan-wire.ts -- a named feature plan and its one saved document, as the planning window and the service read them.
 *
 * A plan is its owner's name for it, the GitHub repository it plans against
 * with the default branch and the commit it was started at, and one current
 * document: a Markdown `body` and an `assumptions` list, each assumption its
 * text and whether the developer confirmed it (`docs/PLANNING.md`). The
 * document is the whole of what the planning model writes, through
 * `update_plan({ body, assumptions })`, and it is replaced whole on every
 * save: there is no version, no revision argument, and no per-assumption id.
 * The owning account and the conversation a plan resumes in are the
 * service's own and never travel here.
 *
 * Every request refuses a key it does not name, as every request frame on
 * this wire does, so a body cannot smuggle an account or a plan id past the
 * bearer and the path that name them. Declared directly with Effect's
 * `Schema.Struct` and exported under its own name.
 */

export const PLAN_BOUNDS = {
  /** The most characters a plan's name may spell. */
  MAX_NAME_CHARS: 200,
  /** GitHub's own bounds sit well inside these. */
  MAX_REPOSITORY_OWNER_CHARS: 100,
  MAX_REPOSITORY_NAME_CHARS: 100,
  MAX_BRANCH_CHARS: 255,
  /** A document body past this is not a plan a coding agent can take in one prompt. */
  MAX_BODY_CHARS: 200_000,
  MAX_ASSUMPTIONS: 200,
  MAX_ASSUMPTION_CHARS: 2_000,
} as const;

/** A full hexadecimal commit id, the form GitHub resolves a branch to. */
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;

/** A text settled with its ends trimmed, refused when nothing but whitespace stands, and bounded. */
function trimmedText(maximumChars: number) {
  return EffectSchema.Trim.check(EffectSchema.isNonEmpty(), EffectSchema.isMaxLength(maximumChars));
}

export const planAssumptionSchema = EffectSchema.Struct({
  /** The assumption as one plain sentence. */
  text: trimmedText(PLAN_BOUNDS.MAX_ASSUMPTION_CHARS),
  /** Whether the developer agreed to it; the model's reading of their answer, stored as given. */
  confirmed: EffectSchema.Boolean,
});

export type PlanAssumption = typeof planAssumptionSchema.Type;

/** The one saved document of a plan, replaced whole by every save. */
export const planDocumentSchema = EffectSchema.Struct({
  /** Markdown, stored exactly as written; empty on a plan nothing has been saved to. */
  body: EffectSchema.String.check(EffectSchema.isMaxLength(PLAN_BOUNDS.MAX_BODY_CHARS)),
  assumptions: EffectSchema.Array(planAssumptionSchema).check(
    EffectSchema.isMaxLength(PLAN_BOUNDS.MAX_ASSUMPTIONS),
  ),
});

export type PlanDocument = typeof planDocumentSchema.Type;

/** The repository a plan reads, fixed at the commit its default branch stood at when the plan started. */
export const planRepositorySchema = EffectSchema.Struct({
  owner: trimmedText(PLAN_BOUNDS.MAX_REPOSITORY_OWNER_CHARS),
  name: trimmedText(PLAN_BOUNDS.MAX_REPOSITORY_NAME_CHARS),
  branch: trimmedText(PLAN_BOUNDS.MAX_BRANCH_CHARS),
  commit: EffectSchema.Trim.check(EffectSchema.isPattern(COMMIT_PATTERN)),
});

export type PlanRepository = typeof planRepositorySchema.Type;

/**
 * Starting a plan (POST): its name and the repository it plans against; the
 * document starts empty. The service resolves the default branch and its
 * commit itself, through the account's GitHub connection, so a request
 * naming either is refused rather than trusted.
 */
export const planCreateRequestSchema = EffectSchema.Struct({
  name: trimmedText(PLAN_BOUNDS.MAX_NAME_CHARS),
  repository: EffectSchema.Struct({
    owner: planRepositorySchema.fields.owner,
    name: planRepositorySchema.fields.name,
  }),
});

export type PlanCreateRequest = typeof planCreateRequestSchema.Type;

const planSummaryFields = {
  id: wireUuidSchema,
  name: trimmedText(PLAN_BOUNDS.MAX_NAME_CHARS),
  repository: planRepositorySchema,
  /** Epoch milliseconds the plan was started. */
  createdAt: countedNumber,
  /** Epoch milliseconds the document was last saved; the start, before any save. */
  updatedAt: countedNumber,
  /** Epoch milliseconds the plan was last opened, which is what the list is ordered by. */
  openedAt: countedNumber,
};

/** One row of the plan list: everything but the document. */
export const planSummarySchema = EffectSchema.Struct(planSummaryFields);

export type PlanSummary = typeof planSummarySchema.Type;

/** One plan with its saved document. */
export const planSchema = EffectSchema.Struct({
  ...planSummaryFields,
  document: planDocumentSchema,
});

export type Plan = typeof planSchema.Type;

/** The plan list (GET): every plan the account owns, most recently opened first. */
export const planListAnswerSchema = EffectSchema.Struct({
  plans: EffectSchema.Array(planSummarySchema),
});

/** A started or opened plan (POST, GET), with its document as saved. */
export const planAnswerSchema = EffectSchema.Struct({ plan: planSchema });

/** A deleted plan (DELETE): its row, its document, and its association are gone. */
export const planDeleteAnswerSchema = EffectSchema.Struct({ deleted: EffectSchema.Literal(true) });
