import assert from "node:assert/strict";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
  type ProviderKeyStatus,
  type ProviderKeysAnswer,
} from "@luke/features/provider-key-wire";
import { test } from "vitest";
import { chatGptPlanLabel, claudePlanLabel } from "./plan-label-model.js";
import { dayAndTimeText } from "./task-time.js";

/**
 * What a Codex agent's composer says of the ChatGPT plan that pays for it:
 * "Using ChatGPT plan" while the plan serves, and why it cannot where it
 * does not, its reached limit's reset among it. Synthetic keys throughout.
 */

/** The time each label is read at: before every reset the tests name. */
const NOW = Date.UTC(2026, 9, 21, 12);

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
  assert.deepEqual(chatGptPlanLabel(keysWith(PROVIDER_KEY_STATUS.VERIFIED), NOW), plain);
  assert.deepEqual(chatGptPlanLabel(keysWith(PROVIDER_KEY_STATUS.UNVERIFIED), NOW), plain);
  assert.deepEqual(chatGptPlanLabel(undefined, NOW), plain);
});

test("a plan that can't serve says why, a reached limit with its reset where OpenAI named one", () => {
  const resetsAt = Date.UTC(2026, 9, 22, 9);
  assert.deepEqual(
    [
      chatGptPlanLabel(keysWith(PROVIDER_KEY_STATUS.LIMIT_REACHED, resetsAt), NOW),
      chatGptPlanLabel(keysWith(PROVIDER_KEY_STATUS.LIMIT_REACHED), NOW),
      chatGptPlanLabel(keysWith(PROVIDER_KEY_STATUS.INVALID), NOW),
      chatGptPlanLabel(keysWith(PROVIDER_KEY_STATUS.INELIGIBLE), NOW),
    ],
    [
      { words: `Usage limit reached · Resets ${dayAndTimeText(resetsAt)}`, attention: true },
      { words: "Usage limit reached", attention: true },
      { words: "ChatGPT signed out. Reconnect in Settings", attention: true },
      { words: "This ChatGPT account isn't eligible for Codex", attention: true },
    ],
  );
});

/** The account's keys holding its Claude setup-token as given. */
const claudeKeysWith = (status: ProviderKeyStatus, limitResetsAt?: number): ProviderKeysAnswer => ({
  keys: [],
  subscriptions: [
    {
      provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
      kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
      hint: "sk-ant-oat01…fake",
      addedAt: 0,
      status,
      statusAt: 0,
      ...(limitResetsAt === undefined ? {} : { limitResetsAt }),
    },
  ],
});

test("a Claude Code agent's label says the Claude plan pays, and its status wherever the plan is not verified", () => {
  const resetsAt = Date.UTC(2026, 9, 21, 15, 40);
  assert.deepEqual(
    [
      claudePlanLabel(claudeKeysWith(PROVIDER_KEY_STATUS.VERIFIED), NOW),
      claudePlanLabel(undefined, NOW),
      claudePlanLabel(claudeKeysWith(PROVIDER_KEY_STATUS.UNVERIFIED), NOW),
      claudePlanLabel(claudeKeysWith(PROVIDER_KEY_STATUS.LIMIT_REACHED, resetsAt), NOW),
      claudePlanLabel(claudeKeysWith(PROVIDER_KEY_STATUS.LIMIT_REACHED), NOW),
      claudePlanLabel(claudeKeysWith(PROVIDER_KEY_STATUS.INVALID), NOW),
      claudePlanLabel({ keys: [] }, NOW),
    ],
    [
      { words: "Using your Claude plan", attention: false },
      { words: "Using your Claude plan", attention: false },
      { words: "Using your Claude plan", attention: false },
      {
        words: `Claude plan limit reached · Resets ${dayAndTimeText(resetsAt)}`,
        attention: true,
      },
      { words: "Claude plan limit reached", attention: true },
      { words: "Claude plan needs reconnecting in Settings", attention: true },
      { words: "Claude plan needs reconnecting in Settings", attention: true },
    ],
  );
});

test("a reached limit whose reset has passed reads as the plan serving again, for either harness", () => {
  const resetsAt = Date.UTC(2026, 9, 21, 15, 40);
  const after = resetsAt + 60_000;
  assert.deepEqual(
    [
      chatGptPlanLabel(keysWith(PROVIDER_KEY_STATUS.LIMIT_REACHED, resetsAt), after),
      claudePlanLabel(claudeKeysWith(PROVIDER_KEY_STATUS.LIMIT_REACHED, resetsAt), after),
      chatGptPlanLabel(keysWith(PROVIDER_KEY_STATUS.LIMIT_REACHED), after),
    ],
    [
      { words: "Using ChatGPT plan", attention: false },
      { words: "Using your Claude plan", attention: false },
      // A limit with no reset named stands until a turn finds it lifted.
      { words: "Usage limit reached", attention: true },
    ],
  );
});
