// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS } from "@sidecar/credentials/snapshot";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, test } from "vitest";
import { UPDATE_STATUS } from "#shared/messages/update";
import { PanelBody } from "./panel-body";
import { PANEL_TAB, type PanelTab } from "./panel-tabs";
import { SESSION_SORT } from "./session-model";
import type { SettingsPanelProps } from "./settings/settings-panel";
import { CONVERSATION_PAGE, type ConversationPage } from "./subagents-panel";

type BodyProps = Parameters<typeof PanelBody>[0];

const NOW = Date.UTC(2026, 8, 16, 12, 0, 0);

const unused = (): Promise<never> => Promise.reject(new Error("Not pressed in this test."));

// SAFETY: the two tabs under test read nothing of the settings but the update
// snapshot, for the Settings tab's dot, and the Settings tab itself is never drawn here.
const SETTINGS = {
  updates: {
    update: {
      status: UPDATE_STATUS.IDLE,
      currentVersion: "0.0.0",
      installSupported: false,
      upToDate: false,
    },
    onCheck: () => Promise.resolve(),
    onInstall: () => undefined,
    onOpenLatest: () => undefined,
  },
  onQuit: () => undefined,
} as SettingsPanelProps;

function bodyProps(
  tab: PanelTab,
  conversationPage: ConversationPage,
  onConversationPageChange: (page: ConversationPage) => void,
): BodyProps {
  return {
    accountRequired: false,
    account: { status: ACCOUNT_STATUS.SIGNED_OUT },
    onBeginSignIn: () => undefined,
    providerConnect: { connected: false, onConnect: () => undefined },
    list: { sessions: [], total: 0, filters: [], groups: [] },
    sessionsSettled: true,
    view: { filters: [], sort: SESSION_SORT.URGENCY, query: "" },
    onViewChange: () => undefined,
    onFiltersChange: () => undefined,
    now: NOW,
    onOpenSession: () => undefined,
    onOpenSessionApplication: () => undefined,
    writes: { sendMessage: unused, runAction: unused, openChange: unused },
    conversation: { groups: [], settled: true },
    roster: [],
    onOpenChat: () => undefined,
    liveConversationEntries: [],
    onOfferRatingFeedback: () => undefined,
    spokenAskPending: false,
    onClearConversationConversation: () => undefined,
    conversationPage,
    onConversationPageChange,
    subagents: { settled: true, children: [] },
    onOpenSubagent: () => undefined,
    onFieldEngaged: () => undefined,
    offerOptions: false,
    optionsOpen: false,
    onOptionsToggle: () => undefined,
    offerSearch: false,
    searchOpen: false,
    onSearchToggle: () => undefined,
    onSearchClose: () => undefined,
    settingsSearchOpen: false,
    onSettingsSearchToggle: () => undefined,
    tab,
    onTabChange: () => undefined,
    settings: SETTINGS,
  };
}

function mount(props: BodyProps) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = (next: BodyProps) => {
    act(() => {
      root.render(createElement(PanelBody, next));
    });
  };
  render(props);
  return { container, render };
}

function subagentsButton(container: ParentNode): HTMLButtonElement | null {
  const button = container.querySelector(".conversation-subagents");
  return button instanceof HTMLButtonElement ? button : null;
}

afterEach(() => {
  document.body.innerHTML = "";
});

test("the Sub-agents button is offered on the Conversation tab, thread or not, and not on the Sessions tab", () => {
  const conversation = mount(bodyProps(PANEL_TAB.CONVERSATION, CONVERSATION_PAGE.THREAD, () => {}));
  const button = subagentsButton(conversation.container);
  assert.ok(button);
  assert.equal(button.textContent, "Sub-agents");
  assert.equal(button.getAttribute("aria-expanded"), "false");
  // Offered over an empty thread too: the empty list has its own words to say.
  assert.ok(conversation.container.querySelector(".conversation-empty"));
  // The Settings tab draws its whole panel, which these controls do not
  // fake; the Sessions tab stands for the tabs that are not the Conversation.
  const sessions = mount(bodyProps(PANEL_TAB.SESSIONS, CONVERSATION_PAGE.THREAD, () => {}));
  assert.equal(subagentsButton(sessions.container), null);
});

test("pressing the button asks for the list, and the list page draws it in the thread's place, with the way back", () => {
  const asked: ConversationPage[] = [];
  const change = (page: ConversationPage) => asked.push(page);
  const mounted = mount(bodyProps(PANEL_TAB.CONVERSATION, CONVERSATION_PAGE.THREAD, change));
  assert.ok(mounted.container.querySelector(".conversation-empty"));
  assert.equal(mounted.container.querySelector(".subagents-list, .subagents-header"), null);

  const button = subagentsButton(mounted.container);
  assert.ok(button);
  act(() => {
    button.click();
  });
  assert.deepEqual(asked, [CONVERSATION_PAGE.SUBAGENTS]);

  mounted.render(bodyProps(PANEL_TAB.CONVERSATION, CONVERSATION_PAGE.SUBAGENTS, change));
  // One tab panel, under the same root and ids the thread uses.
  const panels = mounted.container.querySelectorAll('[role="tabpanel"]');
  assert.equal(panels.length, 1);
  assert.equal(panels[0]?.className, "conversation-view ph-no-capture");
  assert.equal(panels[0]?.id, "panel-view-conversation");
  assert.ok(mounted.container.querySelector(".subagents-header"));
  assert.ok(mounted.container.textContent?.includes("No sub-agents yet"));
  assert.ok(!mounted.container.textContent?.includes("No messages yet"));
  assert.equal(subagentsButton(mounted.container)?.getAttribute("aria-expanded"), "true");

  const lit = subagentsButton(mounted.container);
  assert.ok(lit);
  act(() => {
    lit.click();
  });
  const back = mounted.container.querySelector(".subagents-back");
  assert.ok(back instanceof HTMLButtonElement);
  act(() => {
    back.click();
  });
  assert.deepEqual(asked, [
    CONVERSATION_PAGE.SUBAGENTS,
    CONVERSATION_PAGE.THREAD,
    CONVERSATION_PAGE.THREAD,
  ]);

  mounted.render(bodyProps(PANEL_TAB.CONVERSATION, CONVERSATION_PAGE.THREAD, change));
  assert.ok(mounted.container.textContent?.includes("No messages yet"));
  assert.equal(mounted.container.querySelector(".subagents-header"), null);
});
