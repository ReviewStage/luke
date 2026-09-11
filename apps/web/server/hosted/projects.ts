import {
  ACTION_KIND,
  type CloudAgentProviderId,
  type CloudFetch,
  type HostedProjectsAnswer,
  type HostedWorkspaceAgentModels,
  type HostedWorkspaceProject,
  type WorkspaceProject,
  workspaceAgentModels,
} from "../core.js";
import { actionUnsupportedReason } from "./action-execute.js";
import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS, jsonResponse } from "./http.js";
import {
  keyedCloudProviderIds,
  type ObservationStore,
  observeAndSnapshot,
  storedRoster,
} from "./observation-pass.js";
import type { ObservedRoster } from "./observed-roster.js";
import { createRateBrake } from "./rate-brake.js";
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
  /** The store the snapshot is read from and, on a live pass, written to. */
  store: (secret: string) => ObservationStore;
  /** Injected in tests; production uses the global fetch. */
  fetch?: CloudFetch;
  now?: () => number;
}

/**
 * Lists where the caller's keys can create a workspace: each entry is a
 * project a provider reported on the same stored snapshot a creation is
 * admitted against, so the phone can never be offered a project admission
 * would then refuse. A live pass runs only where no snapshot stands for the
 * standing keys, under the per-user brake, and it is the same pass the
 * schedule runs, stored the same way. Only creation-capable providers are
 * listed; a provider whose keys stand but that documents no creation offers
 * nowhere to create.
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

  const rows = await readVaultKeys(userId);
  const creating = keyedCloudProviderIds(rows).filter(
    (providerId) => actionUnsupportedReason(ACTION_KIND.CREATE_WORKSPACE, providerId) === undefined,
  );
  if (creating.length === 0)
    return jsonResponse(HOSTED_HTTP_STATUS.OK, projectsAnswer(undefined, creating));

  const store = options.store(secret);
  let roster = (await storedRoster(store, userId, rows, secret))?.roster;
  if (!roster) {
    const now = (options.now ?? Date.now)();
    if (projectsRateLimited(userId, now)) {
      return errorResponse(HOSTED_HTTP_STATUS.TOO_MANY_REQUESTS, HOSTED_API_ERROR.QUOTA_EXHAUSTED);
    }
    roster = (await observeAndSnapshot({ userId, rows, secret, store, seams: options, now }))
      .roster;
  }
  return jsonResponse(HOSTED_HTTP_STATUS.OK, projectsAnswer(roster, creating));
}

/** The snapshot's projects for the creation-capable providers, each with the build's agent table beside it. */
function projectsAnswer(
  roster: ObservedRoster | undefined,
  creating: readonly CloudAgentProviderId[],
): HostedProjectsAnswer {
  const projects: HostedWorkspaceProject[] = [];
  const agentModels: HostedWorkspaceAgentModels[] = [];
  for (const provider of roster?.providers ?? []) {
    if (!creating.includes(provider.providerId)) continue;
    for (const project of provider.projects) {
      projects.push(toWireProject(provider.providerId, project));
    }
    // The build's own agent table for each provider that actually offered a
    // project — documented state riding beside the observed state it applies
    // to, so a provider with nowhere to create advertises no choices either.
    if (provider.projects.length > 0) {
      for (const entry of workspaceAgentModels(provider.providerId)) {
        agentModels.push({ providerId: provider.providerId, ...entry });
      }
    }
  }
  return { projects, agentModels };
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
