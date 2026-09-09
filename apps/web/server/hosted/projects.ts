import {
  ACT_KIND,
  CLOUD_AGENT_PROVIDER_ID,
  type CloudAgentProviderId,
  type CloudFetch,
  type HostedWorkspaceAgentModels,
  type HostedWorkspaceProject,
  type WorkspaceProject,
  workspaceAgentModels,
} from "../core.js";
import { actUnsupportedReason } from "./act-execute.js";
import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS, jsonResponse } from "./http.js";
import { createRateBrake } from "./rate-brake.js";
import { observeProviders, readApiKeyFor } from "./vault-keys.js";
import type { HostedVaultRoute } from "./vault-route.js";

const PROJECTS_RATE_LIMIT = {
  WINDOW_MS: 60_000,
  MAX_REQUESTS_PER_WINDOW: 10,
  MAX_TRACKED_USERS: 10_000,
} as const;

const projectsRateLimited = createRateBrake({
  windowMs: PROJECTS_RATE_LIMIT.WINDOW_MS,
  maxRequestsPerWindow: PROJECTS_RATE_LIMIT.MAX_REQUESTS_PER_WINDOW,
  maxTrackedUsers: PROJECTS_RATE_LIMIT.MAX_TRACKED_USERS,
});

export interface ProjectsOptions
  extends Pick<
    HostedVaultRoute,
    "request" | "resolveUserId" | "encryptionSecret" | "readVaultKeys"
  > {
  /** Injected in tests; production uses the global fetch. */
  fetch?: CloudFetch;
  now?: () => number;
}

/**
 * Lists where the caller's keys can create a workspace: each entry is a
 * project the provider itself reported on a fresh observation pass, run here
 * on demand like observe and stored nowhere. Only creation-capable providers
 * are observed at all — a projects request must not spend the quota of a
 * provider that could offer nothing.
 */
export async function handleProjects(options: ProjectsOptions): Promise<Response> {
  const { request, resolveUserId, encryptionSecret, readVaultKeys } = options;

  if (request.method !== "GET") {
    return errorResponse(
      HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
    );
  }

  const userId = await resolveUserId(request);
  if (!userId) {
    return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
  }

  const secret = (encryptionSecret ?? "").trim();
  if (!secret) {
    return errorResponse(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE);
  }

  const now = (options.now ?? Date.now)();
  if (projectsRateLimited(userId, now)) {
    return errorResponse(HOSTED_HTTP_STATUS.TOO_MANY_REQUESTS, HOSTED_API_ERROR.QUOTA_EXHAUSTED);
  }

  const rows = await readVaultKeys(userId);
  const readApiKey = readApiKeyFor(rows, secret);
  const stored = new Set(rows.map((row) => row.providerId));

  const passes = await observeProviders({
    providerIds: Object.values(CLOUD_AGENT_PROVIDER_ID).filter(
      (providerId) =>
        actUnsupportedReason(ACT_KIND.CREATE_WORKSPACE, providerId) === undefined &&
        stored.has(providerId),
    ),
    readApiKey,
    read: async (adapter) => {
      await adapter.observe();
      return adapter.workspaceProjects();
    },
    seams: options,
  });

  const projects: HostedWorkspaceProject[] = [];
  const agentModels: HostedWorkspaceAgentModels[] = [];
  for (const pass of passes) {
    const reported = pass.answer;
    if (!reported) continue;
    for (const project of reported) {
      projects.push(toWireProject(pass.providerId, project));
    }
    // The build's own agent table for each provider that actually offered a
    // project — documented state riding beside the observed state it applies
    // to, so a provider with nowhere to create advertises no choices either.
    if (reported.length > 0) {
      for (const entry of workspaceAgentModels(pass.providerId)) {
        agentModels.push({ providerId: pass.providerId, ...entry });
      }
    }
  }

  return jsonResponse(HOSTED_HTTP_STATUS.OK, { projects, agentModels });
}

function toWireProject(
  providerId: CloudAgentProviderId,
  project: WorkspaceProject,
): HostedWorkspaceProject {
  const wireProject: HostedWorkspaceProject = {
    providerId,
    providerProjectId: project.providerProjectId,
    repository: project.repository,
    taskSupport: project.taskSupport,
  };
  if (project.targetName) wireProject.targetName = project.targetName;
  if (project.namesItself) wireProject.namesItself = true;
  return wireProject;
}
