import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { CLOUD_AGENT_PROVIDER_ID } from "../../server/core.js";
import { getDatabase } from "../../server/db/index.js";
import { oauthAccessToken, observationPass, providerKey } from "../../server/db/schema.js";
import { payloadKeyRing, VAULT_ENCRYPTION_ENVIRONMENT } from "../../server/hosted/encryption.js";
import { observeAndSnapshot } from "../../server/hosted/observation-pass.js";
import {
  handleObservationTick,
  OBSERVATION_ENVIRONMENT,
  type ObservationTickOptions,
} from "../../server/hosted/observation-tick.js";
import { hostedStore } from "../../server/hosted/store/index.js";
import type { Route } from "../../server/route.js";

const CLOUD_PROVIDER_IDS = Object.values(CLOUD_AGENT_PROVIDER_ID);

/**
 * The scheduled observation's one entry, called by Vercel's cron on the
 * cadence `vercel.json` fixes. The logic lives in
 * `server/hosted/observation-tick.ts`; this file hands it the deployment's
 * real seams and the database queries behind them. An account was seen when
 * a hosted bearer was minted for it: every desktop and phone token is a row
 * of the OAuth access tokens, and a refresh mints another, so the latest
 * one's creation is the most recent sign of the account in use this schema
 * records.
 */
const route: Route = {
  async fetch(request) {
    const database = getDatabase();
    const encryptionSecret = process.env[VAULT_ENCRYPTION_ENVIRONMENT.SECRET]?.trim() || undefined;
    const store = encryptionSecret
      ? hostedStore({ db: database, keys: payloadKeyRing(encryptionSecret) })
      : undefined;

    const options: ObservationTickOptions = {
      request,
      cronSecret: process.env[OBSERVATION_ENVIRONMENT.CRON_SECRET],
      encryptionSecret,
      listAccounts: async (limit, seenAfter) => {
        const rows = await database
          .select({ userId: providerKey.userId })
          .from(providerKey)
          .innerJoin(oauthAccessToken, eq(oauthAccessToken.userId, providerKey.userId))
          .leftJoin(observationPass, eq(observationPass.userId, providerKey.userId))
          .where(
            and(
              inArray(providerKey.providerId, CLOUD_PROVIDER_IDS),
              gte(oauthAccessToken.createdAt, new Date(seenAfter)),
            ),
          )
          .groupBy(providerKey.userId, observationPass.attemptedAt)
          .orderBy(sql`${observationPass.attemptedAt} asc nulls first`)
          .limit(limit);
        return rows.map((row) => ({ userId: row.userId }));
      },
      forgetIneligible: async (seenAfter) => {
        await store?.roster.forgetIneligible({ providerIds: CLOUD_PROVIDER_IDS, seenAfter });
      },
      observe: async (userId) => {
        if (!store || !encryptionSecret) return { complete: false, changed: false };
        const rows = await database
          .select({ providerId: providerKey.providerId, ciphertext: providerKey.ciphertext })
          .from(providerKey)
          .where(eq(providerKey.userId, userId));
        const outcome = await observeAndSnapshot({
          userId,
          rows,
          secret: encryptionSecret,
          store,
          seams: {},
          now: Date.now(),
        });
        return { complete: outcome.complete, changed: outcome.changed };
      },
    };

    return handleObservationTick(options);
  },
};

export default route;
