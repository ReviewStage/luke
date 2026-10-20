// @vitest-environment jsdom
import "@luke/panel/testing/match-media";
import "@luke/panel/testing/resize-observer";
import type { WireValue } from "@luke/wire";
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";

/**
 * admin-shell.test.ts -- the admin's shell says where a maintainer is and
 * what it is doing: a view whose read is still out stands under its own
 * title with a status saying it is loading, the navigation marks that view
 * as the current page, and a press on another section moves both; the
 * sidebar hides and comes back from the toggle at its top, remembering which
 * across visits, and in a phone's narrow room stands as a drawer over the
 * view; the account stands at the sidebar's foot, its menu raised over it
 * closing on Escape or a press outside it, and Log out, asked first, leaves
 * for the sign-in. The page runs as its entry mounts it in the browser, on
 * its own `#root`, and is unmounted after each test so no render it scheduled
 * outlives jsdom; the network, the HTTP boundary to Luke and Better Auth, is
 * a fake that answers the session and a sign-out and leaves every admin read
 * hanging. jsdom lays nothing out, so a narrow room is a stage measured
 * narrow, as the browser's layout would report it.
 */

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const SESSION_PATH = "/api/auth/get-session";

const SIGN_OUT_PATH = "/api/auth/sign-out";

/** A phone's width, under the line the app's shell turns narrow at. */
const PHONE_WIDTH = 390;

let root: Root | undefined;

/** What the fake answers a sign-out with: Better Auth's success, unless a test refuses it. */
let signOutStatus = 200;

const SIGNED_IN = {
  session: { id: "session-1" },
  user: { id: "user-1", name: "Ada Lovelace", email: "ada@example.com", image: null },
};

/** The admin at `address`, signed in, with every read but the session's left hanging. */
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
  window.localStorage.setItem("luke-admin-sign-in-chosen", "true");
  window.history.replaceState(null, "", address);
  const container = document.createElement("div");
  container.id = "root";
  document.body.replaceChildren(container);
  // Note that the dashboard is imported afresh, because its session lives in
  // module state and each test signs in anew.
  vi.resetModules();
  const { AdminDashboard } = await import("../src/AdminDashboard");
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(StrictMode, null, createElement(AdminDashboard)));
  });
  return container;
}

/** The names of the navigation links marked as the current page. */
function currentSections(page: HTMLElement): (string | null)[] {
  return Array.from(page.querySelectorAll('nav a[aria-current="page"]')).map(
    (link) => link.textContent,
  );
}

/** The sidebar's link to a section, by the name it shows. */
function sectionLink(page: HTMLElement, name: string): HTMLAnchorElement {
  const link = Array.from(page.querySelectorAll<HTMLAnchorElement>("nav a")).find(
    (candidate) => candidate.textContent === name,
  );
  if (link === undefined) throw new Error(`No ${name} link`);
  return link;
}

/** The button a reader knows by `name`, wherever it stands. */
function button(name: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll("button")).find(
    (candidate) => (candidate.getAttribute("aria-label") ?? candidate.textContent?.trim()) === name,
  );
}

/** Whether nothing under `element` can be reached, by a pointer, the keyboard, or a screen reader. */
function unreachable(element: Element): boolean {
  return element.closest("[inert]") !== null;
}

/** The view beside the sidebar, the page's own `main`. */
function view(page: HTMLElement): HTMLElement {
  const main = page.querySelector("main");
  if (!(main instanceof HTMLElement)) throw new Error("No view");
  return main;
}

/**
 * Whether a status region says the page is loading. Its words lead with that,
 * ahead of the section headings the loading page draws as themselves.
 */
function saysLoading(page: HTMLElement): boolean {
  return Array.from(page.querySelectorAll('[role="status"]')).some((region) =>
    region.textContent?.startsWith("Loading…"),
  );
}

