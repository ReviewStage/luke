// @vitest-environment jsdom
import { type AdminCost, SECONDS_LIST_PRICE } from "@luke/features/admin-cost-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { type AdminDoors, AdminDoorsProvider, type AdminReads } from "./admin-doors.js";
import { AccountScreen } from "./screens/account.js";
import { CostScreen } from "./screens/cost.js";
import { DayScreen } from "./screens/day.js";
import { ReliabilityScreen } from "./screens/reliability.js";
import { UsersScreen } from "./screens/users.js";
import { WorkspacesScreen } from "./screens/workspaces.js";

/**
 * admin-skeletons.test.ts -- an admin screen's first load stands the page it
 * is waiting for: the same headline cards, a chart's own heading and legend,
 * a table's own columns with an account's avatar only where an account
 * lands, a hint only where a card will say one, and every section the page
 * states, its notes among them. Synthetic accounts; every read is held
 * unanswered but the one a test lands.
 */

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

/** A read nobody answers, so the screen stands its skeleton. */
function unanswered(): Promise<never> {
  return Promise.withResolvers<never>().promise;
}

const UNANSWERED: AdminReads = {
  metrics: unanswered,
  cost: unanswered,
  reliability: unanswered,
  users: unanswered,
  user: unanswered,
  day: unanswered,
  workspaces: unanswered,
  favorite: async () => true,
};

/** A synthetic week of list prices: one model and one account. */
const COST: AdminCost = {
  generatedAt: Date.UTC(2026, 9, 17, 12),
  windowDays: 7,
  catalogAvailable: true,
  totals: { spendUsd: 16.01, trend: { days: 7, recent: 16.01, prior: 8 }, unpricedTokens: 0 },
  perAccount: { accounts: 4, meanUsd: 4, medianUsd: 1.5 },
  perMergedPullRequest: { mergedPullRequests: 2, spendUsd: 8 },
  voice: { minutes: 10, spendUsd: 0.5, unpricedMinutes: 0 },
  daily: [
    { day: "2026-10-17", "coding-agents": 12.5, luke: 3, voice: 0.5, dictation: 0, avatar: 0 },
  ],
  byModel: [
    { model: "anthropic/claude-test", spendUsd: 15.5, pricedTokens: 3_000_000, unpricedTokens: 0 },
  ],
  topAccounts: [
    {
      id: "account-ada",
      name: "Ada Lovelace",
      email: "ada@example.test",
      image: null,
      admin: false,
      spendUsd: 12.5,
      unpricedTokens: 0,
      mergedPullRequests: 0,
      spendPerMergedPullRequestUsd: null,
    },
  ],
  prices: SECONDS_LIST_PRICE,
};

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  window.localStorage.clear();
  document.body.replaceChildren();
});

/** Draws `screen` under doors answering with `reads`, and lets any answer land. */
async function draw(
  screen: React.ReactElement,
  reads: Partial<AdminReads> = {},
): Promise<HTMLElement> {
  const doors: AdminDoors = {
    reads: { ...UNANSWERED, ...reads },
    gate: {
      heldAtGate: () => false,
      signedOut: () => createElement("p", null, "Signed out"),
      forbidden: () => createElement("p", null, "Forbidden"),
    },
    address: {
      accountHref: () => undefined,
      search: () => "",
      keepSearch: () => undefined,
      onSearchMoved: () => () => undefined,
    },
  };
  const page = document.body.appendChild(document.createElement("div"));
  const root = createRoot(page);
  roots.push(root);
  await act(async () => root.render(createElement(AdminDoorsProvider, { value: doors }, screen)));
  return page;
}

/** What every screen is handed but these tests never press. */
const QUIET = {
  hideAdmins: false,
  onHideAdminsChange: () => undefined,
  windowDays: 30,
  onWindowDaysChange: () => undefined,
  account: undefined,
  onSignOut: async () => undefined,
  onOpenAccount: () => undefined,
  frame: (content: React.JSX.Element) => content,
} as const;

/** The region a loading page stands its skeleton in. */
function loadingRegion(page: HTMLElement): HTMLElement {
  const region = page.querySelector<HTMLElement>('[role="status"][aria-busy="true"]');
  if (region === null) throw new Error("the page stands no loading region");
  return region;
}

/** The headings of the sections under `within`, in order. */
function sectionHeadings(within: HTMLElement): string[] {
  return Array.from(within.querySelectorAll("section h2"), (heading) => heading.textContent ?? "");
}

