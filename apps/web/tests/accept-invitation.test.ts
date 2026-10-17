// @vitest-environment jsdom
import { HOSTED_SERVICE_PATH } from "@luke/features";
import {
  INVITATION_OFFER_REFUSAL,
  type InvitationOfferAnswer,
} from "@luke/features/workspace-invitation-wire";
import { act } from "react";
import { afterEach, expect, test, vi } from "vitest";

/**
 * accept-invitation.test.ts -- the invitation page says where an invitation
 * stands and offers the one action that moves it on: a valid invitation is
 * accepted from a button that says it is joining while it does; a spent or
 * unreachable one offers nothing to press; and a signed-out visitor is
 * offered the providers, whose failure to start is announced. The page runs
 * as it does in the browser, mounted on its own `#root`; the network, the
 * HTTP boundary to Better Auth and Luke's route, is a fake.
 */

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const INVITATION_ID = "invitation-1";
const INVITED = "ada@example.com";

/** The pages' answers, by path: a JSON body, or a status with none. */
type Answer = { readonly status: number; readonly body?: unknown };

/** The page, answering `answers` by path and leaving every other request hanging. */
async function openPage(answers: ReadonlyMap<string, () => Answer>): Promise<HTMLElement> {
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
  window.history.replaceState(
    null,
    "",
    `/accept-invitation.html?id=${INVITATION_ID}&email=${INVITED}`,
  );
  const root = document.createElement("div");
  root.id = "root";
  document.body.replaceChildren(root);
  vi.resetModules();
  await act(async () => {
    await import("../src/accept-invitation");
  });
  return root;
}

const SIGNED_IN: Answer = {
  status: 200,
  body: {
    session: { id: "session-1", userId: "user-1", expiresAt: "2099-01-01T00:00:00.000Z" },
    user: { id: "user-1", email: INVITED, name: "Ada", emailVerified: true },
  },
};

const SIGNED_IN_UNVERIFIED: Answer = {
  status: 200,
  body: {
    session: { id: "session-1", userId: "user-1", expiresAt: "2099-01-01T00:00:00.000Z" },
    user: { id: "user-1", email: INVITED, name: "Ada", emailVerified: false },
  },
};

const SIGNED_OUT: Answer = { status: 200, body: null };

function offerRead(answer: InvitationOfferAnswer): Answer {
  return { status: 200, body: answer };
}

const VALID = offerRead({
  offer: {
    id: INVITATION_ID,
    workspaceName: "Atlas",
    role: "member",
    inviter: { name: "Grace", email: "grace@example.com" },
  },
});

