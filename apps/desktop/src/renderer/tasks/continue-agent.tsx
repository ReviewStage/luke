import type { CodingAgentAttachment } from "@luke/features/coding-agent-wire";
import type { Failure } from "@luke/features/failure-remedy";
import { ArrowRightIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { DRAFT_PLACE, useDraftWriter } from "../composer-drafts";
import { AgentActorRef, agentSubject, NOTHING_HELD } from "./agent-ref";
import {
  CONTINUE_LABEL,
  CONTINUE_TRAIL,
  CONTINUED_IN,
  continuationsOf,
  continueTrail,
} from "./coding-agent-model";
import type { CodingAgentsControl } from "./use-coding-agents";

/**
 * continue-agent.tsx -- where an agent may be continued in a new one: the press that starts it on the agent's whole transcript, or the agents that already continued it.
 *
 * It ends a failed turn's end line, and the note of a box closed because
 * the agent's session has ended, whose words and files the press carries
 * into the new agent as its note, so nothing typed is lost, and lets go of
 * once it landed. The press is held busy while it is out, and says beside
 * itself why it did not start. Once any agent of the task continues this
 * one (`continuationsOf`), each is named in its place by its chip, which
 * opens its tab, so one agent is not continued twice. Nothing stands where
 * no Start could run and none continued it: on an archived task, or an
 * agent on none.
 */

/** What a closed box hands the press: its words and the files attached to them. */
export interface ContinueCarry {
  readonly words: string;
  readonly attachments: readonly CodingAgentAttachment[];
}

export function ContinueAgent({
  agentId,
  control,
  onOpenAgent,
  carry,
}: {
  agentId: string;
  control: Pick<
    CodingAgentsControl,
    "agents" | "archived" | "models" | "me" | "pullRequests" | "chatOn" | "continueAgent"
  >;
  /** Opens an agent's tab; none where nothing opens one, when a chip hangs its card alone. */
  onOpenAgent: ((agentId: string) => void) | undefined;
  /** The closed box's words and files, which the press carries; none for a press that carries nothing. */
  carry?: ContinueCarry | undefined;
}): React.JSX.Element | null {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Failure | undefined>(undefined);
  const writer = useDraftWriter();
  const continuations = useMemo(
    () => continuationsOf(agentId, control.agents, control.archived),
    [agentId, control.agents, control.archived],
  );
  const { continueAgent } = control;
  const trail = continueTrail(continuations, continueAgent !== undefined);

  const press = () => {
    if (continueAgent === undefined || busy) return;
    const words = carry?.words.trim() ?? "";
    setBusy(true);
    setNote(undefined);
    void continueAgent(agentId, words === "" ? undefined : words, carry?.attachments ?? []).then(
      (failed) => {
        setBusy(false);
        setNote(failed);
        // The words went on into the new agent, so the closed box lets them go.
        if (failed === undefined && carry !== undefined) {
          writer.drop((place) => place.kind === DRAFT_PLACE.AGENT && place.agentId === agentId);
        }
      },
    );
  };

  switch (trail.kind) {
    case CONTINUE_TRAIL.NONE:
      return null;
    case CONTINUE_TRAIL.OFFER:
      return (
        <span className="agent-continue">
          <button
            type="button"
            className="toolbar-button bordered-button"
            disabled={busy}
            aria-busy={busy}
            onClick={press}
          >
            <ArrowRightIcon aria-hidden="true" />
            {CONTINUE_LABEL}
          </button>
          {note === undefined ? null : (
            <span className="agent-continue-note" role="alert">
              {note.text}
            </span>
          )}
        </span>
      );
    case CONTINUE_TRAIL.CONTINUED:
      return (
        <span className="agent-continue" data-continued="">
          {CONTINUED_IN}
          {trail.agents.map((agent) => (
            <AgentActorRef
              key={agent.id}
              subject={agentSubject(control, agent.id, NOTHING_HELD, false)}
              models={control.models}
              onOpen={() => onOpenAgent?.(agent.id)}
            />
          ))}
        </span>
      );
  }
}
