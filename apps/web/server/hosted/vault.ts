import { Context, Effect } from "effect";
import { HostedAuth, HostedEncryption } from "../services/tags.js";
import {
  decodeJsonBody,
  HOSTED_HTTP_STATUS,
  invalidRequest,
  jsonResponseEffect,
  methodNotAllowed,
  readJsonBody,
  unauthorized,
  unavailable,
} from "./http-effect.js";
import { VaultKeyDeleteBodySchema, VaultKeyStoreBodySchema } from "./schema.js";

export class VaultKeyStore extends Context.Tag("@luke/web/VaultKeyStore")<
  VaultKeyStore,
  {
    readonly storeKey: (
      userId: string,
      providerId: string,
      ciphertext: string,
    ) => Effect.Effect<void>;
  }
>() {}

export class VaultKeyList extends Context.Tag("@luke/web/VaultKeyList")<
  VaultKeyList,
  {
    readonly listKeys: (
      userId: string,
    ) => Effect.Effect<readonly { providerId: string; updatedAt: Date }[]>;
  }
>() {}

export class VaultKeyDelete extends Context.Tag("@luke/web/VaultKeyDelete")<
  VaultKeyDelete,
  {
    readonly deleteKey: (userId: string, providerId: string) => Effect.Effect<boolean>;
  }
>() {}

function trimmedSecretOrUnavailable(secret: string | undefined): { secret: string } | Response {
  const trimmed = secret?.trim();
  if (!trimmed) {
    return unavailable();
  }
  return { secret: trimmed };
}

export interface VaultKeyEntry {
  providerId: string;
  updatedAt: Date;
}

export const handleVaultKeyStore = Effect.fn("handleVaultKeyStore")(function* (request: Request) {
  if (request.method !== "POST") {
    return methodNotAllowed();
  }

  const encryption = yield* HostedEncryption;
  const secretResult = trimmedSecretOrUnavailable(encryption.secret);
  if (secretResult instanceof Response) return secretResult;

  const auth = yield* HostedAuth;
  const userId = yield* auth.resolveUserId(request);
  if (!userId) {
    return unauthorized();
  }

  const payload = yield* readJsonBody(request);
  const body = payload === undefined ? undefined : decodeJsonBody(VaultKeyStoreBodySchema, payload);
  if (!body) {
    return invalidRequest();
  }

  const ciphertext = yield* encryption.encrypt(body.key);
  const store = yield* VaultKeyStore;
  yield* store.storeKey(userId, body.providerId, ciphertext);

  return yield* jsonResponseEffect(HOSTED_HTTP_STATUS.OK, { stored: true as const });
});

export const handleVaultKeysList = Effect.fn("handleVaultKeysList")(function* (request: Request) {
  if (request.method !== "GET") {
    return methodNotAllowed();
  }

  const encryption = yield* HostedEncryption;
  const secretResult = trimmedSecretOrUnavailable(encryption.secret);
  if (secretResult instanceof Response) return secretResult;

  const auth = yield* HostedAuth;
  const userId = yield* auth.resolveUserId(request);
  if (!userId) {
    return unauthorized();
  }

  const list = yield* VaultKeyList;
  const rows = yield* list.listKeys(userId);

  return yield* jsonResponseEffect(HOSTED_HTTP_STATUS.OK, {
    keys: rows.map((row) => ({
      providerId: row.providerId,
      updatedAt: row.updatedAt.getTime(),
    })),
  });
});

export const handleVaultKeyDelete = Effect.fn("handleVaultKeyDelete")(function* (request: Request) {
  if (request.method !== "DELETE") {
    return methodNotAllowed();
  }

  const encryption = yield* HostedEncryption;
  const secretResult = trimmedSecretOrUnavailable(encryption.secret);
  if (secretResult instanceof Response) return secretResult;

  const auth = yield* HostedAuth;
  const userId = yield* auth.resolveUserId(request);
  if (!userId) {
    return unauthorized();
  }

  const payload = yield* readJsonBody(request);
  const body =
    payload === undefined ? undefined : decodeJsonBody(VaultKeyDeleteBodySchema, payload);
  if (!body) {
    return invalidRequest();
  }

  const deleter = yield* VaultKeyDelete;
  const deleted = yield* deleter.deleteKey(userId, body.providerId);

  return yield* jsonResponseEffect(HOSTED_HTTP_STATUS.OK, { deleted });
});

/** @deprecated Tests use hosted-runner shims. */
export interface VaultKeyStoreOptions {
  request: Request;
  resolveUserId: (request: Request) => Promise<string | undefined>;
  encryptionSecret: string | undefined;
  storeKey: (userId: string, providerId: string, ciphertext: string) => Promise<void>;
}

/** @deprecated Tests use hosted-runner shims. */
export interface VaultKeysListOptions {
  request: Request;
  resolveUserId: (request: Request) => Promise<string | undefined>;
  encryptionSecret: string | undefined;
  listKeys: (userId: string) => Promise<VaultKeyEntry[]>;
}

/** @deprecated Tests use hosted-runner shims. */
export interface VaultKeyDeleteOptions {
  request: Request;
  resolveUserId: (request: Request) => Promise<string | undefined>;
  encryptionSecret: string | undefined;
  deleteKey: (userId: string, providerId: string) => Promise<boolean>;
}
