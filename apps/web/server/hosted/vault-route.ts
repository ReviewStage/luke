import { and, eq } from "drizzle-orm";
import { auth } from "../auth.js";
import { unparsedWire, type WireBoundaryInput } from "../core.js";
import { getDatabase } from "../db/index.js";
import { providerKey } from "../db/schema.js";
import type { DevicesVaultSeams } from "../devices-vault-app.js";
import type { Route } from "../route.js";
import { runWeb } from "../runtime.js";
import type { UserInfoEndpoint } from "./bearer.js";
import { hostedUserId, oauthUserInfoFromAuthAnswer, userIdForAuthorization } from "./bearer.js";
import { deviceSeams } from "./device-store.js";
import { payloadKeyRing, VAULT_ENCRYPTION_ENVIRONMENT } from "./encryption.js";
import { type HostedStore, hostedStore } from "./store/index.js";

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
  resolveUserId: (request: Request) => Promise<string | undefined>;
  /** The value of PROVIDER_KEY_ENCRYPTION_SECRET; undefined means the env var is absent. */
  encryptionSecret: string | undefined;
  /** Reads the encrypted key row for this user and provider, or undefined if none stored. */
  readKey: (userId: string, providerId: string) => Promise<{ ciphertext: string } | undefined>;
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
      store: hostedStore({ db: getDatabase(), keys: payloadKeyRing(secret), run: runWeb }),
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

/** The bearer resolved against the deployment's own account store, the same for every hosted route. */
export function resolveHostedUserId(request: Request): Promise<string | undefined> {
  return hostedUserId(request, hostedVaultUserInfo);
}

/**
 * The same seams, exported for a route built as an `HttpApi` group instead of
 * through `hostedVaultRoute` below: the group reads them directly rather than
 * rebuilding the queries they close over.
 */
export const hostedVaultSeams = {
  resolveUserId: resolveHostedUserId,
  encryptionSecret: process.env[VAULT_ENCRYPTION_ENVIRONMENT.SECRET],
  readKey: async (userId: string, providerId: string) => {
    const rows = await getDatabase()
      .select({ ciphertext: providerKey.ciphertext })
      .from(providerKey)
      .where(and(eq(providerKey.userId, userId), eq(providerKey.providerId, providerId)))
      .limit(1);
    return rows[0];
  },
  readVaultKeys: (userId: string) =>
    getDatabase()
      .select({ providerId: providerKey.providerId, ciphertext: providerKey.ciphertext })
      .from(providerKey)
      .where(eq(providerKey.userId, userId)),
  listKeys: (userId: string) =>
    getDatabase()
      .select({ providerId: providerKey.providerId, updatedAt: providerKey.updatedAt })
      .from(providerKey)
      .where(eq(providerKey.userId, userId)),
  storeKey: async (userId: string, providerId: string, ciphertext: string) => {
    await getDatabase()
      .insert(providerKey)
      .values({ userId, providerId, ciphertext, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [providerKey.userId, providerKey.providerId],
        set: { ciphertext, updatedAt: new Date() },
      });
  },
  deleteKey: async (userId: string, providerId: string) => {
    const result = await getDatabase()
      .delete(providerKey)
      .where(and(eq(providerKey.userId, userId), eq(providerKey.providerId, providerId)))
      .returning({ userId: providerKey.userId });
    return result.length > 0;
  },
  store: storeFor,
} satisfies Omit<HostedVaultRoute, "request">;

/**
 * One hosted route over the deployment's seams. The handler is what the
 * endpoint is; everything above it is the same for all of them.
 */
export function hostedVaultRoute(handler: (route: HostedVaultRoute) => Promise<Response>): Route {
  return { fetch: (request) => handler({ ...hostedVaultSeams, request }) };
}

/** The devices-and-vault group's real seams: the same account store the `hostedVaultRoute` seams other, still-promise-shaped hosted routes read. */
export function productionDevicesVaultSeams(): DevicesVaultSeams {
  return {
    resolveUserId: (authorization) => userIdForAuthorization(authorization, hostedVaultUserInfo),
    storeKey: hostedVaultSeams.storeKey,
    listKeys: hostedVaultSeams.listKeys,
    deleteKey: hostedVaultSeams.deleteKey,
    ...deviceSeams(getDatabase()),
  };
}
