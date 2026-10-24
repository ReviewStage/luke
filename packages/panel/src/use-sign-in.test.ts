// @vitest-environment jsdom

/**
 * use-sign-in.test.ts -- a sign-in that ends without landing says why on the sign-in screen, each reason in words of its own; a Cancel main refuses says why in a toast.
 */

import assert from "node:assert/strict";
import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { SIGN_IN_FAILURE, type SignInFailure } from "@luke/features/words";
import { ACT_KIND } from "@luke/host/acts";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { rendererRegistry } from "./renderer-runtime.js";
import { SignInGate } from "./sign-in-gate.js";
import { FAKE_ANSWER, type FakeActAnswer, fakeActs } from "./testing/app-bridge.js";
import { fakeAppPlatform } from "./testing/app-platform.js";
import { onRegistry } from "./testing/copy-feedback.js";
import { ToastHost } from "./toast.js";
import { useSignIn } from "./use-sign-in.js";

/** What the screen says for each reason, as a person reads it. */
const SAID = {
  [SIGN_IN_FAILURE.TIMED_OUT]: "Sign-in timed out waiting for your browser. Try again.",
  [SIGN_IN_FAILURE.BROWSER]: "Luke couldn't open the sign-in page in your browser. Try again.",
  [SIGN_IN_FAILURE.ALREADY_WAITING]:
    "A sign-in is already waiting in your browser. Finish it there, or try again later.",
  [SIGN_IN_FAILURE.REFUSED]: "The sign-in was declined in your browser. Try again.",
  [SIGN_IN_FAILURE.OFFLINE]: "You're offline. Connect to the internet, then sign in.",
  [SIGN_IN_FAILURE.UNFINISHED]: "Sign-in didn't finish. Try again.",
} as const satisfies Record<SignInFailure, string>;

const mounted: Root[] = [];

beforeEach(() => {
  fakeAppPlatform({ focusPanel: () => undefined });
});

afterEach(() => {
  act(() => {
    for (const root of mounted.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

/** The sign-in screen as the window stands it: the gate, over the sign-in it begins. */
function SignInScreen(): React.JSX.Element {
  const signIn = useSignIn();
  return createElement(SignInGate, {
    account: { status: ACCOUNT_STATUS.SIGNED_OUT },
    ...(signIn.signInWait === undefined ? {} : { waiting: signIn.signInWait }),
    ...(signIn.signInFailure === undefined ? {} : { failure: signIn.signInFailure }),
    onBegin: signIn.beginSignIn,
    onCancel: signIn.cancelSignIn,
  });
}

/** The screen over a host that answers every sign-in with `answer`, after one press on Google. */
async function pressedOver(answer: FakeActAnswer): Promise<HTMLElement> {
  fakeActs({
    act: async (request) =>
      request.kind === ACT_KIND.ACCOUNT_BEGIN_SIGN_IN
        ? answer
        : { status: FAKE_ANSWER.UNKNOWN_ACT },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push(root);
  act(() => root.render(createElement(SignInScreen)));
  const google = [...container.querySelectorAll("button")].find(
    (each) => each.textContent === "Continue with Google",
  );
  assert.ok(google, "the gate offers Google");
  await act(async () => google.click());
  return container;
}

/** What the screen's alert region says; empty while nothing went wrong. */
function alertWords(container: HTMLElement): string | null | undefined {
  return container.querySelector('[role="alert"]')?.textContent;
}

test("each reason a sign-in ended for reaches the screen in its own words", async () => {
  for (const failure of Object.values(SIGN_IN_FAILURE)) {
    const container = await pressedOver({ status: FAKE_ANSWER.DONE, value: { failure } });
    assert.equal(alertWords(container), SAID[failure], failure);
  }
  assert.equal(new Set(Object.values(SAID)).size, Object.values(SIGN_IN_FAILURE).length);
});

test("a sign-in that landed says nothing went wrong", async () => {
  const container = await pressedOver({
    status: FAKE_ANSWER.DONE,
    value: { account: { status: ACCOUNT_STATUS.SIGNED_OUT } },
  });
  assert.equal(alertWords(container), "");
});

test("a refusal the port drew says only that the sign-in did not finish, never its sentence", async () => {
  const container = await pressedOver({
    status: FAKE_ANSWER.REFUSED,
    reason: "Could not start signing in on this system.",
  });
  assert.equal(alertWords(container), SAID[SIGN_IN_FAILURE.UNFINISHED]);
});

test("a Cancel main refuses says why in a toast, and the gate is offered again all the same", async () => {
  const refusal = "The sign-in could not be withdrawn.";
  fakeActs({
    act: (request) => {
      // The sign-in waits on the browser for as long as the test runs.
      if (request.kind === ACT_KIND.ACCOUNT_BEGIN_SIGN_IN) return new Promise(() => undefined);
      if (request.kind === ACT_KIND.ACCOUNT_CANCEL_SIGN_IN) {
        return Promise.resolve({ status: FAKE_ANSWER.REFUSED, reason: refusal });
      }
      return Promise.resolve({ status: FAKE_ANSWER.UNKNOWN_ACT });
    },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push(root);
  act(() =>
    root.render(
      createElement(
        Fragment,
        null,
        createElement(SignInScreen),
        onRegistry(rendererRegistry, createElement(ToastHost)),
      ),
    ),
  );
  const press = (name: string) =>
    [...container.querySelectorAll("button")].find((each) => each.textContent === name) ??
    assert.fail(`the gate offers ${name}`);
  await act(async () => press("Continue with Google").click());

  await act(async () => press("Cancel").click());

  const toasts = [
    ...document.querySelectorAll(".luke-toast:not([data-leaving]) .luke-toast-words"),
  ];
  assert.equal(toasts.at(-1)?.textContent, refusal);
  assert.equal(press("Continue with Google").disabled, false);
});
