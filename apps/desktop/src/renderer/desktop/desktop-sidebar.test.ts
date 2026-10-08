// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  ACCOUNT_PROVIDER,
  ACCOUNT_STATUS,
  type AccountSnapshot,
} from "@sidecar/credentials/snapshot";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { plansControl } from "#testing/plans-control";
import { PANEL_TAB, type PanelTab } from "../panel-tabs";
import { PLANS_PAGE } from "../planning/planning-model";
import type { PlansControl } from "../planning/use-plans-tab";
import { DesktopSidebar } from "./desktop-sidebar";

const PHOTO = "https://avatars.githubusercontent.com/u/1?v=4";

const DEAN: AccountSnapshot = {
  status: ACCOUNT_STATUS.SIGNED_IN,
  email: "dean@example.com",
  name: "Dean Stratakos",
  provider: ACCOUNT_PROVIDER.GITHUB,
};

function mount(
  account: AccountSnapshot,
  options: {
    settingsNote?: string;
    onTabChange?: (tab: PanelTab) => void;
    tab?: PanelTab;
    plans?: Partial<PlansControl>;
  } = {},
): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      createElement(DesktopSidebar, {
        collapsed: false,
        identity: {
          speakers: { listening: false, lukeSpeaking: false },
          voiceActive: { developer: false, luke: false },
          fixtureSpeaking: false,
          voiceOpening: false,
        },
        plans: plansControl(options.plans),
        tab: options.tab ?? PANEL_TAB.PLANS,
        onTabChange: options.onTabChange ?? (() => undefined),
        account,
        settingsNote: options.settingsNote,
      }),
    );
  });
  return container;
}

function accountButton(container: ParentNode): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(".sidebar-foot button");
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

afterEach(() => {
  document.body.innerHTML = "";
});

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

test("a waiting release marks the account button with its news", () => {
  const button = accountButton(mount(DEAN, { settingsNote: "Update available" }));

  assert.equal(button.querySelector(".tab-note")?.getAttribute("title"), "Update available");
  assert.match(button.textContent ?? "", /\(Update available\)/u);
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
