import { maximumObservedWorkspaceProjects, maximumWorkspaceNameLength } from "./bounds.js";

/**
 * Whether a new workspace in a project carries an opening task — the
 * developer's own words for what its agent should start on. A provider whose
 * creation endpoint requires a prompt cannot make an idle workspace, and one
 * that documents no way to hand a task at creation cannot take one; each
 * project says which it is, so an ask can be validated before a request
 * exists.
 */
export const WORKSPACE_TASK_SUPPORT = {
  NONE: "none",
  OPTIONAL: "optional",
  REQUIRED: "required",
} as const;

export type WorkspaceTaskSupport =
  (typeof WORKSPACE_TASK_SUPPORT)[keyof typeof WORKSPACE_TASK_SUPPORT];

const WORKSPACE_TASK_SUPPORT_LIST: readonly WorkspaceTaskSupport[] =
  Object.values(WORKSPACE_TASK_SUPPORT);

/**
 * One place a provider will create a workspace: a project it reported on the
 * latest observation pass. A request can only name one of these, so the set of
 * places a workspace can be asked for is the set the provider itself listed —
 * never a repository URL or path composed on this side.
 */
export interface WorkspaceProject {
  /** The provider-owned identifier a creation request names the project by. */
  providerProjectId: string;
  /** The repository label the project is named by out loud and on screen. */
  repository: string;
  /** Whether a new workspace here takes — or needs — an opening task. */
  taskSupport: WorkspaceTaskSupport;
  /** The provider-owned host or execution target that owns this project. */
  providerTargetId?: string;
  /** The bounded label a person uses to distinguish that target. */
  targetName?: string;
  /** Agent kinds the provider currently permits for a new workspace here. */
  spawnableAgents?: readonly string[];
  /** The saved agent kind used when a creation ask names none. */
  defaultAgent?: string;
  /**
   * The provider names a workspace here itself and takes none from the ask,
   * so an ask carrying one is refused rather than half honoured.
   */
  namesItself?: boolean;
}

/** A workspace project as the app reports it, stamped with who offered it. */
export interface ObservedWorkspaceProject extends WorkspaceProject {
  providerId: string;
  providerName: string;
}

/** The identity a saved default uses, including a host when one owns it. */
export function workspaceProjectSelectionId(
  project: Pick<WorkspaceProject, "providerProjectId" | "providerTargetId">,
): string {
  return project.providerTargetId
    ? JSON.stringify([project.providerProjectId, project.providerTargetId])
    : project.providerProjectId;
}

/**
 * The providers whose stored default names no project they currently offer —
 * a choice that steers nothing, because every path that reads it matches
 * against the offered set. Only providers present in `projects` are judged: a
 * provider offering nothing is observing nothing, and a default must not be
 * discarded on that silence.
 */
export function staleWorkspaceProjectDefaults(
  projects: readonly ObservedWorkspaceProject[],
  defaults: Readonly<Partial<Record<string, string>>> | undefined,
): readonly string[] {
  if (!defaults) return [];
  const offered = new Map<string, Set<string>>();
  for (const project of projects) {
    const selections = offered.get(project.providerId) ?? new Set<string>();
    selections.add(workspaceProjectSelectionId(project));
    offered.set(project.providerId, selections);
  }
  return [...offered.entries()]
    .filter(([providerId, selections]) => {
      const stored = defaults[providerId];
      return stored !== undefined && !selections.has(stored);
    })
    .map(([providerId]) => providerId);
}

/**
 * Bounds, deduplicates, and alphabetizes the projects adapters offered, so
 * the surface and the conversation are handed the same capped, display-safe
 * list. Ordered by the repository label a person scans for — not by which
 * adapter answered first — and capped after the sort, so a list too long to
 * keep whole loses its alphabetical tail rather than an arbitrary provider.
 */
export function normalizeObservedWorkspaceProjects(
  projects: readonly ObservedWorkspaceProject[],
  preferredSelections?: Readonly<Partial<Record<string, string>>>,
): readonly ObservedWorkspaceProject[] {
  const seen = new Map<string, Map<string, Set<string>>>();
  const normalized: ObservedWorkspaceProject[] = [];
  for (const project of projects) {
    const providerId = project.providerId.trim();
    const providerProjectId = project.providerProjectId.trim();
    const providerTargetId = project.providerTargetId?.trim() ?? "";
    const repository = project.repository.trim().slice(0, maximumWorkspaceNameLength);
    if (!providerId || !providerProjectId || !repository) continue;
    const byProvider = seen.get(providerId) ?? new Map<string, Set<string>>();
    const byProject = byProvider.get(providerProjectId) ?? new Set<string>();
    if (byProject.has(providerTargetId)) continue;
    byProject.add(providerTargetId);
    byProvider.set(providerProjectId, byProject);
    seen.set(providerId, byProvider);
    const normalizedProject: ObservedWorkspaceProject = {
      providerId,
      providerName: project.providerName.trim() || providerId,
      providerProjectId,
      repository,
      // A support level this build does not know is read as none, so an ask
      // is refused rather than guessed at.
      taskSupport: WORKSPACE_TASK_SUPPORT_LIST.includes(project.taskSupport)
        ? project.taskSupport
        : WORKSPACE_TASK_SUPPORT.NONE,
    };
    if (providerTargetId) normalizedProject.providerTargetId = providerTargetId;
    const targetName = project.targetName?.trim();
    if (targetName) {
      normalizedProject.targetName = targetName.slice(0, maximumWorkspaceNameLength);
    }
    if (project.spawnableAgents) {
      normalizedProject.spawnableAgents = [
        ...new Set(project.spawnableAgents.map((agent) => agent.trim())),
      ]
        .filter(Boolean)
        .slice(0, 20);
    }
    const defaultAgent = project.defaultAgent?.trim();
    if (defaultAgent) normalizedProject.defaultAgent = defaultAgent;
    if (project.namesItself === true) normalizedProject.namesItself = true;
    normalized.push(normalizedProject);
  }
  // One sort decides the whole answer. It is alphabetical because that is the
  // order the surface reads, and the cap is spent from it in two passes so a
  // provider's own default survives a list too long to keep whole while the
  // rest loses its alphabetical tail rather than an arbitrary provider.
  const sorted = normalized.sort(compareWorkspaceProjects);
  const isPreferred = (project: ObservedWorkspaceProject): boolean =>
    preferredSelections?.[project.providerId] === workspaceProjectSelectionId(project);
  const preferredCount = sorted.filter(isPreferred).length;
  let ordinaryBudget = Math.max(0, maximumObservedWorkspaceProjects - preferredCount);
  let preferredBudget = maximumObservedWorkspaceProjects;
  return sorted.filter((project) =>
    isPreferred(project) ? preferredBudget-- > 0 : ordinaryBudget-- > 0,
  );
}

function compareWorkspaceProjects(
  left: ObservedWorkspaceProject,
  right: ObservedWorkspaceProject,
): number {
  return (
    compareRepositoryLabels(left.repository, right.repository) ||
    // Two providers can offer one repository label; the provider and then the
    // id keep the order deterministic rather than arrival-dependent.
    left.providerName.localeCompare(right.providerName) ||
    left.providerProjectId.localeCompare(right.providerProjectId)
  );
}

/** Alphabetical the way a person reads labels: case-blind, digits as numbers. */
function compareRepositoryLabels(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base", numeric: true });
}
