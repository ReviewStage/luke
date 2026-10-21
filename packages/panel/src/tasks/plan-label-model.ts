import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_STATUS,
  type ProviderKeysAnswer,
} from "@luke/features/provider-key-wire";
import { dayAndTimeText } from "./task-time.js";

/**
 * plan-label-model.ts -- what stands by the composer of an agent its starter's ChatGPT plan pays for, as OpenAI's guidelines ask.
 *
 * OpenAI's UI guidelines for ChatGPT plan usage
 * (developers.openai.com/siwc/ui-ux-guidelines) ask for "Using ChatGPT
 * plan" near the composer with a Manage usage link to ChatGPT's usage
 * settings, and on a reached limit for Manage usage as the first action.
 * So a Codex agent's composer always says which plan pays and links there;
 * where the plan cannot serve, it says why in place of "Using ChatGPT plan"
 * and the agent waits, never moving to another payer. The plan's status is
 * the starter's alone, so it is read only for the starter, and anyone else
 * sees the plain label.
 */

/** Where OpenAI's guidelines send Manage usage: ChatGPT's own usage settings. */
export const CHATGPT_USAGE_URL = "https://chatgpt.com/settings/usage";

export const PLAN_LABEL_WORDS = {
  USING: "Using ChatGPT plan",
  MANAGE: "Manage usage",
  LIMIT_REACHED: "Usage limit reached",
  SIGNED_OUT: "ChatGPT signed out. Reconnect in Settings",
  INELIGIBLE: "This ChatGPT account isn't eligible for Codex",
  UNREADABLE: "Your ChatGPT sign-in can't be read. Reconnect in Settings",
} as const;

/** What the label says: its words, and whether they ask for attention. */
export interface PlanLabel {
  readonly words: string;
  readonly attention: boolean;
}

/** The label for a Codex agent, by its ChatGPT sign-in as the starter's keys hold it; the plain label where none is read. */
export function chatGptPlanLabel(keys: ProviderKeysAnswer | undefined): PlanLabel {
  const plan = keys?.subscriptions?.find((one) => one.kind === PROVIDER_KEY_KIND.CHATGPT_OAUTH);
  switch (plan?.status) {
    case PROVIDER_KEY_STATUS.LIMIT_REACHED:
      return {
        words:
          plan.limitResetsAt === undefined
            ? PLAN_LABEL_WORDS.LIMIT_REACHED
            : `${PLAN_LABEL_WORDS.LIMIT_REACHED} · Resets ${dayAndTimeText(plan.limitResetsAt)}`,
        attention: true,
      };
    case PROVIDER_KEY_STATUS.INVALID:
      return { words: PLAN_LABEL_WORDS.SIGNED_OUT, attention: true };
    case PROVIDER_KEY_STATUS.INELIGIBLE:
      return { words: PLAN_LABEL_WORDS.INELIGIBLE, attention: true };
    case PROVIDER_KEY_STATUS.UNREADABLE:
      return { words: PLAN_LABEL_WORDS.UNREADABLE, attention: true };
    default:
      return { words: PLAN_LABEL_WORDS.USING, attention: false };
  }
}
