import { waitUntil } from "@vercel/functions";
import { eq } from "drizzle-orm";
import { auth } from "../../auth.js";
import { getDatabase } from "../../db/index.js";
import { providerKey } from "../../db/schema.js";
import type { Route } from "../../route.js";
import { hostedUserId, oauthUserInfoFromAuthAnswer } from "../bearer.js";
import { payloadKeyRing, VAULT_ENCRYPTION_ENVIRONMENT } from "../encryption.js";
import { HOSTED_OPENAI_ENVIRONMENT } from "../openai.js";
import { spendHostedMeter } from "../quota.js";
import { type HostedStore, hostedStore } from "../store/index.js";
import { BRAIN_HOST_ENVIRONMENT } from "./bounds.js";
import { readWorkspaceDefaults } from "./defaults.js";
import type { HostedBrainRoute } from "./route.js";
import { type BrainWakeOptions, handleBrainWake } from "./wake.js";

/**
 * The deployment's real seams behind the brain-host routes, built once: the
 * bearer's account through the auth service's own userinfo, the stored keys
 * out of the vault table, the store under the payload key ring, Luke's own
 * OpenAI key and model, the daily meter, the account's saved creation
 * defaults, and Vercel's `waitUntil` for the run that finishes after the
 * answer. A route file hands its handler here and nothing else.
 */

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

const seams = {
  resolveUserId: (request: Request) =>
    hostedUserId(request, async (input) =>
      oauthUserInfoFromAuthAnswer(await auth.api.oauth2UserInfo(input)),
    ),
  encryptionSecret: process.env[VAULT_ENCRYPTION_ENVIRONMENT.SECRET],
  openAiKey: process.env[HOSTED_OPENAI_ENVIRONMENT.API_KEY],
  model: process.env[HOSTED_OPENAI_ENVIRONMENT.BRAIN_MODEL],
  readVaultKeys: (userId: string) =>
    getDatabase()
      .select({ providerId: providerKey.providerId, ciphertext: providerKey.ciphertext })
      .from(providerKey)
      .where(eq(providerKey.userId, userId)),
  store: storeFor,
  spend: (userId: string) => spendHostedMeter(getDatabase(), { userId, now: Date.now() }),
  workspaceDefaults: (userId: string) => readWorkspaceDefaults(getDatabase(), userId),
  continueAfterResponse: (work: Promise<void>) => {
    waitUntil(work);
  },
} satisfies Omit<HostedBrainRoute, "request">;

/** One brain-host route over the deployment's seams. */
export function hostedBrainHostRoute(
  handler: (route: HostedBrainRoute) => Promise<Response>,
): Route {
  return { fetch: (request) => handler({ ...seams, request }) };
}

/** The scheduled wake over the same seams, under the cron's own bearer. */
export const brainWakeRoute: Route = {
  fetch: (request) => {
    const options: BrainWakeOptions = {
      ...seams,
      request,
      cronSecret: process.env[BRAIN_HOST_ENVIRONMENT.CRON_SECRET],
    };
    return handleBrainWake(options);
  },
};
