// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  ACCOUNT_PROVIDER,
  ACCOUNT_STATUS,
  type AccountProvider,
  type AccountSnapshot,
} from "@luke/credentials/snapshot";
import type { Act, ActOutcome } from "@luke/host/acts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { fakeAppBridge } from "#testing/app-bridge";
import { SignInGate } from "./sign-in-gate";

const ignore = () => undefined;
const SIGNED_OUT: AccountSnapshot = { status: ACCOUNT_STATUS.SIGNED_OUT };

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
  fakeAppBridge({
    act: (request: Act) =>
      new Promise<ActOutcome>((answer) => {
        held.push({ request, answer });
      }),
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
    onBegin: ignore,
    onCancel: ignore,
    ...props,
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

test("each provider's button begins that provider's sign-in", () => {
  const pressed: AccountProvider[] = [];
  const container = mount(gate({ onBegin: (provider) => pressed.push(provider) }));
  act(() => button(container, "Continue with Google").click());
  act(() => button(container, "Continue with GitHub").click());
  assert.deepEqual(pressed, [ACCOUNT_PROVIDER.GOOGLE, ACCOUNT_PROVIDER.GITHUB]);
});

/** Every "Last used" badge drawn, with the button each describes. */
function lastUsedBadges(container: HTMLElement) {
  return [...container.querySelectorAll("span")]
    .filter((each) => each.textContent === "Last used")
    .map((badge) => ({
      badge,
      described: container.querySelector(`button[aria-describedby="${badge.id}"]`),
    }));
}

test("the provider this Mac last signed in with wears the one Last used badge, outside its label", () => {
  for (const [lastUsed, own, other] of [
    [ACCOUNT_PROVIDER.GOOGLE, "Continue with Google", "Continue with GitHub"],
    [ACCOUNT_PROVIDER.GITHUB, "Continue with GitHub", "Continue with Google"],
  ] as const) {
    const container = mount(gate({ lastUsed }));
    const badges = lastUsedBadges(container);
    assert.equal(badges.length, 1);
    assert.equal(badges[0]?.described, button(container, own));
    assert.equal(badges[0]?.described?.contains(badges[0].badge), false);
    assert.equal(button(container, other).hasAttribute("aria-describedby"), false);
  }
});

test("with no provider kept, no button wears the Last used badge", () => {
  const container = mount(gate());
  assert.deepEqual(lastUsedBadges(container), []);
});

test("a sign-in waited on holds both buttons, keeps the badge, and Cancel takes the wait back", () => {
  let cancelled = 0;
  const container = mount(
    gate({
      waiting: ACCOUNT_PROVIDER.GITHUB,
      lastUsed: ACCOUNT_PROVIDER.GITHUB,
      onCancel: () => (cancelled += 1),
    }),
  );
  const waiting = button(container, "Waiting for browser…");
  assert.equal(waiting.disabled, true);
  assert.equal(button(container, "Continue with Google").disabled, true);
  assert.equal(
    buttons(container).some((each) => each.textContent === "Continue with GitHub"),
    false,
  );
  assert.deepEqual(
    lastUsedBadges(container).map(({ described }) => described),
    [waiting],
  );
  act(() => button(container, "Cancel").click());
  assert.equal(cancelled, 1);
});
