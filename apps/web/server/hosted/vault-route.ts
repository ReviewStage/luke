import type { SqlClient } from "@effect/sql";
import type { SqlError } from "@effect/sql/SqlError";
import { Effect, type ParseResult, Redacted } from "effect";
import { auth } from "../auth.js";
import { unparsedWire, type WireBoundaryInput } from "../core.js";
import type { DevicesVaultSeams } from "../devices-vault-app.js";
import { runWeb } from "../runtime.js";
import type { UserInfoEndpoint } from "./bearer.js";
import { hostedUserId, oauthUserInfoFromAuthAnswer, userIdForAuthorization } from "./bearer.js";
import { deviceSeams } from "./device-store.js";
import { payloadKeyRing } from "./encryption.js";
import { HostedEnvironment } from "./environment.js";
import { type HostedStore, hostedStore } from "./store/index.js";
import {
  deleteVaultKey,
  listVaultKeys,
  readStoredVaultKeys,
  readVaultKey,
  storeVaultKey,
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
  resolveUserId: (request: Request) => Effect.Effect<string | undefined>;
  /** The value of PROVIDER_KEY_ENCRYPTION_SECRET; undefined means the env var is absent. */
  encryptionSecret: string | undefined;
  /** Reads the encrypted key row for this user and provider, or undefined if none stored. */
  readKey: (
    userId: string,
    providerId: string,
  ) => Effect.Effect<
    { ciphertext: string } | undefined,
    SqlError | ParseResult.ParseError,
    SqlClient.SqlClient
  >;
  /** Reads every vault key row the user has stored, for decryption in the handler. */
  readVaultKeys: (userId: string) => Promise<VaultKeyRow[]>;
  /** Lists what is stored — provider ids and timestamps, never ciphertext. */
  listKeys: (userId: string) => Promise<{ providerId: string; updatedAt: Date }[]>;
  storeKey: (userId: string, providerId: string, ciphertext: string) => Promise<void>;
  deleteKey: (userId: string, providerId: string) => Promise<boolean>;
  /** The hosted store under the deployment's payload key ring, for the routes that read or write it. */
  store: (secret: string) => HostedStore;
}

let storeUnderSecret: { secret: string; store: HostedStore } | undefined;

/** One store per process, rebuilt only if the secret it was built under changes. */
function storeFor(secret: string): HostedStore {
  if (storeUnderSecret?.secret !== secret) {
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
export const hostedVaultUserInfo: UserInfoEndpoint = async (input) => {
  // SAFETY: Better Auth hands back its parsed userinfo answer as structured-clone data; the wire guards below validate the selected field.
  const answer = (await auth.api.oauth2UserInfo(input)) as WireBoundaryInput;
  return oauthUserInfoFromAuthAnswer(unparsedWire(answer));
};

/**
 * The bearer resolved against the deployment's own account store, the same
 * for every hosted route that reads its seams on its own fiber. `hostedUserId`
 * still answers a promise, since the auth service's userinfo call and the
 * request its `HostedStoreRoute`-shaped callers wrap it in both stay
 * promise-shaped; here, where the one Effect-native seam this deployment
 * carries needs the same bearer, that promise is the effect's own
 * construction, wrapped once with `Effect.tryPromise` rather than rewrapped
 * with `Effect.promise` at every route that reads it.
 */
export function resolveHostedUserId(request: Request): Effect.Effect<string | undefined> {
  return Effect.tryPromise(() => hostedUserId(request, hostedVaultUserInfo)).pipe(
    Effect.orElseSucceed(() => undefined),
  );
}

/** The provider key vault's own secret, read once with the deployment's services rather than at each invocation. */
export async function hostedEncryptionSecret(): Promise<string | undefined> {
  return runWeb(hostedEncryptionSecretEffect);
}

/**
 * The same secret, read on a handler's own fiber rather than through
 * `runWeb`: a handler that is already an effect on the edge's runtime reads
 * `HostedEnvironment` directly instead of running one to get at it.
 */
export const hostedEncryptionSecretEffect: Effect.Effect<
  string | undefined,
  never,
  HostedEnvironment
> = Effect.map(HostedEnvironment, (environment) =>
  environment.providerKeyEncryptionSecret === undefined
    ? undefined
    : Redacted.value(environment.providerKeyEncryptionSecret),
);

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
  readVaultKeys: (userId: string) => runWeb(readStoredVaultKeys(userId)),
  listKeys: (userId: string) => runWeb(listVaultKeys(userId)),
  storeKey: (userId: string, providerId: string, ciphertext: string) =>
    runWeb(storeVaultKey(userId, providerId, ciphertext)),
  deleteKey: (userId: string, providerId: string) => runWeb(deleteVaultKey(userId, providerId)),
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
