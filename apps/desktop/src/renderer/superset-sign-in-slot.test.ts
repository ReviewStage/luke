import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SUPERSET_SIGN_IN_STAGE, type SupersetSignInSnapshot } from "#shared/wire/session";
import { SupersetSignInSlot } from "./superset-sign-in-slot";

function render(state: SupersetSignInSnapshot): string {
  return renderToStaticMarkup(
    createElement(SupersetSignInSlot, {
      state,
      drawn: true,
      onSubmit: () => undefined,
      onReopen: () => undefined,
      onCancel: () => undefined,
      onRetry: () => undefined,
      onChooseOrganization: () => undefined,
      measure: () => undefined,
    }),
  );
}

test("the browser stage speaks the key popups' own language", () => {
  const markup = render({ stage: SUPERSET_SIGN_IN_STAGE.BROWSER_CODE, organizations: [] });
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
  const markup = render({ stage: SUPERSET_SIGN_IN_STAGE.BROWSER_CODE, organizations: [] });
  assert.match(markup, /class="key-slot sign-in-slot"/);
  assert.match(markup, /data-mark="superset"/);
});

test("the exchange disables the code field and says it is connecting", () => {
  const markup = render({ stage: SUPERSET_SIGN_IN_STAGE.EXCHANGING, organizations: [] });
  assert.match(markup, /disabled=""/);
  assert.match(markup, /Connecting…/);
});

test("the organization stage draws only the returned identities", () => {
  const markup = render({
    stage: SUPERSET_SIGN_IN_STAGE.ORGANIZATION,
    organizations: [
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
  const markup = render({ stage: SUPERSET_SIGN_IN_STAGE.SWITCHING, organizations: [] });
  assert.match(markup, /Connecting…/);
  assert.match(markup, /Cancel/);
  assert.doesNotMatch(markup, /Sign-in code/);
  assert.doesNotMatch(markup, /Paste it here/);
  assert.doesNotMatch(markup, /its sign-in page/);
});

test("a bounded failure offers both another sign-in and close", () => {
  const markup = render({
    stage: SUPERSET_SIGN_IN_STAGE.FAILURE,
    failure: "Superset sign-in did not finish.",
    organizations: [],
  });
  assert.match(markup, /Not connected/);
  assert.match(markup, /Sign in again/);
  assert.match(markup, /Close/);
  assert.doesNotMatch(markup, /token=/);
});
