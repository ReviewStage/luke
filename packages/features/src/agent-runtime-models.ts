/**
 * agent-runtime-models.ts -- the models, fast versions, and context windows a coding agent may move to, by the runtime it runs on: the one rule the model chip, `list_models`, `update_agent`, and the agent's PATCH all read.
 *
 * An agent on eve may move to any model the catalog offers its account, a
 * fast version or the standard window among them. An agent on a provider's
 * own harness runs that provider's models alone, through the harness's own
 * CLI, and no choice of context window, since the CLI manages its context
 * itself: Claude Code takes Claude models, a fast version among them, which
 * it runs as the base model with its own fast mode on; Codex takes GPT
 * models, a fast version among them where the account's ChatGPT plan or
 * OpenAI API key pays, which it runs as the base model on its `fast` service
 * tier, and an Ultrafast version only where its OpenAI API key pays, on its
 * `ultrafast` tier, since OpenAI offers Ultrafast on few plans; on a Mac's
 * own sign-in, whatever it is signed in with, it runs neither. A runtime's
 * rule is one row of `NATIVE_MODEL_RULE`, Codex's on the plan
 * (`CODEX_FAST`) and on an API key (`CODEX_ON_API_KEY`) its own; a runtime
 * with no row is eve's, which offers everything.
 * Start is not narrowed here: it offers every model, and what it starts on
 * decides the runtime (`agent-runtime-choice.ts`). eve runs no new agent,
 * and its rule is left offering everything, Ultrafast versions among them.
 */

import { AGENT_PAYER, AGENT_RUNTIME, type AgentPayer, type AgentRuntime } from "./agent-wire.js";
import { MODEL_PROVIDER, MODEL_SPEED, type ModelProvider, modelSpeedOf } from "./models-wire.js";

/** What a runtime lets an agent move to. */
export interface RuntimeModelRule {
  /** The one provider whose models it runs; none for any. */
  readonly provider: ModelProvider | undefined;
  /** Whether it runs a model's fast version. */
  readonly fast: boolean;
  /** Whether it runs a model's Ultrafast version. */
  readonly ultrafast: boolean;
  /** Whether it takes a choice of context window. */
  readonly contextWindow: boolean;
  /** How a refusal names it. */
  readonly name: string;
  /** What a refusal of a fast version says of it, where a fast version runs on another payer of the same runtime. */
  readonly fastRefusal?: string;
  /** What a refusal of an Ultrafast version says of it, where one runs on another payer of the same runtime. */
  readonly ultrafastRefusal?: string;
}

/** eve's rule: everything the catalog offers. */
const ANY_MODEL: RuntimeModelRule = {
  provider: undefined,
  fast: true,
  ultrafast: true,
  contextWindow: true,
  name: "eve",
};

/** The native harnesses' rules. */
const NATIVE_MODEL_RULE: Partial<Record<AgentRuntime, RuntimeModelRule>> = {
  claude_code: {
    provider: MODEL_PROVIDER.ANTHROPIC,
    fast: true,
    ultrafast: false,
    contextWindow: false,
    name: "Claude",
  },
  codex: {
    provider: MODEL_PROVIDER.OPENAI,
    fast: false,
    ultrafast: false,
    contextWindow: false,
    name: "Codex",
    fastRefusal: "which runs a fast version on the ChatGPT plan or an OpenAI API key alone",
    ultrafastRefusal: "which runs an Ultrafast version on an OpenAI API key alone",
  },
};

/** Codex where the account's ChatGPT plan pays: a GPT model's fast version runs on its `fast` service tier, and no Ultrafast version. */
const CODEX_FAST: RuntimeModelRule = {
  provider: MODEL_PROVIDER.OPENAI,
  fast: true,
  ultrafast: false,
  contextWindow: false,
  name: "Codex",
  ultrafastRefusal: "which runs an Ultrafast version on an OpenAI API key alone",
};

/** Codex where the account's OpenAI API key pays: a GPT model's fast version runs on its `fast` service tier, and its Ultrafast version on its `ultrafast` one. */
const CODEX_ON_API_KEY: RuntimeModelRule = {
  provider: MODEL_PROVIDER.OPENAI,
  fast: true,
  ultrafast: true,
  contextWindow: false,
  name: "Codex",
};

/** The harness Settings › Agents names the row of the provider's credentials by: Claude for Anthropic's, Codex for OpenAI's. */
export function harnessNameOf(provider: ModelProvider): string {
  return provider === MODEL_PROVIDER.ANTHROPIC
    ? (NATIVE_MODEL_RULE.claude_code?.name ?? "Claude")
    : (NATIVE_MODEL_RULE.codex?.name ?? "Codex");
}

