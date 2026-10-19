import { PROVIDER_KEY_ENCRYPTION_ENVIRONMENT } from "@luke/database/models/provider-key-seal";
import { INTEGRATION_PROVIDER_LIST } from "@luke/features/integration-wire";
import { type Cause, Effect } from "effect";
import { auth } from "../auth/auth.js";
import {
  AUTH_SECRET_ENVIRONMENT,
  authSecrets,
  GITHUB_APP_ENVIRONMENT,
  socialClientConfigured,
} from "../auth/auth-deployment.js";
import { WORKSPACE_LINEAR_CONNECTOR_VARIABLE } from "../integrations/integration-connect.js";
import { INTEGRATION, type IntegrationDefinition } from "../integrations/integrations.js";
import { CRON_ENVIRONMENT } from "../maintenance/maintenance-bounds.js";
import { SENTRY_ENVIRONMENT } from "../observability/sentry.js";
import { HOSTED_ANTHROPIC_ENVIRONMENT } from "../providers/anthropic.js";
import { HOSTED_OPENAI_ENVIRONMENT } from "../providers/openai.js";
import { POSTHOG_ENVIRONMENT, posthogProjectConsoleUrl } from "../providers/posthog.js";
import type { AdminViewer } from "./admin-access.js";
import { readAdminAccountSource } from "./admin-account-queries.js";
import type { AdminSeams } from "./admin-app.js";
import { readAdminCost } from "./admin-cost-queries.js";
import { buildAdminDayDetail } from "./admin-day.js";
import { adminIntegrations } from "./admin-health.js";
import { buildAdminMetrics } from "./admin-metrics.js";
import {
  readAdminDaySource,
  readAdminMetricsSource,
  readAdminUserSource,
  readAdminUsersSource,
  writeAdminFavorite,
} from "./admin-queries.js";
import { buildAdminReliability } from "./admin-reliability.js";
import { readAdminReliabilitySource } from "./admin-reliability-queries.js";
import { buildAdminUserDetail } from "./admin-user.js";
import { buildAdminUserList } from "./admin-users.js";
import { buildAdminWorkspaceList } from "./admin-workspaces.js";
import { readAdminWorkspacesSource } from "./admin-workspaces-queries.js";

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
 * The call avatar's Keyframe pair, named here as well as where the voice
 * function reads it (`apps/web/server/voice/function.ts`), since a package
 * cannot import from an app.
 */
const AVATAR_ENVIRONMENT = {
  KEYFRAME_API_KEY: "KEYFRAME_API_KEY",
  KEYFRAME_PERSONA_ID: "LUKE_KEYFRAME_PERSONA_ID",
} as const;

/** Each account integration Vercel Connect grants, by whether its connector UID is set; one granted by the account's own sign-in has none. */
function connectorPresence(): Map<(typeof INTEGRATION_PROVIDER_LIST)[number], boolean> {
  const present = new Map<(typeof INTEGRATION_PROVIDER_LIST)[number], boolean>();
  for (const provider of INTEGRATION_PROVIDER_LIST) {
    const { CONNECTOR_VARIABLE }: IntegrationDefinition = INTEGRATION[provider];
    if (CONNECTOR_VARIABLE !== undefined) present.set(provider, configured(CONNECTOR_VARIABLE));
  }
  return present;
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
): Effect.Effect<AdminViewer | undefined, Cause.UnknownError> {
  return Effect.tryPromise(async () => {
    const authenticated = await auth.api.getSession({ headers: request.headers });
    const account = authenticated?.user;
    if (!account) return undefined;
    return { userId: account.id, role: account.role };
  });
}

export function hostedAdminSeams(): AdminSeams {
  // The sign-in clients are read as the auth service reads them, so the
  // dashboard reports the pair a GitHub sign-in would run on.
  const socialClients = authSecrets(process.env);
  const integrations = adminIntegrations({
    hostedTier: configured(HOSTED_OPENAI_ENVIRONMENT.API_KEY),
    codingAgents: configured(HOSTED_ANTHROPIC_ENVIRONMENT.API_KEY),
    // Every variable `github/github-app.ts` builds the App from, and its webhook secret.
    githubApp: [
      GITHUB_APP_ENVIRONMENT.APP_ID,
      GITHUB_APP_ENVIRONMENT.SLUG,
      GITHUB_APP_ENVIRONMENT.CLIENT_ID,
      GITHUB_APP_ENVIRONMENT.CLIENT_SECRET,
      GITHUB_APP_ENVIRONMENT.PRIVATE_KEY,
      AUTH_SECRET_ENVIRONMENT.SESSION_SECRET,
      GITHUB_APP_ENVIRONMENT.WEBHOOK_SECRET,
    ].every(configured),
    githubSignIn: socialClientConfigured(socialClients.github),
    googleSignIn: socialClientConfigured(socialClients.google),
    callAvatar:
      configured(AVATAR_ENVIRONMENT.KEYFRAME_API_KEY) &&
      configured(AVATAR_ENVIRONMENT.KEYFRAME_PERSONA_ID),
    errorReporting: configured(SENTRY_ENVIRONMENT.DSN),
    analyticsRecording: configured(POSTHOG_ENVIRONMENT.PROJECT_API_KEY),
    analyticsErasure:
      configured(POSTHOG_ENVIRONMENT.PERSONAL_API_KEY) &&
      configured(POSTHOG_ENVIRONMENT.PROJECT_ID),
    sweep: configured(CRON_ENVIRONMENT.CRON_SECRET),
    ownKeys: configured(PROVIDER_KEY_ENCRYPTION_ENVIRONMENT.KEYS),
    workspaceLinear: configured(WORKSPACE_LINEAR_CONNECTOR_VARIABLE),
    connectors: connectorPresence(),
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
      Effect.map(readAdminMetricsSource({ now, scope, windowDays }), (source) =>
        buildAdminMetrics(source, now, windowDays),
      ),
    readCost: (now, scope, windowDays) => readAdminCost({ now, scope, windowDays }),
    readUsers: (now, scope, viewerId, windowDays, search) =>
      Effect.map(readAdminUsersSource({ now, scope, search, viewerId, windowDays }), (source) =>
        buildAdminUserList(source, now, windowDays, search),
      ),
    readUser: (userId, now, windowDays) =>
      Effect.map(
        Effect.all(
          [
            readAdminUserSource({ userId, now, windowDays }),
            readAdminAccountSource({ userId, now, windowDays }),
          ],
          { concurrency: "unbounded" },
        ),
        ([source, support]) => source && buildAdminUserDetail(source, support, now, windowDays),
      ),
    readDay: (day, now, scope) =>
      Effect.map(readAdminDaySource({ day, scope }), (source) =>
        buildAdminDayDetail(source, now, day),
      ),
    readReliability: (now, scope, windowDays) =>
      Effect.map(
        readAdminReliabilitySource({ now, scope, windowDays, integrations, analyticsConsoleUrl }),
        (source) => buildAdminReliability(source, now, windowDays),
      ),
    readWorkspaces: (now, scope, kind, search) =>
      Effect.map(readAdminWorkspacesSource({ now, scope, kind, search }), (source) =>
        buildAdminWorkspaceList(source, now, kind, search),
      ),
    writeFavorite: (adminId, userId, favorite) => writeAdminFavorite({ adminId, userId, favorite }),
  };
}
