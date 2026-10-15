// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@luke/features/coding-agent-wire";
import {
  INBOX_CURSOR_START,
  INBOX_RESPONSE,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@luke/features/inbox-wire";
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
import { type PlanInboxControl, usePlanInbox } from "./planning/use-plan-inbox";
import { NO_LOOKS } from "./planning/use-plan-looks";

/**
 * A draft as the developer meets it: words typed in one task's agent's box
 * wait there while another task is open and while the agent's tab is away,
 * which its tab and its task's sidebar row mark with the Draft pencil
 * meanwhile, outlast a reload of the window, and go with the message that
 * sends them; and an inbox card's answer, kept the same way, until the
 * agent changes the item it answers.
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

/** A signed-in identity: its id, where it was stored with one, and its address. */
interface Identity {
  readonly id?: string;
  readonly email: string;
}

/** The account signed in to the window, as the panel's root hands it the drafts. */
function SignedIn({ account }: { account: Identity | undefined }): null {
  useDraftsOwner(account);
  return null;
}

const DEAN = { id: "user-dean", email: "dean@example.com" } as const;
const SAM = { id: "user-sam", email: "sam@example.com" } as const;

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
    }: { onPlan?: boolean; send?: MessageSender; account?: Identity } = {},
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
            createElement(SignedIn, { account }),
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
  await app.show(INVITES, { account: DEAN });
  typeInComposer(app.container, "Expire invites after a week");
  await settle();

  await app.show(INVITES, { account: SAM });
  assert.equal(app.box(), "");
  assert.equal(app.rowDrafted(INVITES.plan.name), false);
  for (const root of roots.splice(0)) act(() => root.unmount());

  const relaunched = windowOn(AtomRegistry.make());
  await relaunched.show(INVITES, { account: SAM });
  assert.equal(relaunched.box(), "", "nor after a relaunch");
  await relaunched.show(INVITES, { account: DEAN });
  assert.equal(relaunched.box(), "Expire invites after a week");
  assert.equal(relaunched.rowDrafted(INVITES.plan.name), true);
});

test("accounts whose identity holds no id are told apart by their address, so neither reads the other's draft", async () => {
  const app = windowOn(AtomRegistry.make());
  await app.show(INVITES, { account: { email: DEAN.email } });
  typeInComposer(app.container, "Expire invites after a week");
  await settle();

  await app.show(INVITES, { account: { email: SAM.email } });
  assert.equal(app.box(), "");
  assert.equal(app.rowDrafted(INVITES.plan.name), false);
  await app.show(INVITES, { account: { email: DEAN.email } });
  assert.equal(app.box(), "Expire invites after a week");
});

test("the drafts an account kept under its address are its own still once its identity learns its id", async () => {
  const app = windowOn(AtomRegistry.make());
  await app.show(INVITES, { account: { email: DEAN.email } });
  typeInComposer(app.container, "Expire invites after a week");
  await settle();

  await app.show(INVITES, { account: DEAN });
  assert.equal(app.box(), "Expire invites after a week");
  assert.equal(app.rowDrafted(INVITES.plan.name), true);
});

/** A draft as storage keeps it: an agent's words on a plan, by the account that wrote them. */
function keptEntry(accountId: string, planId: string, agentId: string, text: string) {
  return { accountId, place: { kind: "agent", planId, agentId }, text };
}

test("past the most drafts kept, the oldest written goes, whosever it is, and the window lets go of it as storage does", async () => {
  // Dean's draft on Teammate invitations is the oldest; Sam's on Billing export the newest.
  const filler = Array.from({ length: 198 }, (_, at) =>
    keptEntry(DEAN.id, `plan-${at}`, `agent-${at}`, `Draft ${at}`),
  );
  window.localStorage.setItem(
    "luke.composerDrafts",
    JSON.stringify([
      keptEntry(DEAN.id, INVITES.plan.id, INVITES.agent.id, "Expire invites after a week"),
      ...filler,
      keptEntry(SAM.id, BILLING.plan.id, BILLING.agent.id, "Also the CSV"),
    ]),
  );
  const app = windowOn(AtomRegistry.make());
  await app.show(BILLING, { account: DEAN });
  assert.equal(app.rowDrafted(INVITES.plan.name), true);

  typeInComposer(app.container, "Monthly, not weekly");
  await settle();
  assert.equal(app.rowDrafted(INVITES.plan.name), false, "the oldest is let go at once");
  for (const root of roots.splice(0)) act(() => root.unmount());

  const sam = windowOn(AtomRegistry.make());
  await sam.show(BILLING, { account: SAM });
  assert.equal(sam.box(), "Also the CSV", "a newer draft of another account's stands");
});

test("where an account kept a draft for one place under its id and a later one under its address, the later stands once both are its id's", async () => {
  window.localStorage.setItem(
    "luke.composerDrafts",
    JSON.stringify([
      keptEntry(DEAN.id, INVITES.plan.id, INVITES.agent.id, "Expire after a month"),
      keptEntry(DEAN.email, INVITES.plan.id, INVITES.agent.id, "Expire invites after a week"),
    ]),
  );
  const app = windowOn(AtomRegistry.make());
  await app.show(INVITES, { account: DEAN });
  assert.equal(app.box(), "Expire invites after a week");
});

