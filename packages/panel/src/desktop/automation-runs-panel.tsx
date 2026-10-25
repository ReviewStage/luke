import {
  AUTOMATION_RUN_STANDING,
  type AutomationRunStanding,
  automationRunLine,
  automationRunStanding,
  automationRunTitle,
} from "@luke/features/automation-list-model";
import { AUTOMATION_FIRING, type AutomationRunSummary } from "@luke/features/automation-wire";
import { LINK_PLACE } from "@luke/features/link-grammar";
import { momentText, sinceText } from "@luke/features/time-format";
import { TRIGGER_CATALOG } from "@luke/features/trigger-catalog";
import {
  BackButton,
  EmptyState,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  FILL_ELEMENT,
  Fill,
  LIST_ROW_CURRENT,
  LIST_ROW_LEAD,
  LIST_VARIANT,
  List,
  ListMotion,
  ListRow,
  RESIZE_EDGE_SIDE,
  ResizeEdge,
  SCROLL_FADE,
  ScrollArea,
  SKELETON_SHAPE,
  Skeleton,
  SkeletonRegion,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  Tooltip,
  useMinute,
  useResizeEdge,
} from "@luke/ui";
import { GLYPH } from "@luke/ui/icons";
import { ClockIcon, ExternalLinkIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { ACTOR_SIZE, ActorMark, actorMarkWidth, automationRunActor } from "../actor-ref.js";
import { useCopyLinkItem } from "../copy-link-item.js";
import { GLYPH_STATE, type GlyphState, stateEndMark } from "../state-glyph.js";
import { centreWithin, scrollerOf } from "../tasks/code-pane.js";
import { useOpenLink } from "../tasks/use-open-link.js";
import { type MenuAction, rowMenu } from "./action-menu.js";
import { RUNS_PANEL_WIDTH, type RunsPanel } from "./folded-groups.js";
import { usePaneSlide } from "./pane-motion.js";
import { PhoneHead } from "./phone-head.js";
import type { RunsRead } from "./use-automation-runs.js";

/** What the runs' own screen is called on a phone. */
const RUNS = "Runs";
/**
 * automation-runs-panel.tsx -- the panel on an automation's page's right: its runs, newest first, each opening its agent.
 *
 * Per Editor round 2, an automation's runs stand beside its setup rather
 * than under it, in the window's own run rows: the glyph of what fired it,
 * a schedule's clock, GitHub's or an integration's mark, a webhook's hook,
 * or Run now's play, wearing where the run stands, its agent's title, what
 * it is about (a Sentry issue's title), or what fired it, a line saying
 * where its agent stands or why it did not start, and when it fired. A run
 * that started an agent opens that agent's page; one that started none opens
 * the subject it is about where it names one, in its provider, which its
 * right-click offers too, and is no press otherwise. A new
 * automation has no runs yet, and the panel, empty, says how to have one.
 * A narrow room, a phone's, has no room beside the setup, so there the
 * runs are a screen of their own the whole width (`AutomationRunsScreen`),
 * under a way back to the setup.
 */

/** Whose key a run ran on where the automation is another's, as its line names it. */
export const CREATOR = "its creator";

/** What a run's row is, which names its ⋯ and its menu. */
const RUN_THING = "Run";

/** What the panel says while the automation has no run, over how to have one. */
const NO_RUNS_LINE = "No runs yet.";

/** What the placeholder rows say to a reader while the runs are first read. */
const READING_RUNS = "Reading its runs…";

/** How wide each placeholder run's title and the line under it stand, as shares of their lines. */
const SKELETON_RUNS = [
  { title: "58%", line: "78%" },
  { title: "44%", line: "66%" },
  { title: "52%", line: "72%" },
] as const;

/** How wide a placeholder run's glyph stands: the row's own glyph size. */
const SKELETON_GLYPH = actorMarkWidth(ACTOR_SIZE.ROW);

/** How wide a placeholder run's time stands, as wide as a short "2h ago". */
const SKELETON_TIME = "36px";

/** The glyph each standing of a run wears. */
export const STANDING_GLYPH = {
  [AUTOMATION_RUN_STANDING.WORKING]: GLYPH_STATE.WORKING,
  [AUTOMATION_RUN_STANDING.FAILED]: GLYPH_STATE.FAILED,
  [AUTOMATION_RUN_STANDING.REST]: GLYPH_STATE.REST,
} as const satisfies Record<AutomationRunStanding, GlyphState>;

/** The subject an integration's run is about, as its provider's page and the words that open it; none for any other run, or one whose subject has no page. */
function subjectLink(run: AutomationRunSummary): { url: string; label: string } | undefined {
  const { firing } = run;
  if (firing.kind !== AUTOMATION_FIRING.INTEGRATION || firing.subject.url === undefined) {
    return undefined;
  }
  return { url: firing.subject.url, label: `Open in ${TRIGGER_CATALOG[firing.provider].name}` };
}

/** One run's row, a press opening its agent where it started one, or else its subject where it names one, and its ⋯ and right-click offering its Copy link and its subject; a run that opens nothing is no press. A row among many automations' runs names its automation on a line of its own. */
export function RunRow({
  run,
  keyHolder,
  automationId,
  automationName,
  linked,
  now,
  onOpenAgent,
}: {
  run: AutomationRunSummary;
  keyHolder: string | undefined;
  automationId: string | undefined;
  /** The automation it is a run of, said over its line where the list holds more than one automation's runs; none on that automation's own page. */
  automationName?: string | undefined;
  /** Whether a link named this run, which marks it and brings it into view. */
  linked: boolean;
  now: number;
  onOpenAgent: (agentId: string) => void;
}): React.JSX.Element {
  const state = STANDING_GLYPH[automationRunStanding(run)];
  const line = automationRunLine(run, keyHolder);
  const linkItem = useCopyLinkItem();
  const openLink = useOpenLink();
  const { agent } = run;
  // Note that every run offers its link, one that started no agent too, because a run's own link opens it, and a run with no menu has no ⋯ track, so its time would stand out of line with the others'.
  const copyLink =
    automationId === undefined
      ? undefined
      : linkItem({ kind: LINK_PLACE.AUTOMATION_RUN, automationId, runId: run.id });
  const subject = subjectLink(run);
  const openSubject: MenuAction | undefined =
    subject === undefined
      ? undefined
      : { label: subject.label, icon: <ExternalLinkIcon />, onSelect: () => openLink(subject.url) };
  const items = [copyLink, openSubject].filter((item) => item !== undefined);
  // A run a link named is brought into the middle of the box that scrolls it, once, as it is drawn.
  const row = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const drawn = row.current;
    const scroller = drawn === null ? undefined : scrollerOf(drawn);
    if (linked && drawn !== null && scroller !== undefined) centreWithin(scroller, drawn);
  }, [linked]);
  return (
    <ListRow
      ref={(node) => {
        row.current = node;
      }}
      leading={
        <ActorMark
          actor={automationRunActor(run, automationName ?? automationRunTitle(run))}
          size={ACTOR_SIZE.ROW}
        />
      }
      title={automationRunTitle(run)}
      lead={
        automationName === undefined
          ? undefined
          : { icon: <GLYPH.AUTOMATION />, label: automationName }
      }
      leadAt={LIST_ROW_LEAD.INLINE}
      description={
        <Tooltip label={line}>
          <span>{line}</span>
        </Tooltip>
      }
      meta={
        <span className="automation-row-meta">
          {stateEndMark(state, true)}
          <Tooltip label={momentText(run.firedAt)}>
            <span>{sinceText(run.firedAt, now)}</span>
          </Tooltip>
        </span>
      }
      current={linked ? LIST_ROW_CURRENT.ITEM : undefined}
      onPress={
        agent !== null
          ? () => onOpenAgent(agent.id)
          : subject === undefined
            ? undefined
            : () => openLink(subject.url)
      }
      menu={rowMenu(RUN_THING, [items])}
    />
  );
}

