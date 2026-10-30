import type { AgentChangedFile } from "@luke/features/agent-wire";
import { formatCount } from "@luke/features/number-format";
import {
  type Chapter,
  chapterHunks,
  chapterLineCounts,
  chapterPatches,
  type LineRef,
  threadInChapter,
} from "@luke/features/pull-request-chapters";
import { PULL_REQUEST_CHAPTERS_FAILURE_KIND } from "@luke/features/pull-request-chapters-wire";
import { FAILURE_SURFACE } from "@luke/features/shown-failure";
import { SETTINGS_VIEW } from "@luke/settings/settings-views";
import { CHAPTERS_KEY, CHAPTERS_SHORTCUTS, chaptersKeyFor } from "@luke/settings/shortcuts";
import {
  Button,
  CHIP_LOOK,
  CHIP_SIZE,
  Checkbox,
  Chip,
  type CountPart,
  CountParts,
  EMPTY_STATE_ACTION_LOOK,
  EmptyState,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  FILL_ELEMENT,
  FILL_FLOW,
  Fill,
  GAP,
  HoverCard,
  HoverCardHead,
  HoverCardNote,
  IconButton,
  INLINE_REF_LOOK,
  INLINE_REF_NAME,
  INSET,
  InlineRef,
  LIST_ROW_CURRENT,
  LIST_ROW_CURRENT_LOOK,
  LIST_ROW_INK,
  LIST_ROW_META,
  LIST_ROW_TITLE_LINES,
  List,
  ListRow,
  linesCount,
  MarkStrip,
  OVER_PANE_EDGE,
  OVER_PANE_WIDTH,
  OverPane,
  PAGER_AXIS,
  Pager,
  PaneBar,
  RowHint,
  SCROLL_FADE,
  SCROLL_OVERSCROLL,
  SCROLL_SIZE,
  ScrollArea,
  SidebarIcon,
  SPINNER_SIZE,
  Spinner,
  SpinnerRegion,
  STATUS_TONE,
  Stack,
  type StatusTone,
  TabNotice,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TIME_LOOK,
  Time,
  Tooltip,
  VisuallyHidden,
} from "@luke/ui";
import { CheckIcon, GLYPH, RotateCwIcon, SparklesIcon } from "@luke/ui/icons";
import { type ReactNode, type RefObject, useMemo, useRef, useState } from "react";
import { PANE_EDGE, usePaneSlide } from "../desktop/pane-motion.js";
import { failureShown, unreadShown } from "../failure-report.js";
import { SettingsPageLink } from "../open-settings.js";
import {
  AgentChangesTab,
  type ChangesBarHost,
  type ChangesReads,
  type ChangesThreads,
  type FileReveal,
  type LineComments,
} from "./agent-changes-tab.js";
import { Section } from "./agent-pull-request-tab.js";
import { typingInto } from "./changes-list.js";
import { CHANGES_WORDS } from "./changes-model.js";
import {
  CHAPTERS_SHOWN,
  type ChaptersShown,
  chapterMarks,
  chapterPaths,
  chaptersModelLabel,
  chaptersShown,
  chapterThreadCount,
  chapterViewed,
  drawnLines,
  firstLineRef,
  lineRefLabel,
  lineRefLines,
  steppedChapter,
} from "./chapters-model.js";
import type { ChaptersRead } from "./chapters-read.js";
import { drawnIn, useFloatsOver } from "./drawn-in.js";
import { FileCard } from "./file-ref.js";
import { fileName } from "./file-ref-model.js";
import { FileTypeIcon } from "./file-type-icon.js";
import type { TreeShown } from "./file-view.js";
import { TranscriptWords } from "./transcript-blocks.js";
import type { AgentsControl } from "./use-agents.js";

