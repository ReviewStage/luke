import { type Cause, Effect } from "effect";
import type { AdminSeams } from "../admin-app.js";
import { auth } from "../auth.js";
import { HOSTED_OPENAI_ENVIRONMENT } from "../hosted/openai.js";
import { POSTHOG_ENVIRONMENT, posthogProjectConsoleUrl } from "../hosted/posthog.js";
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
 * bearer token. Better Auth's `getSession` is a promise of somebody else's,
 * so it is wrapped once here, where the seam is built, and the gate yields
 * the effect on the request's own fiber. A getSession failure must propagate:
 * the gate turns a refused viewer seam into a 503, where swallowing it here
 * would misreport an auth outage as a signed-out 401 and offer a sign-in that
 * cannot succeed.
 */
function resolveSessionViewer(
  request: Request,
): Effect.Effect<AdminViewer | undefined, Cause.UnknownException> {
  return Effect.tryPromise(async () => {
    const authenticated = await auth.api.getSession({ headers: request.headers });
    const account = authenticated?.user;
    if (!account) return undefined;
    return { userId: account.id, role: account.role };
  });
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
    readMetrics: (now, scope, windowDays) =>
      Effect.map(
        readAdminMetricsSource({ now, integrations, analyticsConsoleUrl, scope, windowDays }),
        (source) => buildAdminMetrics(source, now, windowDays),
      ),
    readUsers: (now, scope, viewerId, windowDays, search) =>
      Effect.map(readAdminUsersSource({ now, scope, search, viewerId, windowDays }), (source) =>
        buildAdminUserList(source, now, windowDays, search),
      ),
    readUser: (userId, now, windowDays) =>
      Effect.map(
        readAdminUserSource({ userId, now, windowDays }),
        (source) => source && buildAdminUserDetail(source, now, windowDays),
      ),
    readDay: (day, now, scope) =>
      Effect.map(readAdminDaySource({ day, scope }), (source) =>
        buildAdminDayDetail(source, now, day),
      ),
    writeFavorite: (adminId, userId, favorite) => writeAdminFavorite({ adminId, userId, favorite }),
  };
}
