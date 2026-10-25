// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { type AdminDoors, AdminDoorsProvider, type AdminReads } from "./admin-doors.js";
import { AccountScreen } from "./screens/account.js";
import { CostScreen } from "./screens/cost.js";
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

function costScreen(): React.ReactElement {
  return createElement(CostScreen, { ...QUIET, windowDays: 7 });
}

test("the Cost chart's skeleton stands its own heading and legend, with no caption across from it", async () => {
  const region = loadingRegion(await draw(costScreen()));
  const heading = [...region.querySelectorAll("h3")].find(
    (title) => title.textContent === "Daily list-price equivalent by source, USD",
  );
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
