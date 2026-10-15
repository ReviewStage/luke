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
import { onRegistry } from "#testing/copy-feedback";
import { markdownHtmlParserLanded } from "#testing/markdown";
import { codingAgentsControl, plansControl, UNPINNED_SUMMARY } from "#testing/plans-control";
import { relayout } from "#testing/resize-observer";
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

test("a plan's Inbox tab too narrow for its list and the item side by side shows its list alone, a press opening the item alone under a way back to the list", async () => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  const agentId = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
  const asked: InboxItem = {
    id: "a1b2c3d4-0000-4000-8000-000000000001",
    agentId,
    key: "0001",
    revision: 1,
    version: INBOX_WIRE_VERSION,
    title: "Expire after 7 days?",
    blocks: [],
    response: { type: INBOX_RESPONSE.APPROVAL },
    needsReply: true,
    status: INBOX_STATUS.OPEN,
    postedAt: 1_000,
    updatedAt: 1_000,
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
              tabs: [MAIN_TAB.PLAN, MAIN_TAB.INBOX],
              tab: MAIN_TAB.INBOX,
            },
            agents: codingAgentsControl({
              agentIds: [agentId],
              readInbox: ({ after }) =>
                after === INBOX_CURSOR_START
                  ? Promise.resolve({ items: [asked], cursor: "1" })
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
  const list = tab.querySelector(".inbox-plans");
  const pane = () => tab.querySelector(".inbox-view-items");
  assert.deepEqual([list?.hasAttribute("hidden"), pane()?.hasAttribute("hidden")], [false, true]);

  const row = tab.querySelector<HTMLButtonElement>(".inbox-plans .sidebar-plan");
  act(() => row?.click());
  assert.deepEqual([list?.hasAttribute("hidden"), pane()?.hasAttribute("hidden")], [true, false]);
  const back = tab.querySelector<HTMLButtonElement>("button.inbox-back");
  assert.equal(back?.textContent, "Inbox");
  act(() => back?.click());
  assert.deepEqual([list?.hasAttribute("hidden"), pane()?.hasAttribute("hidden")], [false, true]);
  act(() => root.unmount());
  container.remove();
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

test("the crumb's New task in this repository starts in the plan's own workspace, the window switching to it first where another is listed", () => {
  const acme = { id: "workspace-acme", name: "Acme", role: WORKSPACE_ROLE.MEMBER, github: null };
  const personal = { ...acme, id: PLAN.workspaceId, name: "Personal" };
  const plan = { ...PLAN, repository: "acme/web" };
  const asked: string[] = [];
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
            activePlanId: plan.id,
            region: { kind: DOCUMENT_REGION.READY, plan },
            workspaces: [personal, acme],
            workspace: acme,
            onChooseWorkspace: (workspaceId) => asked.push(`choose ${workspaceId}`),
            onNewPlanIn: (repository) => asked.push(`new plan in ${repository}`),
          }),
        }),
      ),
    ),
  );
  const chip = container.querySelector<HTMLButtonElement>(".plan-crumb-repository");
  assert.ok(chip, "the crumb names the plan's repository as a chip");
  act(() => chip.click());
  const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (each) => each.textContent === "New task in this repository",
  );
  assert.ok(item, "the chip's menu offers New task in this repository");
  act(() => item.click());
  act(() => root.unmount());
  container.remove();

  assert.deepEqual(asked, [`choose ${personal.id}`, "new plan in acme/web"]);
});
