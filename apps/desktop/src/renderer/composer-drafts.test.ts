// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@luke/features/coding-agent-wire";
import type { Plan } from "@luke/features/plan-wire";
import { DOCUMENT_REGION, PLANS_PAGE } from "@luke/ui/planning-model";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import {
  composerEditor,
  installEditorBundle,
  installEditorLayout,
  pressInComposer,
  typeInComposer,
} from "#testing/composer";
import { onRegistry } from "#testing/copy-feedback";
import { codingAgentsControl, plansControl, UNPINNED_SUMMARY } from "#testing/plans-control";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { useDraftsOwner } from "./composer-drafts";
import { DesktopPlans } from "./desktop/desktop-plans";
import { SidebarPlan } from "./desktop/plan-actions";
import { DRAFT_WORD } from "./draft-mark";
import type { MessageSender } from "./planning/use-agent-composer";
import { MAIN_TAB } from "./planning/use-main-tabs";
import { NO_LOOKS } from "./planning/use-plan-looks";

/**
 * A draft as the developer meets it: words typed in one task's agent's box
 * wait there while another task is open and while the agent's tab is away,
 * which its tab and its task's sidebar row mark with the Draft pencil
 * meanwhile, outlast a reload of the window, and go with the message that
 * sends them.
 */

/** A task with one agent of its own, open on its agent's tab. */
function task(id: string, name: string, agentId: string) {
  const plan: Plan = {
    id,
    workspaceId: "workspace-personal",
    name,
    createdAt: 1,
    updatedAt: 2,
    repository: null,
    document: { body: `# ${name}`, assumptions: [] },
  };
  const agent: CodingAgentSummary = {
    id: agentId,
    planId: id,
    model: "openai/gpt-5.6-sol",
    effort: "high",
    title: `${name} agent`,
    createdAt: 1,
    status: CODING_AGENT_STATUS.COMPLETED,
    turnId: null,
  };
  return { plan, agent };
}

const INVITES = task(
  "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  "Teammate invitations",
  "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
);
const BILLING = task(
  "0c9a3f1e-6b2d-4e8f-a1c7-3d5e7f9a1b2c",
  "Billing export",
  "9d2b7b5f-4e3f-4e9c-9c77-7a5d8b3f4c32",
);

const roots: Root[] = [];

// Set before any box renders, since the box reads the editor bundle once per window.
installEditorBundle();

