import { AGENT_CALL_FAILURE, type AgentAgentAnswer } from "@luke/features/agent-view";
import type { AgentRuntime, AgentSummary } from "@luke/features/agent-wire";
import type { ModelChoice } from "@luke/features/models-wire";
import { useRef, useState } from "react";
import type { AgentActAnswer } from "../act.js";
import { chooseFailureNote } from "./agent-model.js";

/**
 * use-agent-model.ts -- the model chip under an agent's transcript as one control: the choice the chip shows, a change on its way, and why the last one did not take.
 *
 * A choice is sent to the service, which writes it on the agent's row for
 * its next step, and the host draws it on that row the moment it is asked
 * (`@luke/host`'s `task-list-collections.ts`), so the chip reads the
 * choice off the agent, and the runtime it runs on, which narrows what the
 * chip offers (`agent-runtime-models.ts`). A change the service refused is
 * taken back by the host, and why is said under the box until the next
 * change. An answer a later change overtook is let go. Another agent's tab
 * starts from nothing of this one's.
 */

/** How a change is sent: the agent and the choice, answered as the view hears it. */
export type ChoiceWriter = (agentId: string, choice: ModelChoice) => Promise<AgentActAnswer>;

/** Everything the chip draws and presses. */
export interface AgentModelControl {
  /** The choice the chip shows: the agent's. */
  choice: ModelChoice;
  /** Why the last change did not take, said under the box; nothing while none failed. */
  note: string | undefined;
  /** Changes the agent's model, effort, and context window for its next step. */
  choose: (next: ModelChoice) => void;
  /** The provider's own harness the agent runs on, which narrows what the chip offers; none on eve. */
  runtime?: AgentRuntime | undefined;
}

interface Held {
  agentId: string;
  note: string | undefined;
}

function fresh(agentId: string): Held {
  return { agentId, note: undefined };
}

export function useAgentModel(input: {
  agent: Pick<AgentSummary, "id" | "model" | "effort" | "contextWindow" | "runtime">;
  choose: ChoiceWriter;
}): AgentModelControl {
  const { agent } = input;
  const [held, setHeld] = useState<Held>(() => fresh(agent.id));
  if (held.agentId !== agent.id) setHeld(fresh(agent.id));
  // Note that the writer is read through a ref, because the tab hands a new
  // closure on every render and an answer lands on whichever render is current.
  const latest = useRef(input);
  latest.current = input;
  /** How many changes have been sent, so an answer to an earlier one is told apart from the latest. */
  const writes = useRef(0);

  const choose = (next: ModelChoice) => {
    writes.current += 1;
    const write = writes.current;
    setHeld((was) => ({ ...was, note: undefined }));
    latest.current
      .choose(agent.id, next)
      .catch((): AgentAgentAnswer => ({ failure: AGENT_CALL_FAILURE.UNANSWERED }))
      .then((answer) => {
        if (write !== writes.current || latest.current.agent.id !== agent.id) return;
        setHeld((was) => ({
          ...was,
          note: "failure" in answer ? chooseFailureNote(answer.failure) : undefined,
        }));
      });
  };

  return {
    choice: {
      model: agent.model,
      effort: agent.effort,
      ...(agent.contextWindow === undefined ? undefined : { contextWindow: agent.contextWindow }),
    },
    note: held.note,
    choose,
    runtime: agent.runtime,
  };
}
