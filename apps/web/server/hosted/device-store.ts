import { and, eq, ne } from "drizzle-orm";
import { devices } from "../db/devices-schema.js";
import type { createDatabase } from "../db/index.js";
import type { DeviceSeams } from "./devices.js";

type DeviceDatabase = Pick<ReturnType<typeof createDatabase>, "transaction" | "delete">;

/**
 * The device seams over a database. A push token is unique across rows
 * because Apple issues one per installation: a reinstall that minted a fresh
 * installation id but kept its token takes the token off the old row in the
 * same transaction, so the row that can be addressed is always the one that
 * last said so. Every write is scoped to the account the bearer resolved to,
 * except that eviction, which is scoped to the token itself: the token now
 * belongs to whoever just presented it, whichever account held the old row.
 */
export function deviceSeams(database: DeviceDatabase): DeviceSeams {
  return {
    registerDevice: (userId, registration, mintId, now) =>
      database.transaction(async (transaction) => {
        if (registration.push) {
          await transaction
            .update(devices)
            .set({ pushToken: null, pushEnvironment: null, updatedAt: now })
            .where(
              and(
                eq(devices.pushToken, registration.push.token),
                ne(devices.installationId, registration.installationId),
              ),
            );
        }
        // A registration that arrived with no token leaves the one on file: the
        // phone holds its token in memory and re-registers on every launch
        // before Apple has handed the token back, and a registration is not a
        // statement that the device has none.
        const pushColumns = registration.push
          ? { pushToken: registration.push.token, pushEnvironment: registration.push.environment }
          : undefined;
        const [row] = await transaction
          .insert(devices)
          .values({
            id: mintId(),
            userId,
            installationId: registration.installationId,
            platform: registration.platform,
            lastSeenAt: now,
            activeUntil: null,
            pushToken: null,
            pushEnvironment: null,
            ...pushColumns,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: devices.installationId,
            set: {
              userId,
              platform: registration.platform,
              lastSeenAt: now,
              activeUntil: null,
              ...pushColumns,
              updatedAt: now,
            },
          })
          .returning({ deviceId: devices.id });
        if (!row) throw new Error("The device upsert returned no row.");
        return row;
      }),
    touchDevice: (userId, heartbeat, now) =>
      database.transaction(async (transaction) => {
        if (heartbeat.push) {
          await transaction
            .update(devices)
            .set({ pushToken: null, pushEnvironment: null, updatedAt: now })
            .where(
              and(eq(devices.pushToken, heartbeat.push.token), ne(devices.id, heartbeat.deviceId)),
            );
        }
        const result = await transaction
          .update(devices)
          .set({
            lastSeenAt: now,
            updatedAt: now,
            ...(heartbeat.activeUntil !== undefined
              ? { activeUntil: heartbeat.activeUntil }
              : undefined),
            ...(heartbeat.push === null ? { pushToken: null, pushEnvironment: null } : undefined),
            ...(heartbeat.push
              ? { pushToken: heartbeat.push.token, pushEnvironment: heartbeat.push.environment }
              : undefined),
          })
          .where(and(eq(devices.userId, userId), eq(devices.id, heartbeat.deviceId)))
          .returning({ deviceId: devices.id });
        return result.length > 0;
      }),
    forgetDevice: async (userId, deviceId) => {
      const result = await database
        .delete(devices)
        .where(and(eq(devices.userId, userId), eq(devices.id, deviceId)))
        .returning({ deviceId: devices.id });
      return result.length > 0;
    },
  };
}
