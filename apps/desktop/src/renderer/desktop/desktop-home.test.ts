// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { CodingAgentInboxAnswerView } from "@sidecar/hosted/coding-agent-view";
import {
  INBOX_RESPONSE,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@sidecar/hosted/inbox-wire";
import type { PlanSummary } from "@sidecar/hosted/plan-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act } from "#shared/messages/acts";
import { onRegistry } from "#testing/copy-feedback";
import { plansControl } from "#testing/plans-control";
import type { InboxChoice, PlansControl } from "../planning/use-plans-tab";
import { DesktopHome } from "./desktop-home";

const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const DAY = 86_400_000;
const NOW = Date.now();

/** A plan of the personal workspace, saved `ago` before now. */
function plan(n: number, name: string, ago: number, repository: string | null): PlanSummary {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    workspaceId: "workspace-personal",
    name,
    createdAt: NOW - ago - DAY,
    updatedAt: NOW - ago,
    repository,
  };
}

const INVITES = plan(1, "Teammate invitations", 4 * 60_000, "acme/relay");
const BILLING = plan(2, "Billing export", 2 * 3_600_000, "acme/ledger");
const PLANS: readonly PlanSummary[] = [
  plan(3, "Usage alerts", 5 * DAY, "acme/relay"),
  INVITES,
  plan(4, "Onboarding checklist", 12 * DAY, null),
  BILLING,
  plan(5, "Search across plans", 19 * DAY, "acme/relay"),
  plan(6, "Schema output", 3 * DAY, "acme/schema"),
  plan(7, "Nightly bump", 6 * 3_600_000, "acme/relay"),
  plan(8, "Old dashboard", 40 * DAY, "acme/relay"),
];

/** An item of the agent's asking a choice, open unless `status` says otherwise. */
function item(
  n: number,
  title: string,
  updatedAt: number,
  status: InboxItem["status"] = INBOX_STATUS.OPEN,
): InboxItem {
  return {
    id: `a1b2c3d4-0000-4000-8000-${String(n).padStart(12, "0")}`,
    agentId: AGENT_ID,
    key: String(n),
    revision: 1,
    version: INBOX_WIRE_VERSION,
    title,
    blocks: [],
    response: { type: INBOX_RESPONSE.CHOICE, options: [{ label: "Yes" }, { label: "No" }] },
    needsReply: true,
    status,
    postedAt: updatedAt,
    updatedAt,
  };
}

const EMAIL = item(1, "Email the invitee when an invite is withdrawn?", NOW - 6 * 60_000);
const SETTLED = item(2, "Expire after 7 days?", NOW - 60_000, INBOX_STATUS.ANSWERED);
const ACCOUNT = item(3, "Which billing account does the export read?", NOW - 2 * 3_600_000);

/** Each plan's inbox as the service answers a read of it. */
const INBOXES = new Map<string, readonly InboxItem[]>([
  [INVITES.id, [EMAIL, SETTLED]],
  [BILLING.id, [ACCOUNT]],
]);

/** The plans holding items, and those of them with an item waiting, as main reads the account. */
const HOLDING: Pick<PlansControl, "inbox" | "inboxPlans"> = {
  inbox: [
    { planId: INVITES.id, items: [EMAIL.id] },
    { planId: BILLING.id, items: [ACCOUNT.id] },
  ],
  inboxPlans: [
    { planId: INVITES.id, items: 2, updatedAt: EMAIL.updatedAt },
    { planId: BILLING.id, items: 1, updatedAt: ACCOUNT.updatedAt },
  ],
};

let root: Root | undefined;

beforeEach(() => {
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: {
      onMenuCommand: () => () => undefined,
      recordSurfaceEvent: () => undefined,
      act: (request: Act) => {
        if (request.kind !== ACT_KIND.CODING_AGENTS_INBOX) {
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." });
        }
        const value: CodingAgentInboxAnswerView = {
          items: INBOXES.get(request.payload.planId) ?? [],
          cursor: "1",
        };
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value });
      },
    },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** Every door the page opens, in order. */
interface Opened {
  readonly plans: string[];
  readonly inbox: (InboxChoice | "inbox")[];
  newPlans: number;
}

