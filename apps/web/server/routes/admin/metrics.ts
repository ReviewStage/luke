import {
  adminIntegrations,
  buildAdminMetrics,
  handleAdminMetrics,
} from "../../admin/admin-metrics.js";
import { readAdminMetricsSource } from "../../admin/admin-queries.js";
import { withAdminViewer } from "../../admin/viewer.js";
import { getDatabase } from "../../db/index.js";
import { HOSTED_OPENAI_ENVIRONMENT } from "../../hosted/openai.js";
import { POSTHOG_ENVIRONMENT, posthogProjectConsoleUrl } from "../../hosted/posthog.js";

/** An environment value counts as configured only when it holds a non-blank string. */
function configured(name: string): boolean {
  return (process.env[name] ?? "").trim().length > 0;
}

/**
 * The admin dashboard's read. The logic lives behind seams in `server/admin/`;
 * this file hands it the deployment's real ones — which integrations the
 * environment has keys for, beside the database. The role is read from the
 * session by the gate, never asserted by the request, and no secret value
 * crosses into the answer: only whether each key is present.
 */
export default withAdminViewer(["GET"], (_viewer, request) => {
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

  return handleAdminMetrics({
    request,
    readMetrics: async (now, scope, windowDays) =>
      buildAdminMetrics(
        await readAdminMetricsSource(getDatabase(), {
          now,
          integrations,
          analyticsConsoleUrl,
          scope,
          windowDays,
        }),
        now,
        windowDays,
      ),
  });
});
