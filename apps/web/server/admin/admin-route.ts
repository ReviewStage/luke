import type { AdminSeams } from "../admin-app.js";
import { auth } from "../auth.js";
import { HOSTED_OPENAI_ENVIRONMENT } from "../hosted/openai.js";
import { POSTHOG_ENVIRONMENT, posthogProjectConsoleUrl } from "../hosted/posthog.js";
import { runWeb } from "../runtime.js";
import type { AdminViewer } from "./admin-access.js";
import { buildAdminDayDetail } from "./admin-day.js";
import { adminIntegrations, buildAdminMetrics } from "./admin-metrics.js";
import {
  readAdminDaySource,
  readAdminMetricsSource,
  readAdminUserSource,
  readAdminUsersSource,
  writeAdminFavorite,
} from "./admin-queries.js";
import { buildAdminUserDetail } from "./admin-user.js";
import { buildAdminUserList } from "./admin-users.js";

/**
 * The deployment's real seams behind the dashboard's group: the browser
 * session the gate reads, this database, and which integrations the
 * environment has keys for. No secret value crosses into an answer — only
 * whether each key is present, and the analytics project id, which names
 * which console to open.
 */

/** An environment value counts as configured only when it holds a non-blank string. */
function configured(name: string): boolean {
  return (process.env[name] ?? "").trim().length > 0;
}

/**
 * The browser session an admin request rides in on — the maintainer's own
 * sign-in on this site, carrying that account's `role`, never the desktop's
 * bearer token. A getSession failure must propagate: the gate turns a thrown
 * viewer seam into a 503, where swallowing it here would misreport an auth
 * outage as a signed-out 401 and offer a sign-in that cannot succeed.
 */
async function resolveSessionViewer(request: Request): Promise<AdminViewer | undefined> {
  const authenticated = await auth.api.getSession({ headers: request.headers });
  const account = authenticated?.user;
  if (!account) return undefined;
  return { userId: account.id, role: account.role };
}

export function hostedAdminSeams(): AdminSeams {
  const integrations = adminIntegrations({
    hostedTier: configured(HOSTED_OPENAI_ENVIRONMENT.API_KEY),
    analyticsRecording: configured(POSTHOG_ENVIRONMENT.PROJECT_API_KEY),
    analyticsErasure:
      configured(POSTHOG_ENVIRONMENT.PERSONAL_API_KEY) &&
      configured(POSTHOG_ENVIRONMENT.PROJECT_ID),
    googleSignIn: configured("GOOGLE_CLIENT_ID") && configured("GOOGLE_CLIENT_SECRET"),
    githubSignIn: configured("GITHUB_CLIENT_ID") && configured("GITHUB_CLIENT_SECRET"),
  });

  // The project id names which console to open, never a secret; the key
  // presence booleans above are still the only thing said about the keys.
  const projectId = (process.env[POSTHOG_ENVIRONMENT.PROJECT_ID] ?? "").trim();
  const analyticsConsoleUrl = projectId
    ? posthogProjectConsoleUrl(projectId, process.env[POSTHOG_ENVIRONMENT.API_HOST])
    : undefined;

  return {
    resolveViewer: resolveSessionViewer,
    readMetrics: async (now, scope, windowDays) =>
      buildAdminMetrics(
        await runWeb(
          readAdminMetricsSource({
            now,
            integrations,
            analyticsConsoleUrl,
            scope,
            windowDays,
          }),
        ),
        now,
        windowDays,
      ),
    readUsers: async (now, scope, viewerId, windowDays, search) =>
      buildAdminUserList(
        await runWeb(readAdminUsersSource({ now, scope, search, viewerId, windowDays })),
        now,
        windowDays,
        search,
      ),
    readUser: async (userId, now, windowDays) => {
      const source = await runWeb(readAdminUserSource({ userId, now, windowDays }));
      return source && buildAdminUserDetail(source, now, windowDays);
    },
    readDay: async (day, now, scope) =>
      buildAdminDayDetail(await runWeb(readAdminDaySource({ day, scope })), now, day),
    writeFavorite: (adminId, userId, favorite) =>
      runWeb(writeAdminFavorite({ adminId, userId, favorite })),
  };
}
