import {
  AUTOMATION_RUN_STANDING,
  automationRunStanding,
} from "@luke/features/automation-list-model";
import type { AutomationWorkspaceRun } from "@luke/features/automation-wire";
import {
  type ChoiceItem,
  type CountPart,
  EmptyState,
  List,
  ListMotion,
  STATUS_TONE,
  type StatusTone,
} from "@luke/ui";
import { ClockIcon } from "@luke/ui/icons";
import { useRef } from "react";
import { CREATOR, RunRow } from "./automation-runs-panel.js";
import type { WorkspaceRunsRead } from "./use-automation-runs.js";

/**
 * automation-runs-tab.tsx -- the Automations page's Runs tab: every run of the listed workspace's automations, newest first, each opening its agent.
 *
 * Per the automation agents design, an automation's agent has no
 * place of its own in the sidebar, so this tab is where every one of them
 * is found: the runs of every automation the reader may read, archived
 * agents among them, since archiving takes a run out of the sidebar and
 * never out of reach. Each run is the row an automation's own runs panel
 * draws (`automation-runs-panel.tsx`), its automation named on a line of
 * its own, and the tab narrows them to the runs still working or the ones
 * that failed. A run that starts slides in at the top.
 */

/** Which runs the tab shows: all of them, the ones whose agent still works, or the ones that failed. */
export const RUNS_SHOWN = {
  ALL: "all",
  RUNNING: "running",
  FAILED: "failed",
} as const;

export type RunsShown = (typeof RUNS_SHOWN)[keyof typeof RUNS_SHOWN];

/** What each choice that narrows the runs is called, in the bar's order. */
const SHOWN_LABEL = {
  [RUNS_SHOWN.ALL]: "All",
  [RUNS_SHOWN.RUNNING]: "Running",
  [RUNS_SHOWN.FAILED]: "Failed",
} as const satisfies Record<RunsShown, string>;

/** The tone a choice's count is drawn in; none for All, which counts nothing. */
const SHOWN_TONE = {
  [RUNS_SHOWN.ALL]: undefined,
  [RUNS_SHOWN.RUNNING]: STATUS_TONE.WORKING,
  [RUNS_SHOWN.FAILED]: STATUS_TONE.DANGER,
} as const satisfies Record<RunsShown, StatusTone | undefined>;

/** The standing each narrowing keeps; none for All, which keeps every run. */
const SHOWN_STANDING = {
  [RUNS_SHOWN.ALL]: undefined,
  [RUNS_SHOWN.RUNNING]: AUTOMATION_RUN_STANDING.WORKING,
  [RUNS_SHOWN.FAILED]: AUTOMATION_RUN_STANDING.FAILED,
} as const satisfies Record<RunsShown, string | undefined>;

/** What the tab says where the narrowing leaves no run. */
const NONE_SHOWN = {
  [RUNS_SHOWN.ALL]: "No runs yet.",
  [RUNS_SHOWN.RUNNING]: "Nothing is running.",
  [RUNS_SHOWN.FAILED]: "No run failed.",
} as const satisfies Record<RunsShown, string>;

/** A count of runs as a choice draws it, in `tone`; none at nothing, as the sidebar's counts leave theirs out. */
export function runsCount(count: number, tone: StatusTone): readonly CountPart[] | undefined {
  return count === 0 ? undefined : [{ text: String(count), tone }];
}

/**
 * The choices that narrow the runs, Running and Failed each counting the runs
 * it keeps in its own tone, so the tab says what is working and what failed
 * before either is chosen.
 */
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

/** The runs a narrowing keeps, in the order they came. */
export function shownRuns(
  runs: readonly AutomationWorkspaceRun[],
  shown: RunsShown,
): readonly AutomationWorkspaceRun[] {
  const standing = SHOWN_STANDING[shown];
  if (standing === undefined) return runs;
  return runs.filter((run) => automationRunStanding(run) === standing);
}

/** How many of the workspace's runs still have an agent at work, which the sidebar's Automations row and the Runs tab count; none while the runs are unread. */
export function runningRuns(read: WorkspaceRunsRead): number {
  return read !== undefined && "runs" in read ? shownRuns(read.runs, RUNS_SHOWN.RUNNING).length : 0;
}

/** The runs the narrowing keeps, in a plain list as an automation's own runs panel draws them, or what the tab says where it keeps none. */
export function WorkspaceRuns({
  runs,
  shown,
  mine,
  now,
  onOpenAgent,
}: {
  runs: readonly AutomationWorkspaceRun[];
  shown: RunsShown;
  /** Whether the reading account made the automation named, whose keys its runs run on; another's runs name its creator's key. */
  mine: (automationId: string) => boolean;
  now: number;
  onOpenAgent: (agentId: string) => void;
}): React.JSX.Element {
  const body = useRef<HTMLDivElement | null>(null);
  const kept = shownRuns(runs, shown);
  if (kept.length === 0) return <EmptyState icon={<ClockIcon />}>{NONE_SHOWN[shown]}</EmptyState>;
  return (
    <div ref={body}>
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
            />
          ))}
        </List>
      </ListMotion>
    </div>
  );
}
