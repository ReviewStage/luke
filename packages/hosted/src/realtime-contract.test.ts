import assert from "node:assert/strict";
import type { UnparsedWireValue } from "@sidecar/wire";
import { test } from "vitest";
import { realtimeCredentialFromResponse, realtimeCredentialIsUsable } from "./realtime-contract.js";

const EXPIRES_AT_SECONDS = 1_800_000_060;
const MINTED_MODEL = "gpt-realtime-2.1";

test("a mint response yields a credential with a millisecond expiry", () => {
  const credential = realtimeCredentialFromResponse(
    {
      value: "ek_test_secret",
      expires_at: EXPIRES_AT_SECONDS,
      session: { model: "gpt-realtime-2" },
    },
    MINTED_MODEL,
  );

  assert.ok(credential);
  assert.equal(credential.value, "ek_test_secret");
  assert.equal(credential.expiresAt, EXPIRES_AT_SECONDS * 1000);
  assert.equal(credential.model, "gpt-realtime-2");
  assert.equal(realtimeCredentialIsUsable(credential, EXPIRES_AT_SECONDS * 1000 - 1), true);
  assert.equal(realtimeCredentialIsUsable(credential, EXPIRES_AT_SECONDS * 1000), false);
});

test("a mint response outside the contract yields no credential", () => {
  const payloads: UnparsedWireValue[] = [
    undefined,
    null,
    "ek_test_secret",
    {},
    { value: "   ", expires_at: EXPIRES_AT_SECONDS },
    { value: "ek_test_secret" },
    { value: "ek_test_secret", expires_at: "soon" },
    { value: "ek_test_secret", expires_at: 0 },
    { value: "ek_test_secret", expires_at: Number.NaN },
  ];
  for (const payload of payloads) {
    assert.equal(realtimeCredentialFromResponse(payload, MINTED_MODEL), undefined);
  }
});

test("a mint response without a session model is labelled with the minted one", () => {
  const credential = realtimeCredentialFromResponse(
    { value: "ek_test_secret", expires_at: EXPIRES_AT_SECONDS },
    MINTED_MODEL,
  );

  assert.equal(credential?.model, MINTED_MODEL);
});
