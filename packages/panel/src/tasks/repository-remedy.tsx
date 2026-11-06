import { FAILURE_REASON, type Failure } from "@repo/features/failure-remedy";
import { agentKeyLink, SETTINGS_VIEW } from "@repo/settings/settings-views";
import { createContext, useContext } from "react";
import { useOpenSettings } from "../open-settings.js";

export interface RepositoryRemedyDoors {
  readonly openWorkspaceGitHub: (taskId: string) => void;
  readonly openGitHub: (url: string) => void;
  readonly chooseRepository: (taskId: string) => void;
  readonly moveTask: (taskId: string, workspaceId: string) => Promise<boolean>;
}

const NO_DOORS: RepositoryRemedyDoors = {
  openWorkspaceGitHub: () => undefined,
  openGitHub: () => undefined,
  chooseRepository: () => undefined,
  moveTask: () => Promise.resolve(false),
};

const RepositoryRemedyContext = createContext<RepositoryRemedyDoors>(NO_DOORS);

export const RepositoryRemedyProvider = RepositoryRemedyContext.Provider;

export function useOpenWorkspaceGitHub(): (taskId: string) => void {
  return useContext(RepositoryRemedyContext).openWorkspaceGitHub;
}

export function useRepositoryRemedy(): (
  failure: Failure,
  retry?: () => void,
) => (() => void) | undefined {
  const doors = useContext(RepositoryRemedyContext);
  const openSettings = useOpenSettings();
  return (failure, retry) => {
    switch (failure.reason) {
      case FAILURE_REASON.CONNECT_GITHUB:
      case FAILURE_REASON.RECONNECT_GITHUB:
        return () => doors.openWorkspaceGitHub(failure.taskId);
      case FAILURE_REASON.ADD_REPOSITORY:
        return () => doors.openGitHub(failure.settingsUrl);
      case FAILURE_REASON.GITHUB_TOKEN:
        return () => openSettings({ page: SETTINGS_VIEW.ACCOUNT });
      case FAILURE_REASON.AUTHORIZE_TOKEN:
        return () => doors.openGitHub(failure.authorizeUrl);
      case FAILURE_REASON.CONNECT_AGENTS:
        return () => openSettings(agentKeyLink(failure.provider));
      case FAILURE_REASON.CHOOSE_REPOSITORY:
        return () => doors.chooseRepository(failure.taskId);
      case FAILURE_REASON.MOVE_TASK:
        return () => {
          void doors.moveTask(failure.taskId, failure.workspace.id).then((moved) => {
            if (moved) retry?.();
          });
        };
      case FAILURE_REASON.API_KEY:
      case FAILURE_REASON.OTHER:
        return undefined;
    }
  };
}