/** The home page over `overrides`, every door it opens recorded. */
function mount(overrides: Partial<PlansControl> = {}, accountName = "Dean Stratakos") {
  const opened: Opened = { plans: [], inbox: [], newPlans: 0 };
  const plans = plansControl({
    plans: PLANS,
    listed: { plans: PLANS, archived: [] },
    ...HOLDING,
    onSelect: (planId) => opened.plans.push(planId),
    onNewPlan: () => {
      opened.newPlans += 1;
    },
    inboxView: {
      open: false,
      chosen: undefined,
      onOpen: () => opened.inbox.push("inbox"),
      onClose: () => undefined,
      onChoose: (chosen) => opened.inbox.push(chosen),
    },
    ...overrides,
  });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      onRegistry(AtomRegistry.make(), createElement(DesktopHome, { plans, accountName })),
    ),
  );
  return { page: container, opened };
}

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** A section's rows as a reader scans them: each row's name, then its context. */
function rows(page: HTMLElement, section: string): string[] {
  const region = page.querySelector(`section[aria-labelledby="${section}"]`);
  assert.ok(region, `${section} stands`);
  return [...region.querySelectorAll(".sidebar-plan")].map(
    (row) =>
      `${row.querySelector(".sidebar-plan-name")?.textContent} · ${row.querySelector(".home-row-context")?.textContent}`,
  );
}

function button(page: HTMLElement, text: string): HTMLButtonElement {
  const found = [...page.querySelectorAll("button")].find((each) =>
    each.textContent?.startsWith(text),
  );
  assert.ok(found, `${text} stands`);
  return found;
}

test("the home page greets the account, lists what needs it with each item's plan, and the plans saved latest with their repositories", async () => {
  const { page } = mount();
  await settle();

  assert.equal(page.querySelector("h1")?.textContent, "Welcome back, Dean");
  assert.ok(button(page, "New plan"));
  assert.deepEqual(rows(page, "home-needs-you"), [
    "Email the invitee when an invite is withdrawn? · Teammate invitations",
    "Which billing account does the export read? · Billing export",
  ]);
  assert.deepEqual(rows(page, "home-recent"), [
    "Teammate invitations · acme/relay",
    "Billing export · acme/ledger",
    "Nightly bump · acme/relay",
    "Schema output · acme/schema",
    "Usage alerts · acme/relay",
    "Onboarding checklist · No repository",
  ]);
  assert.ok(button(page, "Search all 8 plans"));
});

test("a Needs you row opens the Inbox on its item, a recent plan opens the plan, and New plan asks for one", async () => {
  const { page, opened } = mount();
  await settle();

  button(page, "Email the invitee").click();
  button(page, "Usage alerts").click();
  button(page, "New plan").click();

  assert.deepEqual(opened.inbox, ["inbox", { planId: INVITES.id, itemId: EMAIL.id }]);
  assert.deepEqual(opened.plans, [PLANS[0]?.id]);
  assert.equal(opened.newPlans, 1);
});

test("with nothing waiting, Needs you says so in the Inbox's own words, as a line with no glyph", async () => {
  const { page } = mount({ inbox: [], inboxPlans: [] });
  await settle();

  const section = page.querySelector('section[aria-labelledby="home-needs-you"]');
  const note = section?.querySelector(".sidebar-note");
  assert.equal(note?.textContent, "Nothing needs you");
  assert.equal(section?.querySelector("svg"), null);
});

test("an account with no plan yet is welcomed with New plan, and nothing the page says names the sidebar", () => {
  const { page } = mount({
    plans: [],
    listed: { plans: [], archived: [] },
    inbox: [],
    inboxPlans: [],
  });

  assert.equal(page.querySelector("h1")?.textContent, "Plan your first feature");
  assert.ok(button(page, "New plan"));
  assert.doesNotMatch(page.textContent ?? "", /sidebar/iu);
});

test("↑ and ↓ move the focus through the rows from the window, Search all included, and leave a key pressed elsewhere alone", async () => {
  mount();
  await settle();
  const field = document.createElement("input");
  document.body.append(field);
  const press = (key: string) =>
    act(() => {
      (document.activeElement ?? document.body).dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
    });
  const focused = () => document.activeElement?.textContent ?? "";

  press("ArrowDown");
  assert.match(focused(), /^Email the invitee/u);
  press("ArrowDown");
  press("ArrowDown");
  assert.match(focused(), /^Teammate invitations/u);
  press("ArrowUp");
  assert.match(focused(), /^Which billing account/u);

  field.focus();
  press("ArrowDown");
  assert.equal(document.activeElement, field);

  field.blur();
  press("ArrowUp");
  assert.match(focused(), /^Search all 8 plans/u);
});
