import {
  AUTOMATION_RUN_STANDING,
  automationRunStanding,
} from "@repo/features/automation-list-model";
import type { AutomationWorkspaceRun } from "@repo/features/automation-wire";
import {
  type ChoiceItem,
  type CountPart,
  EmptyState,
  List,
  ListMotion,
  STATUS_TONE,
  type StatusTone,
} from "@repo/ui";
import { ClockIcon } from "@repo/ui/icons";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { useRef } from "react";
import { CREATOR, RunRow } from "./automation-runs-panel.js";
import type { WorkspaceRunsRead } from "./use-automation-runs.js";

export const RUNS_SHOWN = {
  ALL: "all",
  RUNNING: "running",
  FAILED: "failed",
} as const;

export type RunsShown = (typeof RUNS_SHOWN)[keyof typeof RUNS_SHOWN];

const SHOWN_LABEL = {
  [RUNS_SHOWN.ALL]: "All",
  [RUNS_SHOWN.RUNNING]: "Running",
  [RUNS_SHOWN.FAILED]: "Failed",
} as const satisfies Record<RunsShown, string>;

const SHOWN_TONE = {
  [RUNS_SHOWN.ALL]: undefined,
  [RUNS_SHOWN.RUNNING]: STATUS_TONE.WORKING,
  [RUNS_SHOWN.FAILED]: STATUS_TONE.DANGER,
} as const satisfies Record<RunsShown, StatusTone | undefined>;

const SHOWN_STANDING = {
  [RUNS_SHOWN.ALL]: undefined,
  [RUNS_SHOWN.RUNNING]: AUTOMATION_RUN_STANDING.WORKING,
  [RUNS_SHOWN.FAILED]: AUTOMATION_RUN_STANDING.FAILED,
} as const satisfies Record<RunsShown, string | undefined>;

const NONE_SHOWN = {
  [RUNS_SHOWN.ALL]: "No runs yet.",
  [RUNS_SHOWN.RUNNING]: "Nothing is running.",
  [RUNS_SHOWN.FAILED]: "No run failed.",
} as const satisfies Record<RunsShown, string>;

export function runsCount(count: number, tone: StatusTone): readonly CountPart[] | undefined {
  return count === 0 ? undefined : [{ text: String(count), tone }];
}

export function runsShownChoices(
  runs: readonly AutomationWorkspaceRun[],
): readonly ChoiceItem<RunsShown>[] {
  return Object.values(RUNS_SHOWN).map((shown) => {
    const tone = SHOWN_TONE[shown];
    return {
      value: shown,
      label: SHOWN_LABEL[shown],
      count: tone === undefined ? undefined : runsCount(shownRuns(runs, shown).length, tone),
    };
  });
}

export function shownRuns(
  runs: readonly AutomationWorkspaceRun[],
  shown: RunsShown,
): readonly AutomationWorkspaceRun[] {
  const standing = SHOWN_STANDING[shown];
  if (standing === undefined) return runs;
  return runs.filter((run) => automationRunStanding(run) === standing);
}

export function runningRuns(read: WorkspaceRunsRead): number {
  return read !== undefined && "runs" in read ? shownRuns(read.runs, RUNS_SHOWN.RUNNING).length : 0;
}

export function WorkspaceRuns({
  runs,
  shown,
  mine,
  now,
  onOpenAgent,
  onOpenAutomation,
}: {
  runs: readonly AutomationWorkspaceRun[];
  shown: RunsShown;
  mine: (automationId: string) => boolean;
  now: number;
  onOpenAgent: (agentId: string) => void;
  onOpenAutomation: (automationId: string) => void;
}): React.JSX.Element {
  const body = useRef<HTMLDivElement | null>(null);
  const kept = shownRuns(runs, shown);
  if (kept.length === 0) return <EmptyState icon={<ClockIcon />}>{NONE_SHOWN[shown]}</EmptyState>;
  return (
    <div ref={body}>
      <ReplayMask>
        <ListMotion root={body}>
          <List label="Runs" moves>
            {kept.map((run) => (
              <RunRow
                key={run.id}
                run={run}
                keyHolder={mine(run.automation.id) ? undefined : CREATOR}
                automationId={run.automation.id}
                automationName={run.automation.name}
                linked={false}
                now={now}
                onOpenAgent={onOpenAgent}
                onOpenAutomation={() => onOpenAutomation(run.automation.id)}
              />
            ))}
          </List>
        </ListMotion>
      </ReplayMask>
    </div>
  );
}
