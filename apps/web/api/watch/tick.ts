import { and, eq, notInArray, or, sql } from "drizzle-orm";
import type { UnparsedWireValue } from "../../server/core.js";
import { getDatabase } from "../../server/db/index.js";
import { deviceToken, providerKey, watchMemory } from "../../server/db/schema.js";
import { ApnsSender, apnsCredentialsFromEnvironment } from "../../server/hosted/apns.js";
import { VAULT_ENCRYPTION_ENVIRONMENT } from "../../server/hosted/encryption.js";
import {
  cloudSessionsObserver,
  handleWatchTick,
  WATCH_ENVIRONMENT,
  type WatchTickOptions,
} from "../../server/hosted/watch.js";

/**
 * The scheduled watch's one entry, called by Vercel's cron on the cadence
 * `vercel.json` fixes. The logic lives in `server/hosted/watch.ts`; this file
 * hands it the deployment's real seams and the database queries behind them.
 */
export default {
  async fetch(request: Request): Promise<Response> {
    const database = getDatabase();
    const credentials = apnsCredentialsFromEnvironment(process.env);
    const sender = credentials ? new ApnsSender({ credentials }) : undefined;
    const encryptionSecret = process.env[VAULT_ENCRYPTION_ENVIRONMENT.SECRET]?.trim() || undefined;

    const readVaultKeys = (userId: string) =>
      database
        .select({ providerId: providerKey.providerId, ciphertext: providerKey.ciphertext })
        .from(providerKey)
        .where(eq(providerKey.userId, userId));

    const options: WatchTickOptions = {
      request,
      cronSecret: process.env[WATCH_ENVIRONMENT.CRON_SECRET],
      sender,
      encryptionSecret,
      listAccounts: async (limit) => {
        const rows = await database
          .select({ userId: deviceToken.userId, passedAt: watchMemory.passedAt })
          .from(deviceToken)
          .innerJoin(providerKey, eq(providerKey.userId, deviceToken.userId))
          .leftJoin(watchMemory, eq(watchMemory.userId, deviceToken.userId))
          .groupBy(deviceToken.userId, watchMemory.passedAt)
          .orderBy(sql`${watchMemory.passedAt} asc nulls first`)
          .limit(limit);
        return rows.map((row) => ({
          userId: row.userId,
          passedAt: row.passedAt?.getTime(),
        }));
      },
      forgetIneligible: async () => {
        await database
          .delete(watchMemory)
          .where(
            or(
              notInArray(
                watchMemory.userId,
                database.select({ userId: deviceToken.userId }).from(deviceToken),
              ),
              notInArray(
                watchMemory.userId,
                database.select({ userId: providerKey.userId }).from(providerKey),
              ),
            ),
          );
      },
      observeSessions: cloudSessionsObserver({
        readVaultKeys,
        encryptionSecret: encryptionSecret ?? "",
      }),
      readMemory: async (userId) => {
        const [row] = await database
          .select({ memory: watchMemory.memory })
          .from(watchMemory)
          .where(eq(watchMemory.userId, userId))
          .limit(1);
        // SAFETY: jsonb comes back as a runtime value; sessionNoticeMemoryFromWire validates it.
        return row?.memory as UnparsedWireValue;
      },
      writeMemory: async (userId, memory, passedAt) => {
        const row = { userId, memory, passedAt: new Date(passedAt) };
        await database
          .insert(watchMemory)
          .values(row)
          .onConflictDoUpdate({
            target: watchMemory.userId,
            set: { memory: row.memory, passedAt: row.passedAt },
          });
      },
      listDevices: (userId) =>
        database
          .select({ token: deviceToken.token, environment: deviceToken.environment })
          .from(deviceToken)
          .where(eq(deviceToken.userId, userId)),
      retireDevice: async (token) => {
        await database.delete(deviceToken).where(and(eq(deviceToken.token, token)));
      },
    };

    try {
      return await handleWatchTick(options);
    } finally {
      await sender?.close();
    }
  },
};
