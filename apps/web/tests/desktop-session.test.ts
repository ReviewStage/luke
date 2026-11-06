// @vitest-environment jsdom
import { desktopSessionPageUrl } from "@repo/features/desktop-session-wire";
import { APP_HOME_LINK } from "@repo/features/link-home";
import { act } from "react";
import { afterEach, expect, test, vi } from "vitest";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const TRANSFER_PATH = "/api/auth/electron/transfer-user";

type Answer = { readonly status: number; readonly body?: unknown };

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

async function titled(page: HTMLElement, title: string): Promise<void> {
  await vi.waitFor(() => expect(page.querySelector("h1")?.textContent).toBe(title));
}

function links(page: HTMLElement): (string | null)[][] {
  return Array.from(page.querySelectorAll("a")).map((a) => [a.textContent, a.getAttribute("href")]);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

test("the hand-off says it is finishing and offers nothing to press while the transfer is asked for", async () => {
  const page = await openPage(new Map());

  await titled(page, "Finishing sign-in…");
  expect(buttonNames(page)).toEqual([]);
});

test("a link that did not come from Vespin says so and offers nothing to press off a Mac", async () => {
  const page = await openPage(new Map(), "/desktop-session.html?state=state-1");

  await titled(page, "This link did not come from Vespin");
  expect(page.textContent).toContain("Sign in again.");
  expect(buttonNames(page)).toEqual([]);
  expect(links(page)).toEqual([]);
});

test("a transfer Vespin refuses says to sign in again, with nothing to press off a Mac", async () => {
  const page = await openPage(new Map([[TRANSFER_PATH, () => ({ status: 500 })]]));

  await titled(page, "Vespin could not be reached");
  expect(page.textContent).toContain("Sign in again.");
  expect(links(page)).toEqual([]);
});

test("on a Mac, a hand-off that ended short offers Open Vespin, and one still finishing offers nothing", async () => {
  vi.stubGlobal("navigator", {
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    maxTouchPoints: 0,
  });
  const finishing = await openPage(new Map());
  await titled(finishing, "Finishing sign-in…");
  expect(links(finishing)).toEqual([]);

  const refused = await openPage(new Map([[TRANSFER_PATH, () => ({ status: 500 })]]));
  await titled(refused, "Vespin could not be reached");
  expect(links(refused)).toEqual([["Open Vespin", APP_HOME_LINK]]);
});

test("a signed-out browser is offered the providers, and a sign-in that cannot start is announced", async () => {
  const page = await openPage(
    new Map([
      [TRANSFER_PATH, () => ({ status: 401 })],
      ["/api/auth/sign-in/social", () => ({ status: 500, body: { message: "unavailable" } })],
    ]),
  );
  await titled(page, "Sign in to finish");
  expect(page.textContent).toContain("Sign in with the account you use in Vespin.");
  expect(page.querySelector('[role="alert"]')?.textContent).toBe("");

  await act(async () => buttonNamed(page, "Continue with Google").click());

  await vi.waitFor(() =>
    expect(page.querySelector('[role="alert"]')?.textContent).toBe(
      "Sign-in didn't finish. Try again.",
    ),
  );
  expect(buttonNames(page)).toEqual(["Continue with Google", "Continue with GitHub"]);
});
