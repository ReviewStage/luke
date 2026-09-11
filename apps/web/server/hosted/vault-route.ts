import { and, eq } from "drizzle-orm";
import { auth } from "../auth.js";
import { getDatabase } from "../db/index.js";
import { providerKey } from "../db/schema.js";
import type { Route } from "../route.js";
import { hostedUserId, oauthUserInfoFromAuthAnswer } from "./bearer.js";
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
      store: hostedStore({ db: getDatabase(), keys: payloadKeyRing(secret) }),
    };
  }
  return storeUnderSecret.store;
}

/** The bearer resolved against the deployment's own account store, the same for every hosted route. */
export function resolveHostedUserId(request: Request): Promise<string | undefined> {
  return hostedUserId(request, async (input) =>
    oauthUserInfoFromAuthAnswer(await auth.api.oauth2UserInfo(input)),
  );
}

const seams = {
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
  return { fetch: (request) => handler({ ...seams, request }) };
}
