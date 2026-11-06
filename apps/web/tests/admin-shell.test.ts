// @vitest-environment jsdom
import "@repo/panel/testing/match-media";
import "@repo/panel/testing/resize-observer";
import { onRegistry } from "@repo/panel/testing/copy-feedback";
import type { WireValue } from "@repo/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { choose, menuItems, openViewOptions } from "./support/view-options";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const SESSION_PATH = "/api/auth/get-session";

const SIGN_OUT_PATH = "/api/auth/sign-out";

const PHONE_WIDTH = 390;

let root: Root | undefined;

let signOutStatus = 200;

const SIGNED_IN = {
  session: { id: "session-1" },
  user: { id: "user-1", name: "Ada Lovelace", email: "ada@example.com", image: null },
};

async function openAdmin(address = "/admin"): Promise<HTMLElement> {
  vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
    const answer = (body: WireValue, status = 200) =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
      );
    if (url.pathname === SESSION_PATH) return answer(SIGNED_IN);
    if (url.pathname === SIGN_OUT_PATH) {
      return signOutStatus === 200
        ? answer({ success: true })
        : answer({ message: "Sign-out failed" }, signOutStatus);
    }
    return new Promise(() => undefined);
  });
  window.localStorage.setItem("app-admin-sign-in-chosen", "true");
  window.history.replaceState(null, "", address);
  const container = document.createElement("div");
  container.id = "root";
  document.body.replaceChildren(container);
  vi.resetModules();
  const { AdminDashboard } = await import("../src/AdminDashboard");
  root = createRoot(container);
  await act(async () => {
    root?.render(
      createElement(
        StrictMode,
        null,
        onRegistry(AtomRegistry.make(), createElement(AdminDashboard)),
      ),
    );
  });
  return container;
}

function currentSections(page: HTMLElement): (string | null)[] {
  return Array.from(page.querySelectorAll('nav a[aria-current="page"]')).map(
    (link) => link.textContent,
  );
}

function sectionLink(page: HTMLElement, name: string): HTMLAnchorElement {
  const link = Array.from(page.querySelectorAll<HTMLAnchorElement>("nav a")).find(
    (candidate) => candidate.textContent === name,
  );
  if (link === undefined) throw new Error(`No ${name} link`);
  return link;
}

function button(name: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll("button")).find(
    (candidate) => (candidate.getAttribute("aria-label") ?? candidate.textContent?.trim()) === name,
  );
}

function unreachable(element: Element): boolean {
  return element.closest("[inert]") !== null;
}

function view(page: HTMLElement): HTMLElement {
  const main = page.querySelector("main");
  if (!(main instanceof HTMLElement)) throw new Error("No view");
  return main;
}

function saysLoading(page: HTMLElement): boolean {
  return Array.from(page.querySelectorAll('[role="status"]')).some((region) =>
    region.textContent?.startsWith("Reading"),
  );
}

afterEach(() => {
  vi.useFakeTimers();
  act(() => root?.unmount());
  root = undefined;
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  signOutStatus = 200;
  window.localStorage.clear();
  document.body.replaceChildren();
});

test("a view whose read is out stands under its title and says it is loading", async () => {
  const page = await openAdmin();

  await vi.waitFor(() => expect(page.querySelector("main h1")?.textContent).toBe("Overview"));
  expect(saysLoading(page)).toBe(true);
  expect(currentSections(page)).toEqual(["Overview"]);
});

test("a press on another section makes it the current page", async () => {
  const page = await openAdmin();
  await vi.waitFor(() => expect(page.querySelector("main h1")?.textContent).toBe("Overview"));

  const users = sectionLink(page, "Users");
  await act(async () => {
    users.click();
  });

  await vi.waitFor(() => expect(page.querySelector("main h1")?.textContent).toBe("Users"));
  expect(currentSections(page)).toEqual(["Users"]);
  expect(saysLoading(page)).toBe(true);
  expect(window.location.search).toBe("?view=users");
});

function sectionNames(navigation: Element): (string | null)[] {
  return Array.from(navigation.querySelectorAll("a"), (link) => link.textContent);
}

test("one sidebar lists the measures", async () => {
  const page = await openAdmin();
  await vi.waitFor(() => expect(page.querySelector("main h1")?.textContent).toBe("Overview"));

  const navigations = page.querySelectorAll('nav[aria-label="Admin sections"]');
  expect(navigations).toHaveLength(1);
  const [sidebar] = Array.from(navigations);
  if (sidebar === undefined) throw new Error("No navigation");
  expect(sectionNames(sidebar)).toEqual(["Overview", "Cost", "Reliability", "Workspaces", "Users"]);
});

test("the toggle at the sidebar's top hides it and shows it again, remembered across visits", async () => {
  let page = await openAdmin();
  await vi.waitFor(() => expect(page.querySelector("main h1")?.textContent).toBe("Overview"));
  expect(unreachable(sectionLink(page, "Users"))).toBe(false);

  await act(async () => {
    button("Hide sidebar")?.click();
  });
  expect(unreachable(sectionLink(page, "Users"))).toBe(true);
  expect(unreachable(view(page))).toBe(false);
  expect(button("Hide sidebar")).toBeUndefined();

  act(() => root?.unmount());
  page = await openAdmin();
  await vi.waitFor(() => expect(page.querySelector("main h1")?.textContent).toBe("Overview"));
  expect(unreachable(sectionLink(page, "Users"))).toBe(true);

  await act(async () => {
    button("Show sidebar")?.click();
  });
  expect(unreachable(sectionLink(page, "Users"))).toBe(false);
  expect(button("Hide sidebar")).toBeDefined();
});

