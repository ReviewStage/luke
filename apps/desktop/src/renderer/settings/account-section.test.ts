// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_PROVIDER, ACCOUNT_STATUS } from "@sidecar/credentials/snapshot";
import { ACTION_RESULT_STATUS, type ActionResult } from "@sidecar/wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { AccountSection } from "./account-section";

/**
 * General's Account group as a developer meets it: Sign out and Delete account
 * each ask in the confirm dialog, only the dialog's answer acts, and a delete
 * the service refuses says why in the dialog with the account still there.
 */

const ACCOUNT = {
  status: ACCOUNT_STATUS.SIGNED_IN,
  name: "Ada Lovelace",
  email: "ada@example.com",
  provider: ACCOUNT_PROVIDER.GITHUB,
} as const;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

function mount(onSignOut: () => Promise<void>, onDeleteAccount: () => Promise<ActionResult>) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(createElement(AccountSection, { account: ACCOUNT, onSignOut, onDeleteAccount })),
  );
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
  });
}

function button(within: ParentNode, words: string): HTMLButtonElement {
  return (
    [...within.querySelectorAll<HTMLButtonElement>("button")].find(
      (each) => each.textContent === words,
    ) ?? assert.fail(`no ${words} button`)
  );
}

function dialog(): HTMLElement {
  return document.querySelector<HTMLElement>('[role="alertdialog"]') ?? assert.fail("no question");
}

test("Sign out asks in the confirm dialog, and only the dialog's answer signs out", async () => {
  let signedOut = 0;
  const page = mount(
    () => {
      signedOut += 1;
      return Promise.resolve();
    },
    () => Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED }),
  );

  act(() => button(page, "Sign out").click());
  assert.equal(signedOut, 0);
  assert.equal(dialog().querySelector("h2")?.textContent, "Sign out of ada@example.com?");

  act(() => button(dialog(), "Sign out").click());
  await settle();
  assert.equal(signedOut, 1);
});

test("Delete account asks first, and a refusal is said in the dialog with the account kept", async () => {
  let asked = 0;
  const page = mount(
    () => Promise.resolve(),
    () => {
      asked += 1;
      return Promise.resolve({ status: ACTION_RESULT_STATUS.REJECTED, reason: "Try again later." });
    },
  );

  act(() => button(page, "Delete account").click());
  assert.equal(asked, 0);
  assert.match(
    dialog().querySelector("h2")?.textContent ?? "",
    /^Delete the account ada@example\.com\?/u,
  );

  act(() => button(dialog(), "Delete account").click());
  await settle();
  assert.equal(asked, 1);
  assert.equal(dialog().querySelector('[role="alert"]')?.textContent, "Try again later.");
  assert.ok(page.textContent?.includes("ada@example.com"), "the account still stands");
});
