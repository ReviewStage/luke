import { CODING_AGENT_PAYER, type CodingAgentPayer } from "@luke/features/coding-agent-wire";
import { MODEL_PROVIDER } from "@luke/features/models-wire";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_STATUS,
  type ProviderKeysAnswer,
} from "@luke/features/provider-key-wire";
import { isFastModelId, providerOf } from "./coding-agent-model.js";

/**
 * payer-model.ts -- who may pay for one agent a Start is about to make, as the draft's payer field offers it.
 *
 * Start shows the payer only where the account could run the agent on its
 * plan: in the native-agents cohort, on a model with no fast version, with
 * that model's provider's plan connected: a Claude plan for a Claude model,
 * which Claude Code runs, and a ChatGPT plan OpenAI has not signed out for a
 * GPT model, which Codex runs. Then it offers the plan, and eve's payer,
 * which runs it as today: the account's own API key for the model's
 * provider where it saved one, named "API key", and Luke's key where it did
 * not, named "Luke". The pick it starts on is the account's default, "Use
 * my Claude plan" or "Use my ChatGPT plan for coding agents" from Settings. Anywhere else nothing is offered and the Start names no payer,
 * as before. The service decides again on its own read
 * (`agent-runtime-choice.ts`), so this only draws.
 */

/** One payer the field offers, and its words. */
export interface PayerOption {
  readonly payer: CodingAgentPayer;
  readonly label: string;
}

/** What the field offers: the payers, and the one it stands on until the developer picks. */
export interface PayerOffer {
  readonly options: readonly PayerOption[];
  readonly fallback: CodingAgentPayer;
}

export const PAYER_WORDS = {
  FIELD: "Who pays",
  [CODING_AGENT_PAYER.CLAUDE_SUBSCRIPTION]: "Claude plan",
  [CODING_AGENT_PAYER.CHATGPT_SUBSCRIPTION]: "ChatGPT plan",
  [CODING_AGENT_PAYER.API_KEY]: "API key",
  [CODING_AGENT_PAYER.LUKE]: "Luke",
} as const;

/** Each provider's plan: the subscription it is kept as, and the payer it is recorded as. */
const PLAN_OF = {
  [MODEL_PROVIDER.ANTHROPIC]: {
    kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
    payer: CODING_AGENT_PAYER.CLAUDE_SUBSCRIPTION,
  },
  [MODEL_PROVIDER.OPENAI]: {
    kind: PROVIDER_KEY_KIND.CHATGPT_OAUTH,
    payer: CODING_AGENT_PAYER.CHATGPT_SUBSCRIPTION,
  },
} as const;

/** The statuses of a ChatGPT sign-in the service will not launch Codex on, as `agent-runtime-choice.ts` reads them. */
const UNUSABLE: ReadonlySet<string> = new Set([
  PROVIDER_KEY_STATUS.INVALID,
  PROVIDER_KEY_STATUS.INELIGIBLE,
  PROVIDER_KEY_STATUS.UNREADABLE,
]);

/** The payers offered for an agent on `model`, or none where the field is not drawn, as above. */
export function payerOffer(
  inCohort: boolean,
  keys: ProviderKeysAnswer | undefined,
  model: string | undefined,
): PayerOffer | undefined {
  if (!inCohort || keys === undefined || model === undefined) return undefined;
  if (isFastModelId(model)) return undefined;
  const provider = providerOf(model);
  if (provider === undefined) return undefined;
  const plan = PLAN_OF[provider];
  const stored = keys.subscriptions?.find(
    (one) => one.kind === plan.kind && one.provider === provider,
  );
  // Note that a ChatGPT sign-in OpenAI signed out or the service cannot read starts nothing on Codex.
  if (stored === undefined || UNUSABLE.has(stored.status)) return undefined;
  const ownKey = keys.keys.some((key) => key.provider === provider);
  const eve = ownKey ? CODING_AGENT_PAYER.API_KEY : CODING_AGENT_PAYER.LUKE;
  return {
    options: [
      { payer: plan.payer, label: PAYER_WORDS[plan.payer] },
      { payer: eve, label: PAYER_WORDS[eve] },
    ],
    // Note that a service before the default names none, which reads as on.
    fallback: stored.forAgents === false ? eve : plan.payer,
  };
}

/**
 * The payer a Start names: the one the developer picked where it is still
 * offered, since a change of model or key may have taken it away, and none
 * otherwise, so the service decides by the account's default.
 */
export function startPayer(
  offer: PayerOffer | undefined,
  picked: CodingAgentPayer | undefined,
): CodingAgentPayer | undefined {
  if (offer === undefined || picked === undefined) return undefined;
  return offer.options.some((option) => option.payer === picked) ? picked : undefined;
}