/** An item of the Teammate invitations agent's, open and asking for an approval, at `revision`. */
function approval(revision: number): InboxItem {
  return {
    id: "a1b2c3d4-0000-4000-8000-000000000001",
    agentId: INVITES.agent.id,
    key: "0001",
    revision,
    version: INBOX_WIRE_VERSION,
    title: "Expire after 7 days?",
    blocks: [],
    response: { type: INBOX_RESPONSE.APPROVAL },
    needsReply: true,
    status: INBOX_STATUS.OPEN,
    postedAt: 1_000,
    updatedAt: 1_000,
  };
}

/** The window on its own registry, open on the Teammate invitations task's Inbox tab, whose read answers `item`. */
async function inboxOn(item: InboxItem) {
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
  roots.push(root);
  const plans = plansControl({
    page: PLANS_PAGE.DOCUMENT,
    plans: [INVITES.plan],
    activePlanId: INVITES.plan.id,
    region: { kind: DOCUMENT_REGION.READY, plan: INVITES.plan },
    mainTabs: {
      ...plansControl().mainTabs,
      tabs: [MAIN_TAB.PLAN, MAIN_TAB.INBOX],
      tab: MAIN_TAB.INBOX,
    },
    agents: codingAgentsControl({
      agents: [INVITES.agent],
      agentIds: [INVITES.agent.id],
      readInbox: ({ after }) =>
        after === INBOX_CURSOR_START
          ? Promise.resolve({ items: [item], cursor: "1" })
          : new Promise(() => undefined),
    }),
  });
  await act(async () =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(
          Fragment,
          null,
          createElement(
            "ul",
            null,
            createElement(SidebarPlan, {
              plans,
              plan: INVITES.plan,
              current: true,
              unread: false,
              now: 3,
              onOpen: () => undefined,
            }),
          ),
          createElement(DesktopPlans, { summary: UNPINNED_SUMMARY, looks: NO_LOOKS, plans }),
        ),
      ),
    ),
  );
  await settle();
  const note = () =>
    container.querySelector<HTMLTextAreaElement>(".inbox-view textarea") ??
    assert.fail("the card's answer box");
  return {
    note,
    /** Types the words into the card's note, as the field's own input does. */
    type: async (words: string) => {
      const field = note();
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
          field,
          words,
        );
        field.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await settle();
    },
    drafted: () =>
      container.querySelector(`.sidebar-plan [role="img"][aria-label="${DRAFT_WORD}"]`) !== null,
    reload: () => {
      for (const each of roots.splice(0)) act(() => each.unmount());
      container.remove();
    },
  };
}

test("an inbox card's note outlasts a reload, its task's row marked meanwhile, and is let go once the agent changes the item", async () => {
  const before = await inboxOn(approval(1));
  await before.type("Only for teammates, not guests");
  assert.equal(before.drafted(), true);
  before.reload();

  const after = await inboxOn(approval(1));
  assert.equal(after.note().value, "Only for teammates, not guests");
  assert.equal(after.drafted(), true);
  after.reload();

  const changed = await inboxOn(approval(2));
  assert.equal(changed.note().value, "", "the agent's change starts the card afresh");
  assert.equal(changed.drafted(), false, "and the draft it outdated is let go");
});

/** One item of an agent's with no plan, open and asking for an approval, at `revision`. */
function planlessItem(agentId: string, id: string, revision: number): InboxItem {
  return { ...approval(revision), id, agentId };
}

/** An agent's own inbox with no plan, read through its reader as the Inbox page reads it, answering `items`. */
async function planlessInbox(agentId: string, items: readonly InboxItem[]) {
  let control: PlanInboxControl | undefined;
  function Probe(): null {
    control = usePlanInbox({
      planId: agentId,
      reader: (after) =>
        after === INBOX_CURSOR_START
          ? Promise.resolve({ items, cursor: "1" })
          : new Promise(() => undefined),
      shown: true,
      waiting: true,
      agents: {
        heldIds: [agentId],
        readInbox: () => new Promise(() => undefined),
        answerInbox: () => new Promise(() => undefined),
        readInboxImage: () => new Promise(() => undefined),
        onRetryList: () => undefined,
      },
    });
    return null;
  }
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  await act(async () => root.render(onRegistry(AtomRegistry.make(), createElement(Probe))));
  await settle();
  return control ?? assert.fail("the inbox is held");
}

test("an agent with no plan lets go of its own outdated answers as its inbox is read, and never another agent's", async () => {
  const mine = planlessItem(INVITES.agent.id, "b1b2c3d4-0000-4000-8000-000000000001", 1);
  const theirs = planlessItem(BILLING.agent.id, "b1b2c3d4-0000-4000-8000-000000000002", 1);
  const first = await planlessInbox(INVITES.agent.id, [mine]);
  act(() => first.onDraft(mine, { choices: [], values: [], note: "Only teammates" }));
  const other = await planlessInbox(BILLING.agent.id, [theirs]);
  act(() => other.onDraft(theirs, { choices: [], values: [], note: "Weekly" }));

  await planlessInbox(INVITES.agent.id, [{ ...mine, revision: 2 }]);
  const reread = await planlessInbox(INVITES.agent.id, [mine]);
  assert.equal(reread.draftOf(mine).note, "", "the answer its agent outdated is let go");
  const kept = await planlessInbox(BILLING.agent.id, [theirs]);
  assert.equal(kept.draftOf(theirs).note, "Weekly");
});
