// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS } from "@sidecar/credentials/snapshot";
import { type AgentRead, CHILD_STATUS, type ChildRead } from "@sidecar/hosted/reads-wire";
import { CONVERSATION_VIEW_SOURCE } from "@sidecar/session";
import { TRANSCRIPT_KIND } from "@sidecar/wire";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, test } from "vitest";
import { UPDATE_STATUS } from "#shared/messages/update";
import { fixtureChildCompletionTurns } from "./conversation-turns.fixtures";
import { PanelBody } from "./panel-body";
import { PANEL_TAB, type PanelTab } from "./panel-tabs";
import { SESSION_SORT } from "./session-model";
import type { SettingsPanelProps } from "./settings/settings-panel";
import {
  CONVERSATION_PAGE,
  type ConversationPage,
  childTranscriptRow,
  type TranscriptRow,
} from "./subagents-panel";

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
  extra: Partial<BodyProps> = {},
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
    agents: { settled: true, agents: [] },
    onOpenTranscript: () => undefined,
    transcriptOpen: undefined,
    childTranscript: undefined,
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
    ...extra,
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

test("the Agents button is offered on the Conversation tab, thread or not, and not on the Sessions tab", () => {
  const conversation = mount(bodyProps(PANEL_TAB.CONVERSATION, CONVERSATION_PAGE.THREAD, () => {}));
  const button = subagentsButton(conversation.container);
  assert.ok(button);
  assert.equal(button.textContent, "Agents");
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

const CHILD: ChildRead = {
  id: "aaaaaaaa-1111-4000-8000-000000000001",
  parentConversationId: "7a1b2c3d-0000-4000-8000-000000000001",
  parentKind: CONVERSATION_VIEW_SOURCE.MAIN,
  label: "Audit the release notes",
  status: CHILD_STATUS.SETTLED,
  acceptedAt: NOW - 60_000,
  settledAt: NOW,
};

const AGENT: AgentRead = {
  id: "6f000000-0000-4000-8000-000000000001",
  providerId: "conductor",
  providerSessionId: "9f4c5d47-2d3e-4f50-b162-3d4e5f6a7b83",
  status: CHILD_STATUS.RUNNING,
  acceptedAt: NOW - 120_000,
  startedAt: NOW - 60_000,
};

test("a completion's chip in the thread opens the child exactly as the list's row does", () => {
  const opened: TranscriptRow[] = [];
  const mounted = mount(
    bodyProps(PANEL_TAB.CONVERSATION, CONVERSATION_PAGE.THREAD, () => undefined, {
      conversation: { groups: fixtureChildCompletionTurns(CHILD.id, CHILD.label), settled: true },
      subagents: { settled: true, children: [CHILD] },
      onOpenTranscript: (row) => opened.push(row),
    }),
  );
  const chip = mounted.container.querySelector(".conversation-subagent-chip");
  assert.ok(chip instanceof HTMLButtonElement);
  assert.equal(chip.textContent, "Sub-agent: Audit the release notes");
  act(() => {
    chip.click();
  });
  assert.deepEqual(opened, [childTranscriptRow(CHILD)]);
});

test("a row's press opens the child or the agent, and the transcript page draws in the thread's place with the way back to the list", () => {
  const asked: ConversationPage[] = [];
  const opened: TranscriptRow[] = [];
  const change = (page: ConversationPage) => asked.push(page);
  const extra: Partial<BodyProps> = {
    subagents: { settled: true, children: [CHILD] },
    agents: { settled: true, agents: [AGENT] },
    onOpenTranscript: (row) => opened.push(row),
  };
  const mounted = mount(
    bodyProps(PANEL_TAB.CONVERSATION, CONVERSATION_PAGE.SUBAGENTS, change, extra),
  );
  // The agents lead the page, then the sub-agents; either row's press names its row to the app.
  const rows = mounted.container.querySelectorAll(".subagent-row");
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.ok(row instanceof HTMLButtonElement);
    act(() => {
      row.click();
    });
  }
  // The press names the row to the app, which opens it on the host and turns the page itself.
  assert.deepEqual(opened, [
    {
      conversationId: AGENT.id,
      kind: TRANSCRIPT_KIND.OBSERVED,
      title: "Session 9f4c5d47",
      status: CHILD_STATUS.RUNNING,
    },
    childTranscriptRow(CHILD),
  ]);
  assert.deepEqual(asked, []);

  mounted.render(
    bodyProps(PANEL_TAB.CONVERSATION, CONVERSATION_PAGE.TRANSCRIPT, change, {
      ...extra,
      transcriptOpen: childTranscriptRow(CHILD),
      childTranscript: {
        conversationId: CHILD.id,
        kind: TRANSCRIPT_KIND.CHILD,
        settled: true,
        groups: [],
      },
    }),
  );
  const panels = mounted.container.querySelectorAll('[role="tabpanel"]');
  assert.equal(panels.length, 1);
  assert.equal(panels[0]?.className, "conversation-view ph-no-capture");
  assert.equal(panels[0]?.id, "panel-view-conversation");
  assert.ok(mounted.container.textContent?.includes("Audit the release notes"));
  assert.ok(mounted.container.textContent?.includes("Nothing said yet"));
  assert.equal(mounted.container.querySelector(".subagents-list"), null);
  // The button stays lit over a transcript, and Clear is not offered off the thread.
  assert.equal(subagentsButton(mounted.container)?.getAttribute("aria-expanded"), "true");
  assert.equal(mounted.container.querySelector(".conversation-clear"), null);

  const back = mounted.container.querySelector(".subagents-back");
  assert.ok(back instanceof HTMLButtonElement);
  assert.equal(back.textContent, "‹ Agents");
  act(() => {
    back.click();
  });
  assert.deepEqual(asked, [CONVERSATION_PAGE.SUBAGENTS]);

  // A transcript page with no row to be of falls back to the thread.
  mounted.render(bodyProps(PANEL_TAB.CONVERSATION, CONVERSATION_PAGE.TRANSCRIPT, change, extra));
  assert.ok(mounted.container.textContent?.includes("No messages yet"));
  assert.equal(mounted.container.querySelector(".subagents-header"), null);
});