afterEach(() => {
  // Note that the session store stops a second after its last reader leaves,
  // on a timer the unmount arms, and that stop reaches for `window`; so the
  // unmount runs on a fake clock that is run out while jsdom still stands.
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

/** The names of a navigation's links, in the order it draws them. */
function sectionNames(navigation: Element): (string | null)[] {
  return Array.from(navigation.querySelectorAll("a"), (link) => link.textContent);
}

test("one sidebar lists the measures, Animations last among them at its own address", async () => {
  const page = await openAdmin();
  await vi.waitFor(() => expect(page.querySelector("main h1")?.textContent).toBe("Overview"));

  const navigations = page.querySelectorAll('nav[aria-label="Admin sections"]');
  expect(navigations).toHaveLength(1);
  const [sidebar] = Array.from(navigations);
  if (sidebar === undefined) throw new Error("No navigation");
  expect(sectionNames(sidebar)).toEqual([
    "Overview",
    "Cost",
    "Reliability",
    "Workspaces",
    "Users",
    "Animations",
  ]);
  expect(sectionLink(page, "Animations").getAttribute("href")).toBe("/admin?view=animations");
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

  // A later visit opens it hidden, as it was left.
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

  // Escape puts it away and hands the keyboard back to the toggle.
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
  // The drawer is the room's: hiding it there is no choice to remember.
  expect(window.localStorage.getItem("luke-admin-sidebar-collapsed")).toBeNull();
});

/** The account's button at the sidebar's foot, once the session names it. */
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
  expect(view(page).querySelector('button[aria-haspopup="menu"]')).toBeNull();

  await act(async () => {
    trigger.click();
  });
  const items = Array.from(document.querySelectorAll('[role="menu"] [role="menuitem"]'));
  expect(items.map((item) => item.textContent)).toEqual(["Log out"]);
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

test("Log out asks first, then signs out and leaves for the sign-in", async () => {
  const page = await openAdmin();
  const trigger = await accountButton(page);
  await act(async () => {
    trigger.click();
  });
  await act(async () => {
    document.querySelector<HTMLElement>('[role="menu"] [role="menuitem"]')?.click();
  });
  const dialog = document.querySelector('[role="alertdialog"]');
  expect(dialog?.textContent).toContain("Log out of ada@example.com?");

  const confirm = Array.from(dialog?.querySelectorAll("button") ?? []).find(
    (candidate) => candidate.textContent === "Log out",
  );
  await act(async () => {
    confirm?.click();
  });

  await vi.waitFor(() => expect(page.querySelector("nav")).toBeNull());
  const asked = vi
    .mocked(globalThis.fetch)
    .mock.calls.map(
      ([input]) =>
        new URL(input instanceof Request ? input.url : String(input), window.location.href),
    );
  expect(asked.some((url) => url.pathname === SIGN_OUT_PATH)).toBe(true);
  expect(window.localStorage.getItem("luke-admin-sign-in-chosen")).toBeNull();
});

test("a press on Reliability opens it as the current page, under its own address", async () => {
  const page = await openAdmin();
  await vi.waitFor(() => expect(page.querySelector("main h1")?.textContent).toBe("Overview"));

  const reliability = sectionLink(page, "Reliability");
  await act(async () => {
    reliability.click();
  });

  await vi.waitFor(() => expect(page.querySelector("main h1")?.textContent).toBe("Reliability"));
  expect(currentSections(page)).toEqual(["Reliability"]);
  expect(saysLoading(page)).toBe(true);
  expect(window.location.search).toBe("?view=reliability");
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
  const windows = page.querySelector('[role="radiogroup"][aria-label="Window in days"]');
  const radios = Array.from(windows?.querySelectorAll('[role="radio"]') ?? []);
  expect(radios.map((radio) => radio.textContent)).toEqual(["7d", "30d"]);
  expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual(["false", "true"]);
});

/** A press as a pointer makes it: its pointerdown, which a dismissal listens for, then its click. */
async function press(element: Element | null | undefined): Promise<void> {
  if (!(element instanceof HTMLElement)) throw new Error("Nothing to press");
  await act(async () => {
    element.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    element.click();
  });
}

/** The Log out question's own button for `words`. */
function dialogButton(words: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll('[role="alertdialog"] button')).find(
    (candidate): candidate is HTMLButtonElement =>
      candidate instanceof HTMLButtonElement && candidate.textContent === words,
  );
}

test("in a phone's drawer, Log out and its question are pressed through without the drawer going away", async () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ width: PHONE_WIDTH, height: 800 }),
  );
  const page = await openAdmin();
  await vi.waitFor(() => expect(page.querySelector("main h1")?.textContent).toBe("Overview"));
  await press(button("Show sidebar"));
  await press(await accountButton(page));

  await press(document.querySelector('[role="menu"] [role="menuitem"]'));
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(
    "Log out of ada@example.com?",
  );
  expect(unreachable(sectionLink(page, "Users"))).toBe(false);

  await press(dialogButton("Log out"));
  await vi.waitFor(() => expect(page.querySelector("nav")).toBeNull());
});

test("a sign-out the service refuses says so and leaves the dashboard signed in", async () => {
  signOutStatus = 500;
  const page = await openAdmin();
  await press(await accountButton(page));
  await press(document.querySelector('[role="menu"] [role="menuitem"]'));
  await press(dialogButton("Log out"));

  await vi.waitFor(() =>
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(
      "Luke could not log out. Try again.",
    ),
  );
  expect(page.querySelector('nav[aria-label="Admin sections"]')).not.toBeNull();
  expect(window.localStorage.getItem("luke-admin-sign-in-chosen")).toBe("true");
});
