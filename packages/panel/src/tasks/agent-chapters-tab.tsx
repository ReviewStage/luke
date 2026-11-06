import type { AgentChangedFile } from "@repo/features/agent-wire";
import { formatCount } from "@repo/features/number-format";
import {
  type Chapter,
  chapterHunks,
  chapterLineCounts,
  chapterPatches,
  type LineRef,
  threadInChapter,
} from "@repo/features/pull-request-chapters";
import {
  type ChaptersRunsOn,
  PULL_REQUEST_CHAPTERS_FAILURE_KIND,
} from "@repo/features/pull-request-chapters-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { SETTINGS_VIEW } from "@repo/settings/settings-views";
import { CHAPTERS_KEY, CHAPTERS_SHORTCUTS, chaptersKeyFor } from "@repo/settings/shortcuts";
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
} from "@repo/ui";
import { CheckIcon, GLYPH } from "@repo/ui/icons";
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
import { API_KEY_WORDS } from "./agent-model.js";
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
import type { PullRequestSource } from "./pull-request-source.js";
import { TranscriptWords } from "./transcript-blocks.js";

const CHAPTERS_WORDS = {
  READING: "Reading chapters",
  FAILED: "The chapters could not be read.",
  NO_PULL_REQUEST: "No pull request yet.",
  none: (runsOn: ChaptersRunsOn | undefined) =>
    runsOn === undefined
      ? "No chapters yet."
      : `No chapters yet. Generating them runs on your ${API_KEY_WORDS[runsOn.provider]}.`,
  generate: (runsOn: ChaptersRunsOn | undefined) =>
    runsOn === undefined
      ? "Generate chapters"
      : `Generate with ${chaptersModelLabel(runsOn.model)}`,
  unavailable: (page: ReactNode) => <>Save an API key in {page} settings to generate chapters.</>,
  GENERATING: "Generating chapters",
  REGENERATE: "Regenerate",
  REGENERATE_CHAPTERS: "Regenerate chapters",
  NOTHING: "This pull request has nothing to chapter.",
  NO_FILES: "None of this chapter's changes are in the pull request now.",
  STALE_DIFF: "Regenerate the chapters to see this chapter's changes.",
  credit: (model: string) => `Chapters by ${model}`,
  STALE: "New commits since these chapters",
  BRIEF: "Summary",
  WHAT_TO_REVIEW: "What to review",
  FILE: "file",
  LINES_APART: " · ",
  reveal: (ref: LineRef) => `Show ${lineRefLabel(ref)} in the diff`,
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
  stepTo: (words: string, chapter: Chapter | undefined) =>
    chapter === undefined ? words : `${words}: ${chapter.title}`,
  threads: "threads",
  files: (count: number) => (count === 1 ? "1 file" : `${formatCount(count)} files`),
  place: (at: number) => `${at}. `,
  VIEWED: "viewed",
} as const;

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

const RISK_WORDS = {
  high: "High risk",
  medium: "Medium risk",
  low: "Low risk",
} as const satisfies Record<Risk, string>;

const RISK_TONES = {
  high: STATUS_TONE.DANGER,
  medium: STATUS_TONE.ATTENTION,
  low: STATUS_TONE.COMPLETE,
} as const satisfies Record<Risk, StatusTone>;

const BESIDE_TOGGLE = '.chapter-rail-toggle[data-place="beside"]';

const OVER_TOGGLE = '.chapter-rail-toggle[data-place="over"]';

function ChaptersBody({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <Fill flow={FILL_FLOW.ROW} clip className="chapters-body">
      {children}
    </Fill>
  );
}

function ChapterRailList({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <ScrollArea>
      <Stack gap={GAP.NONE} inset={INSET.COLUMN}>
        <List label={CHAPTERS_WORDS.RAIL}>{children}</List>
      </Stack>
    </ScrollArea>
  );
}

function ChaptersCredit({ model }: { model: string }): React.JSX.Element {
  return (
    <div className="chapter-rail-credit">
      <Text as={TEXT_ELEMENT.P} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} truncate>
        {CHAPTERS_WORDS.credit(chaptersModelLabel(model))}
      </Text>
    </div>
  );
}

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

interface RailOver {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly toggle: readonly RefObject<HTMLElement | null>[];
}

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

function Generating({ startedAt, live }: { startedAt: number; live: boolean }): React.JSX.Element {
  return (
    <EmptyState
      icon={<Spinner label={CHAPTERS_WORDS.GENERATING} size={SPINNER_SIZE.REGION} delay={false} />}
      title={CHAPTERS_WORDS.GENERATING}
    >
      {live ? <Time at={startedAt} look={TIME_LOOK.DURATION} /> : undefined}
    </EmptyState>
  );
}

function RiskMark({ risk }: { risk: Chapter["risk"] }): React.JSX.Element {
  return (
    <span
      className="block size-ui-8 rounded-ui-full data-[risk=high]:bg-danger data-[risk=low]:bg-complete data-[risk=medium]:bg-attention"
      data-risk={risk ?? undefined}
    />
  );
}

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

