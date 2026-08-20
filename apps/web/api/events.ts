import { eq } from "drizzle-orm";
import { auth } from "../server/auth.js";
import { getDatabase } from "../server/db/index.js";
import { user } from "../server/db/schema.js";
import { hostedUserId } from "../server/hosted/bearer.js";
import { type EventsOptions, handleEvents } from "../server/hosted/events.js";
import { POSTHOG_ENVIRONMENT } from "../server/hosted/posthog.js";

/**
 * Records what the signed-in desktop counted about its own use. The logic
 * lives in `server/hosted/events.ts`; this file only hands it the deployment's
 * real seams — the project token the desktop never holds, and the same
 * in-process token resolution every other hosted endpoint trusts.
 */
export default {
  fetch(request: Request): Promise<Response> {
    const options: EventsOptions = {
      request,
      projectApiKey: process.env[POSTHOG_ENVIRONMENT.PROJECT_API_KEY],
      resolveUserId: (incoming) =>
        hostedUserId(incoming, (input) => auth.api.oauth2UserInfo(input)),
      // Read from the service's own user row rather than from the request, so
      // the desktop still sends nothing that names anybody.
      readPerson: async (userId) => {
        const rows = await getDatabase()
          .select({ name: user.name, email: user.email })
          .from(user)
          .where(eq(user.id, userId))
          .limit(1);
        return rows[0];
      },
    };
    const host = process.env[POSTHOG_ENVIRONMENT.HOST];
    if (host) options.host = host;
    return handleEvents(options);
  },
};