/**
 * agent-chapters-tab.tsx -- the Chapters view of an agent's Pull request tab (`agent-pull-request-tab.tsx`): its pull request's diff told as chapters to review in order, each read as its title, risk, and summary over its own hunks, drawn by Files changed's own list.
 *
 * The chapters are read from the service, which keeps the workspace's
 * newest for the pull request, as what draws them first comes on screen,
 * when the developer presses Refresh, and after a Generate
 * (`chapters-read.ts`'s `useChaptersRead`), never on a clock. The view is a
 * chunk of its own, loaded the first time it is shown, as Settings is. Nothing makes them but a press of
 * Generate chapters, which answers once the generation lands, minutes later
 * at most; until then the view stands as a ring timed from the press.
 * Chapters someone else is making stand the same way, with a Refresh, since
 * only a read sees them land. A generation that failed says why with a
 * Retry; a member who saved no API key, which chapters run on, is told to
 * save one. Chapters made for a head the pull request has moved on
 * from stand as they were, under a line saying new commits came since,
 * with Regenerate (`chapters-model.ts`): their titles, risks, summaries,
 * and What to review, but no diff, no lines or threads counted, no Viewed,
 * and no press to a key change's lines, because a chapter names its hunks
 * by their file and old start line, which the newest push's files may hold
 * an unrelated hunk at, and a hunk drawn under the wrong chapter's risk is
 * worse than none.
 *
 * Ready, the view is a rail of the chapters on its left, as Files changed's
 * tree stands on its right, and the chapter chosen beside it. Each row of
 * the rail is drawn as the Inbox's are (`ListRow`), the open one in the
 * accent's tint: its risk as a mark in its colour, its title on up to two
 * lines, and under the title the lines it adds and removes, summed as Files
 * changed sums them, or how many files it holds where it counts no line,
 * with how many review threads stand on its hunks at that line's end, and a
 * check there once it is viewed, the row standing back; its place and its
 * risk in words are a reader's alone. A chapter is viewed once each of its files is
 * marked viewed on GitHub, the marks Files changed sets, so a file two
 * chapters hold is shared by both. The rail stands beside the chapter while
 * the panel has room for it, slid in and out by its toggle as the tree is
 * (`usePaneSlide`), and folds to a strip of one mark a chapter while
 * hidden; a panel too narrow floats it over the chapter instead, put away
 * by a choice in it or Escape. "Other changes" bears no risk and is always
 * last.
 *
 * The chapter leads with its title, its number left to its rail row and
 * to a reader, its risk as a chip whose card says why, then at the bar's
 * end its Viewed box, which counts its files viewed, "Viewed 1/14", stands
 * mixed while only some are, and marks or unmarks every file in it; its
 * place, "1 of 8", and the arrows to the chapters either side (`Pager`), as
 * ← and → step; its list's diff settings, Collapse all, and tree toggle
 * (`ChangesBarHost`); and its ⋯, which offers Regenerate where chapters can
 * be made, the tab's head holding the one Refresh and the list's bar
 * nothing that acts on the whole pull request inside a chapter. The model
 * that told the chapters is named at the rail's foot. Under the bar its summary in Markdown as the
 * transcript draws words; then What to review, each change a reviewer
 * should weigh with the first lines it points at, a press of which brings
 * that file into view in the list. Under it, the
 * chapter's diff is Files changed itself (`AgentChangesTab`) fed only the
 * chapter's hunks (`chapterPatches`) and the review threads on them, over
 * the Pull request tab's own read of the files and the member's viewed
 * marks, so comments, threads, the review, and Viewed work as they do
 * there, under the chapter's bar alone; its own tree starts hidden, leaving
 * no strip, the rail standing in its room. ← and
 * → step to the previous and the next chapter, and ⇧V marks the chapter
 * viewed (`CHAPTERS_SHORTCUTS`), each answering only past the list's own
 * keys, none of which they share. Every word here is the repository's or
 * a model's about it, so the view stands inside the tab's `ph-no-capture`.
 */

/** The view's own words. */
const CHAPTERS_WORDS = {
  READING: "Reading chapters",
  FAILED: "The chapters could not be read.",
  NO_PULL_REQUEST: "No pull request yet.",
  NONE: "No chapters yet.",
  GENERATE: "Generate chapters",
  /** Why no chapters can be generated, naming the page an API key is saved on by its link. */
  unavailable: (page: ReactNode) => <>Save an API key in {page} settings to generate chapters.</>,
  GENERATING: "Generating chapters",
  ELSEWHERE: "Chapters are being generated",
  REFRESH: "Refresh",
  REFRESHING: "Refreshing",
  REGENERATE: "Regenerate",
  REGENERATE_CHAPTERS: "Regenerate chapters",
  NOTHING: "This pull request has nothing to chapter.",
  NO_FILES: "None of this chapter's changes are in the pull request now.",
  STALE_DIFF: "Regenerate the chapters to see this chapter's changes.",
  /** Which model told the chapters, as quiet caption text at the rail's foot. */
  credit: (model: string) => `Chapters by ${model}`,
  STALE: "New commits since these chapters",
  BRIEF: "Summary",
  WHAT_TO_REVIEW: "What to review",
  /** What a key change's lines name, as a reader hears its pill's kind. */
  FILE: "file",
  /** What parts a key change's file from its lines, as a reader hears its pill. */
  LINES_APART: " · ",
  /** What a press on a key change's lines does, as a reader hears it. */
  reveal: (ref: LineRef) => `Show ${lineRefLabel(ref)} in the diff`,
  /** How many of a chapter's files are viewed, as its Viewed box says it. */
  viewed: (seen: number, count: number) => `Viewed ${seen}/${count}`,
  MARK_VIEWED: "Mark chapter viewed",
  UNMARK_VIEWED: "Mark chapter not viewed",
  PREVIOUS: "Previous chapter",
  NEXT: "Next chapter",
  SHOW_RAIL: "Show chapters",
  HIDE_RAIL: "Hide chapters",
  RAIL: "Chapters",
  ACTIONS_THING: "Chapters",
  RISK_REASONS: "Why",
  /** What an arrow's hint says: where it steps, and the chapter it steps to. */
  stepTo: (words: string, chapter: Chapter | undefined) =>
    chapter === undefined ? words : `${words}: ${chapter.title}`,
  /** How many review threads stand on a chapter's hunks, as its row's speech mark says to a reader. */
  threads: "threads",
  /** How many files a chapter holds, as its row says where it counts no line: a binary file or a pure rename. */
  files: (count: number) => (count === 1 ? "1 file" : `${formatCount(count)} files`),
  /** A chapter's place in the rail, as a reader hears it before its title. */
  place: (at: number) => `${at}. `,
  /** That a chapter is viewed, as its row's check says to a reader. */
  VIEWED: "viewed",
} as const;

