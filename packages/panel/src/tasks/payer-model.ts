import { CODING_AGENT_PAYER, type CodingAgentPayer } from "@luke/features/coding-agent-wire";
import { MODEL_PROVIDER } from "@luke/features/models-wire";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  type ProviderKeysAnswer,
} from "@luke/features/provider-key-wire";
import { isFastModelId, providerOf } from "./coding-agent-model.js";

/**
 * payer-model.ts -- who may pay for one agent a Start is about to make, as the draft's payer field offers it.
 *
 * Start shows the payer only where the account could run the agent on its
 * plan: in the native-agents cohort, with a Claude plan connected, on a
 * Claude model Claude Code runs (no fast version). Then it offers the plan,
 * which runs the agent on Claude Code, and eve's payer, which runs it as
 * today: the account's own Anthropic API key where it saved one, named "API
 * key", and Luke's key where it did not, named "Luke". The pick it starts on
 * is the account's default, "Use my Claude plan for coding agents" from
 * Settings. Anywhere else nothing is offered and the Start names no payer,
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
  [CODING_AGENT_PAYER.API_KEY]: "API key",
  [CODING_AGENT_PAYER.LUKE]: "Luke",
} as const;

/** The payers offered for an agent on `model`, or none where the field is not drawn, as above. */
export function payerOffer(
  inCohort: boolean,
  keys: ProviderKeysAnswer | undefined,
  model: string | undefined,
): PayerOffer | undefined {
  if (!inCohort || keys === undefined || model === undefined) return undefined;
  if (providerOf(model) !== MODEL_PROVIDER.ANTHROPIC || isFastModelId(model)) return undefined;
  const plan = keys.subscriptions?.find(
    (one) =>
      one.kind === PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN &&
      one.provider === PROVIDER_KEY_PROVIDER.ANTHROPIC,
  );
  if (plan === undefined) return undefined;
  const ownKey = keys.keys.some((key) => key.provider === PROVIDER_KEY_PROVIDER.ANTHROPIC);
  const eve = ownKey ? CODING_AGENT_PAYER.API_KEY : CODING_AGENT_PAYER.LUKE;
  return {
    options: [
      {
        payer: CODING_AGENT_PAYER.CLAUDE_SUBSCRIPTION,
        label: PAYER_WORDS[CODING_AGENT_PAYER.CLAUDE_SUBSCRIPTION],
      },
      { payer: eve, label: PAYER_WORDS[eve] },
    ],
    // Note that a service before the default names none, which reads as on.
    fallback: plan.forAgents === false ? eve : CODING_AGENT_PAYER.CLAUDE_SUBSCRIPTION,
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
