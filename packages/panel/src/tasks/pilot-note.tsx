import type { AgentSummary } from "@repo/features/agent-wire";
import { BANNER_LOOK, Banner, Button, ComposerFrame, TEXT_TONE, Text } from "@repo/ui";
import { CornerLeftUpIcon } from "@repo/ui/icons";
import { useState } from "react";
import { COMPOSER_ROOM_CLASS } from "./agent-composer.js";
import { AgentActorRef, agentSubject, NOTHING_HELD } from "./agent-ref.js";
import type { ToolTarget } from "./tool-call-model.js";
import type { AgentsControl } from "./use-agents.js";

const PILOT_NOTE_COPY = {
  REPORTS_TO: "Reports to",
  STEER: "Message the pilot to steer it",
  STOP: "Stop",
  STOPPING: "Stopping",
} as const;

export function PilotComposerNote({
  pilot,
  target,
  control,
  onOpenTarget,
  stop,
}: {
  pilot: NonNullable<AgentSummary["startedByPilot"]>;
  target: ToolTarget;
  control: AgentsControl;
  onOpenTarget?: ((target: ToolTarget) => void) | undefined;
  stop?: (() => Promise<boolean>) | undefined;
}): React.JSX.Element {
  const [stopping, setStopping] = useState(false);
  if (stopping && stop === undefined) setStopping(false);
  const pressStop = (run: () => Promise<boolean>) => {
    setStopping(true);
    run().then(
      (took) => setStopping(took),
      () => setStopping(false),
    );
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
