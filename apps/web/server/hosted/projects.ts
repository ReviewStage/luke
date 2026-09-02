import type { CloudFetch } from "../../../../packages/providers/src/shared/cloud-session-adapter.js";
import {
  type HostedWorkspaceAgentModels,
  type HostedWorkspaceProject,
  VAULT_PROVIDER_ID,
  type VaultProviderId,
  type WorkspaceProject,
  workspaceAgentModels,
} from "../core.js";
import { actUnsupportedReason, REMOTE_SESSION_ACT } from "./act-execute.js";
import { CURSOR_PROJECT_REFRESH, cloudSessionAdapterFor } from "./cloud-adapters.js";
import { decryptProviderKey } from "./encryption.js";
import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS, jsonResponse } from "./http.js";
import type { VaultKeyRow } from "./observe.js";
import { createRateBrake } from "./rate-brake.js";

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

export interface ProjectsOptions {
  request: Request;
  resolveUserId: (request: Request) => Promise<string | undefined>;
  /** The value of PROVIDER_KEY_ENCRYPTION_SECRET; undefined means the env var is absent. */
  encryptionSecret: string | undefined;
  /** Reads every vault key row the user has stored, for decryption here. */
  readVaultKeys: (userId: string) => Promise<VaultKeyRow[]>;
  /** Injected in tests; production uses the global fetch. */
  fetch?: CloudFetch;
  now?: () => number;
}

/**
 * Lists where the caller's keys can create a workspace: each entry is a
 * project the provider itself reported on a fresh observation pass, run here
 * on demand like observe and stored nowhere. Only creation-capable providers
 * are observed at all — a projects request must not spend the quota of a
 * provider that could offer nothing — and Cursor's project read, a background
 * offer on the desktop, is awaited because this pass is the one the answer
 * comes from.
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
  const ciphertextByProviderId = new Map<string, string>(
    rows.map((row) => [row.providerId, row.ciphertext]),
  );

  const providers = Object.values(VAULT_PROVIDER_ID).filter(
    (providerId) =>
      actUnsupportedReason(REMOTE_SESSION_ACT.CREATE_WORKSPACE, providerId) === undefined &&
      ciphertextByProviderId.has(providerId),
  );

  const results = await Promise.allSettled(
    providers.map(async (providerId) => {
      const adapter = cloudSessionAdapterFor(providerId, {
        readApiKey: async () => {
          const ciphertext = ciphertextByProviderId.get(providerId);
          if (!ciphertext) return undefined;
          try {
            return decryptProviderKey(ciphertext, secret);
          } catch {
            return undefined;
          }
        },
        ...(options.fetch ? { fetch: options.fetch } : undefined),
        ...(options.now ? { now: options.now } : undefined),
        cursorProjectRefresh: CURSOR_PROJECT_REFRESH.AWAIT,
      });
      await adapter.observe();
      return adapter.workspaceProjects();
    }),
  );

  const projects: HostedWorkspaceProject[] = [];
  const agentModels: HostedWorkspaceAgentModels[] = [];
  for (const [i, providerId] of providers.entries()) {
    const result = results[i];
    if (result?.status !== "fulfilled") continue;
    for (const project of result.value) {
      projects.push(toWireProject(providerId, project));
    }
    // The build's own agent table for each provider that actually offered a
    // project — documented state riding beside the observed state it applies
    // to, so a provider with nowhere to create advertises no choices either.
    if (result.value.length > 0) {
      for (const entry of workspaceAgentModels(providerId)) {
        agentModels.push({ providerId, ...entry });
      }
    }
  }

  return jsonResponse(HOSTED_HTTP_STATUS.OK, { projects, agentModels });
}

function toWireProject(
  providerId: VaultProviderId,
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
