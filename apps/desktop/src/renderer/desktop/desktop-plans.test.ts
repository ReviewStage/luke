// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  INBOX_CURSOR_START,
  INBOX_RESPONSE,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@luke/features/inbox-wire";
import type { Plan } from "@luke/features/plan-wire";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import { DOCUMENT_REGION, PLANS_PAGE } from "@luke/ui/planning-model";
import { TRANSCRIPT_REGION } from "@luke/voice/transcript-model";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, test, vi } from "vitest";
import { APP_COMMAND } from "#shared/shortcuts";
import { onRegistry } from "#testing/copy-feedback";
import { markdownHtmlParserLanded } from "#testing/markdown";
import { codingAgentsControl, plansControl, UNPINNED_SUMMARY } from "#testing/plans-control";
import { relayout } from "#testing/resize-observer";
import { runAppCommand } from "../app-commands";
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

afterEach(() => {
  vi.restoreAllMocks();
});

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

test("a plan's Inbox tab whose read holds nothing says nothing needs you under the Inbox's glyph, or under its list where the list stands alone, rather than standing blank", async () => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  const agentId = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
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
              tabs: [MAIN_TAB.PLAN, MAIN_TAB.INBOX],
              tab: MAIN_TAB.INBOX,
            },
            agents: codingAgentsControl({
              agentIds: [agentId],
              readInbox: ({ after }) =>
                after === INBOX_CURSOR_START
                  ? Promise.resolve({ items: [], cursor: "1" })
                  : new Promise(() => undefined),
            }),
          }),
        }),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
  const tab = container.querySelector<HTMLElement>('section.inbox-view[aria-label="Inbox"]');
  assert.ok(tab, "the plan's Inbox tab");
  assert.match(tab.textContent ?? "", /Nothing needs you/u);
  // Too narrow for the pane beside it, the list standing alone says so.
  vi.spyOn(tab, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ width: 700, height: 800 }),
  );
  act(() => relayout());
  const shown = [...tab.querySelectorAll(".inbox-plans, .inbox-view-items")].filter(
    (column) => !column.hasAttribute("hidden"),
  );
  assert.match(shown.map((column) => column.textContent).join(""), /Nothing needs you/u);
  assert.equal(
    shown.find((column) => column.classList.contains("inbox-plans"))?.querySelector(".empty-state")
      ?.textContent,
    "Nothing needs you",
    "the list standing alone stands the Inbox's empty state",
  );
  act(() => root.unmount());
  container.remove();
});

/** An item of the plan's agent, open and asking for an approval, as the service answers one. */
function approvalItem(id: string, title: string, at: number): InboxItem {
  return {
    id,
    agentId: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
    key: id.slice(-4),
    revision: 1,
    version: INBOX_WIRE_VERSION,
    title,
    blocks: [],
    response: { type: INBOX_RESPONSE.APPROVAL },
    needsReply: true,
    status: INBOX_STATUS.OPEN,
    postedAt: at,
    updatedAt: at,
  };
}

