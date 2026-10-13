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
import type { Act, ActOutcome } from "#shared/messages/acts";
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