beforeEach(() => {
  installScrollIntoView();
  installEditorLayout();
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  window.localStorage.clear();
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/** The account signed in to the window, as the panel's root hands it the drafts. */
function SignedIn({ accountId }: { accountId: string | undefined }): null {
  useDraftsOwner(accountId);
  return null;
}

/** Sends nothing anywhere: every message stays out, unanswered. */
const NEVER_ANSWERED: MessageSender = () => new Promise(() => undefined);

/**
 * The window on one registry, as one launch of it holds: the sidebar's row
 * of each task beside the plan's column, open on `open`'s agent's tab, or on
 * its plan's own where `onPlan`, its messages sent through `send`.
 */
function windowOn(registry: AtomRegistry.AtomRegistry) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const show = async (
    open: typeof INVITES,
    {
      onPlan = false,
      send = NEVER_ANSWERED,
      account,
    }: { onPlan?: boolean; send?: MessageSender; account?: string } = {},
  ) => {
    const agentTab = { agent: open.agent.id };
    const plans = plansControl({
      page: PLANS_PAGE.DOCUMENT,
      plans: [INVITES.plan, BILLING.plan],
      activePlanId: open.plan.id,
      region: { kind: DOCUMENT_REGION.READY, plan: open.plan },
      mainTabs: {
        ...plansControl().mainTabs,
        tabs: [MAIN_TAB.PLAN, agentTab],
        tab: onPlan ? MAIN_TAB.PLAN : agentTab,
        openAgents: [open.agent.id],
      },
      agents: codingAgentsControl({
        agents: [open.agent],
        agentIds: [open.agent.id],
        onMessage: (agentId, text, clientKey, attachments) =>
          send(agentId, text, clientKey, attachments),
      }),
    });
    const rows = [INVITES.plan, BILLING.plan].map((plan) =>
      createElement(SidebarPlan, {
        key: plan.id,
        plans,
        plan,
        current: plan.id === open.plan.id,
        unread: false,
        now: 3,
        onOpen: () => undefined,
      }),
    );
    await act(async () =>
      root.render(
        onRegistry(
          registry,
          createElement(
            Fragment,
            null,
            createElement(SignedIn, { accountId: account }),
            createElement("ul", null, rows),
            createElement(DesktopPlans, {
              summary: UNPINNED_SUMMARY,
              looks: NO_LOOKS,
              plans,
            }),
          ),
        ),
      ),
    );
    await settle();
  };
  /** The sidebar's row of a task. */
  const row = (name: string) =>
    [...container.querySelectorAll<HTMLElement>(".sidebar-plan-item")].find((each) =>
      each.textContent?.includes(name),
    ) ?? assert.fail(`the sidebar lists ${name}`);
  return {
    container,
    show,
    /** The words the open agent's box shows. */
    box: () => composerEditor(container).textContent,
    /** Whether a task's sidebar row wears the Draft pencil. */
    rowDrafted: (name: string) =>
      row(name).querySelector(`[role="img"][aria-label="${DRAFT_WORD}"]`) !== null,
    /** Whether an agent's tab in the plan's column wears the Draft pencil. */
    tabDrafted: (label: string) => {
      const tab =
        [...container.querySelectorAll<HTMLElement>(".tab")].find(
          (each) => each.querySelector(".tab-label")?.textContent === label,
        ) ?? assert.fail(`the column draws ${label}'s tab`);
      return tab.querySelector(`.tab-end-mark [aria-label="${DRAFT_WORD}"]`) !== null;
    },
  };
}

test("words typed in one task's agent's box wait there while another task is open, and its row and its agent's tab wear the Draft pencil meanwhile", async () => {
  const app = windowOn(AtomRegistry.make());
  await app.show(INVITES);
  assert.equal(app.rowDrafted(INVITES.plan.name), false, "an empty box marks nothing");

  typeInComposer(app.container, "Expire invites after a week");
  await settle();
  assert.equal(app.rowDrafted(INVITES.plan.name), true);
  assert.equal(app.rowDrafted(BILLING.plan.name), false, "only the task holding it is marked");

  await app.show(BILLING);
  assert.equal(app.box(), "", "another task's agent starts from nothing of this one's");
  assert.equal(app.rowDrafted(INVITES.plan.name), true, "the draft is marked while away");

  await app.show(INVITES, { onPlan: true });
  assert.equal(app.tabDrafted(INVITES.agent.title ?? ""), true);

  await app.show(INVITES);
  assert.equal(app.box(), "Expire invites after a week");
});

test("a draft outlasts a reload of the window, words and mark alike", async () => {
  const before = windowOn(AtomRegistry.make());
  await before.show(INVITES);
  typeInComposer(before.container, "Expire invites after a week");
  await settle();
  for (const root of roots.splice(0)) act(() => root.unmount());

  const after = windowOn(AtomRegistry.make());
  await after.show(BILLING);
  assert.equal(after.rowDrafted(INVITES.plan.name), true);
  await after.show(INVITES);
  assert.equal(after.box(), "Expire invites after a week");
});

test("a message sent takes its words out of the draft, so the box comes back empty and nothing is marked", async () => {
  const sent: string[] = [];
  const send: MessageSender = (_agentId, text) => {
    sent.push(text);
    return new Promise(() => undefined);
  };
  const app = windowOn(AtomRegistry.make());
  await app.show(INVITES, { send });
  typeInComposer(app.container, "Expire invites after a week");
  await settle();
  assert.equal(app.rowDrafted(INVITES.plan.name), true);
  pressInComposer(app.container, "Enter");
  await settle();
  assert.deepEqual(sent, ["Expire invites after a week"]);
  assert.equal(app.rowDrafted(INVITES.plan.name), false, "the mark goes with the words");

  await app.show(BILLING);
  await app.show(INVITES, { onPlan: true });
  assert.equal(app.tabDrafted(INVITES.agent.title ?? ""), false);
  await app.show(INVITES);
  assert.equal(app.box(), "");
});

test("a box emptied by hand lets its draft go, and its mark with it", async () => {
  const app = windowOn(AtomRegistry.make());
  await app.show(INVITES);
  typeInComposer(app.container, "Expire invites after a week");
  await settle();
  assert.equal(app.rowDrafted(INVITES.plan.name), true);

  const editor = composerEditor(app.container).editor ?? assert.fail("the box's editor is running");
  act(() => editor.commands.clearContent(true));
  await settle();
  assert.equal(app.rowDrafted(INVITES.plan.name), false);
  await app.show(INVITES, { onPlan: true });
  assert.equal(app.tabDrafted(INVITES.agent.title ?? ""), false);
});

test("a draft is its account's: another signing in on the same Mac meets none of it, and its writer finds it again", async () => {
  const app = windowOn(AtomRegistry.make());
  await app.show(INVITES, { account: "user-dean" });
  typeInComposer(app.container, "Expire invites after a week");
  await settle();

  await app.show(INVITES, { account: "user-sam" });
  assert.equal(app.box(), "");
  assert.equal(app.rowDrafted(INVITES.plan.name), false);
  for (const root of roots.splice(0)) act(() => root.unmount());

  const relaunched = windowOn(AtomRegistry.make());
  await relaunched.show(INVITES, { account: "user-sam" });
  assert.equal(relaunched.box(), "", "nor after a relaunch");
  await relaunched.show(INVITES, { account: "user-dean" });
  assert.equal(relaunched.box(), "Expire invites after a week");
  assert.equal(relaunched.rowDrafted(INVITES.plan.name), true);
});
