import { and, eq } from "drizzle-orm";
import { getDatabase } from "../../server/db/index.js";
import { deviceToken } from "../../server/db/schema.js";
import { handleDeviceTokenDelete, handleDeviceTokenStore } from "../../server/hosted/devices.js";
import { hostedVaultRoute } from "../../server/hosted/vault-route.js";

/**
 * Registers the signed-in phone's push token, and forgets it at sign-out.
 * The logic lives in `server/hosted/devices.ts`; this file only hands it the
 * deployment's real writes.
 */
export default hostedVaultRoute(async (route) => {
  if (route.request.method === "DELETE") {
    return handleDeviceTokenDelete({
      ...route,
      deleteToken: async (userId, token) => {
        const result = await getDatabase()
          .delete(deviceToken)
          .where(and(eq(deviceToken.userId, userId), eq(deviceToken.token, token)))
          .returning({ token: deviceToken.token });
        return result.length > 0;
      },
    });
  }

  return handleDeviceTokenStore({
    ...route,
    storeToken: async (userId, registration) => {
      const now = new Date();
      await getDatabase()
        .insert(deviceToken)
        .values({ ...registration, userId, updatedAt: now })
        .onConflictDoUpdate({
          target: deviceToken.token,
          set: {
            userId,
            platform: registration.platform,
            environment: registration.environment,
            updatedAt: now,
          },
        });
    },
  });
});