/** The cards the first card under `within` groups, as a stat group holds them. */
function groupedCards(within: HTMLElement): number {
  return within.querySelector(".luke-card > div")?.children.length ?? 0;
}

function costScreen(): React.ReactElement {
  return createElement(CostScreen, { ...QUIET, windowDays: 7 });
}

test("the Cost page's skeleton stands as many headline cards as the page lands", async () => {
  const loading = loadingRegion(await draw(costScreen()));
  const loaded = await draw(costScreen(), { cost: async () => COST });
  expect(groupedCards(loading)).toBe(4);
  expect(groupedCards(loading)).toBe(groupedCards(loaded));
});

test("the Cost chart's skeleton stands its own heading and legend, with no caption across from it", async () => {
  const region = loadingRegion(await draw(costScreen()));
  const heading = [...region.querySelectorAll("h3")].find(
    (title) => title.textContent === "Daily list-price equivalent by source, USD",
  );
  expect(heading?.parentElement?.children).toHaveLength(1);
  const card = heading?.closest(".luke-card");
  for (const source of [
    "Coding agents",
    "Luke's own turns",
    "Voice",
    "Dictation",
    "Video avatar",
  ]) {
    expect(card?.textContent).toContain(source);
  }
});

test("a table's skeleton stands an avatar's bone only in the column an account lands in", async () => {
  const region = loadingRegion(await draw(costScreen()));
  const avatars = (label: string) =>
    Array.from(
      region.querySelectorAll(`table[aria-label="${label}"] tbody tr`),
      (row) => row.querySelectorAll('.luke-skeleton[data-shape="circle"]').length,
    );
  expect(avatars("List-price equivalent by model").every((count) => count === 0)).toBe(true);
  const accounts = avatars("Accounts with the highest list-price equivalent");
  expect(accounts.length).toBeGreaterThan(0);
  expect(accounts.every((count) => count === 1)).toBe(true);
});

test("a past day's cards stand no hint, as its loaded cards say none", async () => {
  const region = loadingRegion(
    await draw(createElement(DayScreen, { ...QUIET, day: "2026-01-05", onBack: () => undefined })),
  );
  const cards = [...region.querySelectorAll(".luke-card")].slice(0, 2);
  expect(cards).toHaveLength(2);
  // A card's label and its figure, and no third bone for a hint.
  for (const card of cards) expect(card.querySelectorAll(".luke-skeleton")).toHaveLength(2);
});

test("the Users roster stands its table and its sign-in methods while it is read", async () => {
  const region = loadingRegion(await draw(createElement(UsersScreen, QUIET)));
  const headers = Array.from(region.querySelectorAll("thead th"), (cell) => cell.textContent);
  expect(headers).toEqual(expect.arrayContaining(["Account", "Joined", "Last seen"]));
  expect(sectionHeadings(region)).toEqual(["Sign-in methods"]);
});

test("the Workspaces page stands its four tiles over its table while it is read", async () => {
  const region = loadingRegion(await draw(createElement(WorkspacesScreen, QUIET)));
  expect(region.querySelectorAll(".luke-card").length).toBeGreaterThanOrEqual(5);
  const headers = Array.from(region.querySelectorAll("thead th"), (cell) => cell.textContent);
  expect(headers).toEqual(expect.arrayContaining(["Workspace", "Owner", "Created"]));
});

test("the Reliability page's skeleton states the notes the loaded page states", async () => {
  const region = loadingRegion(await draw(createElement(ReliabilityScreen, QUIET)));
  expect(region.textContent).toContain("Per-request HTTP error rates live in product analytics");
  expect(region.textContent).toContain(
    "A broken key, integration, or GitHub installation fails the account's agents quietly.",
  );
});

test("an account's skeleton stands every section the account page states, down to its failures", async () => {
  const region = loadingRegion(
    await draw(
      createElement(AccountScreen, { ...QUIET, id: "account-ada", onBack: () => undefined }),
    ),
  );
  expect(sectionHeadings(region)).toEqual([
    "Daily use · hosted tier",
    "Volume",
    "Work",
    "Recent agents",
    "Workspaces",
    "Keys and connections",
    "Defaults and experiments",
    "Recent failures · 30 days",
  ]);
  expect(region.textContent).toContain("Each cell is one UTC day, whatever the window.");
});
