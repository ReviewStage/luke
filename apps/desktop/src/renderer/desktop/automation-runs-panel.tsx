import {
  AUTOMATION_RUN_STANDING,
  type AutomationRunStanding,
  automationRunLine,
  automationRunStanding,
  automationRunTitle,
} from "@luke/features/automation-list-model";
import { AUTOMATION_FIRING, type AutomationRunSummary } from "@luke/features/automation-wire";
import { ClockIcon, PlayIcon } from "lucide-react";
import { EmptyState } from "../empty-state";
import { momentText, sinceText, useMinute } from "../planning/plan-time";
import { READ_FAILURE_PLACE, ReadFailure } from "../read-failure";
import { GLYPH_STATE, type GlyphState, StateGlyph, stateEndMark } from "../state-glyph";
import type { RunsRead } from "./use-automation-runs";
import { EDGE_SIDE, useResizableEdge } from "./use-resizable-edge";

/**
 * automation-runs-panel.tsx -- the panel on an automation's page's right: its runs, newest first, each opening its agent.
 *
 * Per Editor round 2, an automation's runs stand beside its setup rather
 * than under it, in the window's own run rows: the glyph of what fired it,
 * a schedule's clock or Run now's play, wearing where the run stands, its
 * agent's title or what fired it, a line saying where its agent stands or
 * why it did not start, and when it fired. A run that started an agent
 * opens that agent's page; one that started none is no press. A new
 * automation has no runs yet, and the panel, empty, says how to have one.
 */

/** What the panel says while the automation has no run, over how to have one. */
const NO_RUNS_TITLE = "No runs yet";

/** The glyph each standing of a run wears. */
export const STANDING_GLYPH = {
  [AUTOMATION_RUN_STANDING.WORKING]: GLYPH_STATE.WORKING,
  [AUTOMATION_RUN_STANDING.FAILED]: GLYPH_STATE.FAILED,
  [AUTOMATION_RUN_STANDING.REST]: GLYPH_STATE.REST,
} as const satisfies Record<AutomationRunStanding, GlyphState>;

/** One run's row, a press opening its agent where it started one. */
function RunRow({
  run,
  now,
  onOpenAgent,
}: {
  run: AutomationRunSummary;
  now: number;
  onOpenAgent: (agentId: string) => void;
}): React.JSX.Element {
  const state = STANDING_GLYPH[automationRunStanding(run)];
  const glyph = run.firing.kind === AUTOMATION_FIRING.MANUAL ? <PlayIcon /> : <ClockIcon />;
  const words = (
    <>
      <StateGlyph glyph={glyph} state={state} />
      <span className="automation-row-copy">
        <span className="automation-row-name">{automationRunTitle(run)}</span>
        <span className="automation-row-detail">{automationRunLine(run)}</span>
      </span>
      <span className="automation-row-when" title={momentText(run.firedAt)}>
        {sinceText(run.firedAt, now)}
      </span>
      {stateEndMark(state, true)}
    </>
  );
  const { agent } = run;
  return agent === null ? (
    <div className="automation-run">{words}</div>
  ) : (
    <button type="button" className="automation-run" onClick={() => onOpenAgent(agent.id)}>
      {words}
    </button>
  );
}

/** The runs panel: the runs, or that there are none yet, or that they could not be read. */
export function AutomationRunsPanel({
  width,
  open,
  onResize,
  onToggle,
  created,
  runs,
  onRetry,
  onOpenAgent,
}: {
  width: number;
  open: boolean;
  onResize: (width: number) => void;
  onToggle: () => void;
  /** Whether the automation exists yet, so has runs to read. */
  created: boolean;
  runs: RunsRead;
  onRetry: () => void;
  onOpenAgent: (agentId: string) => void;
}): React.JSX.Element {
  const now = useMinute();
  // The panel's left edge, as the side panel's: dragged to resize it, past its least width to fold it away.
  const edge = useResizableEdge({
    side: EDGE_SIDE.LEFT,
    width,
    bounds: { MIN: 280, DEFAULT: 340, MAX: 560 },
    reserve: () => 480,
    label: "Resize runs",
    onResize,
    onToggleCollapsed: onToggle,
  });
  if (!open) return <></>;
  return (
    <aside className="automation-runs" aria-label="Runs" style={{ width, position: "relative", overflow: "visible" }}>
      <div className="side-panel-resize" {...edge} />
      <h2 className="settings-group-title">Runs</h2>
      {!created ? (
        <EmptyState icon={<ClockIcon />} title={NO_RUNS_TITLE}>
          Create it, then Run now to try it.
        </EmptyState>
      ) : runs === undefined ? null : "failed" in runs ? (
        <ReadFailure
          line="Its runs could not be read."
          onRetry={onRetry}
          place={READ_FAILURE_PLACE.INLINE}
        />
      ) : runs.runs.length === 0 ? (
        <EmptyState icon={<ClockIcon />} title={NO_RUNS_TITLE}>
          Run now to try it.
        </EmptyState>
      ) : (
        <div className="automation-runs-list">
          {runs.runs.map((run) => (
            <RunRow key={run.id} run={run} now={now} onOpenAgent={onOpenAgent} />
          ))}
        </div>
      )}
    </aside>
  );
}
