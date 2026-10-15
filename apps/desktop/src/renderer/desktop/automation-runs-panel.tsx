import {
  AUTOMATION_RUN_STANDING,
  type AutomationRunStanding,
  automationRunLine,
  automationRunStanding,
  automationRunTitle,
} from "@luke/features/automation-list-model";
import {
  AUTOMATION_FIRING,
  type AutomationFiring,
  type AutomationRunSummary,
} from "@luke/features/automation-wire";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import { ProviderMark } from "@luke/ui";
import { ClockIcon, PlayIcon, WebhookIcon } from "lucide-react";
import { EmptyState } from "../empty-state";
import { momentText, sinceText, useMinute } from "../planning/plan-time";
import { READ_FAILURE_PLACE, ReadFailure } from "../read-failure";
import { GLYPH_STATE, type GlyphState, StateGlyph, stateEndMark } from "../state-glyph";
import { RUNS_PANEL_WIDTH, type RunsPanel } from "./folded-groups";
import type { RunsRead } from "./use-automation-runs";
import { EDGE_SIDE, useResizableEdge } from "./use-resizable-edge";

/**
 * automation-runs-panel.tsx -- the panel on an automation's page's right: its runs, newest first, each opening its agent.
 *
 * Per Editor round 2, an automation's runs stand beside its setup rather
 * than under it, in the window's own run rows: the glyph of what fired it,
 * a schedule's clock, GitHub's mark, a webhook's hook, or Run now's play,
 * wearing where the run stands, its
 * agent's title or what fired it, a line saying where its agent stands or
 * why it did not start, and when it fired. A run that started an agent
 * opens that agent's page; one that started none is no press. A new
 * automation has no runs yet, and the panel, empty, says how to have one.
 */

/** What may fire a run: its automation's trigger, or Run now. */
type AutomationFiringKind = AutomationFiring["kind"];

/** What the panel says while the automation has no run, over how to have one. */
const NO_RUNS_TITLE = "No runs yet";

/** The glyph each standing of a run wears. */
export const STANDING_GLYPH = {
  [AUTOMATION_RUN_STANDING.WORKING]: GLYPH_STATE.WORKING,
  [AUTOMATION_RUN_STANDING.FAILED]: GLYPH_STATE.FAILED,
  [AUTOMATION_RUN_STANDING.REST]: GLYPH_STATE.REST,
} as const satisfies Record<AutomationRunStanding, GlyphState>;

/** What fires an automation or fired a run, as its row's glyph: a schedule's clock, GitHub's mark, a webhook's hook, or Run now's play. */
export function FiringGlyph({ kind }: { kind: AutomationFiringKind }): React.JSX.Element {
  switch (kind) {
    case AUTOMATION_FIRING.GITHUB:
      return <ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} />;
    case AUTOMATION_FIRING.WEBHOOK:
      return <WebhookIcon />;
    case AUTOMATION_FIRING.MANUAL:
      return <PlayIcon />;
    case AUTOMATION_FIRING.SCHEDULE:
      return <ClockIcon />;
  }
}

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
  const glyph = <FiringGlyph kind={run.firing.kind} />;
  const words = (
    <>
      <StateGlyph glyph={glyph} state={state} />
      <span className="automation-row-copy">
        <span className="automation-row-name">{automationRunTitle(run)}</span>
        <span className="automation-row-detail" title={automationRunLine(run)}>
          {automationRunLine(run)}
        </span>
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

/** What the room beside the panel keeps for the form, as the side panel keeps the document's. */
const FORM_RESERVE = 480;

/**
 * The runs panel: the runs, or that there are none yet, or that they could
 * not be read. Its left edge resizes it as the side panel's does, and a
 * drag past its least width folds it away; nothing stands while it is folded.
 */
export function AutomationRunsPanel({
  panel,
  created,
  runs,
  onRetry,
  onOpenAgent,
}: {
  /** How wide it stands and whether it stands, kept by the window (`folded-groups.ts`). */
  panel: RunsPanel;
  /** Whether the automation exists yet, so has runs to read. */
  created: boolean;
  runs: RunsRead;
  onRetry: () => void;
  onOpenAgent: (agentId: string) => void;
}): React.JSX.Element | null {
  const now = useMinute();
  const edge = useResizableEdge({
    side: EDGE_SIDE.LEFT,
    width: panel.width,
    bounds: RUNS_PANEL_WIDTH,
    reserve: () => FORM_RESERVE,
    label: "Resize runs",
    onResize: panel.onResize,
    onToggleCollapsed: panel.onToggle,
  });
  if (!panel.open) return null;
  return (
    <div className="automation-runs-pane" style={{ width: panel.width }}>
      <div className="side-panel-resize" {...edge} />
      <aside className="automation-runs" aria-label="Runs">
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
    </div>
  );
}
