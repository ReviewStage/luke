// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  ACCOUNT_PROVIDER,
  ACCOUNT_STATUS,
  type AccountSnapshot,
} from "@sidecar/credentials/snapshot";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { UPDATE_STATUS, type UpdateSnapshot } from "#shared/messages/update";
import { navigationHistory } from "#testing/navigation-history";
import { plansControl } from "#testing/plans-control";
import { useAppKeymap } from "../app-commands";
import { PANEL_TAB, type PanelTab } from "../panel-tabs";
import { PLANS_PAGE } from "../planning/planning-model";
import type { PlansControl } from "../planning/use-plans-tab";
import { DesktopSidebar } from "./desktop-sidebar";
import { SIDEBAR_WIDTH } from "./sidebar-collapse";

const PHOTO = "https://avatars.githubusercontent.com/u/1?v=4";

const DEAN: AccountSnapshot = {
  status: ACCOUNT_STATUS.SIGNED_IN,
  email: "dean@example.com",
  name: "Dean Stratakos",
  provider: ACCOUNT_PROVIDER.GITHUB,
};

const UP_TO_DATE: UpdateSnapshot = {
  status: UPDATE_STATUS.IDLE,
  currentVersion: "0.10.0",
  installSupported: true,
  upToDate: true,
};

const READY: UpdateSnapshot = {
  status: UPDATE_STATUS.READY,
  currentVersion: "0.10.0",
  installSupported: true,
  latestVersion: "0.11.0",
};

const roots: Root[] = [];

/** Takes down every mounted sidebar, so no keymap outlives its test. */
function unmountAll(): void {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
}

function mount(
  account: AccountSnapshot,
  options: {
    update?: UpdateSnapshot;
    onInstall?: () => void;
    onTabChange?: (tab: PanelTab) => void;
    tab?: PanelTab;
    plans?: Partial<PlansControl>;
    /** Whether the run keeps none of the sidebar's preferences, as a fixture run does. */
    staged?: boolean;
  } = {},
): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  // The window's keymap stands beside the sidebar, as `App` stands it.
  function Keyed(props: Parameters<typeof DesktopSidebar>[0]) {
    useAppKeymap(true);
    return createElement(DesktopSidebar, props);
  }
  act(() => {
    root.render(
      createElement(Keyed, {
        sidebar: {
          collapsed: false,
          width: SIDEBAR_WIDTH.DEFAULT,
          onToggle: () => undefined,
          onResize: () => undefined,
          staged: options.staged ?? false,
        },
        identity: {
          speakers: { listening: false, lukeSpeaking: false },
          voiceActive: { developer: false, luke: false },
          fixtureSpeaking: false,
          voiceOpening: false,
        },
        history: navigationHistory(),
        plans: plansControl(options.plans),
        tab: options.tab ?? PANEL_TAB.PLANS,
        onTabChange: options.onTabChange ?? (() => undefined),
        account,
        updates: {
          update: options.update ?? UP_TO_DATE,
          onCheck: () => Promise.resolve(),
          onInstall: options.onInstall ?? (() => undefined),
          onOpenLatest: () => undefined,
        },
      }),
    );
  });
  return container;
}

function accountButton(container: ParentNode): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(".sidebar-foot .sidebar-account");
  assert.ok(button, "the foot draws the account button");
  return button;
}

beforeEach(() => {
  // Luke's face reads the reduced-motion preference, which jsdom has no media for.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
});

afterEach(unmountAll);

test("the account button is the one way to Settings, and pressing it opens Settings", () => {
  const opened: PanelTab[] = [];
  const container = mount(DEAN, { onTabChange: (tab) => opened.push(tab) });

  assert.equal(container.querySelectorAll(".sidebar-foot button").length, 1);
  act(() => accountButton(container).click());

  assert.deepEqual(opened, [PANEL_TAB.SETTINGS]);
});

test("the account button shows the provider's photo and the account's name", () => {
  const button = accountButton(mount({ ...DEAN, pictureUrl: PHOTO }));

  assert.equal(button.querySelector("img")?.getAttribute("src"), PHOTO);
  assert.equal(button.querySelector(".sidebar-account-name")?.textContent, "Dean Stratakos");
});

