import type { AgentSummary } from "@repo/features/agent-wire";
import type { CatalogModel, ModelChoice } from "@repo/features/models-wire";
import { ACT_KIND } from "@repo/host/acts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useAgentDefault, useOfferedModels } from "../account-choices.js";
import { pressMutation } from "../act-mutations.js";
import { useWorkspaceAgents, type WorkspaceAgents } from "../tasks/use-workspace-agents.js";
import { workspaceAgentSearchQueryOptions } from "../tasks/workspace-agent-search.js";
import { HOST_READ_STATUS } from "../use-host-read.js";

/**
 * use-run-choices.ts -- what an automation's "Runs land in" row chooses from: the models a new agent may run on, the account's default it runs on until one is chosen, and the workspace's agents on the repository a run may go to.
 *
 * The models and the default are the ones the host holds for the account
 * (`account-choices.ts`), drawn as the row first stands, and asked again
 * as the menu's Retry asks. The agents are the newest the task list carries of the
 * repository the automation works in (`useWorkspaceAgents`), drawn only
 * while runs land in the same agent; once a word is searched, the service
 * finds the agents on that repository holding it, so one past the newest
 * can be chosen. A read that did not answer leaves what it would have drawn
 * unread, which the row says plainly rather than offering a list that is
 * not one.
 */

export interface RunChoices {
  /** The catalog as last read; nothing before the first read lands. */
  readonly models: readonly CatalogModel[] | undefined;
  /** Whether the catalog could not be read before it ever was. */
  readonly modelsFailed: boolean;
  /** Reads the catalog again, as the menu's Retry asks. */
  readonly readModels: () => void;
  /** The account's default a new agent runs on until a model is chosen; nothing before it is read. */
  readonly defaultChoice: ModelChoice | undefined;
  /** Whether the read of the default did not answer, so it is not known. */
  readonly defaultFailed: boolean;
  /** The workspace's agents on the repository, newest first, where the picker asks for them. */
  readonly agents: WorkspaceAgents;
  /** The agents on the repository the last search found, standing until the next answers; nothing while no word is searched, or where it failed. */
  readonly found: readonly AgentSummary[] | undefined;
  /** Whether the search for the words typed did not answer, which is not the same as finding no agent. */
  readonly searchFailed: boolean;
  /** Reads the task list again where it failed, and the search for the words typed, after either failed. */
  readonly retryAgents: () => void;
  /** The words the agents are being searched for, trimmed; empty while none is typed. */
  readonly searched: string;
  /** Searches the agents on the repository for the words, or, with none, stops searching. */
  readonly searchAgents: (words: string) => void;
}

/** What the row chooses from, the agents read only while `wantsAgents`. */
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
  const retryModels = offered.retry;
  const readModels = useCallback(() => {
    void retryModels();
  }, [retryModels]);
  // Once a word is typed the service finds the agents it names, however many the repository holds.
  const asked = words.trim();
  const searching = wantsAgents && workspaceId !== undefined && asked !== "";
  const search = useQuery({
    ...workspaceAgentSearchQueryOptions(workspaceId, asked, {
      repository: repository ?? undefined,
    }),
    enabled: searching,
  });
  const searchAgain = search.refetch;
  // Note that nothing a search found stands while it is asked again, nor another repository's while this one's is out.
  const answer = searching && !search.isFetching ? search : undefined;
  const found =
    answer?.data !== undefined && !("failure" in answer.data) ? answer.data.agents : undefined;
  const searchFailed =
    answer !== undefined &&
    (answer.isError || (answer.data !== undefined && "failure" in answer.data));
  const listFailed = agents !== undefined && "failed" in agents;
  const retryAgents = useCallback(() => {
    // Note that the newest are the task list's, so where it failed the list's own Try again reads it.
    if (listFailed) refreshTasks();
    if (searching) void searchAgain();
  }, [refreshTasks, listFailed, searching, searchAgain]);
  return {
    models: offered.rows?.models,
    modelsFailed: offered.status === HOST_READ_STATUS.FAILED,
    readModels,
    defaultChoice: drawnDefault.choice,
    defaultFailed: drawnDefault.status === HOST_READ_STATUS.FAILED,
    agents,
    found,
    searchFailed,
    retryAgents,
    searched: asked,
    searchAgents: setWords,
  };
}
