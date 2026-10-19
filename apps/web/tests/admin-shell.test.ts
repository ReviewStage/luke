// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";

/**
 * admin-shell.test.ts -- the admin's shell says where a maintainer is and
 * what it is doing: a view whose read is still out stands under its own
 * title with a status saying it is loading, the navigation marks that view
 * as the current page, and a press on another section moves both; the
 * account menu opens over the page from its avatar and closes on Escape or a
 * press outside it. The page runs as its entry mounts it in the browser, on
 * its own `#root`, and is unmounted after each test so no render it scheduled
 * outlives jsdom; the network, the HTTP boundary to Luke and Better Auth, is
 * a fake that answers the session and leaves every admin read hanging.
 */

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const SESSION_PATH = "/api/auth/get-session";

let root: Root | undefined;

const SIGNED_IN = {
  session: { id: "session-1" },
  user: { id: "user-1", name: "Ada Lovelace", email: "ada@example.com", image: null },
};

/** The admin at `address`, signed in, with every read but the session's left hanging. */
async function openAdmin(address = "/admin"): Promise<HTMLElement> {
  vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
    if (url.pathname !== SESSION_PATH) return new Promise(() => undefined);
    return Promise.resolve(
      new Response(JSON.stringify(SIGNED_IN), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
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
    (link) => link.getAttribute("aria-label") ?? link.textContent,
  );
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
  window.localStorage.clear();
  document.body.replaceChildren();
});

test("a view whose read is out stands under its title and says it is loading", async () => {
  const page = await openAdmin();

  await vi.waitFor(() => expect(page.querySelector("main h1")?.textContent).toBe("Overview"));
  expect(saysLoading(page)).toBe(true);
  // The rail and the phone's bar are the same navigation, each marking the view.
  expect(currentSections(page)).toEqual(["Overview", "Overview"]);
});

test("a press on another section makes it the current page", async () => {
  const page = await openAdmin();
  await vi.waitFor(() => expect(page.querySelector("main h1")?.textContent).toBe("Overview"));

  const users = page.querySelector<HTMLAnchorElement>('nav a[aria-label="Users"]');
  if (!users) throw new Error("No Users link");
  await act(async () => {
    users.click();
  });

  await vi.waitFor(() => expect(page.querySelector("main h1")?.textContent).toBe("Users"));
  expect(currentSections(page)).toEqual(["Users", "Users"]);
  expect(saysLoading(page)).toBe(true);
  expect(window.location.search).toBe("?view=users");
});

/** The names of a navigation's links, in the order it draws them. */
function sectionNames(navigation: Element): (string | null)[] {
  return Array.from(navigation.querySelectorAll("a"), (link) => link.textContent);
}

test("the rail lists the measures, with Animations after them in its footer at its own address", async () => {
  const page = await openAdmin();
  await vi.waitFor(() => expect(page.querySelector("main h1")?.textContent).toBe("Overview"));

  const [bar, rail] = Array.from(page.querySelectorAll('nav[aria-label="Admin sections"]'));
  if (bar === undefined || rail === undefined) throw new Error("No navigation");
  expect(sectionNames(rail)).toEqual(["Overview", "Workspaces", "Users", "Animations"]);
  const animations = Array.from(rail.querySelectorAll("a")).find(
    (link) => link.textContent === "Animations",
  );
  expect(animations?.getAttribute("href")).toBe("/admin?view=animations");
  // The phone's bar carries the measures alone.
  expect(Array.from(bar.querySelectorAll("a"), (link) => link.getAttribute("aria-label"))).toEqual([
    "Overview",
    "Workspaces",
    "Users",
  ]);
});

test("the account menu opens on its avatar, and Escape or a press outside closes it", async () => {
  const page = await openAdmin();
  const trigger = await vi.waitFor(() => {
    const found = page.querySelector<HTMLButtonElement>(
      'button[aria-label="Account menu for Ada Lovelace"]',
    );
    if (!found) throw new Error("No account menu yet");
    return found;
  });

  await act(async () => {
    trigger.click();
  });
  const signOut = document.querySelector('[role="menu"] [role="menuitem"]');
  expect(signOut?.textContent).toBe("Sign out");
  expect(document.activeElement).toBe(signOut);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");

  await act(async () => {
    signOut?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
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

test("a press on Reliability opens it as the current page, under its own address", async () => {
  const page = await openAdmin();
  await vi.waitFor(() => expect(page.querySelector("main h1")?.textContent).toBe("Dashboard"));

  const reliability = page.querySelector<HTMLAnchorElement>('nav a[aria-label="Reliability"]');
  if (!reliability) throw new Error("No Reliability link");
  await act(async () => {
    reliability.click();
  });

  await vi.waitFor(() => expect(page.querySelector("main h1")?.textContent).toBe("Reliability"));
  expect(currentSections(page)).toEqual(["Reliability", "Reliability"]);
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
