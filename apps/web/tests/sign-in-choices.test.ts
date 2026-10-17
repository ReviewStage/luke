// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { SignInChoices } from "../src/sign-in-choices";

/**
 * sign-in-choices.test.ts -- each provider's button is named for the
 * provider; a press says which sign-in is opening while it opens and holds
 * the other choice; and a sign-in that cannot start is announced and gives
 * the choices back. Better Auth's client, the HTTP boundary, is a fake
 * whose answer the test settles.
 */

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

type SignInAnswer = { readonly error: { readonly message: string } | null };

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

/** A client whose sign-in waits until the test hands it `answer`. */
function heldClient() {
  let answer: (result: SignInAnswer) => void = () => undefined;
  const client = {
    signIn: {
      social: () =>
        new Promise<SignInAnswer>((settle) => {
          answer = settle;
        }),
    },
  };
  return { client, settle: (result: SignInAnswer) => answer(result) };
}

/** The choices drawn on a page, signing in through `client`. */
function choices(client: ReturnType<typeof heldClient>["client"]): HTMLElement {
  const container = document.createElement("div");
  document.body.replaceChildren(container);
  root = createRoot(container);
  // SAFETY: the choices call `client.signIn.social` alone, which the fake
  // answers in Better Auth's own `{ error }` shape.
  const props = { client } as unknown as Parameters<typeof SignInChoices>[0];
  act(() => root?.render(createElement(SignInChoices, props)));
  return container;
}

/** The buttons' accessible names, in order. */
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

test("each provider's button is named for the provider", () => {
  const page = choices(heldClient().client);

  expect(buttonNames(page)).toEqual(["Continue with Google", "Continue with GitHub"]);
});

test("a press says which sign-in is opening and holds the other choice until it answers", () => {
  const { client } = heldClient();
  const page = choices(client);

  act(() => buttonNamed(page, "Continue with GitHub").click());

  const opening = buttonNamed(page, "Opening GitHub");
  expect(opening.getAttribute("aria-busy")).toBe("true");
  expect(buttonNamed(page, "Continue with Google").disabled).toBe(true);
});

test("a sign-in that cannot start is announced and gives the choices back", async () => {
  const { client, settle } = heldClient();
  const page = choices(client);
  act(() => buttonNamed(page, "Continue with Google").click());

  await act(async () => settle({ error: { message: "unavailable" } }));

  expect(page.querySelector('[role="alert"]')?.textContent).toBe(
    "Sign-in could not start. Try again.",
  );
  expect(buttonNames(page)).toEqual(["Continue with Google", "Continue with GitHub"]);
  expect(buttonNamed(page, "Continue with Google").disabled).toBe(false);
});
