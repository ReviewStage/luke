import {
  AUTOMATION_RUN_STANDING,
  type AutomationRunStanding,
  automationRunLine,
  automationRunStanding,
  automationRunTitle,
} from "@repo/features/automation-list-model";
import { AUTOMATION_FIRING, type AutomationRunSummary } from "@repo/features/automation-wire";
import { LINK_PLACE } from "@repo/features/link-grammar";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { momentText, sinceText } from "@repo/features/time-format";
import { TRIGGER_CATALOG } from "@repo/features/trigger-catalog";
import {
  BackButton,
  EmptyState,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  FILL_ELEMENT,
  Fill,
  LIST_ROW_CURRENT,
  LIST_ROW_LEAD,
  LIST_ROW_META,
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
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { ClockIcon, ExternalLinkIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { ACTOR_SIZE, ActorMark, actorMarkWidth, automationRunActor } from "../actor-ref.js";
import { useCoarsePointer } from "../coarse-pointer.js";
import { useCopyLinkItem } from "../copy-link-item.js";
import { unreadShown } from "../failure-report.js";
import { centerWithin, scrollerOf } from "../scroll-within.js";
import { GLYPH_STATE, type GlyphState, stateEndMark } from "../state-glyph.js";
import { useOpenLink } from "../tasks/use-open-link.js";
import { type MenuAction, rowMenu } from "./action-menu.js";
import { AUTOMATION_ROW_META } from "./automation-list-frame.js";
import { RUNS_PANEL_WIDTH, type RunsPanel } from "./folded-groups.js";
import { usePaneSlide } from "./pane-motion.js";
import { PhoneFindButton, PhoneHead } from "./phone-head.js";
import type { RunsRead } from "./use-automation-runs.js";

const RUNS = "Runs";

export const CREATOR = "its creator";

const RUN_THING = "Run";

const NO_RUNS_LINE = "No runs yet.";

const READING_RUNS = "Reading its runs…";

const SKELETON_RUNS = [
  { title: "58%", line: "78%" },
  { title: "44%", line: "66%" },
  { title: "52%", line: "72%" },
] as const;

const SKELETON_GLYPH = actorMarkWidth(ACTOR_SIZE.ROW);

const SKELETON_TIME = "36px";

export const STANDING_GLYPH = {
  [AUTOMATION_RUN_STANDING.WORKING]: GLYPH_STATE.WORKING,
  [AUTOMATION_RUN_STANDING.FAILED]: GLYPH_STATE.FAILED,
  [AUTOMATION_RUN_STANDING.REST]: GLYPH_STATE.REST,
} as const satisfies Record<AutomationRunStanding, GlyphState>;

function subjectLink(run: AutomationRunSummary): { url: string; label: string } | undefined {
  const { firing } = run;
  if (firing.kind !== AUTOMATION_FIRING.INTEGRATION || firing.subject.url === undefined) {
    return undefined;
  }
  return { url: firing.subject.url, label: `Open in ${TRIGGER_CATALOG[firing.provider].name}` };
}

export function RunRow({
  run,
  keyHolder,
  automationId,
  automationName,
  linked,
  now,
  onOpenAgent,
  onOpenAutomation,
}: {
  run: AutomationRunSummary;
  keyHolder: string | undefined;
  automationId: string | undefined;
  automationName?: string | undefined;
  linked: boolean;
  now: number;
  onOpenAgent: (agentId: string) => void;
  onOpenAutomation: () => void;
}): React.JSX.Element {
  const state = STANDING_GLYPH[automationRunStanding(run)];
  const line = automationRunLine(run, keyHolder);
  const linkItem = useCopyLinkItem();
  const openLink = useOpenLink();
  const coarse = useCoarsePointer();
  const { agent } = run;
  const copyLink =
    automationId === undefined
      ? undefined
      : linkItem({ kind: LINK_PLACE.AUTOMATION_RUN, automationId, runId: run.id });
  const subject = subjectLink(run);
  const openSubject: MenuAction | undefined =
    subject === undefined
      ? undefined
      : { label: subject.label, icon: <ExternalLinkIcon />, onSelect: () => openLink(subject.url) };
  const groups = [copyLink, openSubject].flatMap((item) => (item === undefined ? [] : [[item]]));
  const row = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const drawn = row.current;
    const scroller = drawn === null ? undefined : scrollerOf(drawn);
    if (linked && drawn !== null && scroller !== undefined) centerWithin(scroller, drawn);
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
      titleReplayMasked
      lead={
        automationName === undefined
          ? undefined
          : { icon: <GLYPH.AUTOMATION />, label: automationName }
      }
      leadAt={LIST_ROW_LEAD.INLINE}
      metaAt={LIST_ROW_META.TITLE}
      description={
        <Tooltip label={line}>
          <span>
            <ReplayUnmask>{line}</ReplayUnmask>
          </span>
        </Tooltip>
      }
      meta={
        <span className={AUTOMATION_ROW_META}>
          {stateEndMark(state, true)}
          <Tooltip label={momentText(run.firedAt)}>
            <span>
              <ReplayUnmask>{sinceText(run.firedAt, now)}</ReplayUnmask>
            </span>
          </Tooltip>
        </span>
      }
      current={linked ? LIST_ROW_CURRENT.ITEM : undefined}
      onPress={
        agent !== null
          ? () => onOpenAgent(agent.id)
          : subject === undefined
            ? onOpenAutomation
            : () => openLink(subject.url)
      }
      menu={rowMenu(RUN_THING, groups, undefined, true)}
      more={!coarse}
    />
  );
}

export function RunsSkeleton(): React.JSX.Element {
  return (
    <SkeletonRegion label={READING_RUNS}>
      <List label="Runs">
        {SKELETON_RUNS.map(({ title, line }) => (
          <ListRow
            key={title}
            leading={<Skeleton shape={SKELETON_SHAPE.CIRCLE} width={SKELETON_GLYPH} />}
            title={<Skeleton width={title} />}
            description={<Skeleton width={line} />}
            meta={<Skeleton width={SKELETON_TIME} />}
            metaAt={LIST_ROW_META.TITLE}
          />
        ))}
      </List>
    </SkeletonRegion>
  );
}

interface RunsShown {
  mine: boolean;
  created: boolean;
  automationId: string | undefined;
  linkedRun?: string | undefined;
  runs: RunsRead;
  onRetry: () => void;
  onOpenAgent: (agentId: string) => void;
  onOpenSetup: () => void;
}

function RunsBody({
  headed,
  mine,
  created,
  automationId,
  linkedRun,
  runs,
  onRetry,
  onOpenAgent,
  onOpenSetup,
}: RunsShown & { headed: boolean }): React.JSX.Element {
  const now = useMinute();
  const body = useRef<HTMLDivElement | null>(null);
  return (
    <ScrollArea fade={SCROLL_FADE.START}>
      <div
        ref={body}
        className="automation-runs-body flex min-h-full flex-col gap-control-gap p-ui-16"
      >
        {headed ? (
          <div className="automation-runs-head px-ui-2">
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
          <ErrorState
            failure={unreadShown(FAILURE_SURFACE.AUTOMATION_RUNS_READ, { automationId })}
            onRetry={onRetry}
            placement={ERROR_STATE_PLACEMENT.CENTERED}
          >
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
                  onOpenAutomation={onOpenSetup}
                />
              ))}
            </List>
          </ListMotion>
        )}
      </div>
    </ScrollArea>
  );
}