/** Why a generation failed, as the view says it. */
const FAILURE_WORDS = {
  [PULL_REQUEST_CHAPTERS_FAILURE_KIND.TOO_LARGE]: "This pull request is too large to chapter.",
  [PULL_REQUEST_CHAPTERS_FAILURE_KIND.TIMEOUT]: "Generating chapters took too long.",
  [PULL_REQUEST_CHAPTERS_FAILURE_KIND.MODEL_REFUSED]:
    "The model declined to chapter this pull request.",
  [PULL_REQUEST_CHAPTERS_FAILURE_KIND.INVALID_ANSWER]: "The model's chapters could not be read.",
  [PULL_REQUEST_CHAPTERS_FAILURE_KIND.UNEXPECTED]: "The chapters could not be generated.",
} as const satisfies Record<
  (typeof PULL_REQUEST_CHAPTERS_FAILURE_KIND)[keyof typeof PULL_REQUEST_CHAPTERS_FAILURE_KIND],
  string
>;

type Risk = NonNullable<Chapter["risk"]>;

/** A chapter's risk in words, as its chip and its row say it. */
const RISK_WORDS = {
  high: "High risk",
  medium: "Medium risk",
  low: "Low risk",
} as const satisfies Record<Risk, string>;

/** The tone a chapter's risk chip takes. */
const RISK_TONES = {
  high: STATUS_TONE.DANGER,
  medium: STATUS_TONE.ATTENTION,
  low: STATUS_TONE.COMPLETE,
} as const satisfies Record<Risk, StatusTone>;

/** The rail's toggle that opens it beside the chapter, which the stylesheet draws only where it has room there. */
const BESIDE_TOGGLE = '.chapter-rail-toggle[data-place="beside"]';

/** The rail's toggle that floats it over the chapter, which the stylesheet draws only where the panel has no room for it beside. */
const OVER_TOGGLE = '.chapter-rail-toggle[data-place="over"]';

/** The chapters' body: the rail, its strip, and the chapter being read, side by side, clipped at its edges as the rail slides. */
function ChaptersBody({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <Fill flow={FILL_FLOW.ROW} clip className="chapters-body">
      {children}
    </Fill>
  );
}

/** The rail's list in its scroller, which the chapters' rows stand in. */
function ChapterRailList({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <ScrollArea>
      <Stack gap={GAP.NONE} inset={INSET.COLUMN}>
        <List label={CHAPTERS_WORDS.RAIL}>{children}</List>
      </Stack>
    </ScrollArea>
  );
}

/** Which model told the chapters, as muted caption text at the rail's foot, under its rows. */
function ChaptersCredit({ model }: { model: string }): React.JSX.Element {
  return (
    <div className="chapter-rail-credit">
      <Text as={TEXT_ELEMENT.P} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} truncate>
        {CHAPTERS_WORDS.credit(chaptersModelLabel(model))}
      </Text>
    </div>
  );
}

/** The rail's own pane beside the chapter, which the chapters' rows stand in, over its foot. */
function ChapterRailFrame({
  pane,
  leaving = false,
  foot,
  children,
}: {
  pane?: React.Ref<HTMLElement> | undefined;
  leaving?: boolean;
  foot?: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <nav
      ref={pane}
      className="chapter-rail"
      aria-label={CHAPTERS_WORDS.RAIL}
      data-leaving={leaving ? "" : undefined}
      inert={leaving}
    >
      <ChapterRailList>{children}</ChapterRailList>
      {foot}
    </nav>
  );
}

/** What the rail floating over the chapter is handed (`OverPane`): whether it stands there, the doors that put it away, and the controls that float it. */
interface RailOver {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly toggle: readonly RefObject<HTMLElement | null>[];
}

/** The chapter being read, beside the rail, named by its title where it has one. */
function ChapterReading({
  label,
  children,
}: {
  label?: string | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <Fill as={FILL_ELEMENT.SECTION} className="chapter-reading" aria-label={label}>
      {children}
    </Fill>
  );
}

/**
 * Chapters being made: a ring over what is happening and how long it has
 * been, counted only while the view is shown, since the view stays mounted
 * behind `hidden`; where another's Generate is making them, a Refresh,
 * since only a read sees them land.
 */
function Generating({
  startedAt,
  ours,
  live,
  reading,
  onRefresh,
}: {
  startedAt: number;
  ours: boolean;
  live: boolean;
  reading: boolean;
  onRefresh: () => void;
}): React.JSX.Element {
  return (
    <EmptyState
      icon={<Spinner label={CHAPTERS_WORDS.GENERATING} size={SPINNER_SIZE.REGION} delay={false} />}
      title={ours ? CHAPTERS_WORDS.GENERATING : CHAPTERS_WORDS.ELSEWHERE}
      action={
        ours
          ? undefined
          : {
              label: CHAPTERS_WORDS.REFRESH,
              icon: <RotateCwIcon aria-hidden="true" />,
              busy: reading ? CHAPTERS_WORDS.REFRESHING : undefined,
              onClick: onRefresh,
            }
      }
    >
      {live ? <Time at={startedAt} look={TIME_LOOK.DURATION} /> : undefined}
    </EmptyState>
  );
}

/** A chapter's risk as its row's mark, in the risk's colour; none for "Other changes". Decoration: the row's name says it. */
function RiskMark({ risk }: { risk: Chapter["risk"] }): React.JSX.Element {
  return (
    <span
      className="block size-luke-8 rounded-luke-full data-[risk=high]:bg-danger data-[risk=low]:bg-complete data-[risk=medium]:bg-attention"
      data-risk={risk ?? undefined}
    />
  );
}

