// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  ACCOUNT_PROVIDER,
  ACCOUNT_STATUS,
  type AccountProvider,
  type AccountSnapshot,
} from "@sidecar/credentials/snapshot";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "#shared/messages/acts";
import { useLastSignIn } from "./last-sign-in";
import { SignInGate } from "./sign-in-gate";
import { useSignIn } from "./use-sign-in";

const ignore = () => undefined;
const SIGNED_OUT: AccountSnapshot = { status: ACCOUNT_STATUS.SIGNED_OUT };
const SIGNED_IN_WITH_GITHUB: AccountSnapshot = {
  status: ACCOUNT_STATUS.SIGNED_IN,
  email: "developer@example.com",
  provider: ACCOUNT_PROVIDER.GITHUB,
};

/** One act the bridge is holding, answered when the test chooses. */
interface Held {
  request: Act;
  answer: (outcome: ActOutcome) => void;
}

let held: Held[] = [];

/** Every root a test mounted, unmounted after it so nothing it started outlives it. */
const mounted: Root[] = [];

beforeEach(() => {
  held = [];
  window.localStorage.clear();
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: {
      act: (request: Act) =>
        new Promise<ActOutcome>((answer) => {
          held.push({ request, answer });
        }),
    },
  });
});

afterEach(() => {
  act(() => {
    for (const root of mounted.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

function mount(element: React.ReactElement): HTMLElement {
  return mountRoot(element).container;
}

/** A mounted root, kept so the test can draw it again with what main announces next. */
function mountRoot(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push(root);
  act(() => root.render(element));
  return { container, root };
}

function gate(
  props: Partial<Parameters<typeof SignInGate>[0]> = {},
): React.ReactElement<Parameters<typeof SignInGate>[0]> {
  return createElement(SignInGate, {
    account: SIGNED_OUT,
    face: { play: 0 },
    onBegin: ignore,
    onCancel: ignore,
    ...props,
  });
}

/** The gate wired to the sign-in it begins and the one kept, the way the window wires it. */
function SignInWindow({ account = SIGNED_OUT }: { account?: AccountSnapshot }): React.JSX.Element {
  const signIn = useSignIn();
  const lastSignIn = useLastSignIn(account, false);
  return gate({
    account,
    ...(lastSignIn ? { lastUsed: lastSignIn } : undefined),
    ...(signIn.signInWait ? { waiting: signIn.signInWait } : undefined),
    ...(signIn.signInFailure ? { failure: signIn.signInFailure } : undefined),
    onBegin: signIn.beginSignIn,
    onCancel: signIn.cancelSignIn,
  });
}

function buttons(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll("button")];
}

function button(container: HTMLElement, words: string): HTMLButtonElement {
  const found = buttons(container).find((each) => each.textContent === words);
  assert.ok(found, `a "${words}" button is drawn`);
  return found;
}

/** The sign-ins the window has asked the main process to begin, by provider. */
function begun(): AccountProvider[] {
  return held.flatMap(({ request }) =>
    request.kind === ACT_KIND.ACCOUNT_BEGIN_SIGN_IN ? [request.payload.provider] : [],
  );
}

/** What the gate says a button is besides its label: the filled one, and the chip describing it. */
function emphasis(each: HTMLButtonElement) {
  const chip = each.getAttribute("aria-describedby");
  return {
    primary: each.dataset.primary === "true",
    described: chip ? (document.getElementById(chip)?.textContent ?? undefined) : undefined,
  };
}

/** Lands the newest sign-in the window began, main announcing the account it signed in. */
async function landSignIn(root: Root, account: AccountSnapshot): Promise<void> {
  const attempt = held.findLast(({ request }) => request.kind === ACT_KIND.ACCOUNT_BEGIN_SIGN_IN);
  assert.ok(attempt, "a sign-in was begun");
  await act(async () => {
    root.render(createElement(SignInWindow, { account }));
    attempt.answer({ status: ACT_OUTCOME_STATUS.DONE, value: account });
  });
}

/** Refuses the newest sign-in the window began, as a browser closed mid-sign-in does. */
async function refuseSignIn(): Promise<void> {
  const attempt = held.findLast(({ request }) => request.kind === ACT_KIND.ACCOUNT_BEGIN_SIGN_IN);
  assert.ok(attempt, "a sign-in was begun");
  await act(async () => {
    attempt.answer({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "The browser closed." });
  });
}

test("the gate offers the ways in and nothing else, quitting being the app menu's", () => {
  const container = mount(gate());
  assert.deepEqual(
    buttons(container).map((each) => each.textContent),
    ["Continue with Google", "Continue with GitHub"],
  );
});

test("each provider's button begins that provider's sign-in", () => {
  const pressed: AccountProvider[] = [];
  const container = mount(gate({ onBegin: (provider) => pressed.push(provider) }));
  act(() => button(container, "Continue with Google").click());
  act(() => button(container, "Continue with GitHub").click());
  assert.deepEqual(pressed, [ACCOUNT_PROVIDER.GOOGLE, ACCOUNT_PROVIDER.GITHUB]);
});

test("a sign-in out in the browser holds both buttons, the pressed one saying so", () => {
  const container = mount(gate({ waiting: ACCOUNT_PROVIDER.GITHUB }));
  assert.equal(button(container, "Continue with Google").disabled, true);
  assert.equal(button(container, "Waiting for browser…").disabled, true);
  assert.equal(container.querySelector("[role='status']")?.textContent?.includes("browser"), true);
});

test("a sign-in begun from elsewhere holds both buttons too", () => {
  const container = mount(gate({ account: { status: ACCOUNT_STATUS.SIGNING_IN } }));
  assert.deepEqual(
    buttons(container).map((each) => each.disabled),
    [true, true],
  );
});

test("the last attempt's failure is said under the buttons, which are offered again", () => {
  const container = mount(gate({ failure: "Sign-in did not finish." }));
  assert.equal(container.querySelector("[role='alert']")?.textContent, "Sign-in did not finish.");
  assert.ok(buttons(container).every((each) => !each.disabled));
});

test("pressing a provider waits in place, and a sign-in that does not finish says so", async () => {
  const container = mount(createElement(SignInWindow));
  act(() => button(container, "Continue with Google").click());
  assert.deepEqual(begun(), [ACCOUNT_PROVIDER.GOOGLE]);
  assert.equal(button(container, "Waiting for browser…").disabled, true);

  await refuseSignIn();
  assert.equal(button(container, "Continue with Google").disabled, false);
  assert.match(container.querySelector("[role='alert']")?.textContent ?? "", /did not finish/u);
});

test("Cancel takes the wait back, and the withdrawn attempt's late answer says nothing", async () => {
  const container = mount(createElement(SignInWindow));
  act(() => button(container, "Continue with GitHub").click());
  act(() => button(container, "Cancel").click());
  assert.ok(
    held.some(({ request }) => request.kind === ACT_KIND.ACCOUNT_CANCEL_SIGN_IN),
    "the main process is asked to withdraw the sign-in",
  );
  assert.equal(button(container, "Continue with GitHub").disabled, false);

  await refuseSignIn();
  assert.equal(container.querySelector("[role='alert']"), null);
  assert.equal(container.querySelector("[role='status']"), null);
});

test("with no sign-in kept, Google is the filled one and neither says last used", () => {
  const container = mount(createElement(SignInWindow));
  assert.deepEqual(emphasis(button(container, "Continue with Google")), {
    primary: true,
    described: undefined,
  });
  assert.deepEqual(emphasis(button(container, "Continue with GitHub")), {
    primary: false,
    described: undefined,
  });
});

test("a GitHub sign-in makes GitHub the filled, last used one, past sign-out and relaunch", async () => {
  const { container, root } = mountRoot(createElement(SignInWindow));
  act(() => button(container, "Continue with GitHub").click());
  await landSignIn(root, SIGNED_IN_WITH_GITHUB);
  act(() => root.render(createElement(SignInWindow, { account: SIGNED_OUT })));
  act(() => {
    for (const each of mounted.splice(0)) each.unmount();
  });

  const relaunched = mount(createElement(SignInWindow));
  assert.deepEqual(
    buttons(relaunched).map((each) => each.textContent),
    ["Continue with Google", "Continue with GitHub"],
    "the buttons keep their places",
  );
  assert.deepEqual(emphasis(button(relaunched, "Continue with GitHub")), {
    primary: true,
    described: "Last used",
  });
  assert.deepEqual(emphasis(button(relaunched, "Continue with Google")), {
    primary: false,
    described: undefined,
  });
});

test("a sign-in that does not finish leaves the last used one as it was", async () => {
  const { container, root } = mountRoot(createElement(SignInWindow));
  act(() => button(container, "Continue with GitHub").click());
  await landSignIn(root, SIGNED_IN_WITH_GITHUB);
  act(() => root.render(createElement(SignInWindow, { account: SIGNED_OUT })));

  act(() => button(container, "Continue with Google").click());
  await refuseSignIn();
  assert.deepEqual(emphasis(button(container, "Continue with GitHub")), {
    primary: true,
    described: "Last used",
  });
  assert.equal(emphasis(button(container, "Continue with Google")).primary, false);
});
