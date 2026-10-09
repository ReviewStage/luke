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
 * A place in the plan's repository: a file, named relative to the checkout
 * root, and the lines pointed at, or the file whole with none. Luke names one
 * through the planning model's `show_code`.
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

export const SHOWN_CODE_BOUNDS = {
  /** The most lines one showing carries: the lines pointed at, with the file around them. */
  WINDOW_LINES: 200,
  /** The most characters of one line that travel; a longer line is cut there. */
  MAX_LINE_CHARS: 400,
} as const;

/**
 * Code on screen during a planning call, with its lines: the place named,
 * the repository the service read it from, and the window of the file it
 * holds around the lines pointed at. The service reads the lines from the
 * planning session's checkout of the repository as `show_code` runs, and
 * they travel in the call's own journal and on the `plan.code` frame; the Mac
 * reads nothing of its own.
 */
export const shownCodeSchema = EffectSchema.Struct({
  ref: codeRefSchema,
  /** The repository the lines were read from, `owner/name`. */
  repository: githubRepositoryFullNameSchema,
  /** The file's line the first carried line is. */
  firstLine: codeLineSchema,
  /** How many lines the whole file has. */
  lineCount: EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(1)),
  lines: EffectSchema.Array(
    EffectSchema.String.check(EffectSchema.isMaxLength(SHOWN_CODE_BOUNDS.MAX_LINE_CHARS)),
  ).check(EffectSchema.isMaxLength(SHOWN_CODE_BOUNDS.WINDOW_LINES)),
});

export type ShownCode = typeof shownCodeSchema.Type;

/** One window of a file: its first and last line, both counted from one. */
export interface CodeWindow {
  readonly first: number;
  readonly last: number;
}

/**
 * The window of a file of `lineCount` lines the screen holds for `ref`: the
 * lines pointed at centred where the file allows, and the file's head for a
 * reference with none.
 */
export function codeWindow(ref: CodeRef, lineCount: number): CodeWindow {
  const { WINDOW_LINES } = SHOWN_CODE_BOUNDS;
  const latest = Math.max(1, lineCount - WINDOW_LINES + 1);
  if (ref.startLine === undefined || ref.endLine === undefined) {
    return { first: 1, last: Math.min(lineCount, WINDOW_LINES) };
  }
  const pointed = ref.endLine - ref.startLine + 1;
  const margin = Math.max(0, Math.floor((WINDOW_LINES - pointed) / 2));
  const first = Math.min(Math.max(1, ref.startLine - margin), latest);
  return { first, last: Math.min(lineCount, first + WINDOW_LINES - 1) };
}