/** The plan's Inbox tab over the items given, laid out 700px wide, too narrow for its list and the item side by side. */
async function narrowPlanInbox(items: readonly InboxItem[]) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
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
              tabs: [MAIN_TAB.PLAN, MAIN_TAB.INBOX],
              tab: MAIN_TAB.INBOX,
            },
            agents: codingAgentsControl({
              agentIds: ["8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21"],
              readInbox: ({ after }) =>
                after === INBOX_CURSOR_START
                  ? Promise.resolve({ items, cursor: "1" })
                  : new Promise(() => undefined),
            }),
          }),
        }),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
  const tab = container.querySelector<HTMLElement>('section.inbox-view[aria-label="Inbox"]');
  assert.ok(tab, "the plan's Inbox tab");
  vi.spyOn(tab, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ width: 700, height: 800 }),
  );
  act(() => relayout());
  return {
    /** What a reader finds standing: the list or the item, and the item's title. */
    standing: () => [
      tab.querySelector(".inbox-plans")?.hasAttribute("hidden") === false ? "list" : "",
      tab.querySelector(".inbox-view-items")?.hasAttribute("hidden") === false
        ? (tab.querySelector("[data-inbox-title]")?.textContent ?? "item")
        : "",
    ],
    back: () => tab.querySelector<HTMLButtonElement>("button.inbox-back"),
    row: (title: string) =>
      [...tab.querySelectorAll<HTMLButtonElement>(".inbox-plans .sidebar-plan")].find((each) =>
        each.textContent?.includes(title),
      ),
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

test("a plan's Inbox tab too narrow for its list and the item side by side is the item it holds, with no way back to a list of one", async () => {
  const inbox = await narrowPlanInbox([
    approvalItem("a1b2c3d4-0000-4000-8000-000000000001", "Expire after 7 days?", 1_000),
  ]);
  assert.deepEqual(inbox.standing(), ["", "Expire after 7 days?"]);
  assert.equal(inbox.back(), null, "no way back to a list of one");
  assert.equal(runAppCommand(APP_COMMAND.BACK), false, "nor does Back's chord go to one");
  inbox.unmount();
});

test("a plan's Inbox tab too narrow for its list and the item side by side shows the chosen item under a way back to the list, whose rows open their items again", async () => {
  const inbox = await narrowPlanInbox([
    approvalItem("a1b2c3d4-0000-4000-8000-000000000001", "Expire after 7 days?", 1_000),
    approvalItem("a1b2c3d4-0000-4000-8000-000000000002", "Resend on bounce?", 2_000),
  ]);
  assert.deepEqual(inbox.standing(), ["", "Resend on bounce?"], "the newest that needs you");
  assert.equal(inbox.back()?.textContent, "Inbox");
  act(() => inbox.back()?.click());
  assert.deepEqual(inbox.standing(), ["list", ""]);
  act(() => inbox.row("Expire after 7 days?")?.click());
  assert.deepEqual(inbox.standing(), ["", "Expire after 7 days?"]);
  inbox.unmount();
});

test("the crumb's workspace opens that workspace's home page, the window switching to it first where another is listed", () => {
  const acme = { id: "workspace-acme", name: "Acme", role: WORKSPACE_ROLE.MEMBER, github: null };
  const personal = { ...acme, id: PLAN.workspaceId, name: "Personal" };
  const asked: string[] = [];
  const pressHome = (listed: typeof acme) => {
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    act(() =>
      root.render(
        onRegistry(
          AtomRegistry.make(),
          createElement(DesktopPlans, {
            summary: UNPINNED_SUMMARY,
            looks: NO_LOOKS,
            plans: plansControl({
              page: PLANS_PAGE.DOCUMENT,
              activePlanId: PLAN.id,
              region: { kind: DOCUMENT_REGION.READY, plan: PLAN },
              workspaces: [personal, acme],
              workspace: listed,
              onChooseWorkspace: (workspaceId) => asked.push(`choose ${workspaceId}`),
              onGoHome: () => asked.push("home"),
            }),
          }),
        ),
      ),
    );
    const crumb = container.querySelector<HTMLButtonElement>(
      'nav[aria-label="Where this task is"] button.plan-crumb-item',
    );
    assert.ok(crumb, "the crumb names the plan's workspace");
    act(() => crumb.click());
    act(() => root.unmount());
    container.remove();
  };

  pressHome(personal);
  pressHome(acme);

  assert.deepEqual(asked, ["home", `choose ${personal.id}`, "home"]);
});

test("the crumb says the plan's repository as the sidebar does: its name alone, or owner/name where another listed shares the name", () => {
  const home = {
    id: PLAN.workspaceId,
    name: "Personal",
    role: WORKSPACE_ROLE.MEMBER,
    github: null,
  };
  const plan = { ...PLAN, repository: "acme/web" };
  const summary = { ...plan, updatedAt: 2 };
  const said = (others: readonly string[]) => {
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    const listed = others.map((repository, at) => ({
      ...summary,
      id: `plan-${at}`,
      repository,
    }));
    act(() =>
      root.render(
        onRegistry(
          AtomRegistry.make(),
          createElement(DesktopPlans, {
            summary: UNPINNED_SUMMARY,
            looks: NO_LOOKS,
            plans: plansControl({
              page: PLANS_PAGE.DOCUMENT,
              activePlanId: plan.id,
              region: { kind: DOCUMENT_REGION.READY, plan },
              workspaces: [home],
              workspace: home,
              plans: [summary, ...listed],
            }),
          }),
        ),
      ),
    );
    const words = container.querySelector(".plan-crumb-repository")?.textContent;
    act(() => root.unmount());
    container.remove();
    return words;
  };

  assert.deepEqual([said([]), said(["acme/api"]), said(["other/web"])], ["web", "web", "acme/web"]);
});
