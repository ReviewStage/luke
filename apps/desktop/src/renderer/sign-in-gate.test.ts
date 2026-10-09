// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS } from "@sidecar/credentials/snapshot";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { SignInGate } from "./sign-in-gate";

const ignore = () => undefined;

/** Every root a test mounted, unmounted after it so nothing it started outlives it. */
const mounted: Root[] = [];

afterEach(() => {
  act(() => {
    for (const root of mounted.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

test("the gate offers the ways in and nothing else, quitting being the app menu's", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push(root);
  act(() => {
    root.render(
      createElement(SignInGate, {
        account: { status: ACCOUNT_STATUS.SIGNED_OUT },
        onBegin: ignore,
      }),
    );
  });
  const words = [...container.querySelectorAll("button")].map((button) => button.textContent);
  assert.deepEqual(words, ["Continue with Google", "Continue with GitHub"]);
});
