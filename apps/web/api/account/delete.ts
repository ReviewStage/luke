import { eq } from "drizzle-orm";
import { auth } from "../../server/auth.js";
import { getDatabase } from "../../server/db/index.js";
import { user } from "../../server/db/schema.js";
import {
  type AccountDeleteOptions,
  handleAccountDelete,
} from "../../server/hosted/account-delete.js";
import { hostedUserId, oauthUserInfoFromAuthAnswer } from "../../server/hosted/bearer.js";
import {
  forgetPosthogPerson,
  POSTHOG_ENVIRONMENT,
  type PosthogForgetOptions,
} from "../../server/hosted/posthog.js";

/**
 * Erases the signed-in desktop's account. The logic lives in
 * `server/hosted/account-delete.ts`; this file only hands it the deployment's
 * real seams. Deleting the user row is the whole act — sessions, provider
 * accounts, OAuth grants, and usage counters all cascade with it. A
 * deployment configured to record product analytics also asks the processor to
 * erase the person; one that is not simply has no such seam to run.
 */
export default {
  fetch(request: Request): Promise<Response> {
    const options: AccountDeleteOptions = {
      request,
      resolveUserId: (incoming) =>
        hostedUserId(incoming, async (input) =>
          oauthUserInfoFromAuthAnswer(await auth.api.oauth2UserInfo(input)),
        ),
      deleteUser: async (userId) => {
        await getDatabase().delete(user).where(eq(user.id, userId));
      },
    };
    // Without both halves of the analytics configuration there is no person to
    // erase and nothing to erase it with, so the seam is simply absent.
    const personalApiKey = process.env[POSTHOG_ENVIRONMENT.PERSONAL_API_KEY];
    const projectId = process.env[POSTHOG_ENVIRONMENT.PROJECT_ID];
    if (personalApiKey && projectId) {
      const host = process.env[POSTHOG_ENVIRONMENT.API_HOST];
      options.forgetAnalytics = (userId: string) => {
        const forget: PosthogForgetOptions = { personalApiKey, projectId };
        if (host) forget.host = host;
        return forgetPosthogPerson(userId, forget);
      };
    }
    return handleAccountDelete(options);
  },
};
