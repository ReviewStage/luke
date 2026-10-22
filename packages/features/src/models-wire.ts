import { Schema as EffectSchema } from "effect";
import { CODING_AGENT_BOUNDS, contextWindowSchema } from "./coding-agent-wire.js";
import { countedNumber } from "./service-wire.js";

/**
 * models-wire.ts -- the models a coding agent may run on, and the account's default among them, as the desktop reads and writes them.
 *
 * `GET /api/models` answers the service's filtered read of AI Gateway's
 * public catalog: each model's catalog id, its name, which of the two
 * providers runs it, the efforts it lists, and its two context windows
 * where it offers a choice of them, in the catalog's order. The Start menu
 * and Settings › Coding agents both draw it, and every model row carries
 * its provider's mark, so the provider travels as a word of this wire's own
 * rather than being read off the id.
 *
 * The account's default is the `codingAgent` part of the preferences
 * snapshot at `/api/account/preferences`: one model, one effort, and the
 * standard context window where it was chosen, read beside the settings
 * preferences the desktop syncs through its own client and written on its
 * own, as a body carrying that part alone. A Start that names a model
 * writes the same value on the service, so the menu's last choice and the
 * default are one value.
 *
 * A choice without a context window runs on the model's whole window, the
 * long one, which is what every agent ran on before the choice, so a
 * desktop that predates it names nothing new; the smaller standard window
 * is the one a choice opts into, and a desktop that has it names the
 * window only then, so a service that predates it, which refuses a key it
 * does not know, is sent none for the default.
 */

/** What a first-time account starts an agent on, until it chooses. */
export const CODING_AGENT_DEFAULT_CHOICE = {
  model: "anthropic/claude-opus-5.5",
  effort: "high",
} as const;

/** The providers whose models Luke runs coding agents on, as the catalog prefixes their ids. */
export const MODEL_PROVIDER = {
  ANTHROPIC: "anthropic",
  OPENAI: "openai",
} as const;

export type ModelProvider = (typeof MODEL_PROVIDER)[keyof typeof MODEL_PROVIDER];

/** A model provider as the wire spells it. */
export const modelProviderSchema = EffectSchema.Literals(Object.values(MODEL_PROVIDER));

/** A model id or an effort as the wire carries it, bounded as a Start bounds them. */
const choiceText = EffectSchema.Trim.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(CODING_AGENT_BOUNDS.MAX_CHOICE_CHARS),
);

/**
 * A model's two context windows, where it offers a choice of them: each
 * one's size in tokens, and what a request past the standard window costs
 * as a multiple of the standard price, input and output each, where the
 * catalog prices it.
 */
const contextWindowsSchema = EffectSchema.Struct({
  standardTokens: countedNumber,
  longTokens: countedNumber,
  longInputPriceFactor: EffectSchema.optionalKey(countedNumber),
  longOutputPriceFactor: EffectSchema.optionalKey(countedNumber),
});

export type ContextWindows = typeof contextWindowsSchema.Type;

/** One model the service offers: its catalog id, its name, its provider, the efforts it lists, its two windows where it offers them, and why its fast version is withheld where it is. */
export const catalogModelSchema = EffectSchema.Struct({
  /** AI Gateway's catalog id, such as `anthropic/claude-opus-5.5`. */
  id: choiceText,
  name: EffectSchema.String,
  provider: EffectSchema.Literals(Object.values(MODEL_PROVIDER)),
  /** The efforts the model lists, in the catalog's order; never empty. */
  efforts: EffectSchema.Array(choiceText).check(EffectSchema.isMinLength(1)),
  /** Absent for a model with one window, which every choice of it runs on. */
  contextWindows: EffectSchema.optionalKey(contextWindowsSchema),
  /**
   * Whether this model's fast version is withheld because Anthropic said the
   * organization of the key the account's agents run on was never granted
   * fast mode; absent otherwise, and from a service older than it. Note
   * that it is a key of its own, because a desktop that refuses a value it
   * does not know reads a key it does not know as nothing at all.
   */
  fastNotEnabled: EffectSchema.optionalKey(EffectSchema.Boolean),
  /**
   * Whether this model's fast version is withheld because the plan that pays
   * for the account's agents on it runs no fast mode (the ChatGPT plan, on
   * Codex), so no Fast is drawn for it; absent otherwise.
   */
  fastWithheldByPlan: EffectSchema.optionalKey(EffectSchema.Boolean),
  /**
   * Whether no subscription or API key of the account's pays for this
   * model's provider, so a Start on it is refused until one is connected in
   * Settings › Agents; the menus draw it disabled. Absent otherwise, and
   * from a service older than it.
   */
  credentialMissing: EffectSchema.optionalKey(EffectSchema.Boolean),
});

export type CatalogModel = typeof catalogModelSchema.Type;

/** The models the service offers (GET). */
export const modelsAnswerSchema = EffectSchema.Struct({
  models: EffectSchema.Array(catalogModelSchema),
});

/** A model, an effort, and the context window where it is not the default long one, as a Start names them and the account's default stores them. */
export const modelChoiceSchema = EffectSchema.Struct({
  model: choiceText,
  effort: choiceText,
  contextWindow: EffectSchema.optionalKey(contextWindowSchema),
});

export type ModelChoice = typeof modelChoiceSchema.Type;

/** The coding-agent part written on its own (PUT): the body carries nothing else, so the settings preferences stand as they were. */
export const codingAgentDefaultWriteSchema = EffectSchema.Struct({
  codingAgent: modelChoiceSchema,
});
