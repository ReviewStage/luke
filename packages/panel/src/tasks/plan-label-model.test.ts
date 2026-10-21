import assert from "node:assert/strict";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
  type ProviderKeyStatus,
  type ProviderKeysAnswer,
} from "@luke/features/provider-key-wire";
import { test } from "vitest";
import { chatGptPlanLabel } from "./plan-label-model.js";
import { dayAndTimeText } from "./task-time.js";

/**
 * What a Codex agent's composer says of the ChatGPT plan that pays for it:
 * "Using ChatGPT plan" while the plan serves, and why it cannot where it
 * does not, its reached limit's reset among it. Synthetic keys throughout.
 */

const keysWith = (status: ProviderKeyStatus, limitResetsAt?: number): ProviderKeysAnswer => ({
  keys: [],
  subscriptions: [
    {
      provider: PROVIDER_KEY_PROVIDER.OPENAI,
      kind: PROVIDER_KEY_KIND.CHATGPT_OAUTH,
      hint: "ChatGPT",
      addedAt: 0,
      status,
      statusAt: 0,
      ...(limitResetsAt === undefined ? {} : { limitResetsAt }),
    },
  ],
});

test("a plan that serves, one not yet answered, or one the reader can't read the status of says it is in use, plainly", () => {
  const plain = { words: "Using ChatGPT plan", attention: false };
  assert.deepEqual(chatGptPlanLabel(keysWith(PROVIDER_KEY_STATUS.VERIFIED)), plain);
  assert.deepEqual(chatGptPlanLabel(keysWith(PROVIDER_KEY_STATUS.UNVERIFIED)), plain);
  assert.deepEqual(chatGptPlanLabel(undefined), plain);
});

test("a plan that can't serve says why, a reached limit with its reset where OpenAI named one", () => {
  const resetsAt = Date.UTC(2026, 9, 22, 9);
  assert.deepEqual(
    [
      chatGptPlanLabel(keysWith(PROVIDER_KEY_STATUS.LIMIT_REACHED, resetsAt)),
      chatGptPlanLabel(keysWith(PROVIDER_KEY_STATUS.LIMIT_REACHED)),
      chatGptPlanLabel(keysWith(PROVIDER_KEY_STATUS.INVALID)),
      chatGptPlanLabel(keysWith(PROVIDER_KEY_STATUS.INELIGIBLE)),
    ],
    [
      { words: `Usage limit reached · Resets ${dayAndTimeText(resetsAt)}`, attention: true },
      { words: "Usage limit reached", attention: true },
      { words: "ChatGPT signed out. Reconnect in Settings", attention: true },
      { words: "This ChatGPT account isn't eligible for Codex", attention: true },
    ],
  );
});
