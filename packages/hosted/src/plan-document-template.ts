import { Schema as EffectSchema } from "effect";

/**
 * plan-document-template.ts -- the Markdown an account's new plans start from, and how `/api/account/plan-template` reads and writes it.
 *
 * Each account keeps one starter template on the service, so every Mac it
 * signs in on sees the same one. `GET` answers the template with whether the
 * account wrote it (`custom`) or holds the built-in default below. `PUT` takes
 * a template to keep verbatim, or null to go back to the default, and answers
 * the same as a `GET` would after it. The last write wins, like every other
 * preference.
 *
 * The template is plain Markdown. Its guidance sentences are ordinary text the
 * developer and Luke both read: nothing draws them muted and no code replaces
 * them. Nothing reads the template to start a plan yet; that waits on plans
 * becoming one document (`docs/PLANNING.md`, "The fixed template").
 */

export const PLAN_TEMPLATE_BOUNDS = {
  /** The longest template kept: a long design doc's skeleton, far past any sensible starter. */
  MAX_CHARS: 20_000,
} as const;

/**
 * The default's sections: today's fixed template (`plan-template.ts`'s
 * `PLAN_HEADING`, in its order), each with one plain sentence on what it holds.
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
