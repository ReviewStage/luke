import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentAgentAnswer,
} from "@sidecar/hosted/coding-agent-view";
import type { CodingAgentSummary } from "@sidecar/hosted/coding-agent-wire";
import type { ModelChoice } from "@sidecar/hosted/models-wire";
import { useRef, useState } from "react";
import { chooseFailureNote } from "./coding-agent-model";

/**
 * use-agent-model.ts -- the model chip under an agent's transcript as one control: the choice the chip shows, a change on its way, and why the last one did not take.
 *
 * A choice is drawn on the chip the moment it is made and sent to the
 * service, which writes it on the agent's row for its next step; the
 * agent the service answers is the one the list then holds, so the chip
 * reads the choice back off the agent. A change the service refused is
 * taken off the chip again, which falls back to what the agent runs on,
 * and why is said under the box until the next change. An answer a later
 * change overtook is let go. Another agent's tab starts from nothing of
 * this one's.
 */

/** How a change is sent: the agent and the choice, answered as the view hears it. */
export type ChoiceWriter = (
  agentId: string,
  choice: ModelChoice,
) => Promise<CodingAgentAgentAnswer>;

/** Everything the chip draws and presses. */
export interface AgentModelControl {
  /** The choice the chip shows: the one on its way where one is, else the agent's. */
  choice: ModelChoice;
  /** Why the last change did not take, said under the box; nothing while none failed. */
  note: string | undefined;
  /** Changes the agent's model and effort for its next step. */
  choose: (next: ModelChoice) => void;
}

interface Held {
  agentId: string;
  pending: ModelChoice | undefined;
  note: string | undefined;
}

function fresh(agentId: string): Held {
  return { agentId, pending: undefined, note: undefined };
}

export function useAgentModel(input: {
  agent: Pick<CodingAgentSummary, "id" | "model" | "effort">;
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
    setHeld((was) => ({ ...was, pending: next, note: undefined }));
    latest.current
      .choose(agent.id, next)
      .catch((): CodingAgentAgentAnswer => ({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }))
      .then((answer) => {
        if (write !== writes.current || latest.current.agent.id !== agent.id) return;
        setHeld((was) => ({
          ...was,
          pending: undefined,
          note: "failure" in answer ? chooseFailureNote(answer.failure) : undefined,
        }));
      });
  };

  return {
    choice: held.pending ?? { model: agent.model, effort: agent.effort },
    note: held.note,
    choose,
  };
}
