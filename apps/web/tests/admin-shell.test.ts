// @vitest-environment jsdom
import { act } from "react";
import { afterEach, expect, test, vi } from "vitest";

/**
 * admin-shell.test.ts -- the admin's shell says where a maintainer is and
 * what it is doing: a view whose read is still out stands under its own
 * title with a status saying it is loading, the navigation marks that view
 * as the current page, and a press on another section moves both. The page
 * runs as it does in the browser, mounted on its own `#root`; the network,
 * the HTTP boundary to Luke and Better Auth, is a fake that answers the
 * session and leaves every admin read hanging.
 */

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const SESSION_PATH = "/api/auth/get-session";

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
  const root = document.createElement("div");
  root.id = "root";
  document.body.replaceChildren(root);
  vi.resetModules();
  await act(async () => {
    await import("../src/admin");
  });
  return root;
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
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.body.replaceChildren();
});

test("a view whose read is out stands under its title and says it is loading", async () => {
  const page = await openAdmin();

  await vi.waitFor(() => expect(page.querySelector("main h1")?.textContent).toBe("Dashboard"));
  expect(saysLoading(page)).toBe(true);
  // The rail and the phone's bar are the same navigation, each marking the view.
  expect(currentSections(page)).toEqual(["Dashboard", "Dashboard"]);
});

test("a press on another section makes it the current page", async () => {
  const page = await openAdmin();
  await vi.waitFor(() => expect(page.querySelector("main h1")?.textContent).toBe("Dashboard"));

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