/** A chapter's risk as a chip in its tone, whose card says why. */
function RiskChip({
  risk,
  reasons,
}: {
  risk: Risk;
  reasons: readonly string[];
}): React.JSX.Element {
  const card =
    reasons.length === 0 ? undefined : (
      <HoverCard data-risk-card="">
        <HoverCardHead
          glyph={
            // Note that the dot stands in a box of its own, because the head's glyph box sizes its child to a glyph's, which would swell the dot.
            <span className="flex items-center justify-center">
              <RiskMark risk={risk} />
            </span>
          }
          name={RISK_WORDS[risk]}
        />
        {reasons.map((reason) => (
          <HoverCardNote key={reason}>{reason}</HoverCardNote>
        ))}
      </HoverCard>
    );
  return (
    <Tooltip label={card === undefined ? undefined : CHAPTERS_WORDS.RISK_REASONS} card={card}>
      <Chip look={CHIP_LOOK.PILL} size={CHIP_SIZE.COMPACT} tone={RISK_TONES[risk]}>
        {RISK_WORDS[risk]}
      </Chip>
    </Tooltip>
  );
}

/** A chapter as its rail row draws it. */
interface ChapterRow {
  readonly chapter: Chapter;
  readonly paths: readonly string[];
  readonly counts: {
    readonly additions: number;
    readonly deletions: number;
    readonly files: number;
  };
  readonly threads: number;
}

/** What a rail row's last line starts with: the lines its chapter adds and removes, or its files where it counts no line. */
function ChapterLines({ row }: { row: ChapterRow }): React.JSX.Element {
  const { additions, deletions, files } = row.counts;
  return (
    <CountParts
      parts={
        additions + deletions === 0
          ? [{ text: CHAPTERS_WORDS.files(files) }]
          : linesCount(additions, deletions)
      }
    />
  );
}

/** What a rail row's last line ends with: a speech mark and its threads where any stand, then a check once it is viewed. */
function ChapterMarks({ row, viewed }: { row: ChapterRow; viewed: boolean }): React.JSX.Element {
  const parts: readonly CountPart[] = [
    ...(row.threads === 0
      ? []
      : [
          {
            text: formatCount(row.threads),
            glyph: <GLYPH.COMMENT />,
            glyphLabel: CHAPTERS_WORDS.threads,
          },
        ]),
    ...(viewed ? [{ text: "", glyph: <CheckIcon />, glyphLabel: CHAPTERS_WORDS.VIEWED }] : []),
  ];
  return <CountParts parts={parts} />;
}

/** The rail's toggle, drawn for each place the rail can stand, the stylesheet showing the one the panel's width leaves room for, as the tree's is (`TreeToggle`). */
function RailToggle({
  beside,
  over,
  overBox,
  onBeside,
  onOver,
}: {
  beside: boolean;
  over: boolean;
  /** The box around the toggle that floats the rail, which the rail takes as its toggle. */
  overBox: RefObject<HTMLSpanElement | null>;
  onBeside: () => void;
  onOver: () => void;
}): React.JSX.Element {
  const toggle = (
    place: string,
    open: boolean,
    onToggle: () => void,
    box?: RefObject<HTMLSpanElement | null>,
  ) => {
    const label = open ? CHAPTERS_WORDS.HIDE_RAIL : CHAPTERS_WORDS.SHOW_RAIL;
    return (
      <span ref={box} className="chapter-rail-toggle" data-place={place}>
        <Tooltip label={label}>
          <IconButton
            icon={<SidebarIcon />}
            label={label}
            aria-expanded={open}
            onClick={onToggle}
          />
        </Tooltip>
      </span>
    );
  };
  return (
    <>
      {toggle("beside", beside, onBeside)}
      {toggle("over", over, onOver, overBox)}
    </>
  );
}

/** The rail: a row for each chapter, the one shown marked; a press shows it; and its foot under them. */
function ChapterRail({
  rows,
  at,
  stale,
  viewed,
  pane,
  leaving,
  over,
  foot,
  onChoose,
}: {
  rows: readonly ChapterRow[];
  at: number;
  /** Whether the chapters were made for an older head, whose lines and threads the files now read cannot count. */
  stale: boolean;
  viewed: (paths: readonly string[]) => boolean;
  pane: React.Ref<HTMLElement>;
  leaving: boolean;
  /** What the rail floating over the chapter is handed; none draws it beside the chapter. */
  over: RailOver | undefined;
  /** What stands under the rows: which model told the chapters. */
  foot: ReactNode;
  onChoose: (at: number) => void;
}): React.JSX.Element {
  const list = (
    <>
      {rows.map((row, index) => {
        const { title, risk } = row.chapter;
        const done = viewed(row.paths);
        return (
          <ListRow
            key={index}
            ink={LIST_ROW_INK.SIDEBAR}
            currentLook={LIST_ROW_CURRENT_LOOK.TINT}
            leading={<RiskMark risk={risk} />}
            title={
              // Note that its place and its risk are a reader's alone, the mark saying the risk to the eye.
              <>
                <VisuallyHidden>{CHAPTERS_WORDS.place(index + 1)}</VisuallyHidden>
                {title}
                {risk === null ? null : <VisuallyHidden>{`, ${RISK_WORDS[risk]}`}</VisuallyHidden>}
              </>
            }
            titleLines={LIST_ROW_TITLE_LINES.TWO}
            description={stale ? undefined : <ChapterLines row={row} />}
            meta={stale ? undefined : <ChapterMarks row={row} viewed={done} />}
            metaAt={LIST_ROW_META.LAST}
            current={index === at ? LIST_ROW_CURRENT.PAGE : undefined}
            muted={done}
            hint={{ Hint: RowHint, label: title }}
            onPress={() => onChoose(index)}
          />
        );
      })}
    </>
  );
  if (over === undefined) {
    return (
      <ChapterRailFrame pane={pane} leaving={leaving} foot={foot}>
        {list}
      </ChapterRailFrame>
    );
  }
  return (
    <OverPane
      open={over.open}
      onClose={over.onClose}
      toggle={over.toggle}
      label={CHAPTERS_WORDS.RAIL}
      edge={OVER_PANE_EDGE.LEFT}
      width={OVER_PANE_WIDTH.COLUMN}
    >
      <ChapterRailList>{list}</ChapterRailList>
      {foot}
    </OverPane>
  );
}

