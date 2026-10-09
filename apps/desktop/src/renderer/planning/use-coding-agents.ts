import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentDefaultAnswer,
  type CodingAgentModelsAnswer,
} from "@sidecar/hosted/coding-agent-view";
import type { CodingAgentStatus, CodingAgentSummary } from "@sidecar/hosted/coding-agent-wire";
import type { CatalogModel, ModelChoice } from "@sidecar/hosted/models-wire";
import { useCallback, useEffect, useRef, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import type { ActHandle } from "../act";
import { START_NEEDS_REPOSITORY, startFailureNote, withAgentStatus } from "./coding-agent-model";
import type { PullRequestReader } from "./use-agent-pull-request";
import type { TranscriptReader } from "./use-agent-transcript";

/**
 * use-coding-agents.ts -- the open plan's coding agents as one control: the agents and their status, the Start button, the Stop, and the models the menu offers.
 *
 * The agents are read when a plan opens and again after a Start or a Stop,
 * and never on a clock; an agent's status moves between those reads only
 * as its own transcript page reports it. A Start mints a key of its own
 * for the press, so a service that did not answer is asked again under the
 * same key on the next press of the same choice and answers the agent the
 * first press made rather than a second one; a press of another choice is
 * another request with a key of its own. The models the menu offers and
 * the account's default are read when the menu asks, so the menu shows the
 * catalog as it stands and the default a Start on the service just wrote.
 */

/** Everything the Start button, the tabs, and the agent tab draw and press. */
export interface CodingAgentsControl {
  /** The open plan's agents in the order started, or nothing before the first read lands. */
  agents: readonly CodingAgentSummary[] | undefined;
  /** The agent tabs the panel may show, by agent id; nothing before the first read lands. */
  agentIds: readonly string[] | undefined;
  /** Whether the last read of the list did not land. */
  listFailed: boolean;
  onRetryList: () => void;
  /** The models the menu offers, as last read; nothing before the menu first asks. */
  models: readonly CatalogModel[] | undefined;
  /** Reads the models now, for a menu opening. */
  readModels: () => void;
  /** Reads the account's default now, for a menu opening or the Settings page. */
  readDefault: () => Promise<CodingAgentDefaultAnswer>;
  start: {
    /** Whether a Start could run now: the plan names a repository. */
    available: boolean;
    /** Why it cannot, said on the button, while it cannot. */
    reason: string | undefined;
    /** Whether a Start is out. */
    busy: boolean;
    /** Why the last Start did not start, said beside the button until the next. */
    note: string | undefined;
    /** Starts an agent on the choice given, or on the account's default with none. */
    onPress: (choice?: ModelChoice) => void;
  };
  /** Stops one agent; the list is read again once the service answers. */
  onStop: (agentId: string) => Promise<void>;
  /** An agent's transcript page said where it stands now. */
  onStatus: (agentId: string, status: CodingAgentStatus) => void;
  /** One read of an agent's transcript past a cursor, as the tab's loop asks it. */
  readTranscript: TranscriptReader;
  /** One read of what an agent published, as its tab asks it. */
  readPullRequest: PullRequestReader;
}

/** A Start on its way or asked again: the plan, the key the press minted, and the choice it was for. */
interface PendingStart {
  planId: string;
  key: string;
  choice: ModelChoice | undefined;
}

function sameChoice(a: ModelChoice | undefined, b: ModelChoice | undefined): boolean {
  return a?.model === b?.model && a?.effort === b?.effort;
}

export function useCodingAgents(input: {
  acts: Pick<ActHandle, "act">;
  /** The open plan, or none; a fixture run's plans have no agents. */
  planId: string | undefined;
  /** The open plan's repository, or null while it names none. */
  repository: string | null;
  /** Called with the agent a Start made, so its tab opens. */
  onStarted: (agentId: string) => void;
  /** Mints one press's key. */
  mintKey?: () => string;
}): CodingAgentsControl {
  const { planId, repository } = input;
  const { act } = input.acts;
  const mintKey = input.mintKey ?? (() => crypto.randomUUID());
  const [list, setList] = useState<{
    planId: string | undefined;
    agents: readonly CodingAgentSummary[] | undefined;
    failed: boolean;
  }>({ planId: undefined, agents: undefined, failed: false });
  const [models, setModels] = useState<readonly CatalogModel[] | undefined>(undefined);
  const [starting, setStarting] = useState(false);
  const [note, setNote] = useState<{ planId: string; note: string } | undefined>(undefined);
  const [reads, setReads] = useState(0);
  const pending = useRef<PendingStart | undefined>(undefined);
  // Note that the acts and the opening are read through a ref, because the
  // tab hands new closures on every render and a read is owed to the plan
  // opening, not to a render.
  const latest = useRef(input);
  latest.current = input;

  // The list is this plan's: another plan's, or none, is nothing to draw.
  const agents = list.planId === planId ? list.agents : undefined;
  const listFailed = list.planId === planId && list.failed;

  // Read when the plan opens, and again when a Start or a Stop asks (`reads`).
  useEffect(() => {
    if (planId === undefined) return;
    let live = true;
    latest.current.acts.act(ACT_KIND.CODING_AGENTS_LIST, { planId }).then(
      (answer) => {
        if (!live) return;
        setList((was) =>
          "failure" in answer
            ? { planId, agents: was.planId === planId ? was.agents : undefined, failed: true }
            : { planId, agents: answer.agents, failed: false },
        );
      },
      () => {
        // A read that failed keeps the agents already drawn: their tabs stand until a read lands.
        if (live)
          setList((was) => ({
            planId,
            agents: was.planId === planId ? was.agents : undefined,
            failed: true,
          }));
      },
    );
    return () => {
      live = false;
    };
  }, [planId, reads]);

  const readAgain = useCallback(() => setReads((count) => count + 1), []);

  const readModels = useCallback(() => {
    act(ACT_KIND.CODING_AGENTS_MODELS).then(
      (answer: CodingAgentModelsAnswer) => {
        if (!("failure" in answer)) setModels(answer.models);
      },
      () => undefined,
    );
  }, [act]);

  const readDefault = useCallback(
    (): Promise<CodingAgentDefaultAnswer> =>
      act(ACT_KIND.CODING_AGENTS_DEFAULT_READ).catch(
        (): CodingAgentDefaultAnswer => ({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
      ),
    [act],
  );

  const pressStart = (choice?: ModelChoice) => {
    if (planId === undefined || repository === null || starting) return;
    // The key is the press's own, and a press asked again after the service
    // did not answer carries the one it minted, so the service answers the
    // agent it may already have started rather than a second one.
    const held = pending.current;
    const key =
      held !== undefined && held.planId === planId && sameChoice(held.choice, choice)
        ? held.key
        : mintKey();
    pending.current = { planId, key, choice };
    setStarting(true);
    setNote(undefined);
    act(ACT_KIND.CODING_AGENTS_START, {
      planId,
      idempotencyKey: key,
      ...(choice === undefined ? undefined : { model: choice.model, effort: choice.effort }),
    })
      .catch(() => ({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }) as const)
      .then((answer) => {
        setStarting(false);
        if ("failure" in answer) {
          // Only a service that never answered is asked again under the same key.
          if (answer.failure !== CODING_AGENT_CALL_FAILURE.UNANSWERED) pending.current = undefined;
          setNote({ planId, note: startFailureNote(answer.failure) });
          return;
        }
        pending.current = undefined;
        // A Start that lands after the developer left the plan opens no tab on the plan now open.
        if (latest.current.planId !== planId) return;
        setList((was) =>
          was.planId === planId && was.agents !== undefined
            ? {
                ...was,
                agents: was.agents.some((agent) => agent.id === answer.agent.id)
                  ? was.agents
                  : [...was.agents, answer.agent],
              }
            : was,
        );
        latest.current.onStarted(answer.agent.id);
        readAgain();
      });
  };

  const onStop = async (agentId: string): Promise<void> => {
    const answer = await act(ACT_KIND.CODING_AGENTS_STOP, { agentId }).catch(() => undefined);
    if (answer !== undefined && !("failure" in answer)) {
      setList((was) =>
        was.agents === undefined
          ? was
          : { ...was, agents: withAgentStatus(was.agents, agentId, answer.agent.status) },
      );
    }
    readAgain();
  };

  const onStatus = useCallback((agentId: string, status: CodingAgentStatus) => {
    setList((was) =>
      was.agents === undefined
        ? was
        : { ...was, agents: withAgentStatus(was.agents, agentId, status) },
    );
  }, []);

  const readTranscript = useCallback<TranscriptReader>(
    (agentId, after) => act(ACT_KIND.CODING_AGENTS_MESSAGES, { agentId, after }),
    [act],
  );

  const readPullRequest = useCallback<PullRequestReader>(
    (agentId) => act(ACT_KIND.CODING_AGENTS_PULL_REQUEST, { agentId }),
    [act],
  );

  return {
    agents,
    agentIds: agents?.map((agent) => agent.id),
    listFailed,
    onRetryList: readAgain,
    models,
    readModels,
    readDefault,
    start: {
      available: planId !== undefined && repository !== null,
      reason: planId !== undefined && repository === null ? START_NEEDS_REPOSITORY : undefined,
      busy: starting,
      note: note !== undefined && note.planId === planId ? note.note : undefined,
      onPress: pressStart,
    },
    onStop,
    onStatus,
    readTranscript,
    readPullRequest,
  };
}
