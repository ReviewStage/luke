// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { Plan } from "@luke/features/plan-wire";
import { TRANSCRIPT_REGION } from "@luke/voice/transcript-model";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, test } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { markdownHtmlParserLanded } from "#testing/markdown";
import { plansControl, UNPINNED_SUMMARY } from "#testing/plans-control";
import { fixtureChat } from "../planning/chat-fixture";
import { DOCUMENT_REGION, PLANS_PAGE } from "../planning/planning-model";
import { MAIN_TAB } from "../planning/use-main-tabs";
import { NO_LOOKS } from "../planning/use-plan-looks";
import { SIDE_PANEL_TAB } from "../planning/use-side-panel";
import "../file-tree/index";
import { DesktopPlans } from "./desktop-plans";

const PLAN: Plan = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  workspaceId: "workspace-personal",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: null,
  document: { body: "", assumptions: [] },
};

// A reply is drawn once the parser has landed, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

test("the Call tab draws each call's spoken lines as the developer's bubbles and Luke's messages, left out of the screen recording", () => {
  const markup = renderToStaticMarkup(
    createElement(DesktopPlans, {
      summary: UNPINNED_SUMMARY,
      looks: NO_LOOKS,
      plans: plansControl({
        page: PLANS_PAGE.DOCUMENT,
        activePlanId: PLAN.id,
        region: { kind: DOCUMENT_REGION.READY, plan: PLAN },
        sidePanel: { ...plansControl().sidePanel, open: true, tab: SIDE_PANEL_TAB.CALL },
        transcript: {
          region: {
            kind: TRANSCRIPT_REGION.READY,
            earlierOmitted: false,
            calls: [
              {
                key: "call-1",
                startedAt: 1_000,
                live: true,
                lukeEnded: false,
                messages: [
                  {
                    id: "0",
                    role: "user",
                    parts: [{ type: "text", text: "Invites should expire." }],
                  },
                  {
                    id: "1",
                    role: "assistant",
                    parts: [{ type: "text", text: "After how many days?" }],
                  },
                ],
              },
            ],
          },
          onRetry: () => undefined,
        },
      }),
    }),
  );

  const page = document.createElement("div");
  page.innerHTML = markup;
  const call = page.querySelector('section.plan-call.ph-no-capture[aria-label="Call"]');
  assert.ok(call, "the Call tab, left out of the recording");
  // The developer's line a bubble of their own, Luke's an assistant's message, as an agent's tab draws them.
  assert.deepEqual(
    [...call.querySelectorAll(".is-user, .is-assistant")].map((message) => [
      message.classList.contains("is-user") ? "user" : "assistant",
      message.querySelector("p")?.textContent,
    ]),
    [
      ["user", "Invites should expire."],
      ["assistant", "After how many days?"],
    ],
  );
  assert.match(call.textContent ?? "", /Live/u);
});

/** The plan's column on its Chat tab over the fixture's chat, its plan channel this plan's where `ownChannel`. */
function chatTabMounted(ownChannel: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  const staged = fixtureChat({ fixtureMode: true }, 0);
  assert.ok(staged);
  const chat = {
    ...staged,
    answer: {
      ...staged.answer,
      channels: staged.answer.channels.map((channel) =>
        ownChannel && channel.name === "teammate-invitations"
          ? { ...channel, planId: PLAN.id }
          : channel,
      ),
    },
  };
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(DesktopPlans, {
          summary: UNPINNED_SUMMARY,
          looks: NO_LOOKS,
          captions: undefined,
          plans: plansControl({
            page: PLANS_PAGE.DOCUMENT,
            activePlanId: PLAN.id,
            region: { kind: DOCUMENT_REGION.READY, plan: PLAN },
            mainTabs: {
              ...plansControl().mainTabs,
              tabs: [MAIN_TAB.PLAN, MAIN_TAB.CHAT],
              tab: MAIN_TAB.CHAT,
            },
            chatView: { ...plansControl().chatView, available: true, chat },
          }),
        }),
      ),
    ),
  );
  return { container, root };
}

test("a plan's Chat tab shows the plan's own channel at reading size, its composer posting there, and says so where the plan has no channel yet", () => {
  const own = chatTabMounted(true);
  const tab = own.container.querySelector('section.desktop-plan-chat[aria-label="Chat"]');
  assert.ok(tab, "the plan's Chat tab");
  assert.equal(tab.querySelector(".chat-head-title")?.textContent, "# teammate-invitations");
  assert.ok(tab.querySelector('textarea[aria-label="Message #teammate-invitations"]'));
  assert.equal(tab.querySelectorAll(".chat-messages > .chat-message").length, 6);
  act(() => own.root.unmount());
  own.container.remove();

  const none = chatTabMounted(false);
  assert.match(
    none.container.querySelector("section.desktop-plan-chat")?.textContent ?? "",
    /Nothing is posted in this plan's channel yet\./u,
  );
  act(() => none.root.unmount());
  none.container.remove();
});
