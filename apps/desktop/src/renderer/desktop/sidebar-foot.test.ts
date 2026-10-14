// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS, type AccountSnapshot } from "@sidecar/credentials/snapshot";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { ACT_KIND, ACT_OUTCOME_STATUS } from "#shared/messages/acts";
import { UPDATE_STATUS } from "#shared/messages/update";
import { APP_COMMAND } from "#shared/shortcuts";
import { onRegistry } from "#testing/copy-feedback";
import { useAppCommand } from "../app-commands";
import { SidebarFoot } from "./sidebar-foot";

/**
 * The sidebar's foot as the developer meets it: the account's menu in
 * Cursor's order, Settings, what the menu bar's Help menu offers, Contact
 * us, and Log out, which asks first.
 */

const DEAN: AccountSnapshot = {
  status: ACCOUNT_STATUS.SIGNED_IN,
  email: "dean@example.com",
  name: "Dean Stratakos",
  provider: "github",
};

const roots: Root[] = [];

/** Every act the foot sent, in order. */
let sent: { kind: string }[] = [];

beforeEach(() => {
  sent = [];
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: {
      act: (request: { kind: string }) => {
        sent.push({ kind: request.kind });
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.UNKNOWN_ACT });
      },
      recordSurfaceEvent: () => undefined,
    },
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The Help menu's commands, offered as `App` offers them, each press written down. */
function HelpOffers({ ran }: { ran: string[] }): null {
  useAppCommand(APP_COMMAND.SEND_FEEDBACK, () => ran.push(APP_COMMAND.SEND_FEEDBACK));
  useAppCommand(APP_COMMAND.SUGGEST_FEATURE, () => ran.push(APP_COMMAND.SUGGEST_FEATURE));
  useAppCommand(APP_COMMAND.KEYBOARD_SHORTCUTS, () => ran.push(APP_COMMAND.KEYBOARD_SHORTCUTS));
  return null;
}

function mount(
  account: AccountSnapshot,
  options: { onSignOut?: () => Promise<void>; ran?: string[] } = {},
): HTMLButtonElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(
          "div",
          null,
          createElement(SidebarFoot, {
            account,
            updates: {
              update: {
                status: UPDATE_STATUS.IDLE,
                currentVersion: "1.0.0",
                installSupported: true,
                upToDate: true,
              },
              build: { packaged: false },
              onCheck: () => Promise.resolve(),
              onInstall: () => undefined,
              onOpenLatest: () => undefined,
            },
            shown: true,
            settingsOpen: false,
            onSettings: () => undefined,
            onSignOut: options.onSignOut ?? (() => Promise.resolve()),
          }),
          createElement(HelpOffers, { ran: options.ran ?? [] }),
        ),
      ),
    ),
  );
  return (
    container.querySelector<HTMLButtonElement>(".sidebar-account") ??
    assert.fail("the foot draws the account's button")
  );
}

function accountMenu(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="menu"][aria-label="Account"]');
}

/** The open account menu as it reads down: its heading, each item's label and chord, and a dash for each rule. */
function accountMenuLines(): string[] {
  const menu = accountMenu() ?? assert.fail("the account's menu stands");
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
  return item ?? assert.fail(`the account's menu offers ${label}`);
}

function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="alertdialog"]');
}

function dialogButton(label: string): HTMLButtonElement {
  const button = [...(dialog()?.querySelectorAll("button") ?? [])].find(
    (candidate) => candidate.textContent === label,
  );
  return button ?? assert.fail(`the dialog offers ${label}`);
}

test("the account opens its menu: who is signed in, then Settings, the Help menu's offers, Contact us, and Log out, parted by rules", () => {
  const button = mount(DEAN);
  act(() => button.click());

  assert.deepEqual(accountMenuLines(), [
    "Dean Stratakos dean@example.com",
    "—",
    "Settings ⌘,",
    "—",
    "Changelog",
    "Send feedback",
    "Suggest a feature",
    "Keyboard shortcuts ⌘/",
    "Contact us",
    "—",
    "Log out",
  ]);
});

test("the account's menu offers the Help menu's own commands and opens the changelog, each closing the menu", () => {
  const ran: string[] = [];
  const button = mount(DEAN, { ran });
  for (const label of ["Send feedback", "Suggest a feature", "Keyboard shortcuts", "Changelog"]) {
    act(() => button.click());
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

test("Log out asks first, and only its answer signs the account out", async () => {
  let signOuts = 0;
  const button = mount(DEAN, {
    onSignOut: () => {
      signOuts += 1;
      return Promise.resolve();
    },
  });
  const logOut = () => {
    act(() => button.click());
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
  const button = mount(DEAN, { onSignOut: () => Promise.reject(new Error("refused")) });
  act(() => button.click());
  act(() => accountItem("Log out").click());

  await act(async () => dialogButton("Log out").click());

  assert.match(
    dialog()?.querySelector('[role="alert"]')?.textContent ?? "",
    /could not log out, so you are still signed in/u,
  );
});

test("signed out, the account says so and its menu names no one and offers no Log out", () => {
  const button = mount({ status: ACCOUNT_STATUS.SIGNED_OUT });

  assert.equal(button.querySelector(".sidebar-account-name")?.textContent, "Not signed in");
  act(() => button.click());
  assert.deepEqual(accountMenuLines(), [
    "Settings ⌘,",
    "—",
    "Changelog",
    "Send feedback",
    "Suggest a feature",
    "Keyboard shortcuts ⌘/",
    "Contact us",
  ]);
});
