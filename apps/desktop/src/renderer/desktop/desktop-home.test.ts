// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_CHAT_REASON, type AccountChatEntry } from "@luke/features/account-inbox-wire";
import type { PlanSummary } from "@luke/features/plan-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { plansControl } from "#testing/plans-control";
import { type ChatPlace, FOR_YOU } from "../planning/chat-model";
import type { PlansControl } from "../planning/use-plans-tab";
import { DesktopHome } from "./desktop-home";

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

/** A chat message main's read of the account says waits on the developer: from whom, why, in which plan's channel, and when. */
function waiting(
  n: number,
  reason: AccountChatEntry["reason"],
  from: string,
  planId: string | null,
  updatedAt: number,
): AccountChatEntry {
  return {
    messageId: `a1b2c3d4-0000-4000-8000-${String(n).padStart(12, "0")}`,
    seq: n,
    workspaceId: "workspace-personal",
    reason,
    from,
    planId,
    touchedSeq: n,
    updatedAt,
  };
}

/** What waits on the developer in chat, the latest changed first, as main reads the account. */
const WAITING: readonly AccountChatEntry[] = [
  waiting(1, ACCOUNT_CHAT_REASON.ASK, "invites-agent", INVITES.id, NOW - 6 * 60_000),
  waiting(2, ACCOUNT_CHAT_REASON.MENTION, "ana", BILLING.id, NOW - 2 * 3_600_000),
  waiting(3, ACCOUNT_CHAT_REASON.DIRECT, "sam", null, NOW - 3 * 3_600_000),
];

let root: Root | undefined;

beforeEach(() => {
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: { onMenuCommand: () => () => undefined, recordSurfaceEvent: () => undefined },
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
  readonly chat: ChatPlace[];
  newPlans: number;
}

/** The home page over `overrides`, every door it opens recorded. */
function mount(overrides: Partial<PlansControl> = {}, accountName = "Dean Stratakos") {
  const opened: Opened = { plans: [], chat: [], newPlans: 0 };
  const base = plansControl();
  const plans = plansControl({
    plans: PLANS,
    listed: { plans: PLANS, archived: [] },
    chatWaiting: WAITING,
    onSelect: (planId) => opened.plans.push(planId),
    onNewPlan: () => {
      opened.newPlans += 1;
    },
    chatView: { ...base.chatView, onShow: (place) => opened.chat.push(place) },
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

test("the home page greets the account, lists what waits on it in chat with who sent it and the plan it was posted under, and the plans saved latest with their repositories", async () => {
  const { page } = mount();
  await settle();

  assert.equal(page.querySelector("h1")?.textContent, "Welcome back, Dean");
  assert.ok(button(page, "New plan"));
  assert.deepEqual(rows(page, "home-for-you"), [
    "@invites-agent asked you · Teammate invitations",
    "@ana mentioned you · Billing export",
    "@sam messaged you · undefined",
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

test("a waiting message's row opens Chat's For you, a recent plan opens the plan, and New plan asks for one", async () => {
  const { page, opened } = mount();
  await settle();

  button(page, "@invites-agent asked you").click();
  button(page, "Usage alerts").click();
  button(page, "New plan").click();

  assert.deepEqual(opened.chat, [FOR_YOU]);
  assert.deepEqual(opened.plans, [PLANS[0]?.id]);
  assert.equal(opened.newPlans, 1);
});

test("the waiting messages stand under For you, the place a press on one opens, counted beside it", async () => {
  const { page } = mount();
  await settle();

  const heading = page.querySelector("#home-for-you");
  assert.equal(heading?.closest("section")?.getAttribute("aria-labelledby"), "home-for-you");
  // The heading's count follows the name in a span of its own.
  assert.equal(heading?.firstChild?.textContent, "For you");
  assert.equal(heading?.querySelector(".home-section-count")?.textContent, "3");
});

test("with nothing waiting, For you says so, as a line with no glyph", async () => {
  const { page } = mount({ chatWaiting: [] });
  await settle();

  const section = page.querySelector('section[aria-labelledby="home-for-you"]');
  const note = section?.querySelector(".sidebar-note");
  assert.equal(note?.textContent, "Nothing needs you");
  assert.equal(section?.querySelector("svg"), null);
});

test("an account with no plan yet is welcomed with New plan, and nothing the page says names the sidebar", () => {
  const { page } = mount({
    plans: [],
    listed: { plans: [], archived: [] },
    chatWaiting: [],
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
  assert.match(focused(), /^@invites-agent asked you/u);
  press("ArrowDown");
  press("ArrowDown");
  press("ArrowDown");
  assert.match(focused(), /^Teammate invitations/u);
  press("ArrowUp");
  assert.match(focused(), /^@sam messaged you/u);

  field.focus();
  press("ArrowDown");
  assert.ok(document.activeElement === field, "the field keeps the focus");

  field.blur();
  press("ArrowUp");
  assert.match(focused(), /^Search all 8 plans/u);
});

test("a workspace with no plan of its own, in an account with plans elsewhere, still says what needs it rather than welcoming a new account", async () => {
  const { page } = mount({ listed: { plans: [], archived: [] } });
  await settle();

  assert.equal(page.querySelector("h1")?.textContent, "Welcome back, Dean");
  assert.equal(rows(page, "home-for-you").length, 3);
  assert.equal(page.querySelector('section[aria-labelledby="home-recent"]'), null);
});

test("↑ and ↓ pressed on New plan leave the focus on it", async () => {
  const { page } = mount();
  await settle();
  const newPlan = button(page, "New plan");
  newPlan.focus();
  act(() => {
    newPlan.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
    );
  });
  assert.ok(document.activeElement === newPlan, "New plan keeps the focus");
});
