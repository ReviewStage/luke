import { eq } from "drizzle-orm";
import { auth } from "../../server/auth.js";
import { getDatabase } from "../../server/db/index.js";
import { user } from "../../server/db/schema.js";
import { handleAccountDelete } from "../../server/hosted/account-delete.js";
import { hostedUserId, oauthUserInfoFromAuthAnswer } from "../../server/hosted/bearer.js";

/**
 * Erases the signed-in desktop's account. The logic lives in
 * `server/hosted/account-delete.ts`; this file only hands it the deployment's
 * real seams. Deleting the user row is the whole act — sessions, provider
 * accounts, OAuth grants, and usage counters all cascade with it.
 */
export default {
  fetch(request: Request): Promise<Response> {
    return handleAccountDelete({
      request,
      resolveUserId: (incoming) =>
        hostedUserId(incoming, async (input) =>
          oauthUserInfoFromAuthAnswer(await auth.api.oauth2UserInfo(input)),
        ),
      deleteUser: async (userId) => {
        await getDatabase().delete(user).where(eq(user.id, userId));
      },
    });
  },
};
