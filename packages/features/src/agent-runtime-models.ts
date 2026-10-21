/**
 * agent-runtime-models.ts -- the models, fast versions, and context windows a coding agent may move to, by the runtime it runs on: the one rule the model chip, `list_models`, `update_agent`, and the agent's PATCH all read.
 *
 * An agent on eve may move to any model the catalog offers its account, a
 * fast version or the standard window among them. An agent on a provider's
 * own harness runs that provider's models alone, through the harness's own
 * CLI, and no choice of context window, since the CLI manages its context
 * itself: Claude Code takes Claude models, a fast version among them, which
 * it runs as the base model with its own fast mode on; Codex takes GPT
 * models, never a fast version, since it has no fast mode. A runtime's rule is one row of
 * `NATIVE_MODEL_RULE`; a runtime with no row is eve's, which offers everything.
 * Start is not narrowed here: it offers every model, and what it starts on
 * decides the runtime (`agent-runtime-choice.ts`).
 */

import type { CodingAgentRuntime } from "./coding-agent-wire.js";
import { MODEL_PROVIDER, type ModelProvider } from "./models-wire.js";

/** What a runtime lets an agent move to. */
export interface RuntimeModelRule {
  /** The one provider whose models it runs; none for any. */
  readonly provider: ModelProvider | undefined;
  /** Whether it runs a model's fast version. */
  readonly fast: boolean;
  /** Whether it takes a choice of context window. */
  readonly contextWindow: boolean;
  /** How a refusal names it. */
  readonly name: string;
}

/** eve's rule: everything the catalog offers. */
const ANY_MODEL: RuntimeModelRule = {
  provider: undefined,
  fast: true,
  contextWindow: true,
  name: "eve",
};

/** The native harnesses' rules. */
const NATIVE_MODEL_RULE: Partial<Record<CodingAgentRuntime, RuntimeModelRule>> = {
  claude_code: {
    provider: MODEL_PROVIDER.ANTHROPIC,
    fast: true,
    contextWindow: false,
    name: "Claude Code",
  },
  codex: {
    provider: MODEL_PROVIDER.OPENAI,
    fast: false,
    contextWindow: false,
    name: "Codex",
  },
};

/** The suffix AI Gateway gives a model's fast version's id: `anthropic/claude-opus-5.5-fast`. */
const FAST_ID_SUFFIX = "-fast";

/** What separates a catalog id's provider from its model. */
const CATALOG_ID_SEPARATOR = "/";

/** Why a change was refused for the runtime the agent runs on. */
const RUNTIME_CHOICE_REFUSAL = {
  PROVIDER: "provider",
  FAST: "fast",
  CONTEXT_WINDOW: "context_window",
} as const;

export type RuntimeChoiceRefusal =
  (typeof RUNTIME_CHOICE_REFUSAL)[keyof typeof RUNTIME_CHOICE_REFUSAL];

/** The rule of the runtime given; eve's for none, an agent from before the column. */
export function runtimeModelRule(runtime: CodingAgentRuntime | undefined): RuntimeModelRule {
  return (runtime === undefined ? undefined : NATIVE_MODEL_RULE[runtime]) ?? ANY_MODEL;
}

/** The provider word a catalog id begins with: `anthropic` of `anthropic/claude-opus-5.5`. */
function providerWord(modelId: string): string {
  const separator = modelId.indexOf(CATALOG_ID_SEPARATOR);
  return separator === -1 ? "" : modelId.slice(0, separator);
}

/** Whether a catalog id names a model's fast version. */
function isFastId(modelId: string): boolean {
  return modelId.endsWith(FAST_ID_SUFFIX);
}

/**
 * The models an agent on the runtime may move to, of those offered: its
 * provider's alone, no fast version where it runs none, and no context
 * windows where it takes no choice of them, so a menu drawn from the list
 * offers neither. eve's list is the one given, untouched.
 */
export function runtimeModels<
  M extends {
    readonly id: string;
    readonly provider: string;
    readonly contextWindows?: unknown;
    readonly fastNotEnabled?: boolean;
  },
>(models: readonly M[], runtime: CodingAgentRuntime | undefined): readonly M[] {
  const rule = runtimeModelRule(runtime);
  if (rule === ANY_MODEL) return models;
  return models
    .filter((model) => rule.provider === undefined || model.provider === rule.provider)
    .filter((model) => rule.fast || !isFastId(model.id))
    .map((model) => {
      const { contextWindows: _windows, fastNotEnabled: _fast, ...rest } = model;
      const kept = {
        ...rest,
        ...(rule.contextWindow && model.contextWindows !== undefined
          ? { contextWindows: model.contextWindows }
          : undefined),
        ...(rule.fast && model.fastNotEnabled !== undefined
          ? { fastNotEnabled: model.fastNotEnabled }
          : undefined),
      };
      // SAFETY: only the two optional keys are left out, which `M` holds as optional.
      return kept as unknown as M;
    });
}

/**
 * Why the runtime refuses a change to the choice given, or nothing where it
 * takes it: another provider's model, a fast version, or a context window
 * named at all, the long one included, since the harness takes no choice.
 */
export function runtimeChoiceRefusal(
  runtime: CodingAgentRuntime | undefined,
  choice: { readonly model: string; readonly contextWindow?: string | undefined },
): RuntimeChoiceRefusal | undefined {
  const rule = runtimeModelRule(runtime);
  if (rule.provider !== undefined && providerWord(choice.model) !== rule.provider) {
    return RUNTIME_CHOICE_REFUSAL.PROVIDER;
  }
  if (!rule.fast && isFastId(choice.model)) return RUNTIME_CHOICE_REFUSAL.FAST;
  if (!rule.contextWindow && choice.contextWindow !== undefined) {
    return RUNTIME_CHOICE_REFUSAL.CONTEXT_WINDOW;
  }
  return undefined;
}

/** A runtime's refusal in words a model or a member acts on. */
export function runtimeChoiceRefusalWords(
  runtime: CodingAgentRuntime | undefined,
  refusal: RuntimeChoiceRefusal,
): string {
  const rule = runtimeModelRule(runtime);
  switch (refusal) {
    case RUNTIME_CHOICE_REFUSAL.PROVIDER:
      return `that agent runs on ${rule.name}, which runs ${providerName(rule.provider)} models alone; choose one of those, or start a new agent on another model.`;
    case RUNTIME_CHOICE_REFUSAL.FAST:
      return `that agent runs on ${rule.name}, which runs no fast version of a model; choose the model itself.`;
    case RUNTIME_CHOICE_REFUSAL.CONTEXT_WINDOW:
      return `that agent runs on ${rule.name}, which manages its own context; leave contextWindow out.`;
  }
}

/** A provider as a refusal names its models. */
function providerName(provider: ModelProvider | undefined): string {
  if (provider === MODEL_PROVIDER.ANTHROPIC) return "Claude";
  if (provider === MODEL_PROVIDER.OPENAI) return "GPT";
  return "its provider's";
}
