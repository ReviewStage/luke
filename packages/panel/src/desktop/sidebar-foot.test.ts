// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS, type AccountSnapshot } from "@repo/credentials/snapshot";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { HOST_CAPABILITY, type HostCapability } from "@repo/settings";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { UPDATE_STATUS, type UpdateSnapshot } from "@repo/settings/update";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { useAppCommand } from "../app-commands.js";
import { OpenPersonProvider } from "../person-door.js";
import { rendererRegistry } from "../renderer-runtime.js";
import { fakeActPortAnswering, fakeAppBridge } from "../testing/app-bridge.js";
import {
  DESKTOP_CAPABILITIES,
  handCapabilities,
  handState,
  stateWith,
} from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { ToastHost } from "../toast.js";
import { SidebarFoot } from "./sidebar-foot.js";

/**
 * The sidebar's foot as the developer meets it: the account's menu in
 * Cursor's order, Settings, what the menu bar's Help menu offers, Contact
 * us, and Sign out, which acts on the press.
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
  fakeAppBridge({});
  fakeActPortAnswering((request) => {
    sent.push({ kind: request.kind });
    return Promise.resolve(undefined);
  });
  handCapabilities(DESKTOP_CAPABILITIES);
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  vi.restoreAllMocks();
});

/**
 * Hands the window main's document with `patch`, its run a development build
 * of `branch`, and waits for the foot to draw that branch: one client holds a
 * test's document across its mounts, so the branch is what says this one landed.
 */
async function footOn(
  branch: string,
  patch: Partial<AppStateSnapshot>,
  options: Parameters<typeof mount>[1] = {},
): Promise<void> {
  const base = stateWith({}, patch).run;
  handState({}, { ...patch, run: { ...base, commit: { sha: "a10eee5", dirty: false, branch } } });
  mount(DEAN, options);
  await vi.waitFor(() => assert.equal(document.body.textContent?.includes(branch), true));
}

/** Lets the window's document, handed through the bridge's promise, reach what is drawn. */
async function stateArrived(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/** The Help menu's commands, offered as `App` offers them, each press written down. */
function HelpOffers({ ran }: { ran: string[] }): null {
  useAppCommand(APP_COMMAND.SEND_FEEDBACK, () => ran.push(APP_COMMAND.SEND_FEEDBACK));
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
                onMoveToApplications: () => undefined,
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
  // Note that a refusal's toast is shown on the window's own registry, which `showToast` writes to.
  const toasts = document.createElement("div");
  document.body.append(toasts);
  const toastRoot = createRoot(toasts);
  roots.push(toastRoot);
  act(() => toastRoot.render(onRegistry(rendererRegistry, createElement(ToastHost))));
  return (
    container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]') ??
    assert.fail("the foot draws the account's button")
  );
}

function accountMenu(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="menu"][aria-label="Account"]');
}

/** The account menu's own lines as they stand down its scrolling column: its heading, items, and rules. */
function accountMenuColumn(): Element[] {
  const first = accountMenu()?.querySelector('[role^="menuitem"]');
  return [...(first?.parentElement?.children ?? [])];
}

