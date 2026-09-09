import {
  type ProviderSessionObservation,
  type SessionProviderPlugin,
  SUPERSET_WORKSPACE_PROVIDER_ID,
  type WorkspaceProject,
} from "@sidecar/session";
import { reshapeAdmitted } from "@sidecar/wire";
import type { WorkspaceHostEnrichment } from "../shared/host-claims.js";
import type { SqliteModuleLoader } from "../shared/local-sqlite.js";
import { SupersetCli, type SupersetCliOptions } from "./cli.js";
import { supersetHostState } from "./reader.js";
import { type SupersetSnapshot, supersetSnapshot } from "./snapshot.js";
import { SUPERSET_LIMIT } from "./vocabulary.js";
import type { SupersetSessionContext } from "./wire.js";

export interface SupersetPluginOptions extends SupersetCliOptions {
  sqlite?: SqliteModuleLoader;
}

export interface SupersetPlugin extends SessionProviderPlugin {
  /**
   * One pass over Superset's own state: the host databases every organization
   * on this machine wrote, and — while the CLI holds a login — the projects it
   * offers for creation. Answers the enrichment that pass produced, which is
   * what annotates the other providers' rows.
   */
  refresh(defaultAgent: string | undefined): Promise<WorkspaceHostEnrichment>;
  /** The organization the CLI's login serves, as the latest pass read it. */
  activeOrganization(): string | undefined;
  /** The context an action resolves against, in that organization and no other. */
  actableContext(providerId: string, providerSessionId: string): SupersetSessionContext | undefined;
  /** The one enrichment a failed read stands in with: annotating nothing. */
  readonly emptyEnrichment: WorkspaceHostEnrichment;
  readonly cli: SupersetCli;
}

/**
 * Superset as a workspace provider: it observes the idle worktrees its own
 * host state reports as rows of its own, annotates every other provider's
 * rows with the workspace holding them, and names one action — creating a
 * workspace through the CLI's documented `workspaces create`. The actions on a
 * session another provider observes stay on `cli`, reached through
 * `actableContext`, because a roster Superset does not publish cannot be the
 * roster those actions validate against.
 */
export function supersetPlugin(options: SupersetPluginOptions): SupersetPlugin {
  const cli = new SupersetCli(options);
  let snapshot: SupersetSnapshot = supersetSnapshot();
  let organization: string | undefined;
  let workspaceRows: readonly ProviderSessionObservation[] = [];
  let projects: readonly WorkspaceProject[] = [];
  let projectsRefreshedAt: number | undefined;
  let projectsDefaultAgent: string | undefined;

  /**
   * The CLI's project offer, refreshed on its own slower cadence: the
   * workspaces change at the pace of the host state, the projects at the pace
   * of hands.
   */
  const refreshProjects = async (defaultAgent: string | undefined): Promise<void> => {
    if (organization === undefined) {
      projects = [];
      projectsRefreshedAt = undefined;
      projectsDefaultAgent = defaultAgent;
      return;
    }
    const at = Date.now();
    if (
      defaultAgent === projectsDefaultAgent &&
      projectsRefreshedAt !== undefined &&
      at - projectsRefreshedAt < SUPERSET_LIMIT.PROJECT_REFRESH_INTERVAL_MS
    ) {
      return;
    }
    projects = await cli.workspaceProjects(defaultAgent);
    projectsDefaultAgent = defaultAgent;
    projectsRefreshedAt = projects.length > 0 ? at : undefined;
  };

  return {
    provider: { id: SUPERSET_WORKSPACE_PROVIDER_ID, displayName: "Superset" },

    /**
     * The idle workspaces the latest pass reported, exactly as the snapshot
     * decorated them. `refresh` publishes them rather than this reading state
     * of its own, so a plain registry refresh after an action commits the same
     * shape the observation loop does.
     */
    observe: async () => workspaceRows,
    latest: () => workspaceRows,
    projects: () => projects,

    async refresh(defaultAgent) {
      const [read, activeOrganization] = await Promise.all([
        supersetHostState(options),
        cli.activeOrganization(),
      ]);
      read.adoptDirectoryMatches(snapshot);
      snapshot = read;
      organization = activeOrganization;
      // The rows are observation, not an action: host state reads without a
      // login, so they stand — undecorated with actions — however the connection
      // looks.
      workspaceRows = read.workspaceRowObservations(activeOrganization);
      await refreshProjects(defaultAgent);
      return (providerId, observations) =>
        read.enrich(providerId, observations, activeOrganization);
    },

    activeOrganization: () => organization,
    actableContext: (providerId, providerSessionId) =>
      snapshot.actableContext(providerId, providerSessionId, organization),
    emptyEnrichment: (_providerId, observations) => observations,
    cli,

    actions: {
      createWorkspace: (input) =>
        cli.createWorkspace(
          reshapeAdmitted(input, {
            providerProjectId: input.project.providerProjectId,
            // The target is read back off the offered project, never off the
            // ask: a creation lands on the host the pass reported it on.
            ...(input.project.providerTargetId === undefined
              ? undefined
              : { providerTargetId: input.project.providerTargetId }),
            ...(input.agent === undefined ? undefined : { agent: input.agent }),
            ...(input.name === undefined ? undefined : { name: input.name }),
            ...(input.task === undefined ? undefined : { task: input.task }),
          }),
        ),
    },
  };
}
