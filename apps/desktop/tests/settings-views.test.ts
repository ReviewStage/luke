import assert from "node:assert/strict";
import { test } from "node:test";
import {
  credentialSettingsPage,
  PANEL_STAND_DOWN,
  SETTINGS_VIEW,
  standDownReturnPage,
} from "../src/renderer/settings-views";
import {
  CREDENTIAL_PROVIDER_LIST,
  VOICE_CREDENTIAL_PROVIDER_ID,
} from "../src/shared/credential-providers";

test("a credential entry returns to the page its row is drawn on", () => {
  // The OpenAI row lives in the What Luke runs on section at the top of the front
  // page — beside the allowance it replaces — and every other key lives under
  // Connections. An entry's trip to
  // the key slot has to end back on the page it began on, or the check beside
  // the provider lands on a page nobody is looking at.
  for (const provider of CREDENTIAL_PROVIDER_LIST) {
    assert.equal(
      credentialSettingsPage(provider.id),
      provider.id === VOICE_CREDENTIAL_PROVIDER_ID ? SETTINGS_VIEW.ROOT : SETTINGS_VIEW.CONNECTIONS,
      provider.id,
    );
  }
});

test("every stand-down comes back to the page its own row is drawn on", () => {
  // A note is written from the Feedback section on the front page, so leaving
  // the composer — or the thank-you a send lands in — belongs there.
  assert.equal(
    standDownReturnPage({ kind: PANEL_STAND_DOWN.FEEDBACK }),
    SETTINGS_VIEW.ROOT,
    "a note is begun and answered on the front page",
  );

  // The Google Calendar block stands under Integrations, so a cancelled or
  // refused sign-in returns to the row that can try it again.
  assert.equal(standDownReturnPage({ kind: PANEL_STAND_DOWN.CALENDAR }), SETTINGS_VIEW.CONNECTIONS);

  // A key follows its own provider's row, wherever that is drawn — which is
  // the one stand-down whose answer is not fixed.
  for (const provider of CREDENTIAL_PROVIDER_LIST) {
    assert.equal(
      standDownReturnPage({ kind: PANEL_STAND_DOWN.KEY, providerId: provider.id }),
      credentialSettingsPage(provider.id),
      provider.id,
    );
  }

  // No two of them can be the same rule read from the same place: one
  // remembered page cannot stand in for three.
  const pages = new Set([
    standDownReturnPage({ kind: PANEL_STAND_DOWN.FEEDBACK }),
    standDownReturnPage({ kind: PANEL_STAND_DOWN.CALENDAR }),
  ]);
  assert.equal(pages.size, 2, "a note and a calendar sign-in do not share a page");
});