/**
 * The runs while they are first read: rows in a run's own row, a block where
 * its glyph, its title, its line, and when it fired will stand, so the runs
 * land where the blocks stood, in a card where they will stand in one, as
 * the Runs tab draws them. The rows open nothing, and the region says what
 * is being read.
 */
export function RunsSkeleton({ card = false }: { card?: boolean }): React.JSX.Element {
  return (
    <SkeletonRegion label={READING_RUNS}>
      <List label="Runs" variant={card ? LIST_VARIANT.CARD : LIST_VARIANT.PLAIN}>
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

/** What the runs say of themselves, wherever they stand: the automation's, the reader's, and the presses on them. */
interface RunsShown {
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
}

/**
 * The runs under their heading, or none where the screen is headed Runs
 * already, scrolling by themselves: quiet blocks in
 * their place while they are first read, or that there are none yet, or
 * that they could not be read. A run that starts slides in at the top, and
 * the runs under it glide down (`ListMotion`).
 */
function RunsBody({
  headed,
  mine,
  created,
  automationId,
  linkedRun,
  runs,
  onRetry,
  onOpenAgent,
}: RunsShown & { headed: boolean }): React.JSX.Element {
  const now = useMinute();
  const body = useRef<HTMLDivElement | null>(null);
  return (
    <ScrollArea fade={SCROLL_FADE.START}>
      <div ref={body} className="automation-runs-body">
        {headed ? (
          <div className="automation-runs-head">
            <Text variant={TEXT_VARIANT.SECTION} tone={TEXT_TONE.MUTED} as={TEXT_ELEMENT.H2}>
              Runs
            </Text>
          </div>
        ) : null}
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
          <ListMotion root={body}>
            <List label="Runs" moves>
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
          </ListMotion>
        )}
      </div>
    </ScrollArea>
  );
}

