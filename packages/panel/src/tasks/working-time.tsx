import type { TurnRecord } from "@repo/features/agent-wire";
import type { CatalogModel } from "@repo/features/models-wire";
import { callHeading, WORKED_SEPARATOR, workingTime } from "@repo/features/time-format";
import {
  ANNOUNCE,
  cn,
  NOTE_LINE_LOOK,
  NoteLine,
  Shimmer,
  TIME_LOOK,
  Time,
  Tooltip,
  useAnnounce,
  useMinute,
} from "@repo/ui";
import type { ReactNode } from "react";
import { TurnCard } from "./turn-card.js";

const WORKING_LINE = "Working…";

const WORKED_WORDS = "Worked for ";

function workedForText(startedAt: number, endedAt: number, now: number): string {
  const ended = callHeading(endedAt, now);
  return `${WORKED_WORDS}${workingTime(endedAt - startedAt)}${WORKED_SEPARATOR}${ended}`;
}

export function WorkingTime({
  startedAt,
  className = "ml-item-gap",
}: {
  startedAt: number;
  className?: string;
}): ReactNode {
  return (
    <Time
      at={startedAt}
      look={TIME_LOOK.DURATION}
      className={cn("working-time text-muted-foreground tabular-nums", className)}
    />
  );
}

export function WorkedFor({
  startedAt,
  endedAt,
  record = {},
  models = [],
}: {
  startedAt: number;
  endedAt: number;
  record?: TurnRecord | undefined;
  models?: readonly CatalogModel[] | undefined;
}): ReactNode {
  const now = useMinute();
  const text = workedForText(startedAt, endedAt, now);
  return (
    <Tooltip
      label={text}
      card={
        <TurnCard
          startedAt={startedAt}
          endedAt={endedAt}
          now={now}
          record={record}
          models={models}
        />
      }
    >
      <NoteLine look={NOTE_LINE_LOOK.INSET} selectable data-worked="">
        <span className="tabular-nums" data-worked-length="">
          {WORKED_WORDS}
          {workingTime(endedAt - startedAt)}
        </span>
        {WORKED_SEPARATOR}
        <Time at={endedAt} look={TIME_LOOK.DAY} now={now} />
      </NoteLine>
    </Tooltip>
  );
}

export function WorkingLine({
  startedAt,
  words = WORKING_LINE,
}: {
  startedAt: number | undefined;
  words?: string;
}): ReactNode {
  useAnnounce(ANNOUNCE.POLITE, words);
  return (
    <NoteLine look={NOTE_LINE_LOOK.INSET} selectable data-working="">
      <Shimmer>{words}</Shimmer>
      {startedAt === undefined ? null : <WorkingTime startedAt={startedAt} />}
    </NoteLine>
  );
}
