// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
  type ProviderKeyStatus,
  type SubscriptionKeySummary,
} from "@luke/features/provider-key-wire";
import { ACT_KIND } from "@luke/host/acts";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { FAKE_ANSWER, fakeActs } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { handState } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { ChatGptPlanLabel, ClaudePlanLabel } from "./plan-label.js";

/**
 * The label under a Codex agent's box: "Using ChatGPT plan · Manage usage"
 * linking to ChatGPT's usage settings, the starter's plan's status in its
 * place where the plan can't serve, read again as the window comes back to
 * the front, and the plain label for a teammate, whose keys are never read.
 * Synthetic answers throughout.
 */

let status: ProviderKeyStatus = PROVIDER_KEY_STATUS.INVALID;
/** The plan the starter's keys hold. */
let plan: Pick<SubscriptionKeySummary, "provider" | "kind" | "hint"> = {
  provider: PROVIDER_KEY_PROVIDER.OPENAI,
  kind: PROVIDER_KEY_KIND.CHATGPT_OAUTH,
  hint: "ChatGPT",
};
let reads = 0;
const roots: Root[] = [];

beforeEach(() => {
  status = PROVIDER_KEY_STATUS.INVALID;
  plan = {
    provider: PROVIDER_KEY_PROVIDER.OPENAI,
    kind: PROVIDER_KEY_KIND.CHATGPT_OAUTH,
    hint: "ChatGPT",
  };
  reads = 0;
  fakeAppPlatform(QUIET_PANEL);
  fakeActs({
    act: (request) => {
      if (request.kind !== ACT_KIND.PROVIDER_KEYS_READ) {
        return Promise.resolve({ status: FAKE_ANSWER.UNKNOWN_ACT });
      }
      reads += 1;
      return Promise.resolve({
        status: FAKE_ANSWER.DONE,
        value: {
          keys: [],
          subscriptions: [
            {
              ...plan,
              addedAt: 0,
              status,
              statusAt: 0,
            },
          ],
        },
      });
    },
  });
  // Handed after the acts, whose bridge it joins rather than replaces.
  handState({}, { access: { admin: false, nativeAgents: true } });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

async function mount(
  starter: boolean,
  Label: typeof ChatGptPlanLabel = ChatGptPlanLabel,
): Promise<HTMLElement> {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(Label, { starter, status: CODING_AGENT_STATUS.COMPLETED }),
      ),
    ),
  );
  await settle();
  return container;
}

test("the starter sees why the plan can't serve, and the plan as it stands once the window comes back from a reconnect", async () => {
  const label = await mount(true);
  assert.equal(label.textContent, "ChatGPT signed out. Reconnect in Settings · Manage usage");

  status = PROVIDER_KEY_STATUS.VERIFIED;
  act(() => {
    window.dispatchEvent(new Event("focus"));
  });
  await settle();
  assert.equal(label.textContent, "Using ChatGPT plan · Manage usage");
  const link = label.querySelector("a") ?? assert.fail("no Manage usage link");
  assert.equal(link.getAttribute("href"), "https://chatgpt.com/settings/usage");
});

test("a teammate sees the plain label, and the starter's keys are never read", async () => {
  const label = await mount(false);
  assert.equal(label.textContent, "Using ChatGPT plan · Manage usage");
  assert.equal(reads, 0);
});

test('a Claude Code agent\'s starter sees "Using your Claude plan", or why it waits, and a teammate the plain label', async () => {
  plan = {
    provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
    kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
    hint: "sk-ant-oat01…fake",
  };
  const label = await mount(true, ClaudePlanLabel);
  assert.equal(label.textContent, "Claude plan needs reconnecting in Settings");
  assert.ok(label.querySelector('[role="status"]'), "a plan that can't serve is said as a status");

  status = PROVIDER_KEY_STATUS.VERIFIED;
  act(() => {
    window.dispatchEvent(new Event("focus"));
  });
  await settle();
  assert.equal(label.textContent, "Using your Claude plan");
  assert.equal(label.querySelector("a"), null);

  const teammate = await mount(false, ClaudePlanLabel);
  assert.equal(teammate.textContent, "Using your Claude plan");
});