/** The strip the rail leaves in its place while hidden: a mark for each chapter in its risk's colour, dimmed once viewed, the one shown standing out; a press shows the rail (`MarkStrip`). Its box is the stylesheet's to draw only while the rail is hidden. */
function ChapterStrip({
  rows,
  at,
  viewed,
  box,
  onOpen,
}: {
  rows: readonly ChapterRow[];
  at: number;
  viewed: (paths: readonly string[]) => boolean;
  /** The strip's box, which the rail floating over the chapter takes as a toggle of its own. */
  box: RefObject<HTMLDivElement | null>;
  onOpen: () => void;
}): React.JSX.Element {
  return (
    <div ref={box} className="chapter-strip">
      <MarkStrip
        marks={rows.map((row, index) => ({
          tone: row.chapter.risk ? RISK_TONES[row.chapter.risk] : undefined,
          viewed: viewed(row.paths),
          current: index === at,
        }))}
        onPress={onOpen}
      />
    </div>
  );
}

/** One change a reviewer should weigh: its words, and the first lines it points at in the chapter's reading order, as a pill of the file's type icon, its path, and its lines, whose card names the file whole, as a file is named in place (`file-ref.tsx`), a press of which brings them into view; named alone where there is no diff to bring them into (`onReveal` none). */
function KeyChangeItem({
  change,
  paths,
  onReveal,
}: {
  change: Chapter["keyChanges"][number];
  /** The paths of the files the chapter draws, in its order. */
  paths: readonly string[];
  onReveal: ((ref: LineRef) => void) | undefined;
}): React.JSX.Element {
  const first = firstLineRef(change.lineRefs, paths);
  return (
    <li className="flex flex-col items-start gap-tight-gap">
      <TranscriptWords text={change.content} />
      {first === undefined ? null : (
        <InlineRef
          look={INLINE_REF_LOOK.PILL}
          glyph={<FileTypeIcon name={fileName(first.path)} />}
          kind={CHAPTERS_WORDS.FILE}
          label={first.path}
          name={INLINE_REF_NAME.PATH}
          state={
            // Note that the pill's rule parts its path from its lines to the eye alone, so a reader hears them parted in words.
            <>
              <VisuallyHidden>{CHAPTERS_WORDS.LINES_APART}</VisuallyHidden>
              {lineRefLines(first)}
            </>
          }
          card={<FileCard path={first.path} note={lineRefLines(first)} />}
          onPress={onReveal === undefined ? undefined : () => onReveal(first)}
          pressLabel={onReveal === undefined ? undefined : CHAPTERS_WORDS.reveal(first)}
        />
      )}
    </li>
  );
}

/** No review thread, for a view handed none. */
const NO_THREADS: ChangesThreads = { list: [], draw: () => null };

