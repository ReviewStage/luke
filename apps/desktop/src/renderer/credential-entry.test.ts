import assert from "node:assert/strict";
import test from "node:test";
import { CREDENTIAL_PROVIDER_ID } from "@sidecar/credentials/vocabulary";
import { ACT_RESULT_STATUS } from "@sidecar/wire";
import {
  type CredentialEntry,
  type CredentialEntryControl,
  entryForProvider,
  isSubmittable,
  removalEndsEntry,
} from "./credential-entry";

function control(entry?: CredentialEntry): CredentialEntryControl {
  return {
    entry,
    begin: () => undefined,
    connect: () => undefined,
    change: () => undefined,
    fetchKey: () => undefined,
    cancel: () => undefined,
    commit: () => undefined,
    remove: () => Promise.resolve({ status: ACT_RESULT_STATUS.ACCEPTED }),
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
  assert.equal(entryForProvider(current, CREDENTIAL_PROVIDER_ID.LINEAR), undefined);
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

test("deleting a key ends the entry that was going to replace it", () => {
  const held = entry({ draft: "sk-live-key" });

  assert.equal(
    removalEndsEntry(held, CREDENTIAL_PROVIDER_ID.CONDUCTOR, undefined),
    true,
    "a field left open over a key that no longer exists holds the panel for nothing",
  );
});

test("deleting one provider's key leaves another's entry alone", () => {
  const held = entry({ providerId: CREDENTIAL_PROVIDER_ID.LINEAR });

  assert.equal(removalEndsEntry(held, CREDENTIAL_PROVIDER_ID.CONDUCTOR, undefined), false);
  assert.equal(removalEndsEntry(undefined, CREDENTIAL_PROVIDER_ID.CONDUCTOR, undefined), false);
});

test("a delete that was refused ends nothing, because it removed nothing", () => {
  const held = entry({ draft: "sk-live-key" });

  assert.equal(
    removalEndsEntry(held, CREDENTIAL_PROVIDER_ID.CONDUCTOR, "Could not save that API key."),
    false,
  );
});
