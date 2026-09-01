import assert from "node:assert/strict";
import test from "node:test";
import { CLOUD_AGENT_PROVIDER_LIST } from "@sidecar/credentials";
import { VAULT_PROVIDER_ID } from "@sidecar/hosted";
import { decryptProviderKey, encryptProviderKey } from "../server/hosted/encryption";
import { HOSTED_API_ERROR } from "../server/hosted/http";
import type { VaultKeyEntry } from "./hosted-runner";
import { handleVaultKeyDelete, handleVaultKeyStore, handleVaultKeysList } from "./hosted-runner";

// A valid 32-byte secret as 64 hex chars.
const SECRET = "a".repeat(64);
const OTHER_SECRET = "b".repeat(64);

interface VaultStoreBody {
  providerId?: string;
  key?: string;
}

interface VaultDeleteBody {
  providerId?: string;
}

function storeRequest(body?: VaultStoreBody, headers: Record<string, string> = {}): Request {
  return new Request("https://luke.test/api/vault/key", {
    method: "POST",
    headers: { authorization: "Bearer token-1", "content-type": "application/json", ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function listRequest(headers: Record<string, string> = {}): Request {
  return new Request("https://luke.test/api/vault/keys", {
    method: "GET",
    headers: { authorization: "Bearer token-1", ...headers },
  });
}

function deleteRequest(body?: VaultDeleteBody, headers: Record<string, string> = {}): Request {
  return new Request("https://luke.test/api/vault/key", {
    method: "DELETE",
    headers: { authorization: "Bearer token-1", "content-type": "application/json", ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// --- Encryption round-trips ---

test("encrypt then decrypt recovers the original key", () => {
  const original = "sk-test-abc123";
  const encrypted = encryptProviderKey(original, SECRET);
  assert.equal(decryptProviderKey(encrypted, SECRET), original);
});

test("each encrypt call produces a different ciphertext (random nonce)", () => {
  const key = "sk-same-key";
  assert.notEqual(encryptProviderKey(key, SECRET), encryptProviderKey(key, SECRET));
});

test("decrypting with the wrong secret throws", () => {
  const encrypted = encryptProviderKey("sk-secret", SECRET);
  assert.throws(() => decryptProviderKey(encrypted, OTHER_SECRET));
});

test("a secret that is not 64 hex chars throws at encrypt time", () => {
  assert.throws(() => encryptProviderKey("key", "tooshort"));
});

// --- Store ---

function storeOptions(overrides: Partial<Parameters<typeof handleVaultKeyStore>[0]> = {}) {
  return {
    request: storeRequest({ providerId: VAULT_PROVIDER_ID.COPILOT, key: "sk-abc1234" }),
    encryptionSecret: SECRET,
    resolveUserId: async () => "user-1",
    storeKey: async (_userId: string, _providerId: string, _ciphertext: string) => {},
    ...overrides,
  };
}

test("the store gate order is method, secret, token, body", async () => {
  const wrongMethod = await handleVaultKeyStore(
    storeOptions({
      request: new Request("https://luke.test/api/vault/key", { method: "GET" }),
    }),
  );
  assert.equal(wrongMethod.status, 405);

  const noSecret = await handleVaultKeyStore(storeOptions({ encryptionSecret: undefined }));
  assert.equal(noSecret.status, 503);
  assert.equal((await noSecret.json()).error, HOSTED_API_ERROR.UNAVAILABLE);

  const blankSecret = await handleVaultKeyStore(storeOptions({ encryptionSecret: "   " }));
  assert.equal(blankSecret.status, 503);

  const anonymous = await handleVaultKeyStore(
    storeOptions({ resolveUserId: async () => undefined }),
  );
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error, HOSTED_API_ERROR.INVALID_TOKEN);

  const noBody = await handleVaultKeyStore(
    storeOptions({
      request: new Request("https://luke.test/api/vault/key", {
        method: "POST",
        headers: { authorization: "Bearer t" },
      }),
    }),
  );
  assert.equal(noBody.status, 400);
  assert.equal((await noBody.json()).error, HOSTED_API_ERROR.INVALID_REQUEST);
});

test("storing a valid key answers { stored: true } and writes an encrypted ciphertext", async () => {
  let stored: { userId: string; providerId: string; ciphertext: string } | undefined;

  const response = await handleVaultKeyStore(
    storeOptions({
      storeKey: async (userId, providerId, ciphertext) => {
        stored = { userId, providerId, ciphertext };
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.equal((await response.json()).stored, true);
  assert.ok(stored);
  assert.equal(stored.userId, "user-1");
  assert.equal(stored.providerId, VAULT_PROVIDER_ID.COPILOT);
  // Ciphertext must not equal the plaintext key.
  assert.notEqual(stored.ciphertext, "sk-abc1234");
  // Round-trip: decrypt recovers the original key.
  assert.equal(decryptProviderKey(stored.ciphertext, SECRET), "sk-abc1234");
});

test("an unknown provider id is refused", async () => {
  const response = await handleVaultKeyStore(
    storeOptions({
      request: storeRequest({ providerId: "not-a-provider", key: "sk-abc" }),
    }),
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, HOSTED_API_ERROR.INVALID_REQUEST);
});

test("a key with internal whitespace is refused", async () => {
  const response = await handleVaultKeyStore(
    storeOptions({
      request: storeRequest({ providerId: VAULT_PROVIDER_ID.CURSOR, key: "sk ab cd" }),
    }),
  );
  assert.equal(response.status, 400);
});

test("an empty key is refused", async () => {
  const response = await handleVaultKeyStore(
    storeOptions({ request: storeRequest({ providerId: VAULT_PROVIDER_ID.DEVIN, key: "" }) }),
  );
  assert.equal(response.status, 400);
});

test("a key longer than 512 characters is refused", async () => {
  const response = await handleVaultKeyStore(
    storeOptions({
      request: storeRequest({ providerId: VAULT_PROVIDER_ID.JULES, key: "k".repeat(513) }),
    }),
  );
  assert.equal(response.status, 400);
});

// --- List ---

const NOW_DATE = new Date("2026-08-28T00:00:00.000Z");

function listOptions(overrides: Partial<Parameters<typeof handleVaultKeysList>[0]> = {}) {
  return {
    request: listRequest(),
    encryptionSecret: SECRET,
    resolveUserId: async () => "user-1",
    listKeys: async (_userId: string): Promise<VaultKeyEntry[]> => [
      { providerId: VAULT_PROVIDER_ID.COPILOT, updatedAt: NOW_DATE },
    ],
    ...overrides,
  };
}

test("the list gate order is method, secret, token", async () => {
  const wrongMethod = await handleVaultKeysList(
    listOptions({ request: new Request("https://luke.test/api/vault/keys", { method: "POST" }) }),
  );
  assert.equal(wrongMethod.status, 405);

  const noSecret = await handleVaultKeysList(listOptions({ encryptionSecret: undefined }));
  assert.equal(noSecret.status, 503);

  const anonymous = await handleVaultKeysList(
    listOptions({ resolveUserId: async () => undefined }),
  );
  assert.equal(anonymous.status, 401);
});

test("the list answer never contains ciphertext or plaintext keys", async () => {
  const response = await handleVaultKeysList(listOptions());

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(Array.isArray(body.keys));
  assert.equal(body.keys.length, 1);
  assert.equal(body.keys[0].providerId, VAULT_PROVIDER_ID.COPILOT);
  assert.equal(body.keys[0].updatedAt, NOW_DATE.getTime());
  // No ciphertext, no plaintext key field anywhere.
  assert.ok(!("ciphertext" in body.keys[0]));
  assert.ok(!("key" in body.keys[0]));
  assert.doesNotMatch(JSON.stringify(body), /ciphertext/);
});

test("the list calls the seam with the resolved user id", async () => {
  let calledWithUserId: string | undefined;

  await handleVaultKeysList(
    listOptions({
      resolveUserId: async () => "user-xyz",
      listKeys: async (userId) => {
        calledWithUserId = userId;
        return [];
      },
    }),
  );

  assert.equal(calledWithUserId, "user-xyz");
});

// --- Delete ---

function deleteOptions(overrides: Partial<Parameters<typeof handleVaultKeyDelete>[0]> = {}) {
  return {
    request: deleteRequest({ providerId: VAULT_PROVIDER_ID.REPLICAS }),
    encryptionSecret: SECRET,
    resolveUserId: async () => "user-1",
    deleteKey: async (_userId: string, _providerId: string) => true,
    ...overrides,
  };
}

test("the delete gate order is method, secret, token, body", async () => {
  const wrongMethod = await handleVaultKeyDelete(
    deleteOptions({ request: new Request("https://luke.test/api/vault/key", { method: "POST" }) }),
  );
  assert.equal(wrongMethod.status, 405);

  const noSecret = await handleVaultKeyDelete(deleteOptions({ encryptionSecret: undefined }));
  assert.equal(noSecret.status, 503);

  const anonymous = await handleVaultKeyDelete(
    deleteOptions({ resolveUserId: async () => undefined }),
  );
  assert.equal(anonymous.status, 401);

  const unknownProvider = await handleVaultKeyDelete(
    deleteOptions({ request: deleteRequest({ providerId: "not-a-provider" }) }),
  );
  assert.equal(unknownProvider.status, 400);
  assert.equal((await unknownProvider.json()).error, HOSTED_API_ERROR.INVALID_REQUEST);
});

test("deleting an existing key answers { deleted: true }", async () => {
  const response = await handleVaultKeyDelete(deleteOptions({ deleteKey: async () => true }));

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.deleted, true);
});

test("deleting a key that was not stored answers { deleted: false }", async () => {
  const response = await handleVaultKeyDelete(deleteOptions({ deleteKey: async () => false }));

  assert.equal(response.status, 200);
  assert.equal((await response.json()).deleted, false);
});

test("the delete passes the resolved user id and provider id to the seam", async () => {
  let calledWith: { userId: string; providerId: string } | undefined;

  await handleVaultKeyDelete(
    deleteOptions({
      resolveUserId: async () => "user-abc",
      request: deleteRequest({ providerId: VAULT_PROVIDER_ID.CURSOR }),
      deleteKey: async (userId, providerId) => {
        calledWith = { userId, providerId };
        return true;
      },
    }),
  );

  assert.deepEqual(calledWith, { userId: "user-abc", providerId: VAULT_PROVIDER_ID.CURSOR });
});

// --- Provider set parity ---

test("VAULT_PROVIDER_ID matches CLOUD_AGENT_PROVIDER_LIST exactly", () => {
  const vaultIds = new Set(Object.values(VAULT_PROVIDER_ID));
  const cloudIds = new Set(CLOUD_AGENT_PROVIDER_LIST.map((p) => p.id));
  assert.deepEqual(vaultIds, cloudIds);
});

// --- Replace-on-upsert ---

test("storing again for the same provider replaces the previous entry (upsert)", async () => {
  const stored: Array<{ ciphertext: string }> = [];

  async function storeKey(_userId: string, _providerId: string, ciphertext: string): Promise<void> {
    stored.push({ ciphertext });
  }

  // First store.
  await handleVaultKeyStore(
    storeOptions({
      request: storeRequest({ providerId: VAULT_PROVIDER_ID.JULES, key: "first-key-0001" }),
      storeKey,
    }),
  );
  // Second store — same provider, different key.
  await handleVaultKeyStore(
    storeOptions({
      request: storeRequest({ providerId: VAULT_PROVIDER_ID.JULES, key: "second-key-9999" }),
      storeKey,
    }),
  );

  assert.equal(stored.length, 2);
  const first = stored.at(0);
  const second = stored.at(1);
  assert.ok(first && second);
  // Both writes produce different ciphertexts.
  assert.notEqual(first.ciphertext, second.ciphertext);
  // Each ciphertext decrypts to the respective plaintext.
  assert.equal(decryptProviderKey(first.ciphertext, SECRET), "first-key-0001");
  assert.equal(decryptProviderKey(second.ciphertext, SECRET), "second-key-9999");
});
