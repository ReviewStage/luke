import { Schema as EffectSchema } from "effect";
import { githubRepositoryFullNameSchema } from "./github-repositories-wire.js";
import { countedNumber, wireUuidSchema } from "./service-wire.js";

/**
 * plan-wire.ts -- a named feature plan and its one saved document, as the Plans tab and the service read them.
 *
 * A plan is its owner's name for it and one current document: a Markdown `body` and an `assumptions` list, each assumption its
 * text (`docs/PLANNING.md`). The
 * document is the whole of what the plan's notetaker writes, through notes
 * the service takes into the plan's fields and formats into the body as the
 * one fixed template (`plan-template.ts`), and it is replaced whole on every
 * save: there is no version, no revision argument, and no per-assumption id.
 * A plan may name the GitHub repository it is about, `owner/name` as
 * `github-repositories-wire.ts` spells it, which the service confirms the
 * account reaches through the Luke GitHub App before it keeps it; null is a
 * plan with no repository yet, and every plan from before repositories.
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
  /** A document body past this is not a plan a coding agent can take in one prompt. */
  MAX_BODY_CHARS: 200_000,
  MAX_ASSUMPTIONS: 200,
  MAX_ASSUMPTION_CHARS: 2_000,
} as const;

/** A text settled with its ends trimmed, refused when nothing but whitespace stands, and bounded. */
function trimmedText(maximumChars: number) {
  return EffectSchema.Trim.check(EffectSchema.isNonEmpty(), EffectSchema.isMaxLength(maximumChars));
}

export const planAssumptionSchema = EffectSchema.Struct({
  /** The assumption as one plain sentence. */
  text: trimmedText(PLAN_BOUNDS.MAX_ASSUMPTION_CHARS),
});

export type PlanAssumption = typeof planAssumptionSchema.Type;

/** The one saved document of a plan, replaced whole by every save. */
export const planDocumentSchema = EffectSchema.Struct({
  /** The fixed template's canonical Markdown, stored exactly as formatted. */
  body: EffectSchema.String.check(EffectSchema.isMaxLength(PLAN_BOUNDS.MAX_BODY_CHARS)),
  assumptions: EffectSchema.Array(planAssumptionSchema).check(
    EffectSchema.isMaxLength(PLAN_BOUNDS.MAX_ASSUMPTIONS),
  ),
});

export type PlanDocument = typeof planDocumentSchema.Type;

/** A plan's repository as a request names it: a full name, or null for none. */
const repositoryChoiceSchema = EffectSchema.NullOr(githubRepositoryFullNameSchema);

/**
 * Starting a plan (POST): its name, and the repository it is about where one
 * is chosen; the document starts as the untouched template.
 */
export const planCreateRequestSchema = EffectSchema.Struct({
  name: trimmedText(PLAN_BOUNDS.MAX_NAME_CHARS),
  repository: EffectSchema.optionalKey(repositoryChoiceSchema),
});

export type PlanCreateRequest = typeof planCreateRequestSchema.Type;

/** Renaming a plan (PATCH): its new name, under the same rules as the name it started with. */
export const planRenameRequestSchema = EffectSchema.Struct({
  name: trimmedText(PLAN_BOUNDS.MAX_NAME_CHARS),
});

export type PlanRenameRequest = typeof planRenameRequestSchema.Type;

/** Whether an update names anything to change: one that names nothing is refused rather than answered unchanged. */
function updateNamesAChange(update: { name?: string; repository?: string | null }): boolean {
  return "name" in update || "repository" in update;
}

/**
 * Changing a plan (PATCH): its name, its repository, or both. A rename is
 * one of these; a repository is confirmed reachable by the account before it
 * is kept, and null clears it.
 */
export const planUpdateRequestSchema = EffectSchema.Struct({
  name: EffectSchema.optionalKey(trimmedText(PLAN_BOUNDS.MAX_NAME_CHARS)),
  repository: EffectSchema.optionalKey(repositoryChoiceSchema),
}).check(EffectSchema.makeFilter(updateNamesAChange));

