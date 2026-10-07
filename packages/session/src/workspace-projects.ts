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