test("without a photo the account button shows the initial, and the email where there is no name", () => {
  const { name: _, ...nameless } = DEAN;
  const button = accountButton(mount(nameless));

  assert.equal(button.querySelector("img"), null);
  assert.equal(button.querySelector(".sidebar-avatar")?.textContent, "D");
  assert.equal(button.querySelector(".sidebar-account-name")?.textContent, "dean@example.com");
});

test("a photo that fails to load falls back to the initial", () => {
  const button = accountButton(mount({ ...DEAN, pictureUrl: PHOTO }));
  const photo = button.querySelector("img");
  assert.ok(photo);

  act(() => {
    photo.dispatchEvent(new Event("error"));
  });

  assert.equal(button.querySelector("img"), null);
  assert.equal(button.querySelector(".sidebar-avatar")?.textContent, "D");
});

test("signed out, the button still leads to Settings and says so", () => {
  const opened: PanelTab[] = [];
  const button = accountButton(
    mount({ status: ACCOUNT_STATUS.SIGNED_OUT }, { onTabChange: (tab) => opened.push(tab) }),
  );

  assert.equal(button.querySelector("img"), null);
  assert.equal(button.querySelector(".sidebar-account-name")?.textContent, "Settings");
  act(() => button.click());
  assert.deepEqual(opened, [PANEL_TAB.SETTINGS]);
});

function updateControl(container: ParentNode): HTMLElement | null {
  return container.querySelector<HTMLElement>(".sidebar-foot > :not(.sidebar-account)");
}

test("a downloaded release puts Restart to update above the account row, and pressing it installs", () => {
  let installs = 0;
  const container = mount(DEAN, {
    update: READY,
    onInstall: () => {
      installs += 1;
    },
  });
  const control = updateControl(container);
  assert.ok(control instanceof HTMLButtonElement, "the foot draws the update button");
  assert.equal(control.textContent, "Restart to update");
  assert.ok(
    control.nextElementSibling === accountButton(container),
    "it stands just above the account row",
  );

  act(() => control.click());

  assert.equal(installs, 1);
});

test("a downloading release is a quiet line with how far along it is, and nothing to press", () => {
  const container = mount(DEAN, {
    update: {
      status: UPDATE_STATUS.DOWNLOADING,
      currentVersion: "0.10.0",
      installSupported: true,
      latestVersion: "0.11.0",
      progress: { percent: 41.7, transferredBytes: 417, totalBytes: 1000 },
    },
  });
  const control = updateControl(container);

  assert.equal(control?.getAttribute("role"), "status");
  assert.equal(control?.textContent, "Downloading update… 42%");
  assert.equal(container.querySelectorAll(".sidebar-foot button").length, 1);
});

test("up to date, checking, or unable to install in place, the sidebar draws no update control", () => {
  const unsupported: UpdateSnapshot = { ...READY, installSupported: false };
  for (const update of [
    UP_TO_DATE,
    { status: UPDATE_STATUS.CHECKING, currentVersion: "0.10.0", installSupported: true },
    unsupported,
  ] as const) {
    assert.equal(updateControl(mount(DEAN, { update })), null);
  }
});

test("the gear's dot stands down while the sidebar carries the release, and marks a failed one", () => {
  const ready = accountButton(mount(DEAN, { update: READY }));
  assert.equal(ready.querySelector(".tab-note"), null);

  const failed = accountButton(
    mount(DEAN, {
      update: {
        status: UPDATE_STATUS.ERROR,
        currentVersion: "0.10.0",
        installSupported: true,
        latestVersion: "0.11.0",
      },
    }),
  );
  const note = failed.querySelector(".tab-note")?.getAttribute("title");
  assert.match(note ?? "", /could not be installed/u);
  assert.match(failed.textContent ?? "", /could not be installed/u);
});

function newPlanButton(container: ParentNode): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(".sidebar-new-plan");
  assert.ok(button, "the sidebar draws New plan");
  return button;
}

test("New plan is the selected row whenever the Plans tab has no plan open, as a plan row is when it is", () => {
  const PLAN_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
  const home = mount(DEAN);
  const onPlan = mount(DEAN, { plans: { page: PLANS_PAGE.DOCUMENT, activePlanId: PLAN_ID } });
  const onSettings = mount(DEAN, { tab: PANEL_TAB.SETTINGS });

  assert.equal(newPlanButton(home).getAttribute("aria-current"), "page");
  assert.equal(newPlanButton(onPlan).getAttribute("aria-current"), null);
  assert.equal(newPlanButton(onSettings).getAttribute("aria-current"), null);
});