function signedInReading(offer: Answer): Map<string, () => Answer> {
  return new Map([
    ["/api/auth/get-session", () => SIGNED_IN],
    [HOSTED_SERVICE_PATH.WORKSPACES_INVITATION_OFFER, () => offer],
  ]);
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
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

test("a valid invitation names its workspace and inviter and is accepted from its button", async () => {
  let settleAccept: (answer: Answer) => void = () => undefined;
  let offer = VALID;
  let sessionRead: () => void = () => undefined;
  const page = await openPage(
    new Map([
      [
        "/api/auth/get-session",
        () => {
          sessionRead();
          return SIGNED_IN;
        },
      ],
      [HOSTED_SERVICE_PATH.WORKSPACES_INVITATION_OFFER, () => offer],
    ]),
  );
  await titled(page, "Join Atlas");
  expect(page.textContent).toContain("Grace invited you to plan in Atlas on Luke, as member.");
  expect(buttonNames(page)).toEqual(["Accept invitation"]);

  vi.mocked(globalThis.fetch).mockImplementationOnce(
    () =>
      new Promise((settle) => {
        settleAccept = ({ status, body }) => settle(new Response(JSON.stringify(body), { status }));
      }),
  );
  await act(async () => buttonNamed(page, "Accept invitation").click());
  expect(buttonNamed(page, "Joining").getAttribute("aria-busy")).toBe("true");

  // Note that accepting makes Better Auth read the session again, after which the route answers spent.
  const sessionReadAgain = new Promise<void>((settle) => {
    sessionRead = settle;
  });
  offer = offerRead({ refused: INVITATION_OFFER_REFUSAL.SPENT });
  await act(async () => settleAccept({ status: 200, body: { invitation: {}, member: {} } }));
  await act(async () => sessionReadAgain);
  await titled(page, "You joined Atlas");
  expect(page.textContent).toContain("Return to Luke. You can close this tab.");
  expect(buttonNames(page)).toEqual([]);
});

test("a spent invitation says so and offers nothing to press", async () => {
  const page = await openPage(
    signedInReading(offerRead({ refused: INVITATION_OFFER_REFUSAL.SPENT })),
  );

  await titled(page, "This invitation is no longer valid");
  expect(page.textContent).toContain("Ask whoever invited you for a new link.");
  expect(buttonNames(page)).toEqual([]);
});

test("an invitation Luke cannot read asks for a reload and offers nothing to press", async () => {
  const page = await openPage(signedInReading({ status: 500 }));

  await titled(page, "Luke could not be reached");
  expect(page.textContent).toContain("Reload this page to try again.");
  expect(buttonNames(page)).toEqual([]);
});

test("an invitation for another address offers the providers to sign in again", async () => {
  const page = await openPage(
    signedInReading(offerRead({ refused: INVITATION_OFFER_REFUSAL.NOT_RECIPIENT })),
  );

  await titled(page, `This invitation is for ${INVITED}`);
  expect(buttonNames(page)).toEqual(["Continue with Google", "Continue with GitHub"]);
});

test("a signed-out visitor is offered the providers, and a sign-in that cannot start is announced", async () => {
  const page = await openPage(
    new Map([
      ["/api/auth/get-session", () => SIGNED_OUT],
      ["/api/auth/sign-in/social", () => ({ status: 500, body: { message: "unavailable" } })],
    ]),
  );
  await titled(page, "Sign in to accept your invitation");
  expect(page.textContent).toContain(`Sign in with the account that uses ${INVITED}.`);

  await act(async () => buttonNamed(page, "Continue with GitHub").click());

  await vi.waitFor(() =>
    expect(page.querySelector('[role="alert"]')?.textContent).toBe(
      "Sign-in could not start. Try again.",
    ),
  );
  expect(buttonNames(page)).toEqual(["Continue with Google", "Continue with GitHub"]);
});

test("a sign-in asked for again, after a session came and went, carries no earlier failure", async () => {
  let session = SIGNED_OUT;
  const page = await openPage(
    new Map([
      ["/api/auth/get-session", () => session],
      ["/api/auth/sign-in/social", () => ({ status: 500, body: { message: "unavailable" } })],
      [HOSTED_SERVICE_PATH.WORKSPACES_INVITATION_OFFER, () => VALID],
    ]),
  );
  await titled(page, "Sign in to accept your invitation");
  await act(async () => buttonNamed(page, "Continue with GitHub").click());
  await vi.waitFor(() => expect(page.querySelector('[role="alert"]')?.textContent).not.toBe(""));

  // Note that Better Auth refetches the session when the tab is shown again,
  // but not within seconds of its last read, so the clock moves past that.
  vi.useFakeTimers({ toFake: ["Date"] });
  const refocus = async (now: Answer) => {
    session = now;
    vi.setSystemTime(Date.now() + 60_000);
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  };
  await refocus(SIGNED_IN);
  await titled(page, "Join Atlas");
  await refocus(SIGNED_OUT);

  await titled(page, "Sign in to accept your invitation");
  expect(page.querySelector('[role="alert"]')?.textContent).toBe("");
  expect(buttonNames(page)).toEqual(["Continue with Google", "Continue with GitHub"]);
});

test("an address verified while the page stood open makes the invitation acceptable", async () => {
  let session = SIGNED_IN_UNVERIFIED;
  let offer = offerRead({ refused: INVITATION_OFFER_REFUSAL.UNVERIFIED });
  const page = await openPage(
    new Map([
      ["/api/auth/get-session", () => session],
      [HOSTED_SERVICE_PATH.WORKSPACES_INVITATION_OFFER, () => offer],
    ]),
  );
  await titled(page, "Your address isn't verified");

  // Note that Better Auth refetches on visibility only after the prior session read has aged out.
  vi.useFakeTimers({ toFake: ["Date"] });
  session = SIGNED_IN;
  offer = VALID;
  vi.setSystemTime(Date.now() + 60_000);
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));

  await titled(page, "Join Atlas");
  expect(buttonNames(page)).toEqual(["Accept invitation"]);
});
