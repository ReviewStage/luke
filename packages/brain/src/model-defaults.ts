/**
 * What a brain turn runs on when nothing names otherwise: a model by its
 * catalog id and the reasoning effort it is asked for, the same pair a
 * coding agent's row names, so the brain's turns and its workers' are
 * reached, recorded, and drawn as an agent's are. The effort is OpenAI's
 * own default for the model, said out loud so the turn row can record it.
 * The one caller is Luke's hosted brain host, which runs every turn on the
 * deployment's own key; the desktop composes no brain and holds no key of
 * its own.
 */
export const BRAIN_OPENAI_DEFAULTS = {
  MODEL: "openai/gpt-6.1-sol",
  EFFORT: "medium",
} as const;