/** What the room beside the panel keeps for the form, as the side panel keeps the document's. */
const FORM_RESERVE = 480;

/**
 * The runs panel: the runs (`RunsBody`) on the page's right. Its left
 * edge resizes it as the side panel's does, and a
 * drag past its least width folds it away; nothing stands while it is folded.
 * It comes and goes as the window's panes do (`usePaneSlide`): in from the
 * page's right edge as it is shown, and out past it as it is folded, held
 * drawn, out of the layout and out of reach, until that slide has played.
 */
export function AutomationRunsPanel({
  panel,
  ...shown
}: RunsShown & {
  /** How wide it stands and whether it stands, kept by the window (`folded-groups.ts`). */
  panel: RunsPanel;
}): React.JSX.Element | null {
  const edge = useResizeEdge({
    side: RESIZE_EDGE_SIDE.LEFT,
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
      <ResizeEdge edge={edge} />
      <aside className="automation-runs" aria-label="Runs">
        <RunsBody headed {...shown} />
      </aside>
    </div>
  );
}

/**
 * The runs as a narrow room's screen of their own, the whole width in the
 * setup's place: the way back to the setup, named for the automation, over
 * the runs. It is drawn while hidden too, so the setup's Runs names it
 * (`aria-controls`) and the focus can be handed between the two
 * (`narrow-focus.ts`).
 */
export function AutomationRunsScreen({
  id,
  name,
  hidden,
  onBack,
  ...shown
}: RunsShown & {
  /** The id the setup's Runs names it by. */
  id: string;
  /** What the way back says: the automation's name, the setup it goes back to. */
  name: string;
  hidden: boolean;
  onBack: () => void;
}): React.JSX.Element {
  return (
    <Fill
      as={FILL_ELEMENT.SECTION}
      id={id}
      className="automation-runs-screen"
      aria-label="Runs"
      hidden={hidden}
    >
      {/* A narrow room's screen alone, headed as a phone's page is (`phone-head.tsx`): the way back to the setup, Runs centred. */}
      <PhoneHead
        place="automation-runs-page"
        start={<BackButton label={name} place={name} onBack={onBack} />}
        title={RUNS}
        end={null}
      />
      <RunsBody headed={false} {...shown} />
    </Fill>
  );
}
