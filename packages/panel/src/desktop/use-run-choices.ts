import type { CodingAgentSummary } from "@luke/features/coding-agent-wire";
import type { CatalogModel, ModelChoice } from "@luke/features/models-wire";
import { ACT_KIND } from "@luke/host/acts";
import { useCallback, useEffect, useState } from "react";
import { useAct } from "../act.js";

/**
 * use-run-choices.ts -- what an automation's "Runs land in" row chooses from: the models a new agent may run on, the account's default it runs on until one is chosen, and the workspace's agents on the repository a run may go to.
 *
 * The models and the default are read once as the row first stands, and
 * the models again as the chip's menu opens, so it shows the catalog as it
 * stands. The agents are read only while runs land in the same agent, and
 * again whenever the workspace or the repository changes, so the picker
 * offers the agents of the repository the automation works in; once a word
 * is searched, the service finds the agents on that repository holding it,
 * so one past the newest can be chosen. A read that
 * did not answer leaves what it would have drawn unread, which the row says
 * plainly rather than offering a list that is not one.
 */

/** The workspace's agents as the picker draws them: read, failed, or not yet read. */
type AgentsRead =
  | { readonly agents: readonly CodingAgentSummary[] }
  | { readonly failed: true }
  | undefined;

const AGENTS_FAILED = { failed: true } as const;

export interface RunChoices {
  /** The catalog as last read; nothing before the first read lands. */
  readonly models: readonly CatalogModel[] | undefined;
  /** Whether the last read of the catalog did not land. */
  readonly modelsFailed: boolean;
  /** Reads the catalog now, for the chip's name, for its menu opening, and for the menu's Retry. */
  readonly readModels: () => void;
  /** The account's default a new agent runs on until a model is chosen; nothing before it is read. */
  readonly defaultChoice: ModelChoice | undefined;
  /** Whether the read of the default did not answer, so it is not known. */
  readonly defaultFailed: boolean;
  /** The workspace's agents on the repository, newest first, where the picker asks for them. */
  readonly agents: AgentsRead;
  /** The agents on the repository the last search found, standing until the next answers; nothing while no word is searched, or where it failed. */
  readonly found: readonly CodingAgentSummary[] | undefined;
  /** Whether the search for the words typed did not answer, which is not the same as finding no agent. */
  readonly searchFailed: boolean;
  /** Reads the repository's agents again, and the search for the words typed with them, after either failed. */
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
  const { act } = useAct();
  const { workspaceId, repository, wantsAgents } = input;
  const [models, setModels] = useState<readonly CatalogModel[] | undefined>(undefined);
  const [modelsFailed, setModelsFailed] = useState(false);
  const [defaultChoice, setDefaultChoice] = useState<ModelChoice | undefined>(undefined);
  const [defaultFailed, setDefaultFailed] = useState(false);
  const [agents, setAgents] = useState<AgentsRead>(undefined);
  const [found, setFound] = useState<readonly CodingAgentSummary[] | undefined>(undefined);
  const [searchFailed, setSearchFailed] = useState(false);
  const [words, setWords] = useState("");
  // Each press of Retry reads the agents again, and the search with them.
  const [agentReads, setAgentReads] = useState(0);
  const readModels = useCallback(() => {
    // The menu reads again while a read is out, so a Retry shows its reading.
    setModelsFailed(false);
    act(ACT_KIND.CODING_AGENTS_MODELS).then(
      (answer) => {
        if ("failure" in answer) setModelsFailed(true);
        else {
          setModels(answer.models);
          setModelsFailed(false);
        }
      },
      () => setModelsFailed(true),
    );
  }, [act]);
  useEffect(() => {
    readModels();
    act(ACT_KIND.CODING_AGENTS_DEFAULT_READ).then(
      (answer) => {
        if ("failure" in answer) setDefaultFailed(true);
        else setDefaultChoice(answer.choice);
      },
      () => setDefaultFailed(true),
    );
  }, [act, readModels]);
  useEffect(() => {
    if (!wantsAgents || workspaceId === undefined) return;
    let live = true;
    // Nothing of another repository's list stands while this one's is out.
    setAgents(undefined);
    setFound(undefined);
    act(ACT_KIND.CODING_AGENTS_WORKSPACE_LIST, {
      workspaceId,
      ...(repository === null ? undefined : { repository }),
    }).then(
      (answer) => {
        if (live) setAgents("failure" in answer ? AGENTS_FAILED : { agents: answer.agents });
      },
      () => {
        if (live) setAgents(AGENTS_FAILED);
      },
    );
    return () => {
      live = false;
    };
  }, [act, workspaceId, repository, wantsAgents, agentReads]);
  // Once a word is typed the service finds the agents it names, however many the repository holds.
  const asked = words.trim();
  useEffect(() => {
    if (!wantsAgents || workspaceId === undefined || asked === "") return;
    let live = true;
    setSearchFailed(false);
    act(ACT_KIND.CODING_AGENTS_WORKSPACE_LIST, {
      workspaceId,
      words: asked,
      ...(repository === null ? undefined : { repository }),
    }).then(
      (answer) => {
        if (!live) return;
        setSearchFailed("failure" in answer);
        setFound("failure" in answer ? undefined : answer.agents);
      },
      () => {
        if (!live) return;
        setSearchFailed(true);
        setFound(undefined);
      },
    );
    return () => {
      live = false;
    };
  }, [act, workspaceId, repository, wantsAgents, asked, agentReads]);
  const retryAgents = useCallback(() => setAgentReads((count) => count + 1), []);
  return {
    models,
    modelsFailed,
    readModels,
    defaultChoice,
    defaultFailed,
    agents,
    found: asked === "" ? undefined : found,
    searchFailed: asked !== "" && searchFailed,
    retryAgents,
    searched: asked,
    searchAgents: setWords,
  };
}
