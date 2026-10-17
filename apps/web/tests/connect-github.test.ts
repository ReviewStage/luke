// @vitest-environment jsdom
import { HOSTED_SERVICE_PATH } from "@luke/features";
import { act } from "react";
import { afterEach, expect, test, vi } from "vitest";

/**
 * connect-github.test.ts -- the GitHub connection page says where a connect
 * stands: a signed-out browser, or one signed in to another account, is
 * offered the providers, each named for its provider, a press says which
 * sign-in is opening and holds the other choice, and a sign-in that cannot
 * start is announced and gives the choices back; an expired intent has
 * nothing to press; and a link GitHub refused offers the same intent again.
 * The page runs as it does in the browser, mounted on its own `#root`; the
 * network, the HTTP boundary to Luke and Better Auth, is a fake.
 */

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const SESSION_PATH = "/api/auth/get-session";
const SIGN_IN_PATH = "/api/auth/sign-in/social";

/** The pages' answers, by path: a JSON body, or a status with none. */
type Answer = { readonly status: number; readonly body?: unknown };

const SIGNED_OUT: Answer = { status: 200, body: null };
const SIGNED_IN: Answer = {
  status: 200,
  body: { session: { id: "session-1" }, user: { id: "user-1" } },
};

/** The page at `address`, answering `answers` by path and leaving every other request hanging. */
async function openPage(
  answers: ReadonlyMap<string, () => Answer>,
  address = "/connect-github.html?intent=intent-1",
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
    await import("../src/connect-github");
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

test("a signed-out browser is offered each provider, named for it", async () => {
  const page = await openPage(new Map([[SESSION_PATH, () => SIGNED_OUT]]));

  await titled(page, "Sign in to connect GitHub");
  expect(page.textContent).toContain("Sign in to the Luke account you use on your Mac.");
  expect(buttonNames(page)).toEqual(["Continue with Google", "Continue with GitHub"]);
  expect(page.querySelector('[role="alert"]')?.textContent).toBe("");
});

test("a press says which sign-in is opening and holds the other choice until it answers", async () => {
  const page = await openPage(new Map([[SESSION_PATH, () => SIGNED_OUT]]));
  await titled(page, "Sign in to connect GitHub");

  await act(async () => buttonNamed(page, "Continue with GitHub").click());

  expect(buttonNamed(page, "Opening GitHub").getAttribute("aria-busy")).toBe("true");
  expect(buttonNamed(page, "Continue with Google").disabled).toBe(true);
});

test("a sign-in that cannot start is announced and gives the choices back", async () => {
  const page = await openPage(
    new Map([
      [SESSION_PATH, () => SIGNED_OUT],
      [SIGN_IN_PATH, () => ({ status: 500, body: { message: "unavailable" } })],
    ]),
  );
  await titled(page, "Sign in to connect GitHub");

  await act(async () => buttonNamed(page, "Continue with Google").click());

  await vi.waitFor(() =>
    expect(page.querySelector('[role="alert"]')?.textContent).toBe(
      "Sign-in could not start. Try again.",
    ),
  );
  expect(buttonNames(page)).toEqual(["Continue with Google", "Continue with GitHub"]);
  expect(buttonNamed(page, "Continue with Google").disabled).toBe(false);
});

test("a browser signed in to another account is offered the providers", async () => {
  const page = await openPage(
    new Map([
      [SESSION_PATH, () => SIGNED_IN],
      [
        HOSTED_SERVICE_PATH.GITHUB_CONNECT_CLAIM,
        () => ({ status: 200, body: { claim: "other-account" } }),
      ],
    ]),
  );

  await titled(page, "Sign in as the account you're connecting");
  expect(buttonNames(page)).toEqual(["Continue with Google", "Continue with GitHub"]);
});

test("an expired intent sends the developer back to Luke with nothing to press", async () => {
  const page = await openPage(
    new Map([
      [SESSION_PATH, () => SIGNED_IN],
      [
        HOSTED_SERVICE_PATH.GITHUB_CONNECT_CLAIM,
        () => ({ status: 200, body: { claim: "expired" } }),
      ],
    ]),
  );

  await titled(page, "This link has expired");
  expect(page.textContent).toContain("Return to Luke and choose Connect GitHub again.");
  expect(buttonNames(page)).toEqual([]);
});

test("a link GitHub refused says why and offers the same intent again", async () => {
  const page = await openPage(
    new Map(),
    "/connect-github.html?error=1&intent=intent-1&error=unable_to_link_account",
  );

  await titled(page, "GitHub was not connected");
  expect(page.textContent).toContain(
    "GitHub did not confirm this account, so it was not connected.",
  );
  const retry = Array.from(page.querySelectorAll("a")).find((a) => a.textContent === "Try again");
  expect(retry?.getAttribute("href")).toBe("/connect-github.html?intent=intent-1");
});

test("a connected account is told to return to Luke", async () => {
  const page = await openPage(new Map(), "/connect-github.html?done=1");

  await titled(page, "GitHub connected");
  expect(page.textContent).toContain("Return to Luke. You can close this tab.");
  expect(buttonNames(page)).toEqual([]);
});
