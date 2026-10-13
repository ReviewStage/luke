// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  ACCOUNT_PROVIDER,
  ACCOUNT_STATUS,
  type AccountSnapshot,
} from "@sidecar/credentials/snapshot";
import {
  CHECK_SUMMARY,
  type CheckSummary,
  CODING_AGENT_STATUS,
  type CodingAgentSummary,
  PULL_REQUEST_STATE,
  type PullRequestState,
} from "@sidecar/hosted/coding-agent-wire";
import type { Plan, PlanAgentsSummary, PlanSummary } from "@sidecar/hosted/plan-wire";
import { PLAN_CALL_FAILURE } from "@sidecar/hosted/planning-view";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { act, createElement, Fragment, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "#shared/messages/acts";
import { UPDATE_STATUS, type UpdateSnapshot } from "#shared/messages/update";
import { APP_COMMAND } from "#shared/shortcuts";
import { onRegistry, registryOnTestClock } from "#testing/copy-feedback";
import { ringClipping, sheetStyle } from "#testing/css-rules";
import { navigationHistory } from "#testing/navigation-history";
import { codingAgentsControl, plansControl } from "#testing/plans-control";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { useAppCommand, useAppKeymap } from "../app-commands";
import { PANEL_TAB, type PanelTab } from "../panel-tabs";
import { PLAN_MARK, PLANS_PAGE, type PlanMark } from "../planning/planning-model";
import { MAIN_TAB } from "../planning/use-main-tabs";
import { PLAN_LOOK, usePlanLooks } from "../planning/use-plan-looks";
import type { PlansControl } from "../planning/use-plans-tab";
import { type PinnedTab, SIDE_PANEL_TAB } from "../planning/use-side-panel";
import { CommandPalette } from "./command-palette";
import { DesktopSidebar } from "./desktop-sidebar";
import { SIDEBAR_WIDTH } from "./sidebar-collapse";
import "../file-tree/index";

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

/** What a mounted sidebar may stand again with: folded away or back in sight, or with other plans. */
interface Restage {
  collapsed?: boolean;
  plans?: Partial<PlansControl>;
}

/** Each mounted sidebar's way to stand again with a change, by its container. */
const restages = new WeakMap<HTMLElement, (change: Restage) => void>();

/** Takes down every mounted sidebar, so no keymap outlives its test. */
function unmountAll(): void {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
}

interface MountOptions {
  update?: UpdateSnapshot;
  onSignOut?: () => Promise<void>;
  onInstall?: () => void;
  onOpenLatest?: () => void;
  onTabChange?: (tab: PanelTab) => void;
  tab?: PanelTab;
  plans?: Partial<PlansControl>;
  /** Whether the run keeps none of the sidebar's preferences, as a fixture run does. */
  staged?: boolean;
  /** The atoms' registry, a fresh one where none is given, so a launch starts from what storage kept. */
  registry?: AtomRegistry.AtomRegistry;
  /** What the window draws beside the sidebar: the open plan's region. */
  beside?: ReactElement;
}

function mount(account: AccountSnapshot, options: MountOptions = {}): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const registry = options.registry ?? AtomRegistry.make();
  // The window's keymap and command palette stand beside the sidebar, as
  // `App` stands them.
  function Keyed(props: Parameters<typeof DesktopSidebar>[0]) {
    useAppKeymap(true);
    return createElement(
      Fragment,
      null,
      createElement(DesktopSidebar, props),
      createElement(CommandPalette, {
        available: true,
        tab: props.tab,
        onTabChange: props.onTabChange,
        plans: props.plans,
        settings: { rows: undefined, onViewChange: () => undefined },
        readFiles: () => Promise.resolve({ failure: PLAN_CALL_FAILURE.UNANSWERED }),
      }),
    );
  }
  const render = ({ collapsed = false, plans = options.plans }: Restage) =>
    root.render(
      onRegistry(
        registry,
        createElement(
          "div",
          null,
          createElement(Keyed, {
            sidebar: {
              collapsed,
              width: SIDEBAR_WIDTH.DEFAULT,
              onToggle: () => undefined,
              onResize: () => undefined,
              staged: options.staged ?? false,
            },
            history: navigationHistory(),
            call: undefined,
            plans: plansControl(plans),
            tab: options.tab ?? PANEL_TAB.PLANS,
            onTabChange: options.onTabChange ?? (() => undefined),
            account,
            onSignOut: options.onSignOut ?? (() => Promise.resolve()),
            updates: {
              update: options.update ?? UP_TO_DATE,
              onCheck: () => Promise.resolve(),
              onInstall: options.onInstall ?? (() => undefined),
              onOpenLatest: options.onOpenLatest ?? (() => undefined),
            },
          }),
          options.beside,
        ),
      ),
    );
  act(() => render({}));
  restages.set(container, (change) => act(() => render(change)));
  return container;
}

function accountButton(container: ParentNode): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(".sidebar-foot .sidebar-account");
  assert.ok(button, "the foot draws the account button");
  return button;
}

function settingsButton(container: ParentNode): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(
    '.sidebar-foot button[aria-label="Settings"]',
  );
  assert.ok(button, "the foot draws Settings' gear");
  return button;
}

function accountMenu(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="menu"][aria-label="Account"]');
}

/** The open account menu as it reads down: its heading, each item's label and chord, and a dash for each rule. */
function accountMenuLines(): string[] {
  const menu = accountMenu();
  assert.ok(menu, "the account's menu stands");
  return [...menu.children]
    .filter((line) => line.getAttribute("role") !== "menu")
    .map((line) => {
      if (line.matches("hr")) return "—";
      const words = [...line.querySelectorAll(":scope > span, :scope > kbd")].map(
        (part) => part.textContent ?? "",
      );
      return words.filter((word) => word !== "").join(" ");
    });
}

/** The open account menu's own item by its label, not a submenu's. */
function accountItem(label: string): HTMLButtonElement {
  const item = [...(accountMenu()?.children ?? [])].find(
    (line): line is HTMLButtonElement =>
      line instanceof HTMLButtonElement &&
      line.querySelector(".plan-menu-label")?.textContent === label,
  );
  assert.ok(item, `the account's menu offers ${label}`);
  return item;
}

function submenu(): HTMLElement | null {
  return (
    accountMenu()?.querySelector<HTMLElement>('[role="menu"][aria-label="Contact us"]') ?? null
  );
}

function submenuLabels(): string[] {
  return [...(submenu()?.querySelectorAll('[role="menuitem"]') ?? [])].map(
    (item) => item.textContent ?? "",
  );
}

function submenuItem(label: string): HTMLButtonElement {
  const item = [
    ...(submenu()?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
  ].find((candidate) => candidate.textContent === label);
  assert.ok(item, `Contact us offers ${label}`);
  return item;
}

function keyDown(target: Element | null, key: string): void {
  assert.ok(target, `something holds focus for ${key}`);
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="alertdialog"]');
}

function dialogButton(label: string): HTMLButtonElement {
  const button = [...(dialog()?.querySelectorAll("button") ?? [])].find(
    (candidate) => candidate.textContent === label,
  );
  assert.ok(button, `the dialog offers ${label}`);
  return button;
}

/** The Help menu's commands, offered as `App` offers them, each press written down. */
function HelpOffers({ ran }: { ran: string[] }): null {
  useAppCommand(APP_COMMAND.SEND_FEEDBACK, () => ran.push(APP_COMMAND.SEND_FEEDBACK));
  useAppCommand(APP_COMMAND.SUGGEST_FEATURE, () => ran.push(APP_COMMAND.SUGGEST_FEATURE));
  useAppCommand(APP_COMMAND.KEYBOARD_SHORTCUTS, () => ran.push(APP_COMMAND.KEYBOARD_SHORTCUTS));
  return null;
}

/** Every act the sidebar sent, in order. */
let sent: Act[] = [];

beforeEach(() => {
  sent = [];
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: {
      act: (request: Act): Promise<ActOutcome> => {
        sent.push(request);
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: undefined });
      },
    },
  });
  installScrollIntoView();
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

afterEach(() => {
  unmountAll();
  window.localStorage.clear();
  delete document.documentElement.dataset.keyboard;
});

