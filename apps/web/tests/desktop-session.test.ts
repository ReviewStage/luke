// @vitest-environment jsdom
import { desktopSessionPageUrl } from "@luke/features/desktop-session-wire";
import { act } from "react";
import { afterEach, expect, test, vi } from "vitest";

/**
 * desktop-session.test.ts -- the desktop-session page says where the Mac's
 * hand-off stands: under way while the transfer is asked for and once it is
 * sent on, a link that did not come from Luke or a transfer Luke refused
 * with nothing to press, and a signed-out browser offered the providers,
 * whose failure to start is announced. The page runs as it does in the
 * browser, mounted on its own `#root`; the network, the HTTP boundary to
 * Better Auth, is a fake.
 */

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const TRANSFER_PATH = "/api/auth/electron/transfer-user";

/** The pages' answers, by path: a JSON body, or a status with none. */
type Answer = { readonly status: number; readonly body?: unknown };

/** The page as the Mac opens it, answering `answers` by path and leaving every other request hanging. */
async function openPage(
  answers: ReadonlyMap<string, () => Answer>,
  address = desktopSessionPageUrl(window.location.origin, {
    state: "state-1",
    codeChallenge: "challenge-1",
    returnTo: "http://127.0.0.1:4810/callback",
  }),
): Promise<HTMLElement> {
  vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
    const answer = answers.get(url.pathname);
    if (!answer) return new Promise(() => undefined);
    const { status, body } = answer();
    return Promise.resolve(
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  window.history.replaceState(null, "", address);
  const root = document.createElement("div");
  root.id = "root";
  document.body.replaceChildren(root);
  vi.resetModules();
  await act(async () => {
    await import("../src/desktop-session");
  });
  return root;
}

/** Every button's accessible name, in order. */
function buttonNames(page: HTMLElement): (string | null)[] {
  return Array.from(page.querySelectorAll("button")).map(
    (button) => button.getAttribute("aria-label") ?? button.textContent,
  );
}

function buttonNamed(page: HTMLElement, name: string): HTMLButtonElement {
  const button = Array.from(page.querySelectorAll("button")).find(
    (candidate) => (candidate.getAttribute("aria-label") ?? candidate.textContent) === name,
  );
  if (!button) throw new Error(`No button named ${name}`);
  return button;
}

/** The page's title, once it says `title`. */
async function titled(page: HTMLElement, title: string): Promise<void> {
  await vi.waitFor(() => expect(page.querySelector("h1")?.textContent).toBe(title));
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

test("the hand-off says it is finishing and offers nothing to press while the transfer is asked for", async () => {
  const page = await openPage(new Map());

  await titled(page, "Finishing sign-in…");
  expect(buttonNames(page)).toEqual([]);
});

test("a link that did not come from Luke says so and offers nothing to press", async () => {
  const page = await openPage(new Map(), "/desktop-session.html?state=state-1");

  await titled(page, "This link did not come from Luke");
  expect(page.textContent).toContain("Return to Luke and sign in again.");
  expect(buttonNames(page)).toEqual([]);
});

test("a transfer Luke refuses sends the developer back to Luke with nothing to press", async () => {
  const page = await openPage(new Map([[TRANSFER_PATH, () => ({ status: 500 })]]));

  await titled(page, "Luke could not be reached");
  expect(page.textContent).toContain("Return to Luke and sign in again.");
  expect(buttonNames(page)).toEqual([]);
});

test("a signed-out browser is offered the providers, and a sign-in that cannot start is announced", async () => {
  const page = await openPage(
    new Map([
      [TRANSFER_PATH, () => ({ status: 401 })],
      ["/api/auth/sign-in/social", () => ({ status: 500, body: { message: "unavailable" } })],
    ]),
  );
  await titled(page, "Sign in to finish");
  expect(page.textContent).toContain("Sign in with the account you use in Luke.");
  expect(page.querySelector('[role="alert"]')?.textContent).toBe("");

  await act(async () => buttonNamed(page, "Continue with Google").click());

  await vi.waitFor(() =>
    expect(page.querySelector('[role="alert"]')?.textContent).toBe(
      "Sign-in could not start. Try again.",
    ),
  );
  expect(buttonNames(page)).toEqual(["Continue with Google", "Continue with GitHub"]);
});