function RailToggle({
  beside,
  over,
  overBox,
  onBeside,
  onOver,
}: {
  beside: boolean;
  over: boolean;
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
  stale: boolean;
  viewed: (paths: readonly string[]) => boolean;
  pane: React.Ref<HTMLElement>;
  leaving: boolean;
  over: RailOver | undefined;
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

function KeyChangeItem({
  change,
  paths,
  onReveal,
}: {
  change: Chapter["keyChanges"][number];
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

const NO_THREADS: ChangesThreads = { list: [], draw: () => null };

function ChaptersReading({
  agentId,
  source,
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
  source: PullRequestSource;
  shown: boolean;
  repository: string | null;
  tree: TreeShown;
  chapters: readonly Chapter[];
  model: string;
  stale: boolean;
  generatable: boolean;
  read: ChaptersRead;
  changes: ChangesReads;
  files: readonly AgentChangedFile[];
  threads: ChangesThreads;
  lineComments: LineComments | undefined;
}): React.JSX.Element {
  const [chosen, setChosen] = useState(0);
  const at = Math.min(chosen, chapters.length - 1);
  const [beside, setBeside] = useState(true);
  const [over, setOver] = useState(false);
  const slide = usePaneSlide(beside, PANE_EDGE.LEFT);
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
  const [tools, setTools] = useState<HTMLElement | null>(null);
  const [end, setEnd] = useState<HTMLElement | null>(null);
  const host: ChangesBarHost = { tools, end, view: root };
  const overBox = useRef<HTMLSpanElement | null>(null);
  const stripBox = useRef<HTMLDivElement | null>(null);
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
  const toggleRail = () =>
    drawnIn(root, BESIDE_TOGGLE) ? setBeside((was) => !was) : setOver((was) => !was);
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && over && !event.nativeEvent.isComposing) {
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
            <Button icon={<GLYPH.RETRY aria-hidden="true" />} onClick={read.generate}>
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
                          icon: <GLYPH.RETRY aria-hidden="true" />,
                          onSelect: read.generate,
                        },
                      ],
                    ],
                  }
                : undefined
            }
          />
          <div className="flex max-h-1/2 min-h-0 flex-initial flex-col border-b border-border">
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
              key={at}
              agentId={agentId}
              source={source}
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
          onRetry={read.retry}
          placement={ERROR_STATE_PLACEMENT.CENTERED}
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
            label: CHAPTERS_WORDS.generate(state.runsOn),
            look: EMPTY_STATE_ACTION_LOOK.PRIMARY,
            onClick: read.generate,
          }}
        >
          {CHAPTERS_WORDS.none(state.runsOn)}
        </EmptyState>
      ) : (
        <EmptyState icon={<GLYPH.PULL_REQUEST_CHAPTERS />}>
          {CHAPTERS_WORDS.unavailable(<SettingsPageLink page={SETTINGS_VIEW.AGENTS} />)}
        </EmptyState>
      );
    case CHAPTERS_SHOWN.GENERATING:
      return <Generating startedAt={state.startedAt} live={live} />;
    case CHAPTERS_SHOWN.GENERATION_FAILED:
      return (
        <ErrorState
          failure={failureShown({
            surface: FAILURE_SURFACE.AGENT_CHAPTERS_GENERATE,
            cause: state.failureKind,
          })}
          onRetry={state.generatable ? read.generate : undefined}
          placement={ERROR_STATE_PLACEMENT.CENTERED}
        >
          {FAILURE_WORDS[state.failureKind]}
        </ErrorState>
      );
  }
}

export function AgentChaptersTab({
  agentId,
  source,
  shown,
  repository,
  tree,
  chapters,
  changes,
  threads,
  lineComments,
}: {
  agentId: string;
  source: PullRequestSource;
  shown: boolean;
  repository: string | null;
  tree: TreeShown;
  chapters: ChaptersRead;
  changes: ChangesReads;
  threads: ChangesThreads;
  lineComments: LineComments | undefined;
}): React.JSX.Element {
  const state = chaptersShown(chapters.answer, chapters.generating, {
    pullRequest: chapters.head,
    files: changes.pullRequest?.headSha,
  });
  if (state.kind !== CHAPTERS_SHOWN.READY) return <>{chaptersState(state, chapters, shown)}</>;
  const { answer, out, pullRequest } = changes;
  if (answer === undefined || (out && "failure" in answer)) {
    return <SpinnerRegion delay label={CHANGES_WORDS.READING} />;
  }
  if ("failure" in answer) {
    return (
      <ErrorState
        failure={failureShown({ surface: FAILURE_SURFACE.AGENT_CHANGES_READ, cause: answer })}
        onRetry={changes.ask}
        placement={ERROR_STATE_PLACEMENT.CENTERED}
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
      source={source}
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
