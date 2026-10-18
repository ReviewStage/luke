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
import { LINK_PLACE } from "@luke/features/luke-link";
import { usePaneSlide } from "@luke/panel/desktop/pane-motion";
import type { RunsRead } from "@luke/panel/desktop/use-automation-runs";
import { EDGE_SIDE, useResizableEdge } from "@luke/panel/desktop/use-resizable-edge";
import { momentText, sinceText, useMinute } from "@luke/panel/tasks/task-time";
import {
  EmptyState,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  LIST_DENSITY,
  LIST_ROW_CURRENT,
  List,
  ListRow,
  ProviderMark,
  SKELETON_SHAPE,
  Skeleton,
  SkeletonRegion,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  useMenu,
} from "@luke/ui";
import { ClockIcon, PlayIcon, WebhookIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { useCopyLinkItem } from "../copy-link-item";
import { GLYPH_STATE, type GlyphState, StateGlyph, stateEndMark } from "../state-glyph";
import { centreWithin, scrollerOf } from "../tasks/code-pane";
import { Tooltip } from "../tooltip";
import { ActionMenu } from "./action-menu";
import { RUNS_PANEL_WIDTH, type RunsPanel } from "./folded-groups";

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

/** Whose key a run ran on where the automation is another's, as its line names it. */
const CREATOR = "its creator";

/** What a run's right-click menu is called. */
const RUN_ACTIONS = "Run actions";

/** What the panel says while the automation has no run, over how to have one. */
const NO_RUNS_LINE = "No runs yet";

/** What the placeholder rows say to a reader while the runs are first read. */
const READING_RUNS = "Reading its runs…";

/** How wide each placeholder run's title and the line under it stand, as shares of their lines. */
const SKELETON_RUNS = [
  { title: "58%", line: "78%" },
  { title: "44%", line: "66%" },
  { title: "52%", line: "72%" },
] as const;

/** How wide a placeholder run's glyph stands: the row's own glyph size. */
const SKELETON_GLYPH = "var(--luke-control-icon)";

/** How wide a placeholder run's time stands, as wide as a short "2h ago". */
const SKELETON_TIME = "36px";

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

/** One run's row, a press opening its agent where it started one, and its right-click there offering its Copy link; a run that started none is words alone. */
function RunRow({
  run,
  keyHolder,
  automationId,
  linked,
  now,
  onOpenAgent,
}: {
  run: AutomationRunSummary;
  keyHolder: string | undefined;
  automationId: string | undefined;
  /** Whether a link named this run, which marks it and brings it into view. */
  linked: boolean;
  now: number;
  onOpenAgent: (agentId: string) => void;
}): React.JSX.Element {
  const state = STANDING_GLYPH[automationRunStanding(run)];
  const line = automationRunLine(run, keyHolder);
  const menu = useMenu(true);
  const linkItem = useCopyLinkItem();
  const { agent } = run;
  const copyLink =
    automationId === undefined || agent === null
      ? undefined
      : linkItem({ kind: LINK_PLACE.AUTOMATION_RUN, automationId, runId: run.id });
  // A run a link named is brought into the middle of the box that scrolls it, once, as it is drawn.
  const row = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const drawn = row.current;
    const scroller = drawn === null ? undefined : scrollerOf(drawn);
    if (linked && drawn !== null && scroller !== undefined) centreWithin(scroller, drawn);
  }, [linked]);
  return (
    <>
      <ListRow
        ref={(node) => {
          row.current = node;
        }}
        leading={<StateGlyph glyph={<FiringGlyph kind={run.firing.kind} />} state={state} />}
        title={automationRunTitle(run)}
        description={
          <Tooltip label={line}>
            <span>{line}</span>
          </Tooltip>
        }
        meta={
          <span className="automation-row-meta">
            <Tooltip label={momentText(run.firedAt)}>
              <span>{sinceText(run.firedAt, now)}</span>
            </Tooltip>
            {stateEndMark(state, true)}
          </span>
        }
        current={linked ? LIST_ROW_CURRENT.ITEM : undefined}
        onPress={agent === null ? undefined : () => onOpenAgent(agent.id)}
        onContextMenu={copyLink === undefined ? undefined : menu.contextMenu(row)}
      />
      {menu.drawn === undefined || copyLink === undefined ? null : (
        <ActionMenu
          label={RUN_ACTIONS}
          menu={menu.drawn}
          groups={[[copyLink]]}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/**
 * The runs while they are first read: rows in a run's own row, a block where
 * its glyph, its title, its line, and when it fired will stand, so the runs
 * land where the blocks stood. The rows open nothing, and the region says
 * what is being read.
 */
function RunsSkeleton(): React.JSX.Element {
  return (
    <SkeletonRegion label={READING_RUNS}>
      <List label="Runs" density={LIST_DENSITY.COMPACT}>
        {SKELETON_RUNS.map(({ title, line }) => (
          <ListRow
            key={title}
            leading={<Skeleton shape={SKELETON_SHAPE.CIRCLE} width={SKELETON_GLYPH} />}
            title={<Skeleton width={title} />}
            description={<Skeleton width={line} />}
            meta={<Skeleton width={SKELETON_TIME} />}
          />
        ))}
      </List>
    </SkeletonRegion>
  );
}

/** What the room beside the panel keeps for the form, as the side panel keeps the document's. */
const FORM_RESERVE = 480;

/**
 * The runs panel: the runs, quiet blocks in their place while they are first
 * read, or that there are none yet, or that they could not be read. Its left
 * edge resizes it as the side panel's does, and a
 * drag past its least width folds it away; nothing stands while it is folded.
 * It comes and goes as the window's panes do (`usePaneSlide`): in from the
 * page's right edge as it is shown, and out past it as it is folded, held
 * drawn, out of the layout and out of reach, until that slide has played.
 */
export function AutomationRunsPanel({
  panel,
  mine,
  created,
  automationId,
  linkedRun,
  runs,
  onRetry,
  onOpenAgent,
}: {
  /** How wide it stands and whether it stands, kept by the window (`folded-groups.ts`). */
  panel: RunsPanel;
  /** Whether the reading account made it, whose keys its runs' agents run on; another's runs name its creator's key. */
  mine: boolean;
  /** Whether the automation exists yet, so has runs to read. */
  created: boolean;
  /** The automation's id, which a run's Copy link writes its link under; none before it is created. */
  automationId: string | undefined;
  /** The run a link named, marked and brought into view; none where no link named one. */
  linkedRun?: string | undefined;
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
  const slide = usePaneSlide(panel.open);
  if (!slide.drawn) return null;
  return (
    <div
      ref={(node) => {
        slide.pane.current = node;
      }}
      className="automation-runs-pane"
      data-leaving={slide.leaving ? "" : undefined}
      inert={slide.leaving}
      style={{ width: panel.width }}
    >
      <div className="side-panel-resize" {...edge} />
      <aside className="automation-runs scroll-fade-top" aria-label="Runs">
        <div className="automation-runs-head">
          <Text variant={TEXT_VARIANT.SECTION} tone={TEXT_TONE.MUTED} as={TEXT_ELEMENT.H2}>
            Runs
          </Text>
        </div>
        {!created ? (
          <EmptyState icon={<ClockIcon />}>{NO_RUNS_LINE}</EmptyState>
        ) : runs === undefined ? (
          <RunsSkeleton />
        ) : "failed" in runs ? (
          <ErrorState onRetry={onRetry} placement={ERROR_STATE_PLACEMENT.CENTRED}>
            Its runs could not be read.
          </ErrorState>
        ) : runs.runs.length === 0 ? (
          <EmptyState icon={<ClockIcon />}>{NO_RUNS_LINE}</EmptyState>
        ) : (
          <List label="Runs" density={LIST_DENSITY.COMPACT}>
            {runs.runs.map((run) => (
              <RunRow
                key={run.id}
                run={run}
                keyHolder={mine ? undefined : CREATOR}
                automationId={automationId}
                linked={run.id === linkedRun}
                now={now}
                onOpenAgent={onOpenAgent}
              />
            ))}
          </List>
        )}
      </aside>
    </div>
  );
}
