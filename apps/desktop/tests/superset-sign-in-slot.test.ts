import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SupersetSignInSlot } from "../src/renderer/superset-sign-in-slot";
import { SUPERSET_SIGN_IN_STAGE, type SupersetSignInSnapshot } from "../src/shared/contracts";

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

test("the browser stage asks for an explicit paste and can reopen or cancel", () => {
  const markup = render({ stage: SUPERSET_SIGN_IN_STAGE.BROWSER_CODE, organizations: [] });
  assert.match(markup, /Finish signing in with Superset/);
  assert.match(markup, /press ⌘V here/);
  assert.match(markup, /Open the page again/);
  assert.match(markup, /Cancel/);
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

test("a bounded failure offers both retry and close", () => {
  const markup = render({
    stage: SUPERSET_SIGN_IN_STAGE.FAILURE,
    failure: "Superset sign-in did not finish.",
    organizations: [],
  });
  assert.match(markup, /Not connected/);
  assert.match(markup, /Retry/);
  assert.match(markup, /Close/);
  assert.doesNotMatch(markup, /token=/);
});
