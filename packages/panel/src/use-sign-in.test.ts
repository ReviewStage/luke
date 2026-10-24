// @vitest-environment jsdom

/**
 * use-sign-in.test.ts -- a sign-in that ends without landing says why on the sign-in screen, each reason in words of its own.
 */

import assert from "node:assert/strict";
import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { SIGN_IN_FAILURE, type SignInFailure } from "@luke/features/words";
import { ACT_KIND } from "@luke/host/acts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { SignInGate } from "./sign-in-gate.js";
import { FAKE_ANSWER, type FakeActAnswer, fakeActs } from "./testing/app-bridge.js";
import { fakeAppPlatform } from "./testing/app-platform.js";
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
    waiting: signIn.signInWait,
    failure: signIn.signInFailure,
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
