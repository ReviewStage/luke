import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_STATUS,
  type ProviderKeysAnswer,
  planStanding,
} from "@luke/features/provider-key-wire";
import { dayAndTimeText } from "./task-time.js";

/**
 * plan-label-model.ts -- what stands by the composer of an agent its starter's plan pays for: "Using ChatGPT plan", as OpenAI's guidelines ask, or "Using your Claude plan".
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
 *
 * A Claude Code agent's composer says "Using your Claude plan" the same
 * way, or why the plan cannot serve: its limit reached with the reset
 * Claude Code named, or a setup-token that needs pasting again. A plan no
 * turn has run on yet reads as one that serves. Either label reads the plan
 * as it stands at `now` (`planStanding`), so a limit whose reset has passed
 * reads as serving again without waiting on a new read.
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

/** The label for a Codex agent, by its ChatGPT sign-in as the starter's keys hold it at `now`; the plain label where none is read. */
export function chatGptPlanLabel(keys: ProviderKeysAnswer | undefined, now: number): PlanLabel {
  const plan = keys?.subscriptions?.find((one) => one.kind === PROVIDER_KEY_KIND.CHATGPT_OAUTH);
  switch (plan === undefined ? undefined : planStanding(plan, now)) {
    case PROVIDER_KEY_STATUS.LIMIT_REACHED:
      return {
        words:
          plan?.limitResetsAt === undefined
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

const CLAUDE_PLAN_LABEL_WORDS = {
  USING: "Using your Claude plan",
  LIMIT_REACHED: "Claude plan limit reached",
  RECONNECT: "Claude plan needs reconnecting in Settings",
} as const;

/** The label for a Claude Code agent, by the setup-token as the starter's keys hold it at `now`; the plain label where none is read. */
export function claudePlanLabel(keys: ProviderKeysAnswer | undefined, now: number): PlanLabel {
  if (keys === undefined) return { words: CLAUDE_PLAN_LABEL_WORDS.USING, attention: false };
  const plan = keys.subscriptions?.find((one) => one.kind === PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN);
  // Note that a token removed since the agent started is one to paste again, as a refused one is.
  if (plan === undefined) return { words: CLAUDE_PLAN_LABEL_WORDS.RECONNECT, attention: true };
  switch (planStanding(plan, now)) {
    case PROVIDER_KEY_STATUS.LIMIT_REACHED:
      return {
        words:
          plan.limitResetsAt === undefined
            ? CLAUDE_PLAN_LABEL_WORDS.LIMIT_REACHED
            : `${CLAUDE_PLAN_LABEL_WORDS.LIMIT_REACHED} · Resets ${dayAndTimeText(plan.limitResetsAt)}`,
        attention: true,
      };
    case PROVIDER_KEY_STATUS.INVALID:
    case PROVIDER_KEY_STATUS.UNREADABLE:
      return { words: CLAUDE_PLAN_LABEL_WORDS.RECONNECT, attention: true };
    default:
      return { words: CLAUDE_PLAN_LABEL_WORDS.USING, attention: false };
  }
}
