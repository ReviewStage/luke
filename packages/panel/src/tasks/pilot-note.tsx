import type { AgentSummary } from "@luke/features/agent-wire";
import { BANNER_LOOK, Banner, Button, ComposerFrame, TEXT_TONE, Text } from "@luke/ui";
import { CornerLeftUpIcon } from "@luke/ui/icons";
import { useState } from "react";
import { COMPOSER_ROOM_CLASS } from "./agent-composer.js";
import { AgentActorRef, agentSubject, NOTHING_HELD } from "./agent-ref.js";
import type { ToolTarget } from "./tool-call-model.js";
import type { AgentsControl } from "./use-agents.js";

/**
 * pilot-note.tsx -- what stands in a composer's place on an agent a pilot started.
 *
 * In a pilot tree a member talks to the top pilot alone: a coding agent or
 * a sub-pilot reports to the pilot that started it, so its tab offers no
 * composer and says whom it reports to instead, keeping Stop as the one
 * press a member still has on it.
 */

/** What the note says, worded once. */
const PILOT_NOTE_COPY = {
  REPORTS_TO: "Reports to",
  STEER: "Message the pilot to steer it",
  STOP: "Stop",
  STOPPING: "Stopping",
} as const;

/**
 * The quiet note in the box of an agent a pilot started, framed as the box
 * it replaces: Reports to and the pilot's chip, which opens the pilot's tab,
 * on whichever task it stands (`pilotTarget`), then Stop while a turn still
 * runs. The pilot
 * is named as the task's list names it, else as the agent's summary does,
 * since a sub-pilot's pilot stands on another task.
 */
export function PilotComposerNote({
  pilot,
  target,
  control,
  onOpenTarget,
  stop,
}: {
  pilot: NonNullable<AgentSummary["startedByPilot"]>;
  /** Where the chip opens the pilot (`pilotTarget`). */
  target: ToolTarget;
  control: AgentsControl;
  /** Opens what a target names; none where the view stands in no window that opens one. */
  onOpenTarget?: ((target: ToolTarget) => void) | undefined;
  /** Stops the agent, while it has a turn to stop; settles once the service has answered. */
  stop?: (() => Promise<unknown>) | undefined;
}): React.JSX.Element {
  const [stopping, setStopping] = useState(false);
  const pressStop = (run: () => Promise<unknown>) => {
    setStopping(true);
    run().finally(() => setStopping(false));
  };
  const subject = agentSubject(control, pilot.agentId, NOTHING_HELD, false, pilot);
  return (
    <div className={COMPOSER_ROOM_CLASS}>
      <ComposerFrame className="py-row-inset pr-row-inset pl-list-inset">
        <Banner
          look={BANNER_LOOK.ROW}
          glyph={<CornerLeftUpIcon aria-hidden="true" />}
          actions={
            stop === undefined ? undefined : (
              <Button
                busy={stopping}
                busyLabel={PILOT_NOTE_COPY.STOPPING}
                onClick={() => pressStop(stop)}
              >
                {PILOT_NOTE_COPY.STOP}
              </Button>
            )
          }
        >
          <Text>
            <span className="inline-flex min-w-0 flex-wrap items-baseline gap-tight-gap">
              <span>{PILOT_NOTE_COPY.REPORTS_TO}</span>
              <AgentActorRef
                subject={subject}
                models={control.models}
                onOpen={() => onOpenTarget?.(target)}
              />
            </span>
          </Text>
          <Text tone={TEXT_TONE.MUTED}>{PILOT_NOTE_COPY.STEER}</Text>
        </Banner>
      </ComposerFrame>
    </div>
  );
}
