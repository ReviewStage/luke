import type { CodingAgentAttachment, CodingAgentSummary } from "@luke/features/coding-agent-wire";
import type { Failure } from "@luke/features/failure-remedy";
import { Button, TEXT_TONE, Text } from "@luke/ui";
import { ArrowRightIcon } from "lucide-react";
import { useState } from "react";
import { BANNER_LOOK, Banner } from "../banner";
import { DRAFT_PLACE, type Draft, EMPTY_DRAFT, useDraftWriter } from "../composer-drafts";
import { useAgentArchive } from "../desktop/agent-archive";
import { AgentActorRef, agentSubject, NOTHING_HELD } from "./agent-ref";
import { CONTINUE_LABEL, CONTINUED_IN } from "./coding-agent-model";
import { useContinueDoor } from "./fork-action";
import type { CodingAgentsControl } from "./use-coding-agents";

/**
 * continue-agent.tsx -- where an agent may be continued in a new one: the press that starts it on the agent's whole transcript, and, once it was, the agents that continued it.
 *
 * The press ends a failed turn's end line, and the note of a box closed
 * because the agent's session has ended, whose words and files it carries
 * on, so nothing typed is lost. Where the agent's tab opens drafts
 * (`useContinueDoor`), the press opens the task's draft as a continue of
 * the agent, the words and files laid in its box, and lets the closed box's
 * go at once: nothing is sent until the developer sends the draft, an empty
 * one continuing on nothing more. Elsewhere it starts the new agent at
 * once with them as its note, and lets them go once it landed, unless they
 * were changed meanwhile, in another window, when the newer words stay;
 * that press is held busy while it is out, and says beside itself why it
 * did not start. Nothing offers it where no Start could run: on an
 * archived task, or an agent on none.
 *
 * Once any agent continues this one (`continuedByIds`), the press is gone
 * and the agents are named in one place, each by its chip, which opens its
 * tab: the note that takes the box's place (`ContinuedComposerNote`), with
 * Stop while a turn still runs and Archive, since a continued agent is done
 * with; or, where the box is taken by an archived task's note, the row at
 * the transcript's end (`ContinuedTrail`). A fork is no continuation, so a
 * source with only forks keeps its box.
 */

/** What the continued box's note offers, worded once. */
const CONTINUED_COPY = {
  ARCHIVE: "Archive",
  STOP: "Stop",
  STOPPING: "Stopping",
} as const;

/** What a closed box hands the press: its words and the files attached to them, and the agent's task, under which they are kept. */
export interface ContinueCarry {
  readonly words: string;
  readonly attachments: readonly CodingAgentAttachment[];
  readonly planId: string | null;
}

/** Whether a draft still holds what a press carried: the same words and the same files in order. */
function holdsCarried(draft: Draft, carry: ContinueCarry): boolean {
  return (
    draft.text === carry.words &&
    draft.attachments.length === carry.attachments.length &&
    draft.attachments.every((file, index) => file === carry.attachments[index])
  );
}

