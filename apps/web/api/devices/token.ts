import { and, eq } from "drizzle-orm";
import { auth } from "../../server/auth.js";
import { getDatabase } from "../../server/db/index.js";
import { deviceToken } from "../../server/db/schema.js";
import { hostedUserId, oauthUserInfoFromAuthAnswer } from "../../server/hosted/bearer.js";
import {
  type DeviceTokenDeleteOptions,
  type DeviceTokenStoreOptions,
  handleDeviceTokenDelete,
  handleDeviceTokenStore,
} from "../../server/hosted/devices.js";

function resolveUserId(request: Request) {
  return hostedUserId(request, async (input) =>
    oauthUserInfoFromAuthAnswer(await auth.api.oauth2UserInfo(input)),
  );
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "DELETE") {
      const options: DeviceTokenDeleteOptions = {
        request,
        resolveUserId,
        deleteToken: async (userId, token) => {
          const result = await getDatabase()
            .delete(deviceToken)
            .where(and(eq(deviceToken.userId, userId), eq(deviceToken.token, token)))
            .returning({ token: deviceToken.token });
          return result.length > 0;
        },
      };
      return handleDeviceTokenDelete(options);
    }

    const options: DeviceTokenStoreOptions = {
      request,
      resolveUserId,
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
    };
    return handleDeviceTokenStore(options);
  },
};
