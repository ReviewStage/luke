import { Schema as EffectSchema } from "effect";
import {
  PLAN_HISTORY_BOUNDS,
  planRevisionAnswerSchema,
  planRevisionLineSchema,
  planRevisionSeqSchema,
} from "./task-wire.js";

/**
 * plan-document-template.ts -- the Markdown an account's new tasks start from, and how `/api/account/plan-template` reads and writes it.
 *
 * Each account keeps one starter template on the service, so every Mac it
 * signs in on sees the same one. `GET` answers the template with whether the
 * account wrote it (`custom`) or holds the built-in default below. `PUT` takes
 * a template to keep verbatim, or null to go back to the default, and answers
 * the same as a `GET` would after it. The last write wins, like every other
 * preference.
 *
 * The template is plain Markdown. Its guidance sentences are ordinary text the
 * developer and Luke both read, and nothing draws them muted. Every new plan
 * starts as a copy of it (`task-store.ts`'s `createTask`; `docs/TASKS.md`,
 * "The template"), and a note Luke adds to a section that still holds exactly
 * what the template put there, one paragraph of guidance, takes the place of
 * those words (`plan-template.ts`'s `applyNotesToText`).
 *
 * Every write that changes the template is kept as a revision, read and
 * restored the way a plan's are: `GET /api/account/plan-template/revisions`
 * a page at a time, newest first, `GET .../revisions/{seq}` one revision
 * beside the one before it, and `POST .../revisions/{seq}/restore` puts it
 * back as a revision of its own, answered as a `PUT` is.
 */

export const PLAN_TEMPLATE_BOUNDS = {
  /** The longest template kept: a long design doc's skeleton, far past any sensible starter. */
  MAX_CHARS: 20_000,
} as const;

/**
 * The default's sections (`plan-template.ts`'s `PLAN_HEADING`, in its
 * order), each with one plain sentence on what it holds.
 */
const DEFAULT_SECTIONS = [
  [
    "Context",
    "Why this work exists: what happens today, who it affects, and what prompted it now.",
  ],
  ["Goal", "What is true once the work ships, as outcomes a user or a test could observe."],
  [
    "Approach",
    "The design in plain words: the main pieces, where each lives by path, and the reason for each decision.",
  ],
  [
    "Interfaces",
    "Every type, schema, table, route, or signature the change adds or changes, written as code under its file.",
  ],
  ["Alternatives", "Optional: each other approach that was weighed, and why it lost."],
  ["Hard parts", "Each tricky case, and exactly what the change does in it."],
  ["Not doing", "What is out of scope on purpose, and why."],
  ["Plan of attack", "Optional: the steps the work lands in, in order, and why the order matters."],
  [
    "Testing",
    'The cases that prove the change, each as "When …, then …" with an exact result, then the end-to-end check.',
  ],
  ["Open questions", "Each question nobody could answer yet."],
  ["Assumptions", "What the plan assumes without the developer having said it."],
] as const;

/** The template an account holds until it writes its own, and holds again after a reset. */
export const DEFAULT_PLAN_TEMPLATE = DEFAULT_SECTIONS.map(
  ([heading, guidance]) => `## ${heading}\n\n${guidance}\n`,
).join("\n");

/** A template as it is kept: any text within the bound, empty included, never trimmed. */
const planTemplateTextSchema = EffectSchema.String.check(
  EffectSchema.isMaxLength(PLAN_TEMPLATE_BOUNDS.MAX_CHARS),
);

/** The account's template (GET, and every PUT's answer); `custom` is false while it holds the default. */
export const planTemplateAnswerSchema = EffectSchema.Struct({
  template: planTemplateTextSchema,
  custom: EffectSchema.Boolean,
});

export type PlanTemplateAnswer = typeof planTemplateAnswerSchema.Type;

/** A write (PUT): the template to keep verbatim, or null to go back to the default. */
export const planTemplateWriteRequestSchema = EffectSchema.Struct({
  template: EffectSchema.NullOr(planTemplateTextSchema),
});

/**
 * One revision of the template as its version history lists it: a plan's
 * revision line, whose writer is the developer or, for the template as it
 * stood before its history began, `earlier`, and `default` where the
 * revision is the built-in default rather than words of the account's own: a
 * reset, or the default the account held when its history began.
 */
export const planTemplateRevisionLineSchema = EffectSchema.Struct({
  ...planRevisionLineSchema.fields,
  default: EffectSchema.optionalKey(EffectSchema.Literal(true)),
});

export type PlanTemplateRevisionLine = typeof planTemplateRevisionLineSchema.Type;

/**
 * A page of the template's history (GET `/api/account/plan-template/revisions`),
 * the newest first, before the revision the `before` query names where it
 * names one; `earlier` is what the next older page is read before, absent on
 * the oldest.
 */
export const planTemplateRevisionsAnswerSchema = EffectSchema.Struct({
  revisions: EffectSchema.Array(planTemplateRevisionLineSchema).check(
    EffectSchema.isMaxLength(PLAN_HISTORY_BOUNDS.PAGE),
  ),
  earlier: EffectSchema.optionalKey(planRevisionSeqSchema),
});

export type PlanTemplateRevisionsAnswer = typeof planTemplateRevisionsAnswerSchema.Type;

/**
 * One revision's content (GET `/api/account/plan-template/revisions/{seq}`):
 * the template after it and before it, null for the first, as a plan's
 * revision answers it, the default drawn as the default's words.
 */
export const planTemplateRevisionAnswerSchema = planRevisionAnswerSchema;

export type PlanTemplateRevisionAnswer = typeof planTemplateRevisionAnswerSchema.Type;