test("the gear is the one press to Settings, beside the account, and marks Settings while it is on show", () => {
  const opened: PanelTab[] = [];
  const container = mount(DEAN, { onTabChange: (tab) => opened.push(tab) });
  const gear = settingsButton(container);

  assert.equal(gear.previousElementSibling, accountButton(container), "it ends the account's row");
  assert.equal(gear.getAttribute("aria-keyshortcuts"), "Meta+,");
  act(() => gear.click());

  assert.deepEqual(opened, [PANEL_TAB.SETTINGS]);
  assert.equal(gear.getAttribute("aria-current"), null);
  assert.equal(
    settingsButton(mount(DEAN, { tab: PANEL_TAB.SETTINGS })).getAttribute("aria-current"),
    "page",
  );
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

test("the account opens its menu: who is signed in, then Settings, the Help menu's offers, Contact us, and Log out, parted by rules", () => {
  const opened: PanelTab[] = [];
  const container = mount(DEAN, { onTabChange: (tab) => opened.push(tab) });
  const button = accountButton(container);
  assert.equal(button.getAttribute("aria-haspopup"), "menu");

  act(() => button.click());

  assert.equal(button.getAttribute("aria-expanded"), "true");
  assert.deepEqual(accountMenuLines(), [
    "Dean Stratakos dean@example.com",
    "—",
    "Settings ⌘,",
    "—",
    "Changelog",
    "Send feedback…",
    "Suggest a feature…",
    "Keyboard shortcuts ⌘/",
    "Contact us",
    "—",
    "Log out",
  ]);
  assert.equal(document.activeElement?.textContent, "Settings⌘,", "focus lands on its first item");
  act(() => accountItem("Settings").click());
  assert.deepEqual(opened, [PANEL_TAB.SETTINGS]);
  assert.equal(accountMenu(), null, "choosing closes it");
  assert.equal(document.activeElement, button, "and hands focus back to the account");
});

test("the account's menu offers the Help menu's own commands and opens the changelog, each closing the menu", () => {
  const ran: string[] = [];
  const container = mount(DEAN, { beside: createElement(HelpOffers, { ran }) });
  for (const label of ["Send feedback…", "Suggest a feature…", "Keyboard shortcuts", "Changelog"]) {
    act(() => accountButton(container).click());
    act(() => accountItem(label).click());
    assert.equal(accountMenu(), null);
  }

  assert.deepEqual(ran, [
    APP_COMMAND.SEND_FEEDBACK,
    APP_COMMAND.SUGGEST_FEATURE,
    APP_COMMAND.KEYBOARD_SHORTCUTS,
  ]);
  assert.deepEqual(sent, [{ kind: ACT_KIND.UPDATE_OPEN_CHANGELOG }]);
});

test("Contact us opens GitHub and Email beside it, by press or Right, Left or Escape closing it alone, and each writes to Luke's own people", () => {
  const container = mount(DEAN);
  act(() => accountButton(container).click());
  const contact = accountItem("Contact us");
  assert.equal(contact.getAttribute("aria-haspopup"), "menu");

  act(() => contact.click());
  assert.equal(contact.getAttribute("aria-expanded"), "true");
  assert.deepEqual(submenuLabels(), ["GitHub", "Email"]);
  assert.equal(document.activeElement?.textContent, "GitHub", "focus moves into it");
  keyDown(document.activeElement, "ArrowDown");
  assert.equal(document.activeElement?.textContent, "Email", "its arrows walk its own items");
  keyDown(document.activeElement, "ArrowLeft");
  assert.deepEqual(submenuLabels(), []);
  assert.equal(document.activeElement, contact, "Left hands focus back to Contact us");
  assert.ok(accountMenu(), "and leaves the menu standing");

  keyDown(contact, "ArrowRight");
  assert.deepEqual(submenuLabels(), ["GitHub", "Email"]);
  keyDown(document.activeElement, "Escape");
  assert.deepEqual(submenuLabels(), []);
  assert.ok(accountMenu(), "Escape in the submenu closes the submenu alone");

  act(() => contact.click());
  act(() => submenuItem("GitHub").click());
  assert.equal(accountMenu(), null);
  act(() => accountButton(container).click());
  act(() => accountItem("Contact us").click());
  act(() => submenuItem("Email").click());
  assert.equal(accountMenu(), null);

  assert.deepEqual(sent, [
    { kind: ACT_KIND.GITHUB_OPEN, payload: { url: "https://github.com/ReviewStage/luke/issues" } },
    { kind: ACT_KIND.CONTACT_EMAIL },
  ]);
});

test("resting on Contact us opens its submenu without taking focus, and resting on or walking to another item closes it", () => {
  const container = mount(DEAN);
  act(() => accountButton(container).click());
  const focused = document.activeElement;

  act(() => {
    accountItem("Contact us").dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  assert.deepEqual(submenuLabels(), ["GitHub", "Email"]);
  assert.equal(document.activeElement, focused);

  act(() => {
    submenuItem("Email").dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  assert.deepEqual(submenuLabels(), ["GitHub", "Email"], "crossing into it keeps it");
  act(() => {
    accountItem("Changelog").dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  assert.deepEqual(submenuLabels(), []);

  act(() => {
    accountItem("Contact us").dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  keyDown(document.activeElement, "ArrowDown");
  assert.deepEqual(submenuLabels(), [], "walking the menu by key leaves it behind too");
});

test("Log out asks first, and only its answer signs the account out", async () => {
  let signOuts = 0;
  const container = mount(DEAN, {
    onSignOut: () => {
      signOuts += 1;
      return Promise.resolve();
    },
  });
  const logOut = () => {
    act(() => accountButton(container).click());
    act(() => accountItem("Log out").click());
  };

  logOut();
  assert.equal(dialog()?.querySelector("h2")?.textContent, "Log out of dean@example.com?");
  act(() => dialogButton("Cancel").click());
  assert.equal(dialog(), null);
  assert.equal(signOuts, 0);

  logOut();
  await act(async () => dialogButton("Log out").click());
  assert.equal(signOuts, 1);
});

test("a Log out that fails keeps the dialog up saying so, and the account still signed in", async () => {
  const container = mount(DEAN, { onSignOut: () => Promise.reject(new Error("refused")) });
  act(() => accountButton(container).click());
  act(() => accountItem("Log out").click());

  await act(async () => dialogButton("Log out").click());

  assert.match(
    dialog()?.querySelector('[role="alert"]')?.textContent ?? "",
    /could not log out, so you are still signed in/u,
  );
});

test("signed out, the account says so and its menu names no one and offers no Log out", () => {
  const button = accountButton(mount({ status: ACCOUNT_STATUS.SIGNED_OUT }));

  assert.equal(button.querySelector("img"), null);
  assert.equal(button.querySelector(".sidebar-account-name")?.textContent, "Not signed in");
  act(() => button.click());
  assert.deepEqual(accountMenuLines(), [
    "Settings ⌘,",
    "—",
    "Changelog",
    "Send feedback…",
    "Suggest a feature…",
    "Keyboard shortcuts ⌘/",
    "Contact us",
  ]);
});

test("the account's menu closes when the sidebar folds away", () => {
  const container = mount(DEAN);
  act(() => accountButton(container).click());
  assert.ok(accountMenu());

  restages.get(container)?.({ collapsed: true });

  assert.equal(accountMenu(), null);
});

function updateControl(container: ParentNode): HTMLElement | null {
  return container.querySelector<HTMLElement>(".sidebar-foot .sidebar-update");
}

test("a downloaded release puts Update between the account and the gear, and pressing it installs", () => {
  let installs = 0;
  const container = mount(DEAN, {
    update: READY,
    onInstall: () => {
      installs += 1;
    },
  });
  const control = updateControl(container);
  assert.ok(control instanceof HTMLButtonElement, "the foot draws the update button");
  assert.equal(control.textContent, "Update");
  assert.equal(control.previousElementSibling, accountButton(container));
  assert.equal(control.nextElementSibling, settingsButton(container));
  act(() => {
    control.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  assert.equal(
    document.body.querySelector('[role="tooltip"]')?.textContent,
    "Luke 0.11.0 is ready. Restart to update.",
  );

  act(() => control.click());

  assert.equal(installs, 1);
});

test("a downloading release is a quiet count of how far along it is, and nothing to press", () => {
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
  assert.equal(control?.textContent, "42%");
  assert.equal(container.querySelectorAll(".sidebar-foot button").length, 2);
});

test("up to date, checking, or unable to install in place, the foot draws no update control", () => {
  const unsupported: UpdateSnapshot = { ...READY, installSupported: false };
  for (const update of [
    UP_TO_DATE,
    { status: UPDATE_STATUS.CHECKING, currentVersion: "0.10.0", installSupported: true },
    unsupported,
  ] as const) {
    const container = mount(DEAN, { update });
    assert.equal(updateControl(container), null);
    assert.equal(container.querySelectorAll(".sidebar-foot button").length, 2);
  }
});

test("a release that could not be installed puts Download beside the gear, saying why in its hint, and the account wears no word of the release in any state", () => {
  let opened = 0;
  const failed: UpdateSnapshot = {
    status: UPDATE_STATUS.ERROR,
    currentVersion: "0.10.0",
    installSupported: true,
    latestVersion: "0.11.0",
  };
  const container = mount(DEAN, {
    update: failed,
    onOpenLatest: () => {
      opened += 1;
    },
  });
  const control = updateControl(container);
  assert.ok(control instanceof HTMLButtonElement, "the foot draws the download");
  assert.equal(control.textContent, "Download");
  act(() => {
    control.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  assert.match(
    document.body.querySelector('[role="tooltip"]')?.textContent ?? "",
    /could not be installed\. Get version 0\.11\.0/u,
  );
  act(() => control.click());
  assert.equal(opened, 1);

  for (const update of [READY, failed, UP_TO_DATE]) {
    const button = accountButton(mount(DEAN, { update }));
    assert.doesNotMatch(button.textContent ?? "", /update|install|download/iu);
  }
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
    workspaceId: "workspace-personal",
    name: "Invitations",
    createdAt: 1,
    updatedAt: 1,
    repository: null,
  };
  const SECOND = {
    id: "0c9a3f1e-6b2d-4e8f-a1c7-3d5e7f9a1b2c",
    workspaceId: "workspace-personal",
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

test("New plan and Search read in the weight of a read plan's name", async () => {
  const styled = await sheetStyle();
  const container = mount(DEAN, { plans: { plans: [listedPlan("Billing")] } });
  const name = container.querySelector(".sidebar-plan-name");
  assert.ok(name, "the list draws Billing");
  const weight = (element: Element) => styled(element, "font-weight");

  assert.equal(weight(newPlanButton(container)), weight(name));
  assert.equal(weight(searchButton(container)), weight(name));
});

function searchButton(container: ParentNode): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(".sidebar-search");
  assert.ok(button, "the sidebar draws Search");
  return button;
}

test("Search stands right under New plan and opens the command palette", () => {
  const container = mount(DEAN);
  const search = searchButton(container);
  assert.equal(newPlanButton(container).nextElementSibling, search);
  assert.equal(search.textContent?.replace("⌘K", ""), "Search");
  assert.equal(document.querySelector('[cmdk-root=""]'), null);

  act(() => search.click());

  assert.ok(document.querySelector('[cmdk-root=""]'), "the command palette is open");
});

test("a rule under the Inbox parts the rows above it from the plans, which carry no heading but still name themselves Plans", () => {
  const container = mount(DEAN, { plans: { plans: [listedPlan("Billing")] } });
  const rule = inboxButton(container).nextElementSibling;
  assert.equal(rule?.tagName, "HR");
  assert.equal(container.querySelector("h2"), null, "nothing heads the list");
  assert.ok(container.querySelector("nav[aria-label='Plans']"), "the list keeps its name");
});

test("Search names the palette's chord, which it shows at its end only while hovered or reached from the keyboard", () => {
  const button = searchButton(mount(DEAN));
  assert.equal(button.getAttribute("aria-keyshortcuts"), "Meta+K");
  const hint = button.querySelector(".row-shortcut");
  assert.equal(hint?.textContent, "⌘K");
  assert.equal(hint?.getAttribute("aria-hidden"), "true");
});

/** A plan's row of the list, with whatever pin or archive it is given. */
function listedPlan(name: string, marks: { pinnedAt?: number; archivedAt?: number } = {}) {
  return {
    id: `plan-${name}`,
    workspaceId: "workspace-personal",
    name,
    createdAt: 1,
    updatedAt: 1,
    repository: null,
    ...marks,
  };
}

/** Each section the sidebar draws, by its heading, with the names of the plans under it. */
function sections(container: HTMLElement): [string, string[]][] {
  return [...container.querySelectorAll<HTMLElement>(".sidebar-group")].map((group) => [
    group.getAttribute("aria-label") ?? "",
    [...group.querySelectorAll(".sidebar-plan-name")].map((name) => name.textContent ?? ""),
  ]);
}

/** A plan's agents in brief as the list carries them: none working and no pull request, unless the test says. */
function agentsSummary(patch: Partial<PlanAgentsSummary> = {}): PlanAgentsSummary {
  return { total: 1, working: 0, agents: [], pullRequestTotal: 0, pullRequests: [], ...patch };
}

/** A pull request an agent opened, where it stands as given. */
function pullRequest(state: PullRequestState, checks: CheckSummary = CHECK_SUMMARY.PASSING) {
  return { number: 128, title: "Invite by email", state, checks, additions: 12, deletions: 3 };
}

/** Each row's one mark, by the plan's name: what it is, where its pull request stands, and what it says to a reader. */
function rowMarks(container: HTMLElement): [string, string | null, string | null, string | null][] {
  return [...container.querySelectorAll<HTMLElement>(".sidebar-plan")].map((row) => {
    const mark = row.querySelector(".sidebar-plan-time [data-plan-mark]");
    return [
      row.querySelector(".sidebar-plan-name")?.textContent ?? "",
      mark?.getAttribute("data-plan-mark") ?? null,
      mark?.getAttribute("data-state") ?? null,
      mark?.getAttribute("aria-label") ?? null,
    ];
  });
}

test("a plan's row marks an agent at work, else its open, draft, or merged pull request, and nothing for a closed one or none", () => {
  const container = mount(DEAN, {
    plans: {
      plans: [
        {
          ...listedPlan("Working"),
          agents: agentsSummary({
            working: 1,
            pullRequestTotal: 1,
            pullRequests: [pullRequest(PULL_REQUEST_STATE.OPEN)],
          }),
        },
        {
          ...listedPlan("Open"),
          agents: agentsSummary({
            pullRequestTotal: 2,
            pullRequests: [
              pullRequest(PULL_REQUEST_STATE.CLOSED),
              pullRequest(PULL_REQUEST_STATE.OPEN, CHECK_SUMMARY.FAILING),
            ],
          }),
        },
        {
          ...listedPlan("Draft"),
          agents: agentsSummary({
            pullRequestTotal: 1,
            pullRequests: [pullRequest(PULL_REQUEST_STATE.DRAFT)],
          }),
        },
        {
          ...listedPlan("Merged"),
          agents: agentsSummary({
            pullRequestTotal: 1,
            pullRequests: [pullRequest(PULL_REQUEST_STATE.MERGED)],
          }),
        },
        {
          ...listedPlan("Closed"),
          agents: agentsSummary({
            pullRequestTotal: 1,
            pullRequests: [pullRequest(PULL_REQUEST_STATE.CLOSED)],
          }),
        },
        { ...listedPlan("Idle"), agents: agentsSummary() },
        listedPlan("Untouched"),
      ],
    },
  });

  assert.deepEqual(rowMarks(container), [
    ["Working", "working", null, "Agent working"],
    ["Open", "pull-request", "open", "Pull request #128, open, checks failing"],
    ["Draft", "pull-request", "draft", "Pull request #128, draft"],
    ["Merged", "pull-request", "merged", "Pull request #128, merged"],
    ["Closed", null, null, null],
    ["Idle", null, null, null],
    ["Untouched", null, null, null],
  ]);
  assert.ok(
    container.querySelector('[data-plan-mark="working"] svg.working-mark'),
    "the agent at work wears the working mark",
  );
});

test("resting on a plan's row hangs its card beside the row, naming its agents and pull requests", () => {
  const container = mount(DEAN, {
    plans: {
      plans: [
        {
          ...listedPlan("Invites"),
          agents: agentsSummary({
            pullRequestTotal: 1,
            pullRequests: [pullRequest(PULL_REQUEST_STATE.OPEN)],
          }),
        },
      ],
    },
  });
  const row = container.querySelector<HTMLElement>(".sidebar-plan");
  assert.ok(row);

  act(() => {
    row.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });

  const card = document.body.querySelector<HTMLElement>('[role="tooltip"]');
  assert.ok(card);
  assert.equal(card.dataset.side, "end");
  assert.equal(row.getAttribute("aria-describedby"), card.id);
  assert.equal(card.querySelector(".plan-card-name")?.textContent, "Invites");
  assert.deepEqual(
    [...card.querySelectorAll('[aria-label="Pull requests"] > li')].map((line) => line.textContent),
    ["#128 Invite by email+12 −3"],
  );
});

/** The pointer moving from one place in the window to another, as React hears it: out of the first, over the second. */
function cross(from: Element, to: Element): void {
  act(() => {
    from.dispatchEvent(new MouseEvent("pointerout", { bubbles: true, relatedTarget: to }));
    to.dispatchEvent(new MouseEvent("pointerover", { bubbles: true, relatedTarget: from }));
  });
}

/** Each tooltip standing in the window, by whether it is a card. */
function standing(): string[] {
  return [...document.body.querySelectorAll('[role="tooltip"]')].map((each) =>
    each.querySelector(".plan-card") === null ? `pill: ${each.textContent}` : "card",
  );
}

test("a plan row's card stands while the pointer is on the row's Pin and Archive, whose hints yield to it, and a press on one does its work and takes the card down", () => {
  const marked: [string, PlanMark][] = [];
  const container = mount(DEAN, {
    plans: {
      plans: [listedPlan("Invites")],
      onMarkPlan: (planId, mark) => marked.push([planId, mark]),
    },
  });
  const row = container.querySelector<HTMLElement>(".sidebar-plan");
  const pin = container.querySelector<HTMLElement>('.sidebar-plan-mark[aria-label="Pin"]');
  const archive = container.querySelector<HTMLElement>('.sidebar-plan-mark[aria-label="Archive"]');
  assert.ok(row && pin && archive);

  restOn(row);
  cross(row, pin);
  cross(pin, archive);
  assert.deepEqual(standing(), ["card"], "the row's buttons are part of the row");
  act(() => {
    archive.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    archive.click();
  });

  assert.deepEqual(standing(), []);
  assert.deepEqual(marked, [["plan-Invites", PLAN_MARK.ARCHIVE]]);
});

test("a pinned tab's card stands while the pointer is on its Unpin, and a right-click on the row takes it down", () => {
  const billing = listedPlan("Billing");
  const container = mount(DEAN, {
    plans: withPins([{ plan: billing.id, tab: SIDE_PANEL_TAB.BOARD, label: "Board", at: 1 }], {
      plans: [billing],
    }),
  });
  const row = container.querySelector<HTMLElement>("nav[aria-label='Pinned'] .sidebar-plan");
  const unpin = container.querySelector<HTMLElement>('[aria-label="Unpin Board"]');
  assert.ok(row && unpin);

  restOn(row);
  cross(row, unpin);
  assert.deepEqual(standing(), ["card"], "Unpin is part of the row");
  cross(unpin, row);
  assert.deepEqual(standing(), ["card"]);
  act(() => {
    row.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 2 }));
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, button: 2 }));
  });

  assert.deepEqual(standing(), []);
});

test("a plan card's pull request opens on GitHub and its agent opens the plan on its tab, either taking the card down", () => {
  const opened: string[] = [];
  const shownAgents: [string, string][] = [];
  const agent = {
    id: "agent-invite",
    title: "Invite flow",
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    status: CODING_AGENT_STATUS.COMPLETED,
  };
  const url = "https://github.com/acme/relay/pull/128";
  const container = mount(DEAN, {
    plans: {
      plans: [
        {
          ...listedPlan("Invites"),
          agents: agentsSummary({
            agents: [agent],
            pullRequestTotal: 1,
            pullRequests: [{ ...pullRequest(PULL_REQUEST_STATE.OPEN), url }],
          }),
        },
      ],
      onShowAgent: (planId, agentId) => shownAgents.push([planId, agentId]),
      repositories: { ...plansControl().repositories, openGitHub: (page) => opened.push(page) },
    },
  });
  const row = container.querySelector<HTMLElement>(".sidebar-plan");
  assert.ok(row);
  const card = () => {
    act(() => {
      row.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    });
    const shown = document.body.querySelector<HTMLElement>('[role="tooltip"]');
    assert.ok(shown);
    return shown;
  };
  const choose = (label: string) => {
    const line = card().querySelector<HTMLElement>(`[aria-label="${label}"] button`);
    assert.ok(line, `no button among ${label}`);
    act(() => line.click());
  };

  choose("Pull requests");
  assert.deepEqual(opened, [url]);
  assert.equal(document.body.querySelector('[role="tooltip"]') === null, true, "the card went");

  choose("Agents");
  assert.deepEqual(shownAgents, [["plan-Invites", "agent-invite"]]);
  assert.equal(document.body.querySelector('[role="tooltip"]') === null, true, "the card went");
});

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

function press(container: ParentNode, selector: string): void {
  const control = container.querySelector<HTMLElement>(selector);
  assert.ok(control, `nothing to press at ${selector}`);
  act(() => control.click());
}

/** A running agent on a plan, by its id. */
function agentOn(id: string): CodingAgentSummary {
  return {
    id,
    planId: "plan-Billing",
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: "Invite flow",
    createdAt: 3,
    status: CODING_AGENT_STATUS.RUNNING,
    turnId: "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32",
  };
}

/** Each row under Pinned as it reads: a plan's name, or a pinned tab's whole row, with whether its glyph leads it. */
function pinnedSection(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>("nav[aria-label='Pinned'] .sidebar-plan")].map(
    (row) => {
      if (row.querySelector(".sidebar-pinned-tab-name") === null) {
        return row.querySelector(".sidebar-plan-name")?.textContent ?? "";
      }
      const glyph = row.querySelector(".sidebar-pinned-tab-glyph svg") === null ? "" : "◆ ";
      return `${glyph}${row.textContent}`;
    },
  );
}

/** The card a row hangs once the pointer rests on it. */
function restOn(row: HTMLElement | undefined): HTMLElement {
  assert.ok(row);
  act(() => {
    row.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  const card = document.body.querySelector<HTMLElement>('[role="tooltip"]');
  assert.ok(card, "the row hangs a card");
  return card;
}

/** A pinned tab's card as it reads: its name, then each line under it, a button's marked `[…]`. */
function pinCard(card: HTMLElement): string[] {
  const lines = card.querySelectorAll(
    ".plan-card-detail, .plan-card-more, .plan-card-lines > li > :first-child",
  );
  return [
    card.querySelector(".plan-card-name")?.textContent ?? "",
    ...[...lines].map((line) =>
      line.tagName === "BUTTON" ? `[${line.textContent}]` : (line.textContent ?? ""),
    ),
  ];
}

/** The plans control with the tabs given pinned to the sidebar, and every other side panel press ignored. */
function withPins(
  pins: readonly PinnedTab[],
  patch: Partial<PlansControl> = {},
  onUnpin: PlansControl["sidePanel"]["onUnpin"] = () => undefined,
): Partial<PlansControl> {
  return { ...patch, sidePanel: { ...plansControl().sidePanel, pins, onUnpin } };
}

test("the pin the open plan was opened from is marked in its plan's place, standing under a fold, and with none chosen, or it unpinned or pinned again since, the plan's own row is", () => {
  const billing = listedPlan("Billing", { pinnedAt: 5 });
  const board: PinnedTab = { plan: billing.id, tab: SIDE_PANEL_TAB.BOARD, label: "Board", at: 9 };
  const agent: PinnedTab = {
    plan: billing.id,
    tab: { agent: "agent-1" },
    label: "Invite flow",
    at: 8,
  };
  const open = { plans: [billing], page: PLANS_PAGE.DOCUMENT, activePlanId: billing.id };
  const marked = (container: HTMLElement) =>
    [...container.querySelectorAll<HTMLElement>(".sidebar-plan[aria-current='page']")].map(
      (row) => row.querySelector(".sidebar-plan-name, .sidebar-pinned-tab-name")?.textContent,
    );

  const fromPin = mount(DEAN, { plans: withPins([board, agent], { ...open, chosenPin: agent }) });
  const fromRow = mount(DEAN, { plans: withPins([board, agent], open) });
  const unpinned = mount(DEAN, { plans: withPins([board], { ...open, chosenPin: agent }) });
  const repinned = mount(DEAN, {
    plans: withPins([board, { ...agent, at: 12 }], { ...open, chosenPin: agent }),
  });

  assert.deepEqual(marked(fromPin), ["Invite flow"]);
  assert.deepEqual(marked(fromRow), ["Billing"]);
  assert.deepEqual(marked(unpinned), ["Billing"]);
  assert.deepEqual(marked(repinned), ["Billing"], "a pin made since is not the one pressed");
  window.localStorage.clear();
  act(() => pinnedToggle(fromPin).click());
  assert.deepEqual(marked(fromPin), ["Invite flow"], "a fold leaves the marked pin standing");
  window.localStorage.clear();
});

test("a pinned tab's card names the tab, then its plan and its repository, each a button that opens it, and no word for the tab's kind", () => {
  const billing = { ...listedPlan("Billing"), repository: "acme/relay" };
  const opened: string[] = [];
  const github: string[] = [];
  const container = mount(DEAN, {
    plans: withPins(
      [
        { plan: billing.id, tab: SIDE_PANEL_TAB.BOARD, label: "Board", at: 2 },
        { plan: billing.id, tab: { agent: "agent-1" }, label: "Invite flow", at: 1 },
      ],
      {
        plans: [billing],
        onSelect: (planId) => opened.push(planId),
        repositories: { ...plansControl().repositories, openGitHub: (page) => github.push(page) },
      },
    ),
  });
  const rows = container.querySelectorAll<HTMLElement>("nav[aria-label='Pinned'] .sidebar-plan");

  assert.deepEqual(pinCard(restOn(rows[1])), ["Invite flow", "[Billing]", "[acme/relay]"]);
  const card = restOn(rows[0]);
  assert.deepEqual(pinCard(card), ["Board", "[Billing]", "[acme/relay]"]);
  assert.doesNotMatch(card.textContent ?? "", /Coding agent|File|Working|Done/u);
  const choose = (line: string) => {
    const button = [...restOn(rows[0]).querySelectorAll<HTMLElement>("button")].find(
      (each) => each.textContent === line,
    );
    assert.ok(button, `no button says ${line}`);
    act(() => button.click());
    assert.equal(document.body.querySelector('[role="tooltip"]'), null, "the card went");
  };
  choose("Billing");
  choose("acme/relay");
  assert.deepEqual(opened, [billing.id]);
  assert.deepEqual(github, ["https://github.com/acme/relay"]);
});

test("a pinned agent's card draws the pull request it opened once the one read of it lands, which opens it on GitHub", async () => {
  const billing = listedPlan("Billing");
  const url = "https://github.com/acme/relay/pull/128";
  const asked: string[] = [];
  const github: string[] = [];
  const container = mount(DEAN, {
    plans: withPins(
      [{ plan: billing.id, tab: { agent: "agent-1" }, label: "Invite flow", at: 1 }],
      {
        plans: [billing],
        agents: codingAgentsControl({
          readPullRequest: (agentId) => {
            asked.push(agentId);
            return Promise.resolve({
              repository: "acme/relay",
              branch: "invites",
              pullRequest: { ...pullRequest(PULL_REQUEST_STATE.OPEN), url, changedFiles: 4 },
            });
          },
        }),
        repositories: { ...plansControl().repositories, openGitHub: (page) => github.push(page) },
      },
    ),
  });
  const row = container.querySelector<HTMLElement>("nav[aria-label='Pinned'] .sidebar-plan");

  assert.deepEqual(pinCard(restOn(row ?? undefined)), ["Invite flow", "[Billing]"]);
  await act(async () => undefined);
  const card = restOn(row ?? undefined);
  assert.deepEqual(pinCard(card), ["Invite flow", "[Billing]", "[#128 Invite by email+12 −3]"]);
  assert.deepEqual(asked, ["agent-1"]);
  act(() => card.querySelector<HTMLElement>('[aria-label="Pull request"] button')?.click());
  assert.deepEqual(github, [url]);
});

test("a tab pinned to the sidebar stands under Pinned on one line, its glyph and its name, among the pinned plans by when each was pinned", () => {
  const invites = listedPlan("Invites", { pinnedAt: 20 });
  const billing = listedPlan("Billing");
  const archived = listedPlan("Ledger", { archivedAt: 3 });
  const container = mount(DEAN, {
    plans: withPins(
      [
        { plan: billing.id, tab: { agent: "agent-1" }, label: "Invite flow", at: 30 },
        { plan: billing.id, tab: { file: "src/team/roles.ts" }, label: "roles.ts", at: 10 },
        { plan: archived.id, tab: SIDE_PANEL_TAB.BOARD, label: "Board", at: 40 },
      ],
      { plans: [invites, billing], archived: [archived] },
    ),
  });

  assert.deepEqual(pinnedSection(container), ["◆ Invite flow", "Invites", "◆ roles.ts"]);
  const rows = container.querySelectorAll<HTMLElement>("nav[aria-label='Pinned'] .sidebar-plan");
  assert.deepEqual(pinCard(restOn(rows[2])), ["roles.ts", "[Billing]"]);
  assert.deepEqual(
    sections(container).at(-1),
    ["Plans", ["Billing"]],
    "the plan itself stays listed",
  );
});

test("a pinned tab alone draws Pinned, and a press on it opens its plan on the tab, bringing the Plans tab forward from Settings", () => {
  const billing = listedPlan("Billing");
  const pin: PinnedTab = { plan: billing.id, tab: SIDE_PANEL_TAB.CALL, label: "Work", at: 1 };
  const opened: PinnedTab[] = [];
  const tabs: PanelTab[] = [];
  const container = mount(DEAN, {
    tab: PANEL_TAB.SETTINGS,
    onTabChange: (tab) => tabs.push(tab),
    plans: withPins([pin], { plans: [billing], onOpenPinnedTab: (each) => opened.push(each) }),
  });

  assert.deepEqual(sections(container)[0], ["Pinned", []]);
  press(container, "nav[aria-label='Pinned'] .sidebar-plan");
  assert.deepEqual(opened, [pin]);
  assert.deepEqual(tabs, [PANEL_TAB.PLANS]);
});

/** The items of the menu a right-click on the row opens, the menu left open. */
function rowMenu(row: HTMLElement): HTMLElement[] {
  act(() => {
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));
  });
  return [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}

test("a pinned tab's Unpin and its right-click's Unpin both unpin it, and an agent's menu offers its transcript's two copies first while its plan is open", () => {
  const billing = listedPlan("Billing");
  const invites = listedPlan("Invites");
  const agent: PinnedTab = {
    plan: billing.id,
    tab: { agent: "agent-1" },
    label: "Invite flow",
    at: 3,
  };
  const elsewhere: PinnedTab = {
    plan: invites.id,
    tab: { agent: "agent-2" },
    label: "Seats",
    at: 2,
  };
  const board: PinnedTab = { plan: billing.id, tab: SIDE_PANEL_TAB.BOARD, label: "Board", at: 1 };
  const unpinned: unknown[] = [];
  const container = mount(DEAN, {
    plans: withPins(
      [agent, elsewhere, board],
      {
        plans: [billing, invites],
        page: PLANS_PAGE.DOCUMENT,
        activePlanId: billing.id,
        agents: codingAgentsControl({ agents: [agentOn("agent-1")] }),
      },
      (planId, tab) => unpinned.push({ planId, tab }),
    ),
  });

  press(container, '[aria-label="Unpin Board"]');
  const [open, other] = container.querySelectorAll<HTMLElement>(
    "nav[aria-label='Pinned'] .sidebar-plan",
  );
  assert.ok(open && other);
  const elsewhereItems = rowMenu(other);
  assert.deepEqual(
    elsewhereItems.map((item) => item.textContent),
    ["Unpin"],
    "another plan's agent offers no copy",
  );
  act(() => elsewhereItems[0]?.click());
  const items = rowMenu(open);
  assert.deepEqual(
    items.map((item) => item.textContent),
    ["Copy concise transcript", "Copy full transcript", "Unpin"],
  );
  act(() => items.at(-1)?.click());

  assert.deepEqual(unpinned, [
    { planId: billing.id, tab: SIDE_PANEL_TAB.BOARD },
    { planId: invites.id, tab: { agent: "agent-2" } },
    { planId: billing.id, tab: { agent: "agent-1" } },
  ]);
});

test("on the open plan, a pinned agent its plan no longer holds stands dimmed with a note and opens nothing, and one it holds opens", () => {
  const billing = listedPlan("Billing");
  const gone: PinnedTab = {
    plan: billing.id,
    tab: { agent: "agent-gone" },
    label: "Old run",
    at: 2,
  };
  const held: PinnedTab = {
    plan: billing.id,
    tab: { agent: "agent-1" },
    label: "Invite flow",
    at: 1,
  };
  const opened: PinnedTab[] = [];
  const container = mount(DEAN, {
    plans: withPins([gone, held], {
      plans: [billing],
      page: PLANS_PAGE.DOCUMENT,
      activePlanId: billing.id,
      agents: codingAgentsControl({ agents: [agentOn("agent-1")] }),
      onOpenPinnedTab: (each) => opened.push(each),
    }),
  });

  assert.deepEqual(pinnedSection(container), ["◆ Old run", "◆ Invite flow"]);
  const rows = container.querySelectorAll<HTMLElement>("nav[aria-label='Pinned'] .sidebar-plan");
  assert.equal(rows[0]?.getAttribute("aria-disabled"), "true");
  assert.deepEqual(pinCard(restOn(rows[0])), ["Old run", "[Billing]", "No longer on this plan"]);
  act(() => rows[0]?.click());
  act(() => rows[1]?.click());
  assert.deepEqual(opened, [held]);
});

test("a pinned file wears its type's icon, as the file tree draws the file", async () => {
  const billing = listedPlan("Billing");
  const container = mount(DEAN, {
    plans: withPins(
      [{ plan: billing.id, tab: { file: "src/team/roles.ts" }, label: "roles.ts", at: 1 }],
      { plans: [billing] },
    ),
  });
  await act(async () => {
    for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();
  });

  const glyph = container.querySelector("nav[aria-label='Pinned'] .sidebar-pinned-tab-glyph");
  assert.equal(
    glyph?.querySelector(".file-type-icon")?.getAttribute("data-file-type"),
    "typescript",
  );
});

test("a pinned agent wears its harness's mark, never the generic terminal: on the open plan as its tab wears it, where it stands included, and on another plan the mark of the model it was pinned on", () => {
  const billing = listedPlan("Billing");
  const invites = listedPlan("Invites");
  const container = mount(DEAN, {
    plans: withPins(
      [
        { plan: billing.id, tab: { agent: "agent-1" }, label: "Invite flow", at: 3 },
        {
          plan: invites.id,
          tab: { agent: "agent-9" },
          label: "Codex run",
          at: 2,
          model: "openai/gpt-6-astra",
        },
        {
          plan: invites.id,
          tab: { agent: "agent-8" },
          label: "Done run",
          at: 1,
          model: "anthropic/claude-opus-5.5",
        },
      ],
      {
        plans: [billing, invites],
        page: PLANS_PAGE.DOCUMENT,
        activePlanId: billing.id,
        agents: codingAgentsControl({ agents: [agentOn("agent-1")] }),
      },
    ),
  });

  const glyphs = [
    ...container.querySelectorAll<HTMLElement>(
      "nav[aria-label='Pinned'] .sidebar-pinned-tab-glyph",
    ),
  ];
  assert.equal(glyphs.length, 3);
  assert.ok(glyphs[0]?.querySelector(".working-mark"), "the open plan's running agent works");
  assert.ok(
    glyphs[1]?.querySelector('img.provider-mark[src="marks/codex-16.png"]'),
    "Codex's cloud for the OpenAI model it was pinned on",
  );
  assert.ok(glyphs[2]?.querySelector("svg.provider-mark"), "Claude Code's Clawd");
});

test("the archived plans fold away behind a header that counts them while folded, which unfolds them under the rest", () => {
  const opened: string[] = [];
  const archived = [listedPlan("Old", { archivedAt: 9 }), listedPlan("Older", { archivedAt: 8 })];
  const container = mount(DEAN, {
    plans: { plans: [listedPlan("Billing")], archived, onSelect: (planId) => opened.push(planId) },
  });
  const row = container.querySelector<HTMLButtonElement>(".sidebar-archived-row");
  assert.ok(row);

  const folded = sections(container);
  const foldedName = row.textContent;
  act(() => row.click());
  const unfolded = sections(container);
  const old = [...container.querySelectorAll<HTMLButtonElement>("button.sidebar-plan")].at(1);
  act(() => old?.click());

  assert.equal(foldedName, "Archived2 plans");
  assert.equal(row.textContent, "Archived", "unfolded, the plans count themselves");
  assert.deepEqual(folded, [["Plans", ["Billing"]]]);
  assert.equal(row.getAttribute("aria-expanded"), "true");
  assert.deepEqual(unfolded, [["Plans", ["Billing", "Old", "Older"]]]);
  assert.deepEqual(opened, ["plan-Old"]);
});

test("Archived's header is drawn as a repository's, led by the Archive action's own glyph", async () => {
  const styled = await sheetStyle();
  const container = mount(DEAN, {
    plans: {
      plans: [listedPlan("Billing"), onRepository("Search", "acme/relay")],
      archived: [listedPlan("Old", { archivedAt: 9 })],
    },
  });
  const archived = container.querySelector<HTMLElement>(".sidebar-archived-row");
  const repository = header(container, "relay").querySelector<HTMLElement>(
    ".sidebar-repository-toggle",
  );
  const archiveAction = container.querySelector(
    '.sidebar-plan-marks button[aria-label="Archive"] svg',
  );
  assert.ok(archived && repository && archiveAction);
  const box = (toggle: HTMLElement) =>
    ["padding", "font-size", "font-weight", "gap", "color"].map((property) =>
      styled(toggle, property),
    );
  const leading = archived.querySelector(".sidebar-repository-glyph > svg");

  assert.deepEqual(box(archived), box(repository));
  assert.ok(archived.parentElement?.matches(".sidebar-repository-header"));
  assert.equal(leading?.innerHTML, archiveAction.innerHTML);
});

/** Pinned's header, which folds and unfolds it. */
function pinnedToggle(container: ParentNode): HTMLButtonElement {
  const toggle = container.querySelector<HTMLButtonElement>(
    "nav[aria-label='Pinned'] .sidebar-repository-toggle",
  );
  assert.ok(toggle, "Pinned draws its header");
  return toggle;
}

test("Pinned's header is drawn as Archived's, led by the Pin action's own glyph", async () => {
  const styled = await sheetStyle();
  const container = mount(DEAN, {
    plans: {
      plans: [listedPlan("Invites", { pinnedAt: 5 }), listedPlan("Billing")],
      archived: [listedPlan("Old", { archivedAt: 9 })],
    },
  });
  const pinned = pinnedToggle(container);
  const archived = container.querySelector<HTMLElement>(".sidebar-archived-row");
  const pinAction = container.querySelector('.sidebar-plan-marks button[aria-label="Pin"] svg');
  assert.ok(archived && pinAction);
  const box = (toggle: HTMLElement) =>
    ["padding", "font-size", "font-weight", "gap", "color"].map((property) =>
      styled(toggle, property),
    );

  assert.deepEqual(box(pinned), box(archived));
  assert.equal(pinned.querySelector(".sidebar-repository-name")?.textContent, "Pinned");
  assert.equal(
    pinned.querySelector(".sidebar-repository-glyph > svg")?.innerHTML,
    pinAction.innerHTML,
  );
  assert.ok(pinned.querySelector(".sidebar-repository-glyph > .settings-chevron"));
});

test("the keyboard's ring is drawn whole on every control of the plans, and a header rings whole for its fold, at a plan row's height", async () => {
  const styled = await sheetStyle();
  const container = mount(DEAN, {
    plans: withPins([{ plan: "plan-Search", tab: SIDE_PANEL_TAB.BOARD, label: "Board", at: 9 }], {
      plans: [listedPlan("Invites", { pinnedAt: 5 }), onRepository("Search", "acme/relay")],
      archived: [listedPlan("Old", { archivedAt: 9 })],
    }),
  });
  const controls = [...container.querySelectorAll<HTMLElement>(".sidebar-section button")];
  const relay = header(container, "relay");
  const fold = relay.querySelector<HTMLElement>(".sidebar-repository-toggle");
  const row = container.querySelector<HTMLElement>(".sidebar-plan");
  assert.ok(fold && row);

  assert.ok(controls.length >= 10, "rows, their Pin and Archive, a pinned tab, and every header");
  assert.deepEqual(controls.map((control) => ringClipping(styled, control)).filter(Boolean), []);
  document.documentElement.dataset.keyboard = "true";
  fold.dataset.focusVisible = "";
  assert.equal(styled(fold, "outline"), "none");
  assert.match(styled(relay, "outline") ?? "", /var\(--focus-ring\)/u, "the header wears it");
  assert.equal(styled(fold, "padding"), styled(row, "padding"));
});

test("a press folds Pinned for the next launch too, counting its pins, and the open plan and the pinned tab on show still stand under it", () => {
  const billing = listedPlan("Billing", { pinnedAt: 5 });
  const invites = listedPlan("Invites", { pinnedAt: 4 });
  const plans = withPins(
    [
      { plan: billing.id, tab: { agent: "agent-1" }, label: "Invite flow", at: 3 },
      { plan: billing.id, tab: SIDE_PANEL_TAB.BOARD, label: "Board", at: 2 },
    ],
    {
      plans: [billing, invites],
      page: PLANS_PAGE.DOCUMENT,
      activePlanId: billing.id,
      agents: codingAgentsControl({ agents: [agentOn("agent-1")] }),
      mainTabs: { ...plansControl().mainTabs, tab: { agent: "agent-1" } },
    },
  );
  const container = mount(DEAN, { plans });
  const unfolded = pinnedSection(container);

  act(() => pinnedToggle(container).click());
  const relaunched = mount(DEAN, { plans });

  assert.deepEqual(unfolded, ["Billing", "Invites", "◆ Invite flow", "◆ Board"]);
  for (const sidebar of [container, relaunched]) {
    assert.equal(pinnedToggle(sidebar).getAttribute("aria-expanded"), "false");
    assert.deepEqual(pinnedSection(sidebar), ["Billing", "◆ Invite flow"]);
    assert.equal(
      pinnedToggle(sidebar).querySelector(".sidebar-repository-count")?.textContent,
      "4 pins",
    );
  }
  act(() => pinnedToggle(relaunched).click());
  assert.deepEqual(pinnedSection(relaunched), unfolded);
  assert.equal(pinnedToggle(relaunched).querySelector(".sidebar-repository-count"), null);
});

test("a pinned Inbox stands under Pinned with its glyph, its card naming it the Inbox of its plan, and still stands under the folded header while its plan is open on it", () => {
  const billing = listedPlan("Billing");
  const pin: PinnedTab = { plan: billing.id, tab: MAIN_TAB.INBOX, label: "Inbox", at: 1 };
  const onTab = (tab: PlansControl["mainTabs"]["tab"]) =>
    withPins([pin], {
      plans: [billing],
      page: PLANS_PAGE.DOCUMENT,
      activePlanId: billing.id,
      mainTabs: { ...plansControl().mainTabs, tab },
    });
  const container = mount(DEAN, { plans: onTab(MAIN_TAB.INBOX) });
  assert.deepEqual(pinnedSection(container), ["◆ Inbox"]);
  const card = restOn(
    container.querySelector<HTMLElement>("nav[aria-label='Pinned'] .sidebar-plan") ?? undefined,
  );
  assert.deepEqual(pinCard(card), ["Inbox", "[Billing]"]);

  act(() => pinnedToggle(container).click());
  assert.deepEqual(pinnedSection(container), ["◆ Inbox"], "on show");
  const onPlan = mount(DEAN, { plans: onTab(MAIN_TAB.PLAN) });
  assert.deepEqual(pinnedSection(onPlan), [], "folded away behind the plan's own tab");
});

function inboxButton(container: ParentNode): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(".sidebar-inbox");
  assert.ok(button, "the sidebar draws the Inbox");
  return button;
}

/** The plans control with the window's Inbox standing or not, and the presses it records. */
function withInboxView(
  open: boolean,
  patch: Partial<PlansControl> = {},
  onOpen: () => void = () => undefined,
): Partial<PlansControl> {
  return { ...patch, inboxView: { ...plansControl().inboxView, open, onOpen } };
}

test("the Inbox stands right under Search, counting the items waiting across every plan at its end in a group count's ink, the sum of the Inbox's row counts, and nothing at none; its chord shows while hovered", async () => {
  const styled = await sheetStyle();
  const counting = mount(DEAN, {
    plans: {
      plans: [listedPlan("Billing")],
      inbox: [
        { planId: "plan-billing", items: ["item-a", "item-b"] },
        { planId: "plan-invites", items: ["item-c"] },
      ],
    },
  });
  const quiet = mount(DEAN, { plans: { inbox: [] } });
  const folded = mount(DEAN, { plans: { plans: [listedPlan("Invites")] } });
  const group = folded.querySelector<HTMLButtonElement>(".sidebar-repository-toggle");
  assert.ok(group);
  act(() => group.click());

  const row = inboxButton(counting);
  assert.equal(searchButton(counting).nextElementSibling, row);
  assert.equal(row.getAttribute("aria-keyshortcuts"), "Meta+Shift+I");
  const count = row.querySelector<HTMLElement>(".sidebar-inbox-waiting");
  assert.equal(count?.textContent, "3 items waiting");
  assert.equal(inboxButton(quiet).querySelector(".sidebar-inbox-waiting"), null);
  assert.equal(inboxButton(quiet).textContent?.replace("⇧⌘I", ""), "Inbox");
  const groupCount = folded.querySelector<HTMLElement>(".sidebar-repository-count");
  assert.ok(count && groupCount);
  for (const property of ["color", "font-size", "font-variant-numeric"]) {
    assert.equal(styled(count, property), styled(groupCount, property), property);
  }
});

test("a press on the Inbox opens the window's Inbox, bringing the Plans tab forward from Settings, and while it stands the Inbox is the place shown rather than the open plan or the new-plan page", () => {
  const billing = listedPlan("Billing");
  let opened = 0;
  const tabs: PanelTab[] = [];
  const settings = mount(DEAN, {
    tab: PANEL_TAB.SETTINGS,
    onTabChange: (tab) => tabs.push(tab),
    plans: withInboxView(false, { plans: [billing] }, () => {
      opened += 1;
    }),
  });
  act(() => inboxButton(settings).click());
  assert.equal(opened, 1);
  assert.deepEqual(tabs, [PANEL_TAB.PLANS]);

  const onPlan = { plans: [billing], page: PLANS_PAGE.DOCUMENT, activePlanId: billing.id };
  const planShown = mount(DEAN, { plans: withInboxView(false, onPlan) });
  const inboxShown = mount(DEAN, { plans: withInboxView(true, onPlan) });
  const composing = mount(DEAN, { plans: withInboxView(true, { page: PLANS_PAGE.NEW }) });
  const current = (element: Element | null) => element?.getAttribute("aria-current") ?? null;
  assert.equal(current(inboxButton(planShown)), null);
  assert.equal(current(planShown.querySelector(".sidebar-plan")), "page");
  assert.equal(current(inboxButton(inboxShown)), "page");
  assert.equal(current(inboxShown.querySelector(".sidebar-plan")), null);
  assert.equal(current(newPlanButton(composing)), null);
});

test("walking the list passes over the pinned plans Pinned folded away", () => {
  const opened: string[] = [];
  const container = mount(DEAN, {
    plans: {
      page: PLANS_PAGE.NEW,
      plans: [listedPlan("Invites", { pinnedAt: 5 }), listedPlan("Billing")],
      onSelect: (planId) => opened.push(planId),
    },
  });

  act(() => pinnedToggle(container).click());

  assert.equal(walk("ArrowDown"), true);
  assert.deepEqual(opened, ["plan-Billing"]);
});

test("with every plan archived, the list says nothing of having none, and with none archived it draws no Archived row", () => {
  const allArchived = mount(DEAN, { plans: { archived: [listedPlan("Old", { archivedAt: 9 })] } });
  const none = mount(DEAN, { plans: { plans: [listedPlan("Billing")] } });
  const empty = mount(DEAN);

  assert.doesNotMatch(allArchived.textContent ?? "", /No plans yet/u);
  assert.equal(none.querySelector(".sidebar-archived-row"), null);
  assert.match(empty.textContent ?? "", /No plans yet/u);
});

test("before the list is first read the sidebar stands skeleton rows rather than claiming no plans, and its read draws what it holds", () => {
  const container = mount(DEAN, { plans: { listRead: false } });
  const group = () => container.querySelector<HTMLElement>("nav[aria-label='Plans']");
  const busy = () => group()?.querySelector("[role=status][aria-busy=true]") ?? null;

  assert.ok(busy(), "the list says it is being read");
  assert.ok((busy()?.querySelectorAll(".skeleton").length ?? 0) > 0);
  assert.doesNotMatch(group()?.textContent ?? "", /No plans yet/u);

  restages.get(container)?.({ plans: { listRead: true } });
  assert.equal(busy(), null);
  assert.match(group()?.textContent ?? "", /No plans yet/u);

  restages.get(container)?.({ plans: { listRead: true, plans: [listedPlan("Billing")] } });
  assert.equal(busy(), null);
  assert.doesNotMatch(group()?.textContent ?? "", /No plans yet/u);
});

test("a first read that failed stands neither skeleton rows nor a claim of no plans", () => {
  const container = mount(DEAN, { plans: { listRead: false, listFailed: true } });
  const group = container.querySelector<HTMLElement>("nav[aria-label='Plans']");

  assert.ok(group?.querySelector("[role=alert]"));
  assert.equal(group?.querySelector(".skeleton"), null);
  assert.doesNotMatch(group?.textContent ?? "", /No plans yet/u);
});

test("a list that could not be read says so in a sentence of its own, with Retry after it reading the list again", () => {
  let retries = 0;
  const container = mount(DEAN, {
    plans: { listFailed: true, onRetryList: () => (retries += 1) },
  });

  const alert = container.querySelector(".sidebar-group [role=alert]");
  assert.equal(alert?.querySelector("p")?.textContent, "Your plans couldn't be loaded.");
  const retry = alert?.querySelector("button");
  assert.equal(retry?.textContent, "Retry");
  assert.doesNotMatch(container.textContent ?? "", /No plans yet/u);
  act(() => retry?.click());
  assert.equal(retries, 1);
});

/** A plan's row of the list on a repository, last updated at `updatedAt`. */
function onRepository(name: string, repository: string | null, updatedAt = 1) {
  return {
    id: `plan-${name}`,
    workspaceId: "workspace-personal",
    name,
    createdAt: 1,
    updatedAt,
    repository,
  };
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

test("the plans stand under their repositories' headers, newest updated group first and No repository last, the pinned and archived ones flat, every row one line naming no repository", () => {
  window.localStorage.clear();
  const container = mount(DEAN, {
    plans: {
      plans: [
        { ...onRepository("Invites", "acme/relay", 5), pinnedAt: 9 },
        onRepository("Notes", null, 99),
        onRepository("Search", "acme/relay", 20),
        onRepository("Billing", "acme/ledger", 40),
      ],
      archived: [{ ...onRepository("Old", "acme/relay"), archivedAt: 9 }],
    },
  });
  act(() => container.querySelector<HTMLButtonElement>(".sidebar-archived-row")?.click());

  assert.deepEqual(groups(container), [
    ["ledger", ["Billing"]],
    ["relay", ["Search"]],
    ["No repository", ["Notes"]],
  ]);
  const rows = [...container.querySelectorAll<HTMLElement>("button.sidebar-plan")];
  assert.deepEqual(
    rows.map((row) => row.querySelector(".sidebar-plan-name")?.textContent),
    ["Invites", "Billing", "Search", "Notes", "Old"],
  );
  for (const row of rows) {
    assert.doesNotMatch(row.textContent ?? "", /acme/u, "a row leaves its repository to its card");
  }
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

test("a folded group counts its plans, No repository's too, and an open one counts none", () => {
  window.localStorage.setItem("luke.sidebarFoldedGroups", JSON.stringify(["acme/ledger", null]));
  const container = mount(DEAN, {
    plans: {
      plans: [
        onRepository("Billing", "acme/ledger", 3),
        onRepository("Invoices", "acme/ledger", 2),
        onRepository("Search", "acme/relay"),
        onRepository("Notes", null),
      ],
    },
  });
  const count = (name: string) =>
    header(container, name).querySelector(".sidebar-repository-count")?.textContent;

  assert.equal(count("ledger"), "2 plans");
  assert.equal(count("No repository"), "1 plan");
  assert.equal(count("relay"), undefined);
  window.localStorage.clear();
});

test("a folded group's count stands a small gap after its name, not pushed to the header's end beside the +", async () => {
  const styled = await sheetStyle();
  window.localStorage.setItem("luke.sidebarFoldedGroups", JSON.stringify(["acme/ledger"]));
  const container = mount(DEAN, {
    plans: { plans: [onRepository("Billing", "acme/ledger", 3)] },
  });
  const name = header(container, "ledger").querySelector(".sidebar-repository-name");
  const count = name?.nextElementSibling;
  assert.ok(name && count, "the folded header draws a name and something after it");
  assert.ok(count.matches(".sidebar-repository-count"), "the count follows the name");

  // Nothing between them takes the slack: neither the count's margin nor the name's growth.
  assert.notEqual(styled(count, "margin-left"), "auto");
  assert.equal(styled(name, "flex") ?? styled(name, "flex-grow"), undefined);
  window.localStorage.clear();
});

test("the open plan stands under its folded group, the group's other plans do not, and opening another moves it", () => {
  window.localStorage.setItem("luke.sidebarFoldedGroups", JSON.stringify(["acme/ledger", null]));
  const plans = {
    page: PLANS_PAGE.DOCUMENT,
    plans: [
      onRepository("Billing", "acme/ledger", 3),
      onRepository("Invoices", "acme/ledger", 2),
      onRepository("Notes", null),
    ],
  };
  const container = mount(DEAN, { plans: { ...plans, activePlanId: "plan-Billing" } });
  const open = () => container.querySelector('.sidebar-plan[aria-current="page"]')?.textContent;

  const onBilling = groups(container);
  const openBilling = open();
  restages.get(container)?.({ plans: { ...plans, activePlanId: "plan-Invoices" } });
  const onInvoices = groups(container);
  restages.get(container)?.({ plans: { ...plans, activePlanId: "plan-Notes" } });

  assert.deepEqual(onBilling, [
    ["ledger", ["Billing"]],
    ["No repository", []],
  ]);
  assert.match(openBilling ?? "", /^Billing/u);
  assert.deepEqual(onInvoices, [
    ["ledger", ["Invoices"]],
    ["No repository", []],
  ]);
  assert.deepEqual(groups(container), [
    ["ledger", []],
    ["No repository", ["Notes"]],
  ]);
  assert.equal(
    header(container, "ledger")
      .querySelector(".sidebar-repository-toggle")
      ?.getAttribute("aria-expanded"),
    "false",
    "the group stays folded",
  );
  window.localStorage.clear();
});

test("from the new-plan page, walking down passes over a folded group's last open plan, which the list no longer shows", () => {
  window.localStorage.setItem("luke.sidebarFoldedGroups", JSON.stringify(["acme/ledger"]));
  const opened: string[] = [];
  const container = mount(DEAN, {
    plans: {
      page: PLANS_PAGE.NEW,
      activePlanId: "plan-Billing",
      plans: [onRepository("Billing", "acme/ledger", 9), onRepository("Search", "acme/relay")],
      onSelect: (planId) => opened.push(planId),
    },
  });

  assert.equal(walk("ArrowDown"), true);
  assert.deepEqual(groups(container), [
    ["ledger", []],
    ["relay", ["Search"]],
  ]);
  assert.deepEqual(opened, ["plan-Search"]);
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

/** The labels of the menu standing open, item by item. */
function menuItems(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] [role="menuitem"]')];
}

/** Chooses the open menu's item by its label. */
function choose(label: string): void {
  const item = menuItems().find((candidate) => candidate.textContent === label);
  assert.ok(item, `the menu offers ${label}`);
  act(() => item.click());
}

/** Opens a header's menu from its ⋯. */
function openActions(container: HTMLElement, name: string): void {
  const ellipsis = header(container, name).querySelector<HTMLButtonElement>(
    `[aria-label="Actions for ${name}"]`,
  );
  assert.ok(ellipsis, `the ${name} header offers its actions`);
  act(() => ellipsis.click());
}

test("a repository's header is led by its owner's picture, and No repository, a picture that fails, and a fixture run by a folder", () => {
  window.localStorage.clear();
  const plans = {
    plans: [onRepository("Billing", "acme/ledger", 2), onRepository("Notes", null)],
  };
  const live = mount(DEAN, { plans });
  const picture = header(live, "ledger").querySelector<HTMLImageElement>("img");
  assert.equal(picture?.getAttribute("src"), "https://github.com/acme.png?size=32");
  assert.equal(header(live, "No repository").querySelector("img"), null);

  act(() => {
    picture?.dispatchEvent(new Event("error"));
  });
  assert.equal(header(live, "ledger").querySelector("img"), null);

  const staged = mount(DEAN, {
    plans: { ...plans, repositories: { ...plansControl().repositories, pictures: false } },
  });
  assert.equal(staged.querySelector(".sidebar-repository-header img"), null);
  assert.ok(header(staged, "ledger").querySelector("svg"), "the folder stands in its place");
});

test("a repository's ⋯ and a right-click on its header open one menu: Pin, Archive plans, and Open on GitHub under GitHub's mark", () => {
  window.localStorage.clear();
  const container = mount(DEAN, {
    plans: { plans: [onRepository("Billing", "acme/ledger"), onRepository("Notes", null)] },
  });

  openActions(container, "ledger");
  const fromEllipsis = menuItems().map((item) => item.textContent);
  act(() => {
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
  assert.deepEqual(menuItems(), []);
  act(() => {
    header(container, "ledger").dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, clientX: 40, clientY: 12 }),
    );
  });

  assert.deepEqual(fromEllipsis, ["Pin", "Archive plans", "Open on GitHub"]);
  const github = menuItems().find((item) => item.textContent === "Open on GitHub");
  assert.ok(github?.querySelector("svg.account-mark"), "GitHub's mark, not the owner's picture");
  assert.deepEqual(
    menuItems().map((item) => item.textContent),
    fromEllipsis,
  );
  act(() => {
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
  openActions(container, "No repository");
  assert.deepEqual(
    menuItems().map((item) => item.textContent),
    ["Archive plans"],
    "the plans with no repository have no pin and no page to open",
  );
});

test("a repository's menu closes when the sidebar folds away, so nothing of a hidden header stands over the window", () => {
  const container = mount(DEAN, { plans: { plans: [onRepository("Billing", "acme/ledger")] } });
  openActions(container, "ledger");
  const opened = menuItems().length;

  restages.get(container)?.({ collapsed: true });

  assert.ok(opened > 0, "the menu stood open");
  assert.deepEqual(menuItems(), []);
});

test("a pinned repository stands above groups updated since, newest pinned first and marked pinned, and its menu asks for the pin or the unpin", () => {
  const asked: [string, boolean][] = [];
  const container = mount(DEAN, {
    plans: {
      plans: [
        onRepository("Billing", "acme/ledger", 9),
        onRepository("Search", "acme/relay", 5),
        onRepository("Gateway", "acme/gateway", 3),
        onRepository("Notes", null),
      ],
      pinnedRepositories: ["acme/gateway", "acme/relay"],
      onPinRepository: (repository, pinned) => asked.push([repository, pinned]),
    },
  });

  openActions(container, "relay");
  choose("Unpin");
  openActions(container, "ledger");
  choose("Pin");

  assert.deepEqual(
    groups(container).map(([name]) => name),
    ["gateway", "relay", "ledger", "No repository"],
  );
  assert.match(header(container, "relay").textContent ?? "", /\(pinned\)/u);
  assert.doesNotMatch(header(container, "ledger").textContent ?? "", /\(pinned\)/u);
  assert.deepEqual(asked, [
    ["acme/relay", false],
    ["acme/ledger", true],
  ]);
});

test("Archive plans archives every plan under the header and no other, and Open on GitHub opens the repository's page", () => {
  window.localStorage.clear();
  const archived: (readonly string[])[] = [];
  const opened: string[] = [];
  const container = mount(DEAN, {
    plans: {
      plans: [
        onRepository("Billing", "acme/ledger"),
        onRepository("Invoices", "acme/ledger"),
        { ...onRepository("Refunds", "acme/ledger"), pinnedAt: 3 },
        onRepository("Search", "acme/relay"),
      ],
      onArchivePlans: (planIds) => archived.push(planIds),
      repositories: { ...plansControl().repositories, openGitHub: (url) => opened.push(url) },
    },
  });

  openActions(container, "ledger");
  choose("Archive plans");
  openActions(container, "ledger");
  choose("Open on GitHub");

  assert.deepEqual(archived, [["plan-Billing", "plan-Invoices"]], "one archive of them all");
  assert.deepEqual(opened, ["https://github.com/acme/ledger"]);
});

/** The plans the sidebar draws as unread, by name: the rows whose name takes the heavier weight. */
function unread(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>(".sidebar-plan[data-unread='true']")].map(
    (row) => row.querySelector(".sidebar-plan-name")?.textContent ?? "",
  );
}

/** A plan's row of the list, started at `createdAt` and last saved at `updatedAt`. */
function savedPlan(name: string, createdAt: number, updatedAt: number): PlanSummary {
  return {
    id: `plan-${name}`,
    workspaceId: "workspace-personal",
    name,
    createdAt,
    updatedAt,
    repository: null,
  };
}

/** The open plan's region as the window draws it beside the sidebar: only its look matters here. */
function Region({ plan }: { plan: Plan }): null {
  usePlanLooks(plan);
  return null;
}

/** `summary` as the open plan's document, with nothing written in it. */
function opened(summary: PlanSummary): Plan {
  return { ...summary, document: { body: "", assumptions: [] } };
}

/** Lets what fell due land and redraw. */
const landed = Effect.promise(() =>
  act(async () => {
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
  }),
);

test("the plans this Mac first lists are read, the open one too, and none is unread before the list is read", () => {
  const billing = savedPlan("Billing", 1, 50);
  const invites = { ...savedPlan("Invites", 2, 60), pinnedAt: 70 };
  const old = { ...savedPlan("Old", 3, 40), archivedAt: 80 };
  const listed = { plans: [invites, billing], archived: [old] };

  const reading = mount(DEAN, { plans: { ...listed, listRead: false } });
  assert.deepEqual(unread(reading), []);
  unmountAll();

  const first = mount(DEAN, {
    plans: { ...listed, page: PLANS_PAGE.DOCUMENT, activePlanId: billing.id },
  });
  const row = first.querySelector<HTMLElement>(".sidebar-plan[aria-current='page']");

  assert.deepEqual(unread(first), []);
  assert.equal(row?.querySelector(".sidebar-plan-name")?.textContent, "Billing");
  assert.doesNotMatch(row?.textContent ?? "", /unread/u);
});

test("a plan saved since this Mac last saw it is unread, and so is one from another Mac with anything saved in it", () => {
  const listed = [savedPlan("Billing", 1, 50), savedPlan("Invites", 2, 60)];
  const archived = [{ ...savedPlan("Old", 3, 40), archivedAt: 80 }];
  mount(DEAN, { plans: { plans: listed, archived } });
  // The next launch, with the marks the first one kept.
  unmountAll();

  const later = mount(DEAN, {
    plans: {
      plans: [
        savedPlan("Billing", 1, 90),
        savedPlan("Invites", 2, 60),
        savedPlan("Search", 100, 120),
        savedPlan("Blank", 110, 110),
      ],
      archived: [{ ...savedPlan("Old", 3, 95), archivedAt: 80 }],
    },
  });
  const unfold = later.querySelector<HTMLButtonElement>(".sidebar-archived-row");
  act(() => unfold?.click());

  assert.deepEqual(unread(later), ["Billing", "Search", "Old"]);
  const billing = [...later.querySelectorAll(".sidebar-plan")].find((row) =>
    row.textContent?.startsWith("Billing"),
  );
  assert.match(billing?.textContent ?? "", /\(unread\)/u);
});

test("another account's plans, listed on this Mac for the first time, are read too", () => {
  mount(DEAN, { plans: { plans: [savedPlan("Billing", 1, 50)] } });
  unmountAll();

  const other = mount(DEAN, {
    plans: { plans: [savedPlan("Roadmap", 1, 70), savedPlan("Hiring", 2, 80)] },
  });

  assert.deepEqual(unread(other), []);
});

it.effect(
  "an unread plan opened is read once it has been looked at, and stays read once left",
  () =>
    Effect.gen(function* () {
      mount(DEAN, { plans: { plans: [savedPlan("Billing", 1, 50)] } });
      unmountAll();
      const saved = savedPlan("Billing", 1, 90);
      const open = { page: PLANS_PAGE.DOCUMENT, activePlanId: saved.id, plans: [saved] };

      const container = mount(DEAN, {
        plans: open,
        registry: yield* registryOnTestClock,
        beside: createElement(Region, { plan: opened(saved) }),
      });
      yield* landed;
      assert.deepEqual(unread(container), ["Billing"], "unread until the look");
      yield* TestClock.adjust(PLAN_LOOK);
      yield* landed;
      assert.deepEqual(unread(container), []);
      unmountAll();

      assert.deepEqual(unread(mount(DEAN, { plans: { plans: [saved] } })), []);
    }),
);

it.effect("a save that lands on the plan the developer is looking at never makes it unread", () =>
  Effect.gen(function* () {
    const plan = savedPlan("Billing", 1, 50);
    mount(DEAN, { plans: { plans: [plan] } });
    unmountAll();
    const open = { page: PLANS_PAGE.DOCUMENT, activePlanId: plan.id };
    const container = mount(DEAN, {
      plans: { ...open, plans: [plan] },
      registry: yield* registryOnTestClock,
      beside: createElement(Region, { plan: opened(plan) }),
    });
    yield* landed;
    yield* TestClock.adjust(PLAN_LOOK);
    yield* landed;

    // Note that the list's row is read ahead of the document here, as a
    // refresh reads the list first.
    restages.get(container)?.({ plans: { ...open, plans: [savedPlan("Billing", 1, 70)] } });
    yield* landed;

    assert.deepEqual(unread(container), []);
  }),
);