/** The chapters ready: the rail, the chapter chosen, and its diff. */
function ChaptersReading({
  agentId,
  control,
  shown,
  repository,
  tree,
  chapters,
  model,
  stale,
  generatable,
  read,
  changes,
  files,
  threads,
  lineComments,
}: {
  agentId: string;
  control: AgentsControl;
  shown: boolean;
  repository: string | null;
  tree: TreeShown;
  chapters: readonly Chapter[];
  /** The provider's id of the model that told the chapters. */
  model: string;
  stale: boolean;
  generatable: boolean;
  read: ChaptersRead;
  changes: ChangesReads;
  /** Every file the pull request changes, as the read of its files answered. */
  files: readonly AgentChangedFile[];
  threads: ChangesThreads;
  lineComments: LineComments | undefined;
}): React.JSX.Element {
  const [chosen, setChosen] = useState(0);
  const at = Math.min(chosen, chapters.length - 1);
  const [beside, setBeside] = useState(true);
  const [over, setOver] = useState(false);
  const slide = usePaneSlide(beside, PANE_EDGE.LEFT);
  // The chapter's own tree starts hidden, the rail standing in its room; its width is the panel's for every tree.
  const [filesOpen, setFilesOpen] = useState(false);
  const [briefOpen, setBriefOpen] = useState(true);
  const filesTree: TreeShown = {
    open: filesOpen,
    onToggle: () => setFilesOpen((was) => !was),
    width: tree.width,
  };
  const [reveal, setReveal] = useState<FileReveal | undefined>(undefined);
  const asks = useRef(0);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  // The box in the chapter's bar its list's own tools are drawn into, the list drawing no bar of its own.
  const [tools, setTools] = useState<HTMLElement | null>(null);
  // The box at the bar's very end its list's tree toggle is drawn into, past the ⋯, as every tab's bar stands it.
  const [end, setEnd] = useState<HTMLElement | null>(null);
  const host: ChangesBarHost = { tools, end, view: root };
  const overBox = useRef<HTMLSpanElement | null>(null);
  const stripBox = useRef<HTMLDivElement | null>(null);
  // Note that the rail floats over the chapter wherever the stylesheet draws its over toggle, and then only.
  const narrow = useFloatsOver(root, OVER_TOGGLE, BESIDE_TOGGLE);
  const hunks = useMemo(() => chapterHunks(files), [files]);
  const rows = useMemo(
    () =>
      chapters.map(
        (chapter): ChapterRow => ({
          chapter,
          paths: chapterPaths(chapter, files),
          counts: chapterLineCounts(chapter, files),
          threads: chapterThreadCount(chapter, threads.list, hunks),
        }),
      ),
    [chapters, files, hunks, threads.list],
  );
  const chapter = chapters[at];
  const row = rows[at];
  // Note that the chapter's files and threads are kept while it and the read stand, because the list draws itself anew for new ones.
  const chapterFiles = useMemo(
    () => (chapter === undefined ? [] : chapterPatches(chapter, files)),
    [chapter, files],
  );
  const chapterThreads = useMemo<ChangesThreads>(
    () =>
      chapter === undefined
        ? NO_THREADS
        : {
            ...threads,
            list: threads.list.filter((thread) => threadInChapter(thread, chapter, hunks)),
          },
    [chapter, threads, hunks],
  );
  // Note that stale chapters name hunks of an older head, so they mark no file of this one viewed.
  const marks = stale ? undefined : changes.viewedFiles.marks;
  const viewed = (paths: readonly string[]) =>
    marks === undefined ? false : chapterViewed(paths, marks.viewed);
  const markChapter = () => {
    if (marks === undefined || row === undefined) return;
    for (const path of chapterMarks(row.paths, marks.viewed)) void marks.toggle(path);
  };
  const choose = (next: number) => {
    setChosen(next);
    setReveal(undefined);
    setOver(false);
  };
  const step = (by: number) => choose(steppedChapter(at, by, chapters.length));
  // Note that the rail is shown where it is seen: beside the chapter where it has room, else over it.
  const toggleRail = () =>
    drawnIn(root, BESIDE_TOGGLE) ? setBeside((was) => !was) : setOver((was) => !was);
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && over && !event.nativeEvent.isComposing) {
      // Note that the Escape is stopped here, because the window's own would leave the view.
      event.stopPropagation();
      setOver(false);
      return;
    }
    if (event.defaultPrevented || event.nativeEvent.isComposing || typingInto(event.target)) return;
    const key = chaptersKeyFor(event);
    if (key === undefined) return;
    const runs = {
      [CHAPTERS_KEY.PREVIOUS_CHAPTER]: () => step(-1),
      [CHAPTERS_KEY.NEXT_CHAPTER]: () => step(1),
      [CHAPTERS_KEY.MARK_CHAPTER_VIEWED]: marks === undefined ? undefined : markChapter,
    } satisfies Record<typeof key, (() => void) | undefined>;
    const run = runs[key];
    if (run === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    run();
  };
  if (chapter === undefined || row === undefined) {
    return <EmptyState icon={<GLYPH.PULL_REQUEST_CHAPTERS />}>{CHAPTERS_WORDS.NOTHING}</EmptyState>;
  }
  const done = viewed(row.paths);
  const seen = marks === undefined ? 0 : row.paths.filter(marks.viewed).length;
  const previous = chapters[at - 1];
  const next = chapters[at + 1];
  return (
    // The view hears its chapter keys from whatever in it has the focus, past the list's own.
    <Fill
      ref={setRoot}
      className="chapters-view"
      data-rail-beside={String(slide.drawn)}
      data-rail-over={over ? "open" : "closed"}
      onKeyDown={onKeyDown}
    >
      {stale ? (
        <TabNotice>
          <p>{CHAPTERS_WORDS.STALE}</p>
          {generatable ? (
            <Button icon={<SparklesIcon aria-hidden="true" />} onClick={read.generate}>
              {CHAPTERS_WORDS.REGENERATE}
            </Button>
          ) : null}
        </TabNotice>
      ) : null}
      <ChaptersBody>
        <ChapterRail
          rows={rows}
          at={at}
          viewed={viewed}
          stale={stale}
          pane={slide.pane}
          leaving={slide.leaving}
          over={
            !narrow && slide.drawn
              ? undefined
              : { open: over, onClose: () => setOver(false), toggle: [overBox, stripBox] }
          }
          foot={<ChaptersCredit model={model} />}
          onChoose={choose}
        />
        <ChapterStrip rows={rows} at={at} viewed={viewed} box={stripBox} onOpen={toggleRail} />
        <ChapterReading label={`${at + 1}. ${chapter.title}`}>
          <PaneBar
            start={
              <RailToggle
                beside={beside}
                over={over}
                overBox={overBox}
                onBeside={() => setBeside((was) => !was)}
                onOver={() => setOver((was) => !was)}
              />
            }
            title={chapter.title}
            detail={
              chapter.risk === null ? undefined : (
                // A phone's bar folds the chip away, the rail's row marking the risk in its colour and saying it to a reader.
                <span className="chapter-risk flex">
                  <RiskChip risk={chapter.risk} reasons={chapter.riskReasons} />
                </span>
              )
            }
            actions={
              <>
                {marks === undefined ? null : (
                  <Tooltip
                    label={done ? CHAPTERS_WORDS.UNMARK_VIEWED : CHAPTERS_WORDS.MARK_VIEWED}
                    chord={CHAPTERS_SHORTCUTS[CHAPTERS_KEY.MARK_CHAPTER_VIEWED].chord}
                  >
                    <span className="chapter-viewed me-control-gap flex items-center whitespace-nowrap text-caption-inline text-muted-foreground tabular-nums">
                      <Checkbox checked={done} mixed={seen > 0 && !done} onChange={markChapter}>
                        {CHAPTERS_WORDS.viewed(seen, row.paths.length)}
                      </Checkbox>
                    </span>
                  </Tooltip>
                )}
                <Pager
                  axis={PAGER_AXIS.HORIZONTAL}
                  place={{ at: at + 1, total: chapters.length }}
                  previous={{
                    label: CHAPTERS_WORDS.PREVIOUS,
                    hint: CHAPTERS_WORDS.stepTo(CHAPTERS_WORDS.PREVIOUS, previous),
                    chord: CHAPTERS_SHORTCUTS[CHAPTERS_KEY.PREVIOUS_CHAPTER].chord,
                    onStep: previous === undefined ? undefined : () => step(-1),
                  }}
                  next={{
                    label: CHAPTERS_WORDS.NEXT,
                    hint: CHAPTERS_WORDS.stepTo(CHAPTERS_WORDS.NEXT, next),
                    chord: CHAPTERS_SHORTCUTS[CHAPTERS_KEY.NEXT_CHAPTER].chord,
                    onStep: next === undefined ? undefined : () => step(1),
                  }}
                />
                <span ref={setTools} className="chapter-list-tools" />
              </>
            }
            end={<span ref={setEnd} className="chapter-list-tools" />}
            menu={
              generatable
                ? {
                    thing: CHAPTERS_WORDS.ACTIONS_THING,
                    groups: [
                      [
                        {
                          label: CHAPTERS_WORDS.REGENERATE_CHAPTERS,
                          icon: <SparklesIcon aria-hidden="true" />,
                          onSelect: read.generate,
                        },
                      ],
                    ],
                  }
                : undefined
            }
          />
          <div className="flex max-h-1/2 min-h-0 flex-initial flex-col border-b border-border">
            {/* Note that a brief cut short by its share fades at the cut, never slicing a line through its letters, and a swipe past its end scrolls the Pull request tab, which a short window scrolls to the foot. */}
            <ScrollArea
              size={SCROLL_SIZE.CONTENT}
              fade={SCROLL_FADE.BOTH}
              overscroll={SCROLL_OVERSCROLL.CHAIN}
            >
              <div className="chapter-brief pb-list-inset">
                <Section
                  title={CHAPTERS_WORDS.BRIEF}
                  fold={{ open: briefOpen, onOpenChange: setBriefOpen }}
                >
                  <div className="chapter-brief-body flex max-w-page-measure flex-col gap-section-gap">
                    <TranscriptWords text={chapter.summary} />
                    {chapter.keyChanges.length === 0 ? null : (
                      <section aria-label={CHAPTERS_WORDS.WHAT_TO_REVIEW}>
                        <Text
                          as={TEXT_ELEMENT.H4}
                          variant={TEXT_VARIANT.GROUP}
                          tone={TEXT_TONE.MUTED}
                        >
                          {CHAPTERS_WORDS.WHAT_TO_REVIEW}
                        </Text>
                        <ul className="mt-item-gap flex list-none flex-col gap-section-gap p-0">
                          {chapter.keyChanges.map((change, index) => (
                            <KeyChangeItem
                              key={index}
                              change={change}
                              paths={row?.paths ?? []}
                              onReveal={
                                stale
                                  ? undefined
                                  : (ref) => {
                                      asks.current += 1;
                                      setReveal({
                                        path: ref.path,
                                        ask: asks.current,
                                        lines: drawnLines(
                                          chapterFiles.find((file) => file.path === ref.path),
                                          ref,
                                        ),
                                      });
                                    }
                              }
                            />
                          ))}
                        </ul>
                      </section>
                    )}
                  </div>
                </Section>
              </div>
            </ScrollArea>
          </div>
          {stale ? (
            <EmptyState icon={<GLYPH.PULL_REQUEST_CHANGES />}>
              {CHAPTERS_WORDS.STALE_DIFF}
            </EmptyState>
          ) : chapterFiles.length === 0 ? (
            <EmptyState icon={<GLYPH.PULL_REQUEST_CHANGES />}>{CHAPTERS_WORDS.NO_FILES}</EmptyState>
          ) : (
            <AgentChangesTab
              // Note that each chapter's list stands on its own, its folds and the file stood on its own, as a chapter is its own page.
              key={at}
              agentId={agentId}
              control={control}
              shown={shown}
              repository={repository}
              tree={filesTree}
              threads={chapterThreads}
              lineComments={lineComments}
              reads={changes}
              files={chapterFiles}
              fileReveal={reveal}
              overscroll={SCROLL_OVERSCROLL.CHAIN}
              host={host}
            />
          )}
        </ChapterReading>
      </ChaptersBody>
    </Fill>
  );
}