test("New plan from Settings brings the Plans tab forward and asks for the new-plan page", () => {
  const opened: PanelTab[] = [];
  let asked = false;
  const container = mount(DEAN, {
    tab: PANEL_TAB.SETTINGS,
    onTabChange: (tab) => opened.push(tab),
    plans: {
      onNewPlan: () => {
        asked = true;
      },
    },
  });

  act(() => newPlanButton(container).click());

  assert.deepEqual(opened, [PANEL_TAB.PLANS]);
  assert.equal(asked, true);
});

test("Option-Command-Up and Down walk the list as it reads, New plan at its head, and stop at its ends", () => {
  const FIRST = {
    id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
    name: "Invitations",
    createdAt: 1,
    updatedAt: 1,
    repository: null,
  };
  const SECOND = {
    id: "0c9a3f1e-6b2d-4e8f-a1c7-3d5e7f9a1b2c",
    name: "Billing",
    createdAt: 2,
    updatedAt: 2,
    repository: null,
  };
  const opened: string[] = [];
  let home = 0;
  const step = (activePlanId: string | undefined, key: string): boolean => {
    unmountAll();
    mount(DEAN, {
      plans: {
        page: activePlanId === undefined ? PLANS_PAGE.NEW : PLANS_PAGE.DOCUMENT,
        activePlanId,
        plans: [FIRST, SECOND],
        onSelect: (planId) => opened.push(planId),
        onNewPlan: () => {
          home += 1;
        },
      },
    });
    const event = new KeyboardEvent("keydown", {
      key,
      code: key,
      metaKey: true,
      altKey: true,
      cancelable: true,
    });
    act(() => {
      window.dispatchEvent(event);
    });
    return event.defaultPrevented;
  };

  assert.equal(step(undefined, "ArrowDown"), true);
  assert.equal(step(FIRST.id, "ArrowDown"), true);
  assert.deepEqual(opened, [FIRST.id, SECOND.id]);
  assert.equal(step(SECOND.id, "ArrowDown"), false, "the last plan goes no further");

  assert.equal(step(SECOND.id, "ArrowUp"), true);
  assert.equal(step(FIRST.id, "ArrowUp"), true);
  assert.deepEqual(opened, [FIRST.id, SECOND.id, FIRST.id]);
  assert.equal(home, 1, "up from the first plan is the new-plan page");
  assert.equal(step(undefined, "ArrowUp"), false, "the new-plan page goes no further");
});

test("New plan names its chord, which it shows at its end only while hovered or reached from the keyboard", () => {
  const button = newPlanButton(mount(DEAN));
  assert.equal(button.getAttribute("aria-keyshortcuts"), "Meta+N");
  const hint = button.querySelector(".row-shortcut");
  assert.equal(hint?.textContent, "⌘N");
  assert.equal(hint?.getAttribute("aria-hidden"), "true");
});

/** A plan's row of the list, with whatever pin or archive it is given. */
function listedPlan(name: string, marks: { pinnedAt?: number; archivedAt?: number } = {}) {
  return { id: `plan-${name}`, name, createdAt: 1, updatedAt: 1, repository: null, ...marks };
}

/** Each section the sidebar draws, by its heading, with the names of the plans under it. */
function sections(container: HTMLElement): [string, string[]][] {
  return [...container.querySelectorAll<HTMLElement>(".sidebar-group")].map((group) => [
    group.getAttribute("aria-label") ?? "",
    [...group.querySelectorAll(".sidebar-plan-name")].map((name) => name.textContent ?? ""),
  ]);
}

test("the pinned plans stand under Pinned above the rest only while any are pinned", () => {
  const flat = mount(DEAN, { plans: { plans: [listedPlan("Billing"), listedPlan("Invites")] } });
  const pinned = mount(DEAN, {
    plans: { plans: [listedPlan("Invites", { pinnedAt: 5 }), listedPlan("Billing")] },
  });

  assert.deepEqual(sections(flat), [["Plans", ["Billing", "Invites"]]]);
  assert.deepEqual(sections(pinned), [
    ["Pinned", ["Invites"]],
    ["Plans", ["Billing"]],
  ]);
});

