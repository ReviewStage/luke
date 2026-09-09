import {
  isCloudAgentProviderId,
  isRecord,
  isWireString,
  text,
  type UnparsedWireValue,
  vaultKeyIsStorable,
} from "../core.js";
import { encryptProviderKey, secretOrUnavailable } from "./encryption.js";
import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS, jsonResponse } from "./http.js";
import type { HostedVaultRoute } from "./vault-route.js";

/**
 * A valid provider key, by the shape rule the wire contract fixes for both
 * sides. Loose by design — never provider-specific format.
 */
function parseProviderKey(value: UnparsedWireValue): string | undefined {
  if (!isWireString(value) || !vaultKeyIsStorable(value)) return undefined;
  return value;
}

export type VaultKeyStoreOptions = Pick<
  HostedVaultRoute,
  "request" | "resolveUserId" | "encryptionSecret" | "storeKey"
>;

/** Stores or replaces the provider API key for the signed-in user. */
export async function handleVaultKeyStore(options: VaultKeyStoreOptions): Promise<Response> {
  const { request, resolveUserId, encryptionSecret, storeKey } = options;

  if (request.method !== "POST") {
    return errorResponse(
      HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
    );
  }

  const secretResult = secretOrUnavailable(encryptionSecret);
  if (secretResult instanceof Response) return secretResult;

  const userId = await resolveUserId(request);
  if (!userId) {
    return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
  }

  let body: UnparsedWireValue;
  try {
    // SAFETY: request.json() returns unknown; isRecord below validates the shape.
    body = (await request.json()) as UnparsedWireValue;
  } catch {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }

  if (!isRecord(body)) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }

  const providerId = text(body.providerId);
  if (!isCloudAgentProviderId(providerId)) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }

  const key = parseProviderKey(body.key);
  if (!key) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }

  const ciphertext = encryptProviderKey(key, secretResult.secret);

  await storeKey(userId, providerId, ciphertext);

  return jsonResponse(HOSTED_HTTP_STATUS.OK, { stored: true });
}

export type VaultKeysListOptions = Pick<
  HostedVaultRoute,
  "request" | "resolveUserId" | "encryptionSecret" | "listKeys"
>;

/** Lists stored provider keys for the signed-in user. Never returns ciphertext or plaintext. */
export async function handleVaultKeysList(options: VaultKeysListOptions): Promise<Response> {
  const { request, resolveUserId, encryptionSecret, listKeys } = options;

  if (request.method !== "GET") {
    return errorResponse(
      HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
    );
  }

  const secretResult = secretOrUnavailable(encryptionSecret);
  if (secretResult instanceof Response) return secretResult;

  const userId = await resolveUserId(request);
  if (!userId) {
    return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
  }

  const rows = await listKeys(userId);

  // The table outlives the provider set: a key stored for a provider this
  // build no longer accepts still has a row, and both clients' readers drop
  // the whole answer on an id they do not know. The list answers only for
  // the providers the wire contract names, and a stale row is held silently
  // rather than surfaced as a key that cannot be deleted or used.
  return jsonResponse(HOSTED_HTTP_STATUS.OK, {
    keys: rows
      .filter((row) => isCloudAgentProviderId(row.providerId))
      .map((row) => ({
        providerId: row.providerId,
        updatedAt: row.updatedAt.getTime(),
      })),
  });
}

export type VaultKeyDeleteOptions = Pick<
  HostedVaultRoute,
  "request" | "resolveUserId" | "encryptionSecret" | "deleteKey"
>;

/** Deletes the stored provider key for the signed-in user. */
export async function handleVaultKeyDelete(options: VaultKeyDeleteOptions): Promise<Response> {
  const { request, resolveUserId, encryptionSecret, deleteKey } = options;

  if (request.method !== "DELETE") {
    return errorResponse(
      HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
    );
  }

  const secretResult = secretOrUnavailable(encryptionSecret);
  if (secretResult instanceof Response) return secretResult;

  const userId = await resolveUserId(request);
  if (!userId) {
    return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
  }

  let body: UnparsedWireValue;
  try {
    // SAFETY: request.json() returns unknown; isRecord below validates the shape.
    body = (await request.json()) as UnparsedWireValue;
  } catch {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }

  if (!isRecord(body)) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }

  const providerId = text(body.providerId);
  if (!isCloudAgentProviderId(providerId)) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }

  const deleted = await deleteKey(userId, providerId);

  return jsonResponse(HOSTED_HTTP_STATUS.OK, { deleted });
}