/** The open account menu as it reads down: its heading, each item's label and chord, and a dash for each rule; not the unseen focus guards a submenu standing beside it leaves among them. */
function accountMenuLines(): string[] {
  accountMenu() ?? assert.fail("the account's menu stands");
  const lines = accountMenuColumn().filter((line) =>
    line.matches('hr, [role^="menuitem"], [role="none"]'),
  );
  return lines.map((line) => {
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
  const item = accountMenuColumn().find(
    (line): line is HTMLButtonElement =>
      line instanceof HTMLButtonElement &&
      line.querySelector(".ui-menu-item-label")?.textContent === label,
  );
  return item ?? assert.fail(`the account's menu offers ${label}`);
}

test("the account opens its menu: who is signed in, then the changelog, Keyboard shortcuts, Contact us, and Sign out, parted by rules", async () => {
  const button = mount(DEAN);
  await stateArrived();
  act(() => button.click());

  assert.deepEqual(accountMenuLines(), [
    "Dean Stratakos dean@example.com",
    "—",
    "Changelog",
    "Keyboard shortcuts ⌘/",
    "Contact us",
    "—",
    "Sign out",
  ]);
});

test("the account's menu opens Keyboard shortcuts and the changelog, each closing the menu", async () => {
  const ran: string[] = [];
  const button = mount(DEAN, { ran });
  await stateArrived();
  for (const label of ["Keyboard shortcuts", "Changelog"]) {
    act(() => button.click());
    await act(async () => accountItem(label).click());
    assert.equal(accountMenu(), null);
  }

  assert.deepEqual(ran, [APP_COMMAND.KEYBOARD_SHORTCUTS]);
  assert.deepEqual(sent, [{ kind: ACT_KIND.UPDATE_OPEN_CHANGELOG }]);
});

test("in a browser, which is no installed app, the account's menu offers no Keyboard shortcuts, since no page lists them there", async () => {
  handCapabilities(DESKTOP_CAPABILITIES.filter((each) => each !== HOST_CAPABILITY.DESKTOP_APP));
  const button = mount(DEAN);
  await stateArrived();
  act(() => button.click());

  assert.deepEqual(accountMenuLines().slice(2, 4), ["Changelog", "Contact us"]);
});

test("Contact us flies out its own menu beside the account's, which stands whole behind it", async () => {
  const button = mount(DEAN);
  await stateArrived();
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
  assert.equal(accountMenuLines().length, 7, "the account's menu keeps every line");
  assert.equal(contact.getAttribute("aria-expanded"), "true");
});

test("Left or Escape closes Contact us's menu alone, and choosing in it closes both", async () => {
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
  await act(async () => email?.click());
  assert.equal(accountMenu(), null);
  assert.equal(contactMenu(), null, "the submenu goes with the menu");
  assert.deepEqual(sent, [{ kind: ACT_KIND.CONTACT_EMAIL }]);
});

test("in the window's bottom-left corner, Contact us's menu opens rightward and rises so it ends level with its row", async () => {
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(1000);
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(700);
  // Note that the page's root is the window's size, as a browser lays it out, though jsdom lays out nothing.
  vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1000);
  vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(700);
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
  // Note that a menu is laid out 196 by 74, its own offset size as well, as a browser lays it out, though jsdom lays out nothing.
  const menuBox = (element: HTMLElement) =>
    element.getAttribute("role") === "menu" ||
    element.querySelector(':scope > [role="menu"]') !== null;
  const measured = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return menuBox(this)
      ? DOMRect.fromRect({ x: 0, y: 0, width: 196, height: 74 })
      : measured.call(this);
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return menuBox(this) ? 196 : this.getBoundingClientRect().width;
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return menuBox(this) ? 74 : this.getBoundingClientRect().height;
  });

  act(() => contact.click());
  // Note that Base UI places the submenu over a few promises rather than in the render that opened it.
  await act(async () => {
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
  });

  const submenu = contactMenu() ?? assert.fail("Contact us opens its submenu");
  const at = /translate\((-?[\d.]+px), (-?[\d.]+px)\)/u.exec(
    submenu.parentElement?.style.transform ?? "",
  );
  assert.equal(at?.[1], "226px", "beside the menu's right edge");
  assert.equal(at?.[2], "602px", "its foot level with Contact us's");
});

test("Sign out signs the account out on the press, with no question first", async () => {
  let signOuts = 0;
  const button = mount(DEAN, {
    onSignOut: () => {
      signOuts += 1;
      return Promise.resolve();
    },
  });
  act(() => button.click());

  await act(async () => accountItem("Sign out").click());

  assert.equal(signOuts, 1);
  assert.equal(document.querySelector('[role="alertdialog"], [role="dialog"]'), null);
});

test("a Sign out that fails says so in a toast, and the account is still signed in", async () => {
  const button = mount(DEAN, { onSignOut: () => Promise.reject(new Error("refused")) });
  act(() => button.click());

  await act(async () => accountItem("Sign out").click());

  assert.match(
    document.body.textContent ?? "",
    /The account could not be signed out\. Try again\./u,
  );
});