/** What the view draws for each state but the chapters ready, which `ChaptersReading` draws. */
function chaptersState(
  state: Exclude<ChaptersShown, { kind: typeof CHAPTERS_SHOWN.READY }>,
  read: ChaptersRead,
  live: boolean,
): ReactNode {
  switch (state.kind) {
    case CHAPTERS_SHOWN.READING:
      return <SpinnerRegion delay label={CHAPTERS_WORDS.READING} />;
    case CHAPTERS_SHOWN.FAILED:
      return (
        <ErrorState
          failure={unreadShown(FAILURE_SURFACE.AGENT_CHAPTERS_READ)}
          onRetry={read.ask}
          placement={ERROR_STATE_PLACEMENT.CENTRED}
        >
          {CHAPTERS_WORDS.FAILED}
        </ErrorState>
      );
    case CHAPTERS_SHOWN.NO_PULL_REQUEST:
      return (
        <EmptyState icon={<GLYPH.PULL_REQUEST_CHAPTERS />}>
          {CHAPTERS_WORDS.NO_PULL_REQUEST}
        </EmptyState>
      );
    case CHAPTERS_SHOWN.NONE:
      return state.generatable ? (
        <EmptyState
          icon={<GLYPH.PULL_REQUEST_CHAPTERS />}
          action={{
            label: CHAPTERS_WORDS.GENERATE,
            look: EMPTY_STATE_ACTION_LOOK.PRIMARY,
            onClick: read.generate,
          }}
        >
          {CHAPTERS_WORDS.NONE}
        </EmptyState>
      ) : (
        <EmptyState icon={<GLYPH.PULL_REQUEST_CHAPTERS />}>
          {CHAPTERS_WORDS.unavailable(<SettingsPageLink page={SETTINGS_VIEW.AGENTS} />)}
        </EmptyState>
      );
    case CHAPTERS_SHOWN.GENERATING:
      return (
        <Generating
          startedAt={state.startedAt}
          ours={state.ours}
          live={live}
          reading={read.out}
          onRefresh={read.ask}
        />
      );
    case CHAPTERS_SHOWN.GENERATION_FAILED:
      return (
        <ErrorState
          failure={failureShown({
            surface: FAILURE_SURFACE.AGENT_CHAPTERS_GENERATE,
            cause: state.failureKind,
          })}
          onRetry={state.generatable ? read.generate : undefined}
          placement={ERROR_STATE_PLACEMENT.CENTRED}
        >
          {FAILURE_WORDS[state.failureKind]}
        </ErrorState>
      );
  }
}

