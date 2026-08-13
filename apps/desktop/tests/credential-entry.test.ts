import assert from "node:assert/strict";
import test from "node:test";
import {
  type CredentialEntry,
  type CredentialEntryControl,
  entryForProvider,
  isSubmittable,
} from "../src/renderer/credential-entry";
import { CREDENTIAL_PROVIDER_ID } from "../src/shared/credential-providers";

function control(entry?: CredentialEntry): CredentialEntryControl {
  return {
    entry,
    begin: () => undefined,
    change: () => undefined,
    fetchKey: () => undefined,
    cancel: () => undefined,
    commit: () => undefined,
    remove: () => Promise.resolve(undefined),
  };
}

function entry(overrides: Partial<CredentialEntry> = {}): CredentialEntry {
  return {
    providerId: CREDENTIAL_PROVIDER_ID.CONDUCTOR,
    draft: "",
    busy: false,
    away: false,
    ...overrides,
  };
}

test("an entry belongs to one provider, so no other line draws a field", () => {
  const held = entry();
  const current = control(held);

  assert.equal(entryForProvider(current, CREDENTIAL_PROVIDER_ID.CONDUCTOR), held);
  assert.equal(entryForProvider(current, CREDENTIAL_PROVIDER_ID.CURSOR), undefined);
  assert.equal(
    entryForProvider(control(), CREDENTIAL_PROVIDER_ID.CONDUCTOR),
    undefined,
    "no entry anywhere means no field anywhere",
  );
});

test("whitespace is not a key", () => {
  assert.equal(isSubmittable(entry({ draft: "" })), false);
  assert.equal(isSubmittable(entry({ draft: "   \n\t" })), false);
  assert.equal(isSubmittable(entry({ draft: " sk-live-key " })), true);
});

test("a key already in flight is not sent a second time", () => {
  assert.equal(isSubmittable(entry({ draft: "sk-live-key", busy: true })), false);
});

test("nothing being entered can be submitted", () => {
  assert.equal(isSubmittable(undefined), false);
});
