import type { AdminViewer } from "../../server/admin/admin-access.js";
import {
  adminIntegrations,
  buildAdminMetrics,
  handleAdminMetrics,
} from "../../server/admin/admin-metrics.js";
import { readAdminMetricsSource } from "../../server/admin/admin-queries.js";
import { auth } from "../../server/auth.js";
import { getDatabase } from "../../server/db/index.js";
import { HOSTED_OPENAI_ENVIRONMENT } from "../../server/hosted/openai.js";
import { POSTHOG_ENVIRONMENT } from "../../server/hosted/posthog.js";

/** An environment value counts as configured only when it holds a non-blank string. */
function configured(name: string): boolean {
  return (process.env[name] ?? "").trim().length > 0;
}

/**
 * The admin dashboard's read. The logic lives behind seams in `server/admin/`;
 * this file hands it the deployment's real ones — the browser session the
 * maintainer signed in for, carrying that account's own `role`, and which
 * integrations the environment has keys for. The role is read from the session,
 * never asserted by the request, and no secret value crosses into the answer:
 * only whether each key is present.
 */
export default {
  fetch(request: Request): Promise<Response> {
    const resolveViewer = async (incoming: Request): Promise<AdminViewer | undefined> => {
      // A getSession failure must propagate: the handler turns a thrown viewer
      // seam into a 503, where swallowing it here would misreport an auth
      // outage as a signed-out 401 and offer a sign-in that cannot succeed.
      const authenticated = await auth.api.getSession({ headers: incoming.headers });
      const account = authenticated?.user;
      if (!account) return undefined;
      return { userId: account.id, role: account.role };
    };

    const integrations = adminIntegrations({
      hostedTier: configured(HOSTED_OPENAI_ENVIRONMENT.API_KEY),
      analyticsRecording: configured(POSTHOG_ENVIRONMENT.PROJECT_API_KEY),
      analyticsErasure:
        configured(POSTHOG_ENVIRONMENT.PERSONAL_API_KEY) &&
        configured(POSTHOG_ENVIRONMENT.PROJECT_ID),
      googleSignIn: configured("GOOGLE_CLIENT_ID") && configured("GOOGLE_CLIENT_SECRET"),
      githubSignIn: configured("GITHUB_CLIENT_ID") && configured("GITHUB_CLIENT_SECRET"),
      authSecret: configured("BETTER_AUTH_SECRET"),
    });

    return handleAdminMetrics({
      request,
      resolveViewer,
      readMetrics: async (now) =>
        buildAdminMetrics(await readAdminMetricsSource(getDatabase(), { now, integrations }), now),
    });
  },
};
