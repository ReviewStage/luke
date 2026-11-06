import { AGENT_CALL_FAILURE, type AgentAgentAnswer } from "@repo/features/agent-view";
import type { AgentRuntime, AgentSummary } from "@repo/features/agent-wire";
import type { ModelChoice } from "@repo/features/models-wire";
import { useRef, useState } from "react";
import type { AgentActAnswer } from "../act.js";
import { chooseFailureNote } from "./agent-model.js";

export type ChoiceWriter = (agentId: string, choice: ModelChoice) => Promise<AgentActAnswer>;

export interface AgentModelControl {
  choice: ModelChoice;
  note: string | undefined;
  choose: (next: ModelChoice) => void;
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
  const latest = useRef(input);
  latest.current = input;
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
