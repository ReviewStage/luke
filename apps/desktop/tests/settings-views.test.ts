import assert from "node:assert/strict";
import { test } from "node:test";
import {
  credentialSettingsPage,
  PAGE_EXIT_MS,
  pageExitFromToken,
  SETTINGS_VIEW,
} from "../src/renderer/settings-views";
import {
  CREDENTIAL_PROVIDER_LIST,
  VOICE_CREDENTIAL_PROVIDER_ID,
} from "../src/shared/credential-providers";

test("the page swap reads the exit token in either unit", () => {
  assert.equal(pageExitFromToken("90ms"), 90);
  assert.equal(pageExitFromToken(" 90ms "), 90);
  assert.equal(pageExitFromToken("0.09s"), 90);
});

test("a zeroed token swaps at once, the way capture and reduced motion still the fade", () => {
  // Capture zeroes the token as a length of seconds; reduced motion leaves a
  // millisecond so transitions still fire. Either way the swap must not wait
  // out an exit that is not running.
  assert.equal(pageExitFromToken("0s"), 0);
  assert.equal(pageExitFromToken("1ms"), 1);
});

test("a token that cannot be read falls back to the resting exit, not to none", () => {
  assert.equal(pageExitFromToken(""), PAGE_EXIT_MS);
  assert.equal(pageExitFromToken("fast"), PAGE_EXIT_MS);
});

test("a credential entry returns to the page its row is drawn on", () => {
  // The OpenAI row lives at the top of the Voice page — it is what turns
  // voice on — its OpenAI BYOK row lives in Account and usage on the front
  // page — and every other key lives under Connections. An entry's trip to
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
