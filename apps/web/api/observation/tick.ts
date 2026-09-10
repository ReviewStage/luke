import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { CLOUD_AGENT_PROVIDER_ID } from "../../server/core.js";
import { getDatabase } from "../../server/db/index.js";
import { devices, observationPass, providerKey } from "../../server/db/schema.js";
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
 * one of its devices last registered or sent a heartbeat: the `devices` row's
 * `last_seen_at`, which every platform moves along while the app is open.
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
          .innerJoin(devices, eq(devices.userId, providerKey.userId))
          .leftJoin(observationPass, eq(observationPass.userId, providerKey.userId))
          .where(
            and(
              inArray(providerKey.providerId, CLOUD_PROVIDER_IDS),
              gte(devices.lastSeenAt, new Date(seenAfter)),
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
      purgeCleared: async (now) => (store ? store.retention.purgeCleared(new Date(now)) : 0),
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