test("the archived plans fold away behind a row that counts them, which unfolds them under the rest", () => {
  const opened: string[] = [];
  const archived = [listedPlan("Old", { archivedAt: 9 }), listedPlan("Older", { archivedAt: 8 })];
  const container = mount(DEAN, {
    plans: { plans: [listedPlan("Billing")], archived, onSelect: (planId) => opened.push(planId) },
  });
  const row = container.querySelector<HTMLButtonElement>(".sidebar-archived-row");
  assert.ok(row);

  const folded = sections(container);
  act(() => row.click());
  const unfolded = sections(container);
  const old = [...container.querySelectorAll<HTMLButtonElement>("button.sidebar-plan")].at(1);
  act(() => old?.click());

  assert.equal(row.textContent, "Archived (2)");
  assert.deepEqual(folded, [["Plans", ["Billing"]]]);
  assert.equal(row.getAttribute("aria-expanded"), "true");
  assert.deepEqual(unfolded, [["Plans", ["Billing", "Old", "Older"]]]);
  assert.deepEqual(opened, ["plan-Old"]);
});

test("with every plan archived, the list says nothing of having none, and with none archived it draws no Archived row", () => {
  const allArchived = mount(DEAN, { plans: { archived: [listedPlan("Old", { archivedAt: 9 })] } });
  const none = mount(DEAN, { plans: { plans: [listedPlan("Billing")] } });
  const empty = mount(DEAN);

  assert.doesNotMatch(allArchived.textContent ?? "", /No plans yet/u);
  assert.equal(none.querySelector(".sidebar-archived-row"), null);
  assert.match(empty.textContent ?? "", /No plans yet/u);
});

/** A plan's row of the list on a repository, last updated at `updatedAt`. */
function onRepository(name: string, repository: string | null, updatedAt = 1) {
  return { id: `plan-${name}`, name, createdAt: 1, updatedAt, repository };
}

/** Each repository group the Plans section draws, by its header, with the plans standing under it. */
function groups(container: HTMLElement): [string, string[]][] {
  return [...container.querySelectorAll<HTMLElement>(".sidebar-repository")].map((group) => [
    group.querySelector(".sidebar-repository-name")?.textContent ?? "",
    [...group.querySelectorAll(".sidebar-plan-name")].map((name) => name.textContent ?? ""),
  ]);
}

function header(container: HTMLElement, name: string): HTMLElement {
  const found = [...container.querySelectorAll<HTMLElement>(".sidebar-repository-header")].find(
    (candidate) => candidate.querySelector(".sidebar-repository-name")?.textContent === name,
  );
  assert.ok(found, `the ${name} group is drawn`);
  return found;
}

test("the plans stand under their repositories' headers, newest updated group first and No repository last, the pinned ones flat and naming theirs", () => {
  window.localStorage.clear();
  const container = mount(DEAN, {
    plans: {
      plans: [
        { ...onRepository("Invites", "acme/relay", 5), pinnedAt: 9 },
        onRepository("Notes", null, 99),
        onRepository("Search", "acme/relay", 20),
        onRepository("Billing", "acme/ledger", 40),
      ],
    },
  });

  assert.deepEqual(groups(container), [
    ["ledger", ["Billing"]],
    ["relay", ["Search"]],
    ["No repository", ["Notes"]],
  ]);
  const pinned = container.querySelector("nav[aria-label='Pinned'] .sidebar-plan");
  assert.equal(pinned?.querySelector(".sidebar-plan-repository")?.textContent, "acme/relay");
  assert.equal(
    container.querySelector(".sidebar-repository .sidebar-plan-repository"),
    null,
    "a grouped row leaves its repository to the header",
  );
});