test("signed out, the account says so and its menu names no one and offers no Sign out", async () => {
  const button = mount({ status: ACCOUNT_STATUS.SIGNED_OUT });
  await stateArrived();

  assert.match(button.textContent ?? "", /Not signed in$/u);
  act(() => button.click());
  assert.deepEqual(accountMenuLines(), ["Changelog", "Keyboard shortcuts ⌘/", "Contact us"]);
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

test("Send feedback beside the gear runs the Help menu's Send feedback, with no menu to open first", async () => {
  const ran: string[] = [];
  mount(DEAN, { ran });
  await stateArrived();
  const feedback =
    document.querySelector<HTMLButtonElement>('button[aria-label="Send feedback"]') ??
    assert.fail("the foot draws Send feedback");
  act(() => feedback.click());

  assert.deepEqual(ran, [APP_COMMAND.SEND_FEEDBACK]);
  assert.equal(accountMenu(), null);
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

test("an update ready to install offers Restart in the sidebar on the desktop, and nothing on a platform without updates", async () => {
  const ready: UpdateSnapshot = {
    status: UPDATE_STATUS.READY,
    currentVersion: "1.0.0",
    installSupported: true,
    latestVersion: "1.1.0",
  };
  const restartShown = async (branch: string, capabilities: readonly HostCapability[]) => {
    await footOn(branch, { run: { ...stateWith({}, {}).run, capabilities } }, { update: ready });
    const shown = [...document.querySelectorAll("button")].some(
      (button) => button.textContent === "Restart",
    );
    for (const root of roots.splice(0)) act(() => root.unmount());
    return shown;
  };

  assert.equal(await restartShown("feat/updates", DESKTOP_CAPABILITIES), true);
  assert.equal(
    await restartShown(
      "feat/no-updates",
      DESKTOP_CAPABILITIES.filter((each) => each !== HOST_CAPABILITY.UPDATES),
    ),
    false,
  );
});

test("the Mac offline says so in the foot, and nothing does while it is online", async () => {
  const offlineShown = async (online: boolean) => {
    await footOn(online ? "feat/online" : "feat/offline", { network: { online, reachable: true } });
    const mark = document.querySelector('.offline-mark[aria-label="Offline"]');
    const words = mark?.textContent ?? null;
    for (const root of roots.splice(0)) act(() => root.unmount());
    return words;
  };

  assert.equal(await offlineShown(false), "Offline");
  assert.equal(await offlineShown(true), null);
});

test("a development build's branch row hides the branch, and its hidden row brings it back", async () => {
  const asked: unknown[] = [];
  const run = {
    profile: "test",
    packaged: false,
    platform: "darwin",
    capabilities: DESKTOP_CAPABILITIES,
    appVersion: "1.0.0",
    captureMode: false,
    fixtureMode: false,
    accountRequired: false,
    commit: { sha: "a10eee5", dirty: false, branch: "feat/demo" },
  };
  const footWith = async (hidden: boolean) => {
    handState({}, { run, window: { fullScreen: false, buildLabelHidden: hidden } });
    fakeActPortAnswering((request) => {
      if (request.kind === ACT_KIND.WINDOW_SHOW_BUILD_LABEL) asked.push(request.payload);
      return Promise.resolve(undefined);
    });
    mount(DEAN);
    await vi.waitFor(() => assert.equal(branchPress(hidden ? "Show branch" : "Hide branch"), true));
  };
  const branchPress = (name: string) =>
    [...document.querySelectorAll("button")].some(
      (each) => each.getAttribute("aria-label") === name || each.textContent === name,
    );
  const pressNamed = async (name: string) => {
    const button = [...document.querySelectorAll("button")].find(
      (each) => each.getAttribute("aria-label") === name || each.textContent === name,
    );
    await act(async () => (button ?? assert.fail(`the foot offers ${name}`)).click());
  };

  await footWith(false);
  assert.ok(document.body.textContent?.includes("feat/demo"));
  await pressNamed("Hide branch");
  for (const root of roots.splice(0)) act(() => root.unmount());

  await footWith(true);
  assert.ok(!document.body.textContent?.includes("feat/demo"));
  await pressNamed("Show branch");

  assert.deepEqual(asked, [{ shown: false }, { shown: true }]);
});