export function ContinueAgent({
  agentId,
  control,
  carry,
  offers = true,
}: {
  agentId: string;
  control: Pick<CodingAgentsControl, "continueAgent">;
  /** The closed box's words and files, which the press carries; none for a press that carries nothing. */
  carry?: ContinueCarry | undefined;
  /** Whether the press may stand here, where no other place offers it. */
  offers?: boolean;
}): React.JSX.Element | null {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Failure | undefined>(undefined);
  const writer = useDraftWriter();
  const { continueAgent } = control;
  const opensDraft = useContinueDoor();

  const press = () => {
    if (continueAgent === undefined || busy) return;
    // Where the place opens a draft, the words move into the continue's draft, sent once the developer sends it.
    if (opensDraft !== undefined) {
      opensDraft(carry?.words ?? "", carry?.attachments ?? []);
      if (carry !== undefined) {
        writer.update({ kind: DRAFT_PLACE.AGENT, planId: carry.planId, agentId }, (now) =>
          holdsCarried(now, carry) ? EMPTY_DRAFT : now,
        );
      }
      return;
    }
    const words = carry?.words.trim() ?? "";
    setBusy(true);
    setNote(undefined);
    void continueAgent(agentId, words === "" ? undefined : words, carry?.attachments ?? []).then(
      (failed) => {
        setBusy(false);
        setNote(failed);
        // The words went on into the new agent, so the closed box lets them go, where nothing newer stands.
        if (failed === undefined && carry !== undefined) {
          writer.update({ kind: DRAFT_PLACE.AGENT, planId: carry.planId, agentId }, (now) =>
            holdsCarried(now, carry) ? EMPTY_DRAFT : now,
          );
        }
      },
    );
  };

  if (!offers || continueAgent === undefined) return null;
  return (
    <span className="agent-continue">
      <button
        type="button"
        className="toolbar-button bordered-button failure-note-remedy"
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
}

/** What names the agents that continued another: the control their chips are read from, and the door that opens one's tab. */
interface ContinuedDoors {
  readonly agentIds: readonly string[];
  readonly control: Pick<
    CodingAgentsControl,
    "agents" | "archived" | "models" | "me" | "pullRequests" | "chatOn"
  >;
  /** Opens an agent's tab; none where nothing opens one, when a chip hangs its card alone. */
  readonly onOpenAgent: ((agentId: string) => void) | undefined;
}

/** Continued in, then each continuing agent's chip, a comma held after each but the last so no gap opens before it. */
function ContinuedIn({ agentIds, control, onOpenAgent }: ContinuedDoors): React.JSX.Element {
  return (
    <span className="agent-continued-in" data-continued="">
      <span>{CONTINUED_IN}</span>
      {agentIds.map((agentId, index) => (
        <span key={agentId} className="agent-continued-item">
          <AgentActorRef
            subject={agentSubject(control, agentId, NOTHING_HELD, false)}
            models={control.models}
            onOpen={() => onOpenAgent?.(agentId)}
          />
          {index === agentIds.length - 1 ? null : <span aria-hidden="true">,</span>}
        </span>
      ))}
    </span>
  );
}

/** The row at a transcript's end naming the agents that continued it, led by an arrow as Forked to is by its split. */
export function ContinuedTrail(doors: ContinuedDoors): React.JSX.Element {
  return (
    <p className="agent-continued" data-continued-trail="">
      <ArrowRightIcon className="size-3.5 shrink-0" aria-hidden="true" />
      <ContinuedIn {...doors} />
    </p>
  );
}

/**
 * The quiet note in a continued agent's box, framed as the box it replaces:
 * Continued in and the agents' chips, then Stop while a turn still runs,
 * and Archive, bordered as a housekeeping press is, which asks first where
 * archiving would stop a turn (`useAgentArchive`) and toasts with Undo once
 * it took. An agent already archived is offered no Archive.
 */
export function ContinuedComposerNote({
  agent,
  doors,
  stop,
  control,
  shown,
}: {
  agent: CodingAgentSummary;
  doors: ContinuedDoors;
  /** Stops the agent, while it has a turn to stop; settles once the service has answered. */
  stop?: (() => Promise<void>) | undefined;
  control: CodingAgentsControl;
  /** Whether the tab is on screen, which the archive's question goes with. */
  shown: boolean;
}): React.JSX.Element {
  const [stopping, setStopping] = useState(false);
  const archive = useAgentArchive(agent, control, shown);
  const pressStop = (run: () => Promise<void>) => {
    setStopping(true);
    run().finally(() => setStopping(false));
  };
  return (
    <>
      <Banner
        look={BANNER_LOOK.COMPOSER}
        className="continued-composer"
        glyph={<ArrowRightIcon aria-hidden="true" />}
        actions={
          stop === undefined && agent.archivedAt !== undefined ? undefined : (
            <>
              {stop === undefined ? null : (
                <Button
                  busy={stopping}
                  busyLabel={CONTINUED_COPY.STOPPING}
                  onClick={() => pressStop(stop)}
                >
                  {CONTINUED_COPY.STOP}
                </Button>
              )}
              {agent.archivedAt !== undefined ? null : (
                <button
                  type="button"
                  className="toolbar-button bordered-button failure-note-remedy"
                  onClick={archive.action.onSelect}
                >
                  {CONTINUED_COPY.ARCHIVE}
                </button>
              )}
            </>
          )
        }
      >
        <Text tone={TEXT_TONE.MUTED}>
          <ContinuedIn {...doors} />
        </Text>
      </Banner>
      {archive.dialog}
    </>
  );
}
