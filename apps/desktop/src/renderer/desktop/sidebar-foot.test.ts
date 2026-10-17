// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS, type AccountSnapshot } from "@luke/credentials/snapshot";
import { ACT_KIND, ACT_OUTCOME_STATUS } from "@luke/host/acts";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { UPDATE_STATUS, type UpdateSnapshot } from "@luke/settings/update";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { fakeAppBridge } from "#testing/app-bridge";
import { onRegistry } from "#testing/copy-feedback";
import { useAppCommand } from "../app-commands";
import { OpenPersonProvider } from "../person-door";
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
  fakeAppBridge({
    act: (request: { kind: string }) => {
      sent.push({ kind: request.kind });
      return Promise.resolve({ status: ACT_OUTCOME_STATUS.UNKNOWN_ACT });
    },
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  vi.restoreAllMocks();
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
  options: {
    onSignOut?: () => Promise<void>;
    ran?: string[];
    openPerson?: (userId: string) => void;
    update?: UpdateSnapshot;
    settingsOpen?: boolean;
    onSettings?: () => void;
  } = {},
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
          OpenPersonProvider,
          { value: options.openPerson },
          createElement(
            "div",
            null,
            createElement(SidebarFoot, {
              account,
              updates: {
                update: options.update ?? {
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
              settingsOpen: options.settingsOpen ?? false,
              onSettings: options.onSettings ?? (() => undefined),
              onSignOut: options.onSignOut ?? (() => Promise.resolve()),
            }),
            createElement(HelpOffers, { ran: options.ran ?? [] }),
          ),
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
  return [...menu.children].map((line) => {
    if (line.matches("hr")) return "—";
    const words = [...line.querySelectorAll(":scope > span, :scope > kbd")].map(
      (part) => part.textContent ?? "",
    );
    return words.filter((word) => word !== "").join(" ");
  });
}

/** Contact us's submenu, while it stands. */
function contactMenu(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="menu"][aria-label="Contact us"]');
}

/** Lays an element out where the window would, which jsdom never does. */
function placeAt(
  element: Element,
  box: { left: number; top: number; width: number; height: number },
) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ x: box.left, y: box.top, width: box.width, height: box.height }),
  );
}

/** The open account menu's own item by its label, not a submenu's. */
function accountItem(label: string): HTMLButtonElement {
  const item = [...(accountMenu()?.children ?? [])].find(
    (line): line is HTMLButtonElement =>
      line instanceof HTMLButtonElement &&
      line.querySelector(".luke-menu-item-label")?.textContent === label,
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

test("Contact us flies out its own menu beside the account's, which stands whole behind it", () => {
  const button = mount(DEAN);
  act(() => button.click());
  const contact = accountItem("Contact us");
  act(() =>
    contact.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
  );

  const submenu = contactMenu() ?? assert.fail("Contact us opens its submenu");
  assert.ok(!accountMenu()?.contains(submenu), "the submenu stands on its own surface");
  assert.deepEqual(
    [...submenu.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent),
    ["GitHub", "Email"],
  );
  assert.equal(document.activeElement?.textContent, "GitHub", "focus lands on its first item");
  assert.equal(accountMenuLines().length, 11, "the account's menu keeps every line");
  assert.equal(contact.getAttribute("aria-expanded"), "true");
});

test("Left or Escape closes Contact us's menu alone, and choosing in it closes both", () => {
  const button = mount(DEAN);
  act(() => button.click());
  for (const key of ["ArrowLeft", "Escape"]) {
    act(() => accountItem("Contact us").click());
    act(() =>
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })),
    );
    assert.equal(contactMenu(), null, `${key} closes the submenu`);
    assert.ok(accountMenu(), `and ${key} leaves the account's menu standing`);
    assert.equal(document.activeElement, accountItem("Contact us"), "focus back on Contact us");
  }

  act(() => accountItem("Contact us").click());
  const email = [...(contactMenu()?.querySelectorAll("button") ?? [])].find(
    (item) => item.textContent === "Email",
  );
  act(() => email?.click());
  assert.equal(accountMenu(), null);
  assert.equal(contactMenu(), null, "the submenu goes with the menu");
  assert.deepEqual(sent, [{ kind: ACT_KIND.CONTACT_EMAIL }]);
});

test("in the window's bottom-left corner, Contact us's menu opens rightward and rises so it ends level with its row", () => {
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(1000);
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(700);
  const button = mount(DEAN);
  act(() => button.click());
  const contact = accountItem("Contact us");
  placeAt(accountMenu() ?? assert.fail("the account's menu stands"), {
    left: 12,
    top: 340,
    width: 210,
    height: 340,
  });
  placeAt(contact, { left: 16, top: 640, width: 200, height: 32 });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ x: 0, y: 0, width: 196, height: 74 }),
  );

  act(() => contact.click());

  const submenu = contactMenu() ?? assert.fail("Contact us opens its submenu");
  assert.equal(submenu.style.left, "226px", "beside the menu's right edge");
  assert.equal(submenu.style.top, "602px", "its foot level with Contact us's");
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

  assert.match(dialog()?.querySelector('[role="alert"]')?.textContent ?? "", /could not log out/u);
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

test("in the window, the account's menu opens with the reader's own profile, once their account's id is known", () => {
  const opened: string[] = [];
  const button = mount(
    { ...DEAN, id: "user-dean" },
    { openPerson: (userId) => opened.push(userId) },
  );
  act(() => button.click());

  assert.equal(accountMenuLines()[2], "Your profile");
  act(() => accountItem("Your profile").click());
  assert.deepEqual(opened, ["user-dean"]);
});

test("the gear goes to Settings, and marks itself the page while Settings shows", () => {
  let opened = 0;
  mount(DEAN, { onSettings: () => opened++ });
  const gear = (): HTMLButtonElement =>
    document.querySelector<HTMLButtonElement>('button[aria-label="Settings"]') ??
    assert.fail("the foot draws the gear");
  assert.equal(gear().getAttribute("aria-current"), null);
  act(() => gear().click());
  assert.equal(opened, 1);

  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  mount(DEAN, { settingsOpen: true });
  assert.equal(gear().getAttribute("aria-current"), "page");
});
