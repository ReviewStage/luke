import { Schema as EffectSchema } from "effect";
import { CODING_AGENT_BOUNDS } from "./coding-agent-wire.js";

/**
 * models-wire.ts -- the models a coding agent may run on, and the account's default among them, as the desktop reads and writes them.
 *
 * `GET /api/models` answers the service's filtered read of AI Gateway's
 * public catalog: each model's catalog id, its name, which of the two
 * providers runs it, and the efforts it lists, in the catalog's order. The
 * Start menu and Settings › Coding agents both draw it, and every model row
 * carries its provider's mark, so the provider travels as a word of this
 * wire's own rather than being read off the id.
 *
 * The account's default is the `codingAgent` part of the preferences
 * snapshot at `/api/account/preferences`: one model and one effort, read
 * beside the settings preferences the desktop syncs through its own client
 * and written on its own, as a body carrying that part alone. A Start that
 * names a model writes the same value on the service, so the menu's last
 * choice and the default are one value.
 */

/** The providers whose models Luke runs coding agents on, as the catalog prefixes their ids. */
export const MODEL_PROVIDER = {
  ANTHROPIC: "anthropic",
  OPENAI: "openai",
} as const;

export type ModelProvider = (typeof MODEL_PROVIDER)[keyof typeof MODEL_PROVIDER];

/** A model id or an effort as the wire carries it, bounded as a Start bounds them. */
const choiceText = EffectSchema.Trim.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(CODING_AGENT_BOUNDS.MAX_CHOICE_CHARS),
);

/** One model the service offers: its catalog id, its name, its provider, and the efforts it lists. */
export const catalogModelSchema = EffectSchema.Struct({
  /** AI Gateway's catalog id, such as `anthropic/claude-opus-5.5`. */
  id: choiceText,
  name: EffectSchema.String,
  provider: EffectSchema.Literals(Object.values(MODEL_PROVIDER)),
  /** The efforts the model lists, in the catalog's order; never empty. */
  efforts: EffectSchema.Array(choiceText).check(EffectSchema.isMinLength(1)),
});

export type CatalogModel = typeof catalogModelSchema.Type;

/** The models the service offers (GET). */
export const modelsAnswerSchema = EffectSchema.Struct({
  models: EffectSchema.Array(catalogModelSchema),
});

/** A model and an effort, as a Start names them and the account's default stores them. */
export const modelChoiceSchema = EffectSchema.Struct({
  model: choiceText,
  effort: choiceText,
});

export type ModelChoice = typeof modelChoiceSchema.Type;

/**
 * The preferences snapshot read for its coding-agent part alone (GET): the
 * settings preferences beside it are the settings client's to read, so the
 * reader drops them rather than naming them here.
 */
export const codingAgentDefaultAnswerSchema = EffectSchema.Struct({
  codingAgent: modelChoiceSchema,
});

/** The coding-agent part written on its own (PUT): the body carries nothing else, so the settings preferences stand as they were. */
export const codingAgentDefaultWriteSchema = EffectSchema.Struct({
  codingAgent: modelChoiceSchema,
});
