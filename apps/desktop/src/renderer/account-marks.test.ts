// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_PROVIDER, ACCOUNT_STATUS, type AccountProvider } from "@luke/credentials/snapshot";
import { ProviderMark } from "@luke/ui";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { AccountSection } from "./settings/account-section";
import { SignInGate } from "./sign-in-gate";

/**
 * Every surface that names a provider the account signs in with draws that
 * provider's one mark beside the name. Synthetic accounts.
 */

/** `element` drawn, as a page to query. */
function drawn(element: React.ReactElement): HTMLElement {
  const page = document.createElement("div");
  page.innerHTML = renderToStaticMarkup(element);
  return page;
}

/** The mark standing in `place`, as its markup. */
function markIn(place: Element | null | undefined): string | undefined {
  return place?.querySelector("svg.provider-mark")?.outerHTML;
}

/** The provider's own mark, as its markup. */
function markOf(provider: AccountProvider): string {
  return drawn(createElement(ProviderMark, { provider })).innerHTML;
}

/** The Account section signed in with `provider`. */
function accountLine(provider: AccountProvider): HTMLElement {
  return drawn(
    createElement(AccountSection, {
      account: { status: ACCOUNT_STATUS.SIGNED_IN, email: "ada@example.com", provider },
      onSignOut: () => Promise.resolve(),
      onDeleteAccount: () => Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED }),
    }),
  );
}

test("the sign-in buttons and the account's line each draw the provider's one mark beside its name", () => {
  const gate = drawn(
    createElement(SignInGate, {
      account: { status: ACCOUNT_STATUS.SIGNED_OUT },
      onBegin: () => undefined,
      onCancel: () => undefined,
    }),
  );
  const button = (provider: AccountProvider) =>
    gate.querySelector(`button[data-provider="${provider}"]`);

  assert.equal(markIn(button(ACCOUNT_PROVIDER.GOOGLE)), markOf(ACCOUNT_PROVIDER.GOOGLE));
  assert.equal(markIn(button(ACCOUNT_PROVIDER.GITHUB)), markOf(ACCOUNT_PROVIDER.GITHUB));
  for (const provider of [ACCOUNT_PROVIDER.GOOGLE, ACCOUNT_PROVIDER.GITHUB]) {
    assert.equal(markIn(accountLine(provider)), markOf(provider));
  }
});
