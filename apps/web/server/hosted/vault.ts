import {
  isRecord,
  isWireString,
  text,
  type UnparsedWireValue,
  VAULT_PROVIDER_ID,
  type VaultProviderId,
} from "../core.js";
import { encryptProviderKey } from "./encryption.js";
import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS, jsonResponse } from "./http.js";

/** Maximum length accepted for a provider API key. */
const KEY_MAX_LENGTH = 512;

/**
 * A valid provider key: non-empty, no whitespace anywhere, bounded length.
 * Loose by design — shape validation only, not provider-specific format.
 */
function parseProviderKey(value: UnparsedWireValue): string | undefined {
  if (!isWireString(value)) return undefined;
  if (!value || value.length > KEY_MAX_LENGTH) return undefined;
  if (/\s/u.test(value)) return undefined;
  return value;
}

const VAULT_PROVIDER_ID_SET: ReadonlySet<string> = new Set(Object.values(VAULT_PROVIDER_ID));

function isVaultProviderId(value: string | undefined): value is VaultProviderId {
  return value !== undefined && VAULT_PROVIDER_ID_SET.has(value);
}

/**
 * Returns the trimmed secret if present, or a 503 Response if it is absent or
 * blank. All vault endpoints require it; its absence is a kill switch.
 */
function trimmedSecretOrUnavailable(secret: string | undefined): { secret: string } | Response {
  const trimmed = secret?.trim();
  if (!trimmed) {
    return errorResponse(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE);
  }
  return { secret: trimmed };
}

export interface VaultKeyStoreOptions {
  request: Request;
  resolveUserId: (request: Request) => Promise<string | undefined>;
  /** The value of PROVIDER_KEY_ENCRYPTION_SECRET; undefined means the env var is absent. */
  encryptionSecret: string | undefined;
  storeKey: (userId: string, providerId: string, ciphertext: string, hint: string) => Promise<void>;
}

/** Stores or replaces the provider API key for the signed-in user. */
export async function handleVaultKeyStore(options: VaultKeyStoreOptions): Promise<Response> {
  const { request, resolveUserId, encryptionSecret, storeKey } = options;

  if (request.method !== "POST") {
    return errorResponse(
      HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
    );
  }

  const secretResult = trimmedSecretOrUnavailable(encryptionSecret);
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
  if (!isVaultProviderId(providerId)) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }

  const key = parseProviderKey(body.key);
  if (!key) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }

  const ciphertext = encryptProviderKey(key, secretResult.secret);
  const hint = key.slice(-4);

  await storeKey(userId, providerId, ciphertext, hint);

  return jsonResponse(HOSTED_HTTP_STATUS.OK, { stored: true });
}

export interface VaultKeyEntry {
  providerId: string;
  hint: string;
  updatedAt: Date;
}

export interface VaultKeysListOptions {
  request: Request;
  resolveUserId: (request: Request) => Promise<string | undefined>;
  encryptionSecret: string | undefined;
  listKeys: (userId: string) => Promise<VaultKeyEntry[]>;
}

/** Lists stored provider keys for the signed-in user. Never returns ciphertext or plaintext. */
export async function handleVaultKeysList(options: VaultKeysListOptions): Promise<Response> {
  const { request, resolveUserId, encryptionSecret, listKeys } = options;

  if (request.method !== "GET") {
    return errorResponse(
      HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
    );
  }

  const secretResult = trimmedSecretOrUnavailable(encryptionSecret);
  if (secretResult instanceof Response) return secretResult;

  const userId = await resolveUserId(request);
  if (!userId) {
    return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
  }

  const rows = await listKeys(userId);

  return jsonResponse(HOSTED_HTTP_STATUS.OK, {
    keys: rows.map((row) => ({
      providerId: row.providerId,
      hint: row.hint,
      updatedAt: row.updatedAt.getTime(),
    })),
  });
}

export interface VaultKeyDeleteOptions {
  request: Request;
  resolveUserId: (request: Request) => Promise<string | undefined>;
  encryptionSecret: string | undefined;
  deleteKey: (userId: string, providerId: string) => Promise<boolean>;
}

/** Deletes the stored provider key for the signed-in user. */
export async function handleVaultKeyDelete(options: VaultKeyDeleteOptions): Promise<Response> {
  const { request, resolveUserId, encryptionSecret, deleteKey } = options;

  if (request.method !== "DELETE") {
    return errorResponse(
      HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
    );
  }

  const secretResult = trimmedSecretOrUnavailable(encryptionSecret);
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
  if (!isVaultProviderId(providerId)) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }

  const deleted = await deleteKey(userId, providerId);

  return jsonResponse(HOSTED_HTTP_STATUS.OK, { deleted });
}
