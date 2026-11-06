import { AGENT_PAYER, AGENT_RUNTIME, type AgentPayer, type AgentRuntime } from "./agent-wire.js";
import { MODEL_PROVIDER, MODEL_SPEED, type ModelProvider, modelSpeedOf } from "./models-wire.js";

export interface RuntimeModelRule {
  readonly provider: ModelProvider | undefined;
  readonly fast: boolean;
  readonly ultrafast: boolean;
  readonly contextWindow: boolean;
  readonly name: string;
  readonly fastRefusal?: string;
  readonly ultrafastRefusal?: string;
}

const ANY_MODEL: RuntimeModelRule = {
  provider: undefined,
  fast: true,
  ultrafast: true,
  contextWindow: true,
  name: "eve",
};

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

const CODEX_FAST: RuntimeModelRule = {
  provider: MODEL_PROVIDER.OPENAI,
  fast: true,
  ultrafast: false,
  contextWindow: false,
  name: "Codex",
  ultrafastRefusal: "which runs an Ultrafast version on an OpenAI API key alone",
};

const CODEX_ON_API_KEY: RuntimeModelRule = {
  provider: MODEL_PROVIDER.OPENAI,
  fast: true,
  ultrafast: true,
  contextWindow: false,
  name: "Codex",
};

export function harnessNameOf(provider: ModelProvider): string {
  return provider === MODEL_PROVIDER.ANTHROPIC
    ? (NATIVE_MODEL_RULE.claude_code?.name ?? "Claude")
    : (NATIVE_MODEL_RULE.codex?.name ?? "Codex");
}

const CATALOG_ID_SEPARATOR = "/";

const RUNTIME_CHOICE_REFUSAL = {
  PROVIDER: "provider",
  FAST: "fast",
  ULTRAFAST: "ultrafast",
  CONTEXT_WINDOW: "context_window",
} as const;

export type RuntimeChoiceRefusal =
  (typeof RUNTIME_CHOICE_REFUSAL)[keyof typeof RUNTIME_CHOICE_REFUSAL];

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

function providerWord(modelId: string): string {
  const separator = modelId.indexOf(CATALOG_ID_SEPARATOR);
  return separator === -1 ? "" : modelId.slice(0, separator);
}

function runsSpeedOf(rule: RuntimeModelRule, modelId: string): boolean {
  const speed = modelSpeedOf(modelId);
  if (speed === MODEL_SPEED.FAST) return rule.fast;
  if (speed === MODEL_SPEED.ULTRAFAST) return rule.ultrafast;
  return true;
}

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
      return kept as unknown as M;
    });
}

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

function providerName(provider: ModelProvider | undefined): string {
  if (provider === MODEL_PROVIDER.ANTHROPIC) return "Claude";
  if (provider === MODEL_PROVIDER.OPENAI) return "GPT";
  return "its provider's";
}
