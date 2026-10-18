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
 * offers the agents of the repository the automation works in. A read that
 * did not answer leaves what it would have drawn unread, which the row says
 * plainly rather than offering a list that is not one.
 */

/** The workspace's agents as the picker draws them: read, failed, or not yet read. */
export type AgentsRead =
  | { readonly agents: readonly CodingAgentSummary[] }
  | { readonly failed: true }
  | undefined;

const AGENTS_FAILED = { failed: true } as const;

export interface RunChoices {
  /** The catalog as last read; nothing before the first read lands. */
  readonly models: readonly CatalogModel[] | undefined;
  /** Reads the catalog now, for the chip's name and for its menu opening. */
  readonly readModels: () => void;
  /** The account's default a new agent runs on until a model is chosen; nothing before it is read. */
  readonly defaultChoice: ModelChoice | undefined;
  /** Whether the read of the default did not answer, so it is not known. */
  readonly defaultFailed: boolean;
  /** The workspace's agents on the repository, newest first, where the picker asks for them. */
  readonly agents: AgentsRead;
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
  const [defaultChoice, setDefaultChoice] = useState<ModelChoice | undefined>(undefined);
  const [defaultFailed, setDefaultFailed] = useState(false);
  const [agents, setAgents] = useState<AgentsRead>(undefined);
  const readModels = useCallback(() => {
    act(ACT_KIND.CODING_AGENTS_MODELS).then(
      (answer) => {
        if (!("failure" in answer)) setModels(answer.models);
      },
      () => undefined,
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
  }, [act, workspaceId, repository, wantsAgents]);
  return { models, readModels, defaultChoice, defaultFailed, agents };
}