const FORM_RESERVE = 480;

export function AutomationRunsPanel({
  panel,
  ...shown
}: RunsShown & {
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
      className="automation-runs-pane relative flex min-h-0 max-w-automation-runs flex-none data-leaving:absolute data-leaving:inset-y-0 data-leaving:right-0 data-leaving:bg-ground"
      data-leaving={slide.leaving ? "" : undefined}
      inert={slide.leaving}
      style={{ width: panel.width }}
    >
      <ResizeEdge edge={edge} />
      <aside
        className="automation-runs flex min-w-0 flex-1 flex-col border-l border-border"
        aria-label="Runs"
      >
        <ReplayUnmask>
          <RunsBody headed {...shown} />
        </ReplayUnmask>
      </aside>
    </div>
  );
}

export function AutomationRunsScreen({
  id,
  name,
  hidden,
  onBack,
  ...shown
}: RunsShown & {
  id: string;
  name: string;
  hidden: boolean;
  onBack: () => void;
}): React.JSX.Element {
  return (
    <Fill
      as={FILL_ELEMENT.SECTION}
      id={id}
      className="automation-runs-screen [&[hidden]]:hidden"
      aria-label="Runs"
      hidden={hidden}
    >
      <PhoneHead
        place="automation-runs-page"
        start={<BackButton label={name} place={name} onBack={onBack} />}
        title={RUNS}
        titleReplayUnmasked
        end={<PhoneFindButton />}
      />
      <ReplayUnmask>
        <RunsBody headed={false} {...shown} />
      </ReplayUnmask>
    </Fill>
  );
}
