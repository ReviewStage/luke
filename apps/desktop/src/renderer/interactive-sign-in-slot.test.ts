import assert from "node:assert/strict";
import test from "node:test";
import { CONNECTION_ID, connectionDeclaration } from "@sidecar/credentials/vocabulary";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { INTERACTIVE_SIGN_IN_STAGE, type InteractiveSignInSnapshot } from "#shared/wire/session";
import { InteractiveSignInSlot } from "./interactive-sign-in-slot";

function render(state: InteractiveSignInSnapshot): string {
  return renderToStaticMarkup(
    createElement(InteractiveSignInSlot, {
      declaration: connectionDeclaration(CONNECTION_ID.SUPERSET),
      state,
      drawn: true,
      onSubmit: () => undefined,
      onReopen: () => undefined,
      onCancel: () => undefined,
      onRetry: () => undefined,
      onChooseScope: () => undefined,
      measure: () => undefined,
    }),
  );
}

test("the browser stage speaks the key popups' own language", () => {
  const markup = render({ stage: INTERACTIVE_SIGN_IN_STAGE.BROWSER_CODE, scopes: [] });
  assert.match(markup, /key-slot-label[^>]*>Sign-in code/);
  assert.match(markup, /key-slot-foot/);
  assert.match(markup, /type="password"/);
  assert.match(markup, /Paste it here/);
  assert.match(markup, /its sign-in page/);
  assert.match(markup, /Cancel/);
  assert.match(markup, /Connect</);
  assert.match(markup, /Superset sign-in code/);
});

test("the slot introduces itself the way every other slot does", () => {
  const markup = render({ stage: INTERACTIVE_SIGN_IN_STAGE.BROWSER_CODE, scopes: [] });
  assert.match(markup, /class="key-slot sign-in-slot"/);
  assert.match(markup, /data-mark="superset"/);
});

test("the exchange disables the code field and says it is connecting", () => {
  const markup = render({ stage: INTERACTIVE_SIGN_IN_STAGE.EXCHANGING, scopes: [] });
  assert.match(markup, /disabled=""/);
  assert.match(markup, /Connecting…/);
});

test("the organization stage draws only the returned identities", () => {
  const markup = render({
    stage: INTERACTIVE_SIGN_IN_STAGE.SCOPE,
    scopes: [
      { id: "one", name: "Acme", slug: "acme" },
      { id: "two", name: "Luke", slug: "luke" },
    ],
  });
  assert.match(markup, /Choose a Superset organization/);
  assert.match(markup, />Acme</);
  assert.match(markup, />Luke</);
  assert.doesNotMatch(markup, /Superset sign-in code/);
});

test("the organization switch keeps the one-line dress and asks for no code", () => {
  const markup = render({ stage: INTERACTIVE_SIGN_IN_STAGE.SWITCHING, scopes: [] });
  assert.match(markup, /Connecting…/);
  assert.match(markup, /Cancel/);
  assert.doesNotMatch(markup, /Sign-in code/);
  assert.doesNotMatch(markup, /Paste it here/);
  assert.doesNotMatch(markup, /its sign-in page/);
});

test("a bounded failure offers both another sign-in and close", () => {
  const markup = render({
    stage: INTERACTIVE_SIGN_IN_STAGE.FAILURE,
    failure: "Superset sign-in did not finish.",
    scopes: [],
  });
  assert.match(markup, /Not connected/);
  assert.match(markup, /Sign in again/);
  assert.match(markup, /Close/);
  assert.doesNotMatch(markup, /token=/);
});