/** What separates a catalog id's provider from its model. */
const CATALOG_ID_SEPARATOR = "/";

/** Why a change was refused for the runtime the agent runs on. */
const RUNTIME_CHOICE_REFUSAL = {
  PROVIDER: "provider",
  FAST: "fast",
  ULTRAFAST: "ultrafast",
  CONTEXT_WINDOW: "context_window",
} as const;

export type RuntimeChoiceRefusal =
  (typeof RUNTIME_CHOICE_REFUSAL)[keyof typeof RUNTIME_CHOICE_REFUSAL];

/** The rule of the runtime and payer given; eve's for no runtime, an agent from before the column. */
export function runtimeModelRule(
  runtime: AgentRuntime | undefined,
  payer?: AgentPayer | null | undefined,
): RuntimeModelRule {
  if (runtime === AGENT_RUNTIME.CODEX && payer === AGENT_PAYER.API_KEY) return CODEX_ON_API_KEY;
  if (runtime === AGENT_RUNTIME.CODEX && payer === AGENT_PAYER.CHATGPT_SUBSCRIPTION) {
    return CODEX_FAST;
  }
  return (runtime === undefined ? undefined : NATIVE_MODEL_RULE[runtime]) ?? ANY_MODEL;
}

/** The provider word a catalog id begins with: `anthropic` of `anthropic/claude-opus-5.5`. */
function providerWord(modelId: string): string {
  const separator = modelId.indexOf(CATALOG_ID_SEPARATOR);
  return separator === -1 ? "" : modelId.slice(0, separator);
}

/** Whether the rule runs the version of its model a catalog id names, by its speed. */
function runsSpeedOf(rule: RuntimeModelRule, modelId: string): boolean {
  const speed = modelSpeedOf(modelId);
  if (speed === MODEL_SPEED.FAST) return rule.fast;
  if (speed === MODEL_SPEED.ULTRAFAST) return rule.ultrafast;
  return true;
}

/**
 * The models an agent on the runtime may move to, of those offered: its
 * provider's alone, no fast or Ultrafast version where it runs none, and no context
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
>(
  models: readonly M[],
  runtime: AgentRuntime | undefined,
  payer?: AgentPayer | null | undefined,
): readonly M[] {
  const rule = runtimeModelRule(runtime, payer);
  if (rule === ANY_MODEL) return models;
  return models
    .filter((model) => rule.provider === undefined || model.provider === rule.provider)
    .filter((model) => runsSpeedOf(rule, model.id))
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
 * takes it: another provider's model, a fast or Ultrafast version, or a context window
 * named at all, the long one included, since the harness takes no choice.
 */
export function runtimeChoiceRefusal(
  runtime: AgentRuntime | undefined,
  choice: { readonly model: string; readonly contextWindow?: string | undefined },
  payer?: AgentPayer | null | undefined,
): RuntimeChoiceRefusal | undefined {
  const rule = runtimeModelRule(runtime, payer);
  if (rule.provider !== undefined && providerWord(choice.model) !== rule.provider) {
    return RUNTIME_CHOICE_REFUSAL.PROVIDER;
  }
  if (!runsSpeedOf(rule, choice.model)) {
    return modelSpeedOf(choice.model) === MODEL_SPEED.ULTRAFAST
      ? RUNTIME_CHOICE_REFUSAL.ULTRAFAST
      : RUNTIME_CHOICE_REFUSAL.FAST;
  }
  if (!rule.contextWindow && choice.contextWindow !== undefined) {
    return RUNTIME_CHOICE_REFUSAL.CONTEXT_WINDOW;
  }
  return undefined;
}

/** A runtime's refusal in words a model or a member acts on. */
export function runtimeChoiceRefusalWords(
  runtime: AgentRuntime | undefined,
  refusal: RuntimeChoiceRefusal,
): string {
  const rule = runtimeModelRule(runtime);
  switch (refusal) {
    case RUNTIME_CHOICE_REFUSAL.PROVIDER:
      return `that agent runs on ${rule.name}, which runs ${providerName(rule.provider)} models alone; choose one of those, or start a new agent on another model.`;
    case RUNTIME_CHOICE_REFUSAL.FAST:
      return `that agent runs on ${rule.name}, ${rule.fastRefusal ?? "which runs no fast version of a model"}; choose the model itself.`;
    case RUNTIME_CHOICE_REFUSAL.ULTRAFAST:
      return `that agent runs on ${rule.name}, ${rule.ultrafastRefusal ?? "which runs no Ultrafast version of a model"}; choose the model itself.`;
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
