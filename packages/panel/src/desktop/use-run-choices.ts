import type { AgentSummary } from "@repo/features/agent-wire";
import type { CatalogModel, ModelChoice } from "@repo/features/models-wire";
import { ACT_KIND } from "@repo/host/acts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useAgentDefault, useOfferedModels } from "../account-choices.js";
import { pressMutation } from "../act-mutations.js";
import { modelsRetryMutation } from "../live-reads.js";
import { useWorkspaceAgents, type WorkspaceAgents } from "../tasks/use-workspace-agents.js";
import { workspaceAgentSearchQueryOptions } from "../tasks/workspace-agent-search.js";

export interface RunChoices {
  readonly models: readonly CatalogModel[] | undefined;
  readonly modelsFailed: boolean;
  readonly readModels: () => void;
  readonly defaultChoice: ModelChoice | undefined;
  readonly defaultFailed: boolean;
  readonly agents: WorkspaceAgents;
  readonly found: readonly AgentSummary[] | undefined;
  readonly searchFailed: boolean;
  readonly retryAgents: () => void;
  readonly searched: string;
  readonly searchAgents: (words: string) => void;
}

export function useRunChoices(input: {
  readonly workspaceId: string | undefined;
  readonly repository: string | null;
  readonly wantsAgents: boolean;
}): RunChoices {
  const { mutate: refreshTasks } = useMutation(pressMutation(ACT_KIND.TASKS_REFRESH));
  const { workspaceId, repository, wantsAgents } = input;
  const offered = useOfferedModels();
  const drawnDefault = useAgentDefault();
  const agents = useWorkspaceAgents(wantsAgents ? workspaceId : undefined, repository);
  const [words, setWords] = useState("");
  const { mutate: retryModels } = useMutation(modelsRetryMutation());
  const readModels = useCallback(() => retryModels(), [retryModels]);
  const asked = words.trim();
  const searching = wantsAgents && workspaceId !== undefined && asked !== "";
  const search = useQuery({
    ...workspaceAgentSearchQueryOptions(workspaceId, asked, {
      repository: repository ?? undefined,
    }),
    enabled: searching,
  });
  const searchAgain = search.refetch;
  const answer = searching && !search.isFetching ? search : undefined;
  const found =
    answer?.data !== undefined && !("failure" in answer.data) ? answer.data.agents : undefined;
  const searchFailed =
    answer !== undefined &&
    (answer.isError || (answer.data !== undefined && "failure" in answer.data));
  const listFailed = agents !== undefined && "failed" in agents;
  const retryAgents = useCallback(() => {
    if (listFailed) refreshTasks();
    if (searching) void searchAgain();
  }, [refreshTasks, listFailed, searching, searchAgain]);
  return {
    models: offered.data?.models,
    modelsFailed: offered.isError,
    readModels,
    defaultChoice: drawnDefault.choice,
    defaultFailed: drawnDefault.failed,
    agents,
    found,
    searchFailed,
    retryAgents,
    searched: asked,
    searchAgents: setWords,
  };
}