test("in a phone's narrow room the sidebar is a drawer the toggle opens over the view, and a choice in it puts away", async () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ width: PHONE_WIDTH, height: 800 }),
  );
  const page = await openAdmin();
  await vi.waitFor(() => expect(page.querySelector("main h1")?.textContent).toBe("Overview"));
  const toggle = button("Show sidebar");
  if (toggle === undefined) throw new Error("No sidebar toggle");
  expect(unreachable(sectionLink(page, "Users"))).toBe(true);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");

  await act(async () => {
    toggle.click();
  });
  expect(unreachable(sectionLink(page, "Users"))).toBe(false);
  expect(unreachable(view(page))).toBe(true);
  expect(toggle.getAttribute("aria-label")).toBe("Hide sidebar");
  expect(document.activeElement).toBe(sectionLink(page, "Overview"));

  await act(async () => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  expect(unreachable(sectionLink(page, "Users"))).toBe(true);
  expect(document.activeElement).toBe(toggle);

  await act(async () => {
    toggle.click();
  });
  await act(async () => {
    sectionLink(page, "Users").click();
  });
  await vi.waitFor(() => expect(page.querySelector("main h1")?.textContent).toBe("Users"));
  expect(unreachable(sectionLink(page, "Users"))).toBe(true);
  expect(unreachable(view(page))).toBe(false);
  expect(window.localStorage.getItem("app-admin-sidebar-collapsed")).toBeNull();
});

async function accountButton(page: HTMLElement): Promise<HTMLButtonElement> {
  return vi.waitFor(() => {
    const found = Array.from(page.querySelectorAll<HTMLButtonElement>("aside button")).find(
      (candidate) => candidate.textContent?.includes("Ada Lovelace") === true,
    );
    if (found === undefined) throw new Error("No account in the sidebar yet");
    return found;
  });
}

test("the account stands at the sidebar's foot, not in the page's header, and its menu closes on Escape or a press outside", async () => {
  const page = await openAdmin();
  const trigger = await accountButton(page);
  expect(
    Array.from(view(page).querySelectorAll("button")).some((button) =>
      button.textContent?.includes("Ada Lovelace"),
    ),
  ).toBe(false);

  await act(async () => {
    trigger.click();
  });
  const items = Array.from(document.querySelectorAll('[role="menu"] [role="menuitem"]'));
  expect(items.map((item) => item.textContent)).toEqual(["Sign out"]);
  expect(document.activeElement).toBe(items[0]);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");

  await act(async () => {
    items[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(trigger);

  await act(async () => {
    trigger.click();
  });
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  await act(async () => {
    document.querySelector("main h1")?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  });
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

test("Sign out signs out on the press, with no question, and leaves for the sign-in", async () => {
  const page = await openAdmin();
  const trigger = await accountButton(page);
  await act(async () => {
    trigger.click();
  });
  await act(async () => {
    document.querySelector<HTMLElement>('[role="menu"] [role="menuitem"]')?.click();
  });
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();

  await vi.waitFor(() => expect(page.querySelector("nav")).toBeNull());
  const asked = vi
    .mocked(globalThis.fetch)
    .mock.calls.map(
      ([input]) =>
        new URL(input instanceof Request ? input.url : String(input), window.location.href),
    );
  expect(asked.some((url) => url.pathname === SIGN_OUT_PATH)).toBe(true);
  expect(window.localStorage.getItem("app-admin-sign-in-chosen")).toBeNull();
});

test("a quarter's address opens Reliability on the month, the longest window it reads", async () => {
  const page = await openAdmin("/admin?view=reliability&days=90");
  await vi.waitFor(() => expect(page.querySelector("main h1")?.textContent).toBe("Reliability"));

  const asked = vi
    .mocked(globalThis.fetch)
    .mock.calls.map(
      ([input]) =>
        new URL(input instanceof Request ? input.url : String(input), window.location.href),
    )
    .filter((url) => url.pathname === "/api/admin/reliability");
  expect(asked.map((url) => url.search)).toContain("");
  openViewOptions(page);
  choose("Time range");
  expect(menuItems()).toEqual([
    { label: "Last 7 days", checked: "false" },
    { label: "Last 30 days", checked: "true" },
  ]);
});

async function press(element: Element | null | undefined): Promise<void> {
  if (!(element instanceof HTMLElement)) throw new Error("Nothing to press");
  await act(async () => {
    element.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    element.click();
  });
}

test("in a phone's drawer, the account's menu is pressed through without the drawer going away, and Sign out leaves", async () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ width: PHONE_WIDTH, height: 800 }),
  );
  const page = await openAdmin();
  await vi.waitFor(() => expect(page.querySelector("main h1")?.textContent).toBe("Overview"));
  await press(button("Show sidebar"));
  await press(await accountButton(page));

  expect(document.querySelector('[role="menu"]')).not.toBeNull();
  expect(unreachable(sectionLink(page, "Users"))).toBe(false);

  await press(document.querySelector('[role="menu"] [role="menuitem"]'));
  await vi.waitFor(() => expect(page.querySelector("nav")).toBeNull());
});

test("a sign-out the service refuses says so and leaves the dashboard signed in", async () => {
  signOutStatus = 500;
  const page = await openAdmin();
  await press(await accountButton(page));
  await press(document.querySelector('[role="menu"] [role="menuitem"]'));

  await vi.waitFor(() =>
    expect(page.querySelector('[role="alert"]')?.textContent).toContain(
      "The account could not be signed out. Try again.",
    ),
  );
  expect(page.querySelector('nav[aria-label="Admin sections"]')).not.toBeNull();
  expect(window.localStorage.getItem("app-admin-sign-in-chosen")).toBe("true");
});