test("a group folded stays folded when the sidebar stands again, and walking the list passes its plans over", () => {
  window.localStorage.clear();
  const plans = {
    plans: [onRepository("Billing", "acme/ledger", 2), onRepository("Search", "acme/relay")],
  };
  const first = mount(DEAN, { plans });
  const toggle = header(first, "ledger").querySelector<HTMLButtonElement>(
    ".sidebar-repository-toggle",
  );
  assert.ok(toggle);
  act(() => toggle.click());
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  unmountAll();

  const opened: string[] = [];
  const again = mount(DEAN, { plans: { ...plans, onSelect: (planId) => opened.push(planId) } });
  const event = new KeyboardEvent("keydown", {
    key: "ArrowDown",
    code: "ArrowDown",
    metaKey: true,
    altKey: true,
    cancelable: true,
  });
  act(() => {
    window.dispatchEvent(event);
  });

  assert.deepEqual(groups(again), [
    ["ledger", []],
    ["relay", ["Search"]],
  ]);
  assert.deepEqual(opened, ["plan-Search"]);
});

test("a repository's + asks for a new plan on it and folds nothing, and No repository offers none", () => {
  window.localStorage.clear();
  const asked: string[] = [];
  const container = mount(DEAN, {
    plans: {
      plans: [onRepository("Billing", "acme/ledger"), onRepository("Notes", null)],
      onNewPlanIn: (repository) => asked.push(repository),
    },
  });
  const plus = header(container, "ledger").querySelector<HTMLButtonElement>(
    ".sidebar-repository-new",
  );
  assert.ok(plus);

  act(() => plus.click());

  assert.equal(plus.getAttribute("aria-label"), "New plan in ledger");
  assert.deepEqual(asked, ["acme/ledger"]);
  assert.deepEqual(groups(container)[0], ["ledger", ["Billing"]]);
  assert.equal(header(container, "No repository").querySelector(".sidebar-repository-new"), null);
});

/** Option-Command and an arrow pressed in the window, answering whether the window claimed it. */
function walk(key: "ArrowUp" | "ArrowDown"): boolean {
  const event = new KeyboardEvent("keydown", {
    key,
    code: key,
    metaKey: true,
    altKey: true,
    cancelable: true,
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

test("the open plan under a folded group still walks to its neighbours", () => {
  window.localStorage.setItem("luke.sidebarFoldedGroups", JSON.stringify(["acme/relay"]));
  const opened: string[] = [];
  mount(DEAN, {
    plans: {
      page: PLANS_PAGE.DOCUMENT,
      activePlanId: "plan-Search",
      plans: [
        onRepository("Billing", "acme/ledger", 9),
        onRepository("Search", "acme/relay", 5),
        onRepository("Notes", null),
      ],
      onSelect: (planId) => opened.push(planId),
    },
  });

  assert.equal(walk("ArrowUp"), true);
  assert.equal(walk("ArrowDown"), true);
  assert.deepEqual(opened, ["plan-Billing", "plan-Notes"]);
  window.localStorage.clear();
});

test("a fixture run's sidebar wears none of the folds this Mac kept, and keeps none of its own", () => {
  window.localStorage.setItem("luke.sidebarFoldedGroups", JSON.stringify(["acme/ledger"]));
  const container = mount(DEAN, {
    staged: true,
    plans: { plans: [onRepository("Billing", "acme/ledger")] },
  });
  const toggle = header(container, "ledger").querySelector<HTMLButtonElement>(
    ".sidebar-repository-toggle",
  );
  assert.ok(toggle);

  const unfolded = groups(container);
  act(() => toggle.click());

  assert.deepEqual(unfolded, [["ledger", ["Billing"]]]);
  assert.deepEqual(groups(container), [["ledger", []]]);
  assert.equal(window.localStorage.getItem("luke.sidebarFoldedGroups"), '["acme/ledger"]');
  window.localStorage.clear();
});

test("a plan row naming its repository leads the name with its owner's picture, and a fixture run with the GitHub mark", () => {
  const plans = { plans: [{ ...onRepository("Invites", "acme/relay"), pinnedAt: 9 }] };
  const live = mount(DEAN, { plans });
  const staged = mount(DEAN, {
    plans: { ...plans, repositories: { ...plansControl().repositories, pictures: false } },
  });

  const named = (container: HTMLElement) =>
    container.querySelector("nav[aria-label='Pinned'] .sidebar-plan-repository");
  assert.equal(named(live)?.textContent, "acme/relay");
  assert.equal(
    named(live)?.querySelector("img")?.getAttribute("src"),
    "https://github.com/acme.png?size=32",
  );
  assert.equal(named(staged)?.querySelector("img"), null);
  assert.ok(named(staged)?.querySelector("svg.account-mark"));
});