/**
 * One agent's Chapters view: what its read and its Generate leave to draw
 * (`chaptersShown`), and, once the chapters are ready, the chapters over
 * the Pull request tab's read of the files, which they wait on as Files
 * changed does.
 */
export function AgentChaptersTab({
  agentId,
  control,
  shown,
  repository,
  tree,
  chapters,
  changes,
  threads,
  lineComments,
}: {
  agentId: string;
  control: AgentsControl;
  /** Whether the view is on screen, which is when its time counts and its keys' sheet stands. */
  shown: boolean;
  repository: string | null;
  /** Whether the tree beside File and Changes tabs is open, whose width the chapter's own tree takes. */
  tree: TreeShown;
  chapters: ChaptersRead;
  /** The Pull request tab's read of the files and the member's viewed marks, Files changed's own. */
  changes: ChangesReads;
  threads: ChangesThreads;
  lineComments: LineComments | undefined;
}): React.JSX.Element {
  // Note that the files' head counts as well as the pull request's, because a chapter's hunks are found in the files drawn.
  const state = chaptersShown(chapters.answer, chapters.out, chapters.generating, {
    pullRequest: chapters.head,
    files: changes.pullRequest?.headSha,
  });
  if (state.kind !== CHAPTERS_SHOWN.READY) return <>{chaptersState(state, chapters, shown)}</>;
  // The chapters wait on the files as Files changed does: a failure gives way to the wait once asked again.
  const { answer, out, pullRequest } = changes;
  if (answer === undefined || (out && "failure" in answer)) {
    return <SpinnerRegion delay label={CHANGES_WORDS.READING} />;
  }
  if ("failure" in answer) {
    return (
      <ErrorState
        failure={failureShown({ surface: FAILURE_SURFACE.AGENT_CHANGES_READ, cause: answer })}
        onRetry={changes.ask}
        placement={ERROR_STATE_PLACEMENT.CENTRED}
      >
        {CHANGES_WORDS.FAILED}
      </ErrorState>
    );
  }
  if (pullRequest === null) {
    return (
      <EmptyState icon={<GLYPH.PULL_REQUEST_CHAPTERS />}>
        {CHAPTERS_WORDS.NO_PULL_REQUEST}
      </EmptyState>
    );
  }
  return (
    <ChaptersReading
      agentId={agentId}
      control={control}
      shown={shown}
      repository={repository}
      tree={tree}
      chapters={state.chapters}
      model={state.model}
      stale={state.stale}
      generatable={state.generatable}
      read={chapters}
      changes={changes}
      files={pullRequest.files}
      threads={threads}
      lineComments={lineComments}
    />
  );
}
