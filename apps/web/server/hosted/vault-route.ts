import { Effect, Equal, type Option, type Redacted } from "effect";
import { auth } from "../auth.js";
import { unparsedWire, type WireBoundaryInput } from "../core.js";
import type { DevicesVaultSeams } from "../devices-vault-app.js";
import type { UserInfoEndpoint } from "./bearer.js";
import { hostedUserId, oauthUserInfoFromAuthAnswer, userIdForAuthorization } from "./bearer.js";
import { deviceSeams } from "./device-store.js";
import { payloadKeyRing } from "./encryption.js";
import { HostedEnvironment } from "./environment.js";
import type { UserIdResolver } from "./http-effect.js";
import { type HostedStore, hostedStore } from "./store/index.js";
import {
  deleteVaultKey,
  listVaultKeys,
  readStoredVaultKeys,
  readVaultKey,
  storeVaultKey,
  type VaultKeyEffect,
} from "./vault-key-store.js";

/**
 * The deployment's own seams, handed to a hosted route once instead of
 * rebuilt in each of its files. Every hosted endpoint resolves the same
 * bearer against the same account store, and the twelve that touch a stored
 * provider key read it out of the same table under the same secret; a copy of
 * that wiring per route file is a copy that can be wrong in one place. What
 * each endpoint does with the seams still lives in its own handler, and a
 * handler takes only the ones its endpoint needs.
 */

/** Stored vault key row as a route supplies it. */
export interface VaultKeyRow {
  providerId: string;
  ciphertext: string;
}

export interface HostedVaultRoute {
  request: Request;
  resolveUserId: UserIdResolver;
  /** PROVIDER_KEY_ENCRYPTION_SECRET, sealed; undefined means the env var is absent or blank. */
  encryptionSecret: Redacted.Redacted | undefined;
  /** Reads the encrypted key row for this user and provider, or undefined if none stored. */
  readKey: (
    userId: string,
    providerId: string,
  ) => VaultKeyEffect<{ ciphertext: string } | undefined>;
  /** Reads every vault key row the user has stored, for decryption in the handler. */
  readVaultKeys: (userId: string) => VaultKeyEffect<VaultKeyRow[]>;
  /** Lists what is stored — provider ids and timestamps, never ciphertext. */
  listKeys: (userId: string) => VaultKeyEffect<{ providerId: string; updatedAt: Date }[]>;
  storeKey: (userId: string, providerId: string, ciphertext: string) => VaultKeyEffect<void>;
  deleteKey: (userId: string, providerId: string) => VaultKeyEffect<boolean>;
  /** The hosted store under the deployment's payload key ring, for the routes that read or write it. */
  store: (secret: Redacted.Redacted) => HostedStore;
}

let storeUnderSecret: { secret: Redacted.Redacted; store: HostedStore } | undefined;

/** One store per process, rebuilt only if the secret it was built under changes; the secrets are compared sealed. */
function storeFor(secret: Redacted.Redacted): HostedStore {
  if (storeUnderSecret === undefined || !Equal.equals(storeUnderSecret.secret, secret)) {
    storeUnderSecret = {
      secret,
      store: hostedStore({ keys: payloadKeyRing(secret) }),
    };
  }
  return storeUnderSecret.store;
}

/**
 * The auth service's own userinfo endpoint, read at the hosted API boundary.
 * Every vault, device, or mint route resolves its bearer through this one,
 * whether it is built from the seams below or composed as an `HttpApp`.
 */
export const hostedVaultUserInfo: UserInfoEndpoint = (input) =>
  Effect.tryPromise(async () => {
    // SAFETY: Better Auth hands back its parsed userinfo answer as structured-clone data; the wire guards below validate the selected field.
    const answer = (await auth.api.oauth2UserInfo(input)) as WireBoundaryInput;
    return oauthUserInfoFromAuthAnswer(unparsedWire(answer));
  });

/**
 * The bearer resolved against the deployment's own account store, the same
 * for every hosted route that reads its seams on its own fiber. The auth
 * service's userinfo call is the one promise in it, wrapped once where
 * `hostedVaultUserInfo` is constructed, so the resolution itself is an effect
 * a route yields rather than a promise each route rewraps.
 */
export function resolveHostedUserId(request: Request): Effect.Effect<Option.Option<string>> {
  return hostedUserId(request, hostedVaultUserInfo);
}

/**
 * The provider key vault's own secret, read on the reader's own fiber: every
 * route here is already an effect on the edge's runtime, so it reads
 * `HostedEnvironment` directly rather than running one to get at it.
 */
export const hostedEncryptionSecretEffect: Effect.Effect<
  Redacted.Redacted | undefined,
  never,
  HostedEnvironment
> = Effect.map(HostedEnvironment, (environment) => environment.providerKeyEncryptionSecret);

/**
 * The same seams, read directly by every route built as an `HttpApi` group
 * rather than rebuilding the queries they close over. `encryptionSecret` is
 * not among them: it is read fresh from `HostedEnvironment` per request, by
 * the handlers that still spread this object as a promise-shaped route's
 * options, and by `server/actions-app.ts` and `server/rating-app.ts`, whose
 * handlers are effects and so read it on the group's own fiber.
 */
export const hostedVaultSeams = {
  resolveUserId: resolveHostedUserId,
  readKey: readVaultKey,
  readVaultKeys: readStoredVaultKeys,
  listKeys: listVaultKeys,
  storeKey: storeVaultKey,
  deleteKey: deleteVaultKey,
  store: storeFor,
} satisfies Omit<HostedVaultRoute, "request" | "encryptionSecret">;

/** The devices-and-vault group's real seams: the same account store `hostedVaultSeams` reads for the other, Effect-native hosted routes. */
export function productionDevicesVaultSeams(): DevicesVaultSeams {
  return {
    resolveUserId: (authorization) => userIdForAuthorization(authorization, hostedVaultUserInfo),
    storeKey: hostedVaultSeams.storeKey,
    listKeys: hostedVaultSeams.listKeys,
    deleteKey: hostedVaultSeams.deleteKey,
    ...deviceSeams(),
  };
}
