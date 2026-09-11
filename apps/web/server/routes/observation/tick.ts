import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { CLOUD_AGENT_PROVIDER_ID } from "../../core.js";
import { getDatabase } from "../../db/index.js";
import { devices, observationPass, providerKey } from "../../db/schema.js";
import { CATALOG_TOOL_SET } from "../../hosted/brain-tool-set.js";
import { payloadKeyRing, VAULT_ENCRYPTION_ENVIRONMENT } from "../../hosted/encryption.js";
import { observeAndSnapshot } from "../../hosted/observation-pass.js";
import {
  handleObservationTick,
  OBSERVATION_ENVIRONMENT,
  type ObservationTickOptions,
} from "../../hosted/observation-tick.js";
import {
  hostedStore,
  type SpeechSweepOutcome,
  storeWriter,
  sweepSpeech,
} from "../../hosted/store/index.js";
import type { Route } from "../../route.js";

const CLOUD_PROVIDER_IDS = Object.values(CLOUD_AGENT_PROVIDER_ID);

const NOTHING_SWEPT: SpeechSweepOutcome = { held: 0, released: 0, expired: 0, turns: 0 };

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
      sweepSpeech: async (now) => {
        if (!store) return NOTHING_SWEPT;
        const writer = await storeWriter({ db: database, tools: CATALOG_TOOL_SET });
        return sweepSpeech({ db: database, writer }, { now });
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
