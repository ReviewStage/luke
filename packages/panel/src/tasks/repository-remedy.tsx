import { FAILURE_REASON, type Failure } from "@luke/features/failure-remedy";
import { createContext, useContext } from "react";

/**
 * repository-remedy.tsx -- what the press under a refused start or message does when the task's repository is out of reach.
 *
 * Each reason's remedy is one door of the window's (`App`'s, over the
 * Tasks tab), handed down on a context so the composer and the Start button
 * mend the task's repository without every surface between threading the
 * doors on: Settings › Workspace's GitHub for the task's workspace, the
 * installation's settings page on GitHub, the task's repository chip, or
 * the task moved to the workspace whose GitHub reaches it, after which the
 * same send goes again by itself. Outside the window, as in a test of one
 * surface, every door does nothing.
 */

/** The window's doors a repository's remedy opens. */
export interface RepositoryRemedyDoors {
  /** Settings › Workspace at its GitHub, for the task's workspace. */
  readonly openWorkspaceGitHub: (taskId: string) => void;
  /** A page of GitHub's in the browser. */
  readonly openGitHub: (url: string) => void;
  /** The task's repository chip, opened on its menu. */
  readonly chooseRepository: (taskId: string) => void;
  /** The task moved to the workspace; answers whether it moved. */
  readonly moveTask: (taskId: string, workspaceId: string) => Promise<boolean>;
}

const NO_DOORS: RepositoryRemedyDoors = {
  openWorkspaceGitHub: () => undefined,
  openGitHub: () => undefined,
  chooseRepository: () => undefined,
  moveTask: () => Promise.resolve(false),
};

const RepositoryRemedyContext = createContext<RepositoryRemedyDoors>(NO_DOORS);

/** Hands the window's doors to everything under it. */
export const RepositoryRemedyProvider = RepositoryRemedyContext.Provider;

/**
 * The press that mends a repository out of reach, by the failure's reason;
 * none for a failure whose remedy is the surface's own or that has none.
 * `retry` sends the same words again, which a move does once it lands.
 */
export function useRepositoryRemedy(): (
  failure: Failure,
  retry?: () => void,
) => (() => void) | undefined {
  const doors = useContext(RepositoryRemedyContext);
  return (failure, retry) => {
    switch (failure.reason) {
      case FAILURE_REASON.CONNECT_GITHUB:
      case FAILURE_REASON.RECONNECT_GITHUB:
        return () => doors.openWorkspaceGitHub(failure.taskId);
      case FAILURE_REASON.ADD_REPOSITORY:
        return () => doors.openGitHub(failure.settingsUrl);
      case FAILURE_REASON.CHOOSE_REPOSITORY:
        return () => doors.chooseRepository(failure.taskId);
      case FAILURE_REASON.MOVE_TASK:
        return () => {
          void doors.moveTask(failure.taskId, failure.workspace.id).then((moved) => {
            if (moved) retry?.();
          });
        };
      case FAILURE_REASON.RECONNECT_INTEGRATION:
      case FAILURE_REASON.API_KEY:
      case FAILURE_REASON.OTHER:
        return undefined;
    }
  };
}
