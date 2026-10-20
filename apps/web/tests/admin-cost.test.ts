// @vitest-environment jsdom
import type { AdminCost } from "@luke/service/admin/admin-cost-wire";
import { SECONDS_LIST_PRICE } from "@luke/service/admin/admin-cost-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { CostScreen } from "../src/admin/screens/cost";

/**
 * admin-cost.test.ts -- the Cost screen reads its window and scope from the
 * service, states each headline tile in words, names every dollar figure a
 * list-price equivalent and says it is not what Luke pays, shows a model the
 * catalog does not price as unpriced rather than as dollars, and opens an expensive account's own page from its
 * row. The network, the HTTP boundary to Luke, is a fake that answers the
 * screen's read.
 */

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const DAY = {
  day: "2026-10-17",
  "coding-agents": 12.5,
  luke: 3,
  voice: 0.5,
  dictation: 0.01,
  avatar: 0,
};

/** A synthetic week: one priced model, one the catalog does not price, and one account. */
function cost(overrides: Partial<AdminCost> = {}): AdminCost {
  return {
    generatedAt: Date.UTC(2026, 9, 17, 12),
    windowDays: 7,
    catalogAvailable: true,
    totals: {
      spendUsd: 16.01,
      trend: { days: 7, recent: 16.01, prior: 8 },
      unpricedTokens: 2_500_000,
    },
    perAccount: { accounts: 4, meanUsd: 4.0025, medianUsd: 1.5 },
    perMergedPullRequest: { mergedPullRequests: 2, spendUsd: 8.005 },
    voice: { minutes: 10, spendUsd: 0.5, unpricedMinutes: 0 },
    daily: [DAY],
    byModel: [
      {
        model: "anthropic/claude-test",
        spendUsd: 15.5,
        pricedTokens: 3_000_000,
        unpricedTokens: 0,
      },
      {
        model: "openai/retired-test",
        spendUsd: null,
        pricedTokens: 0,
        unpricedTokens: 2_500_000,
      },
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
    ...overrides,
  };
}

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.body.replaceChildren();
});

/** The screen, signed in, with its read answered by `body`, every address it asked kept in `asked`. */
async function openCost(
  body: AdminCost,
  opened: string[] = [],
  asked: string[] = [],
): Promise<HTMLElement> {
  vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    asked.push(String(input));
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  window.localStorage.setItem("luke-admin-sign-in-chosen", "true");
  const page = document.createElement("div");
  document.body.replaceChildren(page);
  root = createRoot(page);
  await act(async () => {
    root?.render(
      createElement(CostScreen, {
        hideAdmins: true,
        onHideAdminsChange: () => undefined,
        windowDays: 7,
        onWindowDaysChange: () => undefined,
        account: undefined,
        onSignOut: async () => undefined,
        onOpenAccount: (id) => opened.push(id),
        frame: (content) => content,
      }),
    );
  });
  return page;
}

/** The words of the card whose name is `label`, its figure and hint after it. */
function cardOf(page: HTMLElement, label: string): string {
  const name = Array.from(page.querySelectorAll("div")).find(
    (element) => element.children.length === 0 && element.textContent === label,
  );
  return name?.parentElement?.parentElement?.textContent ?? "";
}

/** One table's body rows, each as the words of its cells. */
function rowsOf(page: HTMLElement, label: string): string[][] {
  const table = page.querySelector(`table[aria-label="${label}"]`);
  return Array.from(table?.querySelectorAll("tbody tr") ?? [], (row) =>
    Array.from(row.querySelectorAll("td"), (cell) => cell.textContent ?? ""),
  );
}

test("the screen reads the window it shows, admins left out", async () => {
  const asked: string[] = [];
  await openCost(cost(), [], asked);

  expect(asked).toEqual(["/api/admin/cost?window=7"]);
});

test("each headline tile reads its figure and its hint under its name", async () => {
  const page = await openCost(cost());

  expect(page.querySelector("h1")?.textContent).toBe("Cost");
  expect(cardOf(page, "List-price equivalent · 7 days")).toBe(
    "List-price equivalent · 7 days$16.01+100% vs the 7 days before · plus 2.5M unpriced tokens",
  );
  expect(cardOf(page, "List-price equivalent per active account")).toBe(
    "List-price equivalent per active account$4.00median $1.50 · 4 accounts",
  );
  expect(cardOf(page, "List-price equivalent per merged PR")).toBe(
    "List-price equivalent per merged PR$8.01the window's whole figure over 2 PRs merged",
  );
  expect(cardOf(page, "Voice minutes")).toBe("Voice minutes10$0.50 at gpt-live-1's list price");
});

test("every dollar figure is said to be a list-price equivalent, not what Luke pays", async () => {
  const page = await openCost(cost());

  expect(page.textContent).toContain("a list-price equivalent, not what Luke pays.");
  expect(page.textContent).toContain(
    "List prices leave out discounts, credits, plan fees, and which key paid.",
  );
  expect(page.textContent).not.toMatch(/\bspend\b/i);
  expect(page.textContent).toContain(
    "Voice is priced at gpt-live-1's $0.05 a minute, dictation at gpt-transcribe's $0.0045",
  );
  expect(page.textContent).not.toContain("Own key");
});

test("a model the catalog does not price reads as unpriced, never as dollars", async () => {
  const page = await openCost(cost());

  expect(rowsOf(page, "List-price equivalent by model")).toEqual([
    ["anthropic/claude-test", "$15.50", "3M"],
    ["openai/retired-test", "Unpriced", "2.5M"],
  ]);
});

test("a short call on an unpriced Live model still says it is there", async () => {
  const page = await openCost(cost({ voice: { minutes: 0.2, spendUsd: 0, unpricedMinutes: 0.2 } }));

  expect(cardOf(page, "Voice minutes")).toBe(
    "Voice minutes<1$0.00 at list price · <1 min on an unpriced model",
  );
});

test("a catalog that could not be read says no model token was priced", async () => {
  const page = await openCost(cost({ catalogAvailable: false }));

  expect(page.textContent).toContain("The catalog could not be read for this answer");
});

test("an expensive account's row opens its own page", async () => {
  const opened: string[] = [];
  const page = await openCost(cost(), opened);

  const [row] = rowsOf(page, "Accounts with the highest list-price equivalent");
  expect(row?.slice(1)).toEqual(["$12.50", "0", "—"]);
  const cell = page.querySelector(
    'table[aria-label="Accounts with the highest list-price equivalent"] tbody td:last-child',
  );
  act(() => cell?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(opened).toEqual(["account-ada"]);
});