const planSummaryFields = {
  id: wireUuidSchema,
  name: trimmedText(PLAN_BOUNDS.MAX_NAME_CHARS),
  /** Epoch milliseconds the plan was started. */
  createdAt: countedNumber,
  /** Epoch milliseconds the document was last saved; the start, before any save. */
  updatedAt: countedNumber,
  /** The GitHub repository the plan is about, `owner/name`; null before one is chosen. */
  repository: repositoryChoiceSchema,
  /**
   * The start again, answered only for a desktop through v0.7.1, which
   * refuses a summary without it; the list once ordered by the last open.
   * Optional here so no later build needs it, and nothing reads it. It goes
   * once a release that decodes it as optional has shipped and v0.7.1 is no
   * longer supported.
   */
  openedAt: EffectSchema.optionalKey(countedNumber),
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

/** The plan list (GET): every plan the account owns, newest started first. */
export const planListAnswerSchema = EffectSchema.Struct({
  plans: EffectSchema.Array(planSummarySchema),
});

/** A started, opened, or changed plan (POST, GET, PATCH), with its document as saved. */
export const planAnswerSchema = EffectSchema.Struct({ plan: planSchema });

/** A deleted plan (DELETE): its row, its document, and its association are gone. */
export const planDeleteAnswerSchema = EffectSchema.Struct({ deleted: EffectSchema.Literal(true) });

/** The most characters of stdout or stderr one command's result carries. */
export const PLAN_COMMAND_OUTPUT_MAX_CHARS = 20_000;

/** One command the planning model asked to run in the plan's folder, as the Mac claims it; the Mac knows the folder. */
export const planCommandSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  command: EffectSchema.String,
});

export type PlanCommand = typeof planCommandSchema.Type;

/** A claim (POST): the oldest command waiting for the plan, or null when none arrived in time. */
export const planCommandClaimAnswerSchema = EffectSchema.Struct({
  command: EffectSchema.NullOr(planCommandSchema),
});

/** What the Mac posts back once it ran a claimed command. */
export const planCommandResultSchema = EffectSchema.Struct({
  exitCode: EffectSchema.Int,
  stdout: EffectSchema.String.check(EffectSchema.isMaxLength(PLAN_COMMAND_OUTPUT_MAX_CHARS)),
  stderr: EffectSchema.String.check(EffectSchema.isMaxLength(PLAN_COMMAND_OUTPUT_MAX_CHARS)),
});

export type PlanCommandResult = typeof planCommandResultSchema.Type;

/** A settled command (POST): whether the result landed on a command the account had claimed. */
export const planCommandSettleAnswerSchema = EffectSchema.Struct({
  settled: EffectSchema.Boolean,
});

/** The most lines one code reference points at; a reference is a passage, not a file. */
const CODE_REF_MAX_LINES = 200;

/** The most characters of a path one code reference names: macOS's own bound. */
export const CODE_PATH_MAX_CHARS = 1_024;

const codeLineSchema = EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(1));

/** Whether a reference names both of its lines or neither, in order and within the bound. */
function codeRangeIsReadable(ref: { startLine?: number; endLine?: number }): boolean {
  if (ref.startLine === undefined || ref.endLine === undefined) {
    return ref.startLine === ref.endLine;
  }
  return ref.endLine >= ref.startLine && ref.endLine - ref.startLine < CODE_REF_MAX_LINES;
}

/**
 * Code on screen during a planning call, by place and never by content: a
 * file of the plan's folder, named relative to it, and the lines pointed at,
 * or the file whole with none. Luke names one through the planning model's
 * `show_code`, and the Mac reads the lines from its own folder.
 */
export const codeRefSchema = EffectSchema.Struct({
  path: EffectSchema.String.check(
    EffectSchema.isNonEmpty(),
    EffectSchema.isMaxLength(CODE_PATH_MAX_CHARS),
  ),
  startLine: EffectSchema.optionalKey(codeLineSchema),
  endLine: EffectSchema.optionalKey(codeLineSchema),
}).check(EffectSchema.makeFilter(codeRangeIsReadable));

export type CodeRef = typeof codeRefSchema.Type;
