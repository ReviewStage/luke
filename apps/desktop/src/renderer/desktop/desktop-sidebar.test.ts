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
  options: { settingsNote?: string; onTabChange?: (tab: PanelTab) => void } = {},
): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      createElement(DesktopSidebar, {
        identity: {
          speakers: { listening: false, lukeSpeaking: false },
          voiceActive: { developer: false, luke: false },
          fixtureSpeaking: false,
          voiceOpening: false,
        },
        plans: plansControl(),
        tab: PANEL_TAB.PLANS,
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
