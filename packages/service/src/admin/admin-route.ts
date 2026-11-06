import { PROVIDER_KEY_ENCRYPTION_ENVIRONMENT } from "@repo/database/models/provider-key-seal";
import { INTEGRATION_PROVIDER_LIST } from "@repo/features/integration-wire";
import { Effect } from "effect";
import {
  AUTH_SECRET_ENVIRONMENT,
  authSecrets,
  GITHUB_APP_ENVIRONMENT,
  socialClientConfigured,
} from "../auth/auth-deployment.js";
import { sessionCredential } from "../auth/session-credential.js";
import { INTEGRATION, type IntegrationDefinition } from "../integrations/integrations.js";
import { CRON_ENVIRONMENT } from "../maintenance/maintenance-bounds.js";
import { SENTRY_ENVIRONMENT } from "../observability/sentry.js";
import {
  POSTHOG_ENVIRONMENT,
  posthogPersonConsoleUrl,
  posthogProjectConsoleUrl,
} from "../providers/posthog.js";
import type { AdminViewer } from "./admin-access.js";
import { readAdminAccountSource } from "./admin-account-queries.js";
import { readAdminCost } from "./admin-cost-queries.js";
import { buildAdminDayDetail } from "./admin-day.js";
import { readAdminDaySource } from "./admin-day-queries.js";
import { adminIntegrations } from "./admin-health.js";
import { buildAdminMetrics } from "./admin-metrics.js";
import { buildAdminOverview } from "./admin-overview.js";
import { readAdminDashboardSources } from "./admin-overview-queries.js";
import type { AdminProcedureSeams } from "./admin-procedures.js";
import { readAdminUserSource, readAdminUsersSource, writeAdminFavorite } from "./admin-queries.js";
import { buildAdminReliability } from "./admin-reliability.js";
import { readAdminReliabilitySource } from "./admin-reliability-queries.js";
import { buildAdminUserDetail } from "./admin-user.js";
import { buildAdminUserList } from "./admin-users.js";
import { buildAdminWorkspaceDetail } from "./admin-workspace.js";
import { buildAdminWorkspaceList } from "./admin-workspaces.js";
import { readAdminWorkspaceSource, readAdminWorkspacesSource } from "./admin-workspaces-queries.js";
import type { AdminViewerResolver } from "./gate.js";

export interface AdminSessionApi {
  readonly getSession: (input: { headers: Headers }) => Promise<{
    readonly user: { readonly id: string; readonly role?: string | null | undefined };
  } | null>;
}

function configured(name: string): boolean {
  return (process.env[name] ?? "").trim().length > 0;
}

function connectorPresence(): Map<(typeof INTEGRATION_PROVIDER_LIST)[number], boolean> {
  const present = new Map<(typeof INTEGRATION_PROVIDER_LIST)[number], boolean>();
  for (const provider of INTEGRATION_PROVIDER_LIST) {
    const { CONNECTOR_VARIABLE }: IntegrationDefinition = INTEGRATION[provider];
    if (CONNECTOR_VARIABLE !== undefined) present.set(provider, configured(CONNECTOR_VARIABLE));
  }
  return present;
}

function sessionViewer(api: AdminSessionApi): AdminViewerResolver {
  return (request) => {
    const credential = sessionCredential(request.headers);
    if (credential === undefined) return Effect.succeed(undefined);
    return Effect.tryPromise(async (): Promise<AdminViewer | undefined> => {
      const authenticated = await api.getSession({ headers: credential });
      const account = authenticated?.user;
      if (!account) return undefined;
      return { userId: account.id, role: account.role };
    });
  };
}

export function hostedAdminSeams(api: AdminSessionApi): AdminProcedureSeams {
  const socialClients = authSecrets(process.env);
  const integrations = adminIntegrations({
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
    errorReporting: configured(SENTRY_ENVIRONMENT.DSN),
    analyticsRecording: configured(POSTHOG_ENVIRONMENT.PROJECT_API_KEY),
    analyticsErasure:
      configured(POSTHOG_ENVIRONMENT.PERSONAL_API_KEY) &&
      configured(POSTHOG_ENVIRONMENT.PROJECT_ID),
    sweep: configured(CRON_ENVIRONMENT.CRON_SECRET),
    ownKeys: configured(PROVIDER_KEY_ENCRYPTION_ENVIRONMENT.KEYS),
    connectors: connectorPresence(),
  });

  const projectId = (process.env[POSTHOG_ENVIRONMENT.PROJECT_ID] ?? "").trim();
  const analyticsConsoleUrl = projectId
    ? posthogProjectConsoleUrl(projectId, process.env[POSTHOG_ENVIRONMENT.API_HOST])
    : undefined;

  return {
    resolveViewer: sessionViewer(api),
    readMetrics: (now, scope, windowDays) =>
      Effect.map(readAdminDashboardSources({ now, scope, windowDays }), (sources) => ({
        ...buildAdminMetrics(sources.metrics, now, windowDays),
        overview: buildAdminOverview(sources.overview, now, windowDays),
      })),
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
        ([source, support]) =>
          source && {
            ...buildAdminUserDetail(source, support, now, windowDays),
            analyticsPersonUrl:
              analyticsConsoleUrl && posthogPersonConsoleUrl(analyticsConsoleUrl, userId),
          },
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
    readWorkspace: (id, now) =>
      Effect.map(
        readAdminWorkspaceSource({ now, id }),
        (source) => source && buildAdminWorkspaceDetail(source, now),
      ),
    writeFavorite: (adminId, userId, favorite) => writeAdminFavorite({ adminId, userId, favorite }),
  };
}
