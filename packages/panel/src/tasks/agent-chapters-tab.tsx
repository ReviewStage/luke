import type { CodingAgentChangedFile } from "@luke/features/coding-agent-wire";
import {
  type Chapter,
  chapterHunks,
  chapterLineCounts,
  chapterPatches,
  type LineRef,
  threadInChapter,
} from "@luke/features/pull-request-chapters";
import { PULL_REQUEST_CHAPTERS_FAILURE_KIND } from "@luke/features/pull-request-chapters-wire";
import { CHAPTERS_KEY, CHAPTERS_SHORTCUTS, chaptersKeyFor } from "@luke/settings/shortcuts";
import {
  BUTTON_VARIANT,
  Button,
  CHIP_LOOK,
  CHIP_SIZE,
  CHIP_TONE,
  Checkbox,
  Chip,
  type ChipTone,
  EMPTY_STATE_ACTION_LOOK,
  EmptyState,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  HoverCard,
  HoverCardHead,
  HoverCardNote,
  IconButton,
  NAV_CURRENT,
  NavItem,
  SCROLL_SIZE,
  ScrollArea,
  Skeleton,
  SkeletonRegion,
  TEXT_BUTTON_TONE,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
  TextButton,
} from "@luke/ui";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BookOpenIcon,
  CheckIcon,
  FileDiffIcon,
  PanelLeftIcon,
  RotateCwIcon,
  SparklesIcon,
} from "lucide-react";
import { type ReactNode, useId, useMemo, useRef, useState } from "react";
import { PANE_EDGE, usePaneSlide } from "../desktop/pane-motion.js";
import { SpinnerRegion } from "../spinner.js";
import { Tooltip } from "../tooltip.js";
import {
  AgentChangesTab,
  type ChangesReads,
  type ChangesThreads,
  type FileReveal,
  type LineComments,
} from "./agent-changes-tab.js";
import { LinesChanged } from "./agent-published.js";
import { typingInto } from "./changes-list.js";
import { CHANGES_WORDS } from "./changes-model.js";
import {
  CHAPTERS_SHOWN,
  type ChaptersShown,
  chapterMarks,
  chapterPaths,
  chaptersShown,
  chapterThreadCount,
  chapterViewed,
  drawnLines,
  firstLineRef,
  lineRefLabel,
  steppedChapter,
} from "./chapters-model.js";
import type { ChaptersRead } from "./chapters-read.js";
import { BarMenu } from "./file-menu.js";
import type { TreeShown } from "./file-view.js";
import { TranscriptWords } from "./transcript-blocks.js";
import type { CodingAgentsControl } from "./use-coding-agents.js";
import { useWorkingNow, workingTime } from "./working-time.js";

/**
 * agent-chapters-tab.tsx -- the Chapters view of an agent's Pull request tab (`agent-pull-request-tab.tsx`): its pull request's diff told as chapters to review in order, each read as its title, risk, and summary over its own hunks, drawn by Files changed's own list.
 *
 * The chapters are read from the service, which keeps the workspace's
 * newest for the pull request, as what draws them first comes on screen,
 * when the developer presses Refresh, and after a Generate
 * (`chapters-read.ts`'s `useChaptersRead`), never on a clock. The view is a
 * chunk of its own, loaded the first time it is shown, as Settings is. Nothing makes them but a press of
 * Generate chapters, which answers once the generation lands, minutes later
 * at most; until then the view stands as a skeleton timed from the press.
 * Chapters someone else is making stand the same way, with a Refresh, since
 * only a read sees them land. A generation that failed says why with a
 * Retry; a deployment holding no key for the model says chapters are not
 * available on it. Chapters made for a head the pull request has moved on
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
 * the rail names the chapter, its number and title, its risk as a mark in
 * its colour, the lines it adds and removes, how many review threads stand
 * on its hunks, and a check once it is viewed: every one of its files
 * marked viewed on GitHub, the marks Files changed sets, so a file two
 * chapters hold is shared by both. The rail stands beside the chapter while
 * the panel has room for it, slid in and out by its toggle as the tree is
 * (`usePaneSlide`), and folds to a strip of one mark a chapter while
 * hidden; a panel too narrow floats it over the chapter instead, put away
 * by a choice in it or Escape. "Other changes" bears no risk and is always
 * last.
 *
 * The chapter leads with its title, its risk as a chip whose card says
 * why, its Viewed box, which marks or unmarks every file in it, and its
 * summary in Markdown as the transcript draws words; then What to review,
 * each change a reviewer should weigh with the first lines it points at,
 * a press of which brings that file into view in the list. Under it, the
 * chapter's diff is Files changed itself (`AgentChangesTab`) fed only the
 * chapter's hunks (`chapterPatches`) and the review threads on them, over
 * the Pull request tab's own read of the files and the member's viewed
 * marks, so comments, threads, the review, and Viewed work as they do
 * there; its own tree starts hidden, the rail standing in its room. Its
 * foot steps to the previous and the next chapter, as ← and → do, and ⇧V
 * marks the chapter viewed (`CHAPTERS_SHORTCUTS`), each answering only
 * past the list's own keys, none of which they share. Every word here is the
 * repository's or a model's about it, so the view stands inside the tab's
 * `ph-no-capture`.
 */

/** The view's own words. */
const CHAPTERS_WORDS = {
  READING: "Reading chapters",
  FAILED: "The chapters could not be read.",
  NO_PULL_REQUEST: "No pull request yet.",
  NONE: "Split this pull request into chapters to review in order, each with what to look at.",
  GENERATE: "Generate chapters",
  UNAVAILABLE: "Chapters aren't available on this deployment.",
  GENERATING: "Generating chapters",
  ELSEWHERE: "Chapters are being generated",
  REFRESH: "Refresh",
  REFRESH_CHAPTERS: "Refresh chapters",
  REGENERATE: "Regenerate",
  REGENERATE_CHAPTERS: "Regenerate chapters",
  NOTHING: "This pull request has nothing to chapter.",
  NO_FILES: "None of this chapter's changes are in the pull request now.",
  STALE_DIFF:
    "These chapters were made before the newest commits. Regenerate to see their changes.",
  STALE: "New commits since these chapters",
  WHAT_TO_REVIEW: "What to review",
  VIEWED: "Viewed",
  MARK_VIEWED: "Mark chapter viewed",
  UNMARK_VIEWED: "Mark chapter not viewed",
  PREVIOUS: "Previous chapter",
  NEXT: "Next chapter",
  SHOW_RAIL: "Show chapters",
  HIDE_RAIL: "Hide chapters",
  RAIL: "Chapters",
  ACTIONS: "Chapters actions",
  RISK_REASONS: "Why",
  /** A chapter's place among them, as its foot says it. */
  of: (at: number, count: number) => `Chapter ${at} of ${count}`,
  /** How many review threads stand on a chapter's hunks, as its row says to a reader. */
  threads: "threads",
  /** A chapter's row, as a reader hears it whole. */
  row: (at: number, title: string, risk: string | undefined, viewed: boolean) =>
    [`${at}. ${title}`, risk, viewed ? "viewed" : undefined]
      .filter((part) => part !== undefined)
      .join(", "),
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
  high: CHIP_TONE.DANGER,
  medium: CHIP_TONE.ATTENTION,
  low: CHIP_TONE.COMPLETE,
} as const satisfies Record<Risk, ChipTone>;

/** The rail's toggle that opens it beside the chapter, which the stylesheet draws only where it has room there. */
const BESIDE_TOGGLE = '.chapter-rail-toggle[data-place="beside"]';

/** How long chapters have been generating, moving each second on the window's own clock; a timer to a reader, never announced. */
function Elapsed({ startedAt }: { startedAt: number }): React.JSX.Element | null {
  const now = useWorkingNow();
  if (now === undefined) return null;
  return (
    <span role="timer" aria-live="off">
      {workingTime(now - startedAt)}
    </span>
  );
}

/** The widths of the blocks standing for the rail's rows, and for the chapter's lines. */
const SKELETON_ROWS = ["80%", "65%", "72%", "50%"] as const;
const SKELETON_LINES = ["40%", "92%", "86%", "60%"] as const;

/**
 * Chapters being made: blocks where the rail and the chapter will stand,
 * and how long it has been, counted only while the view is shown, since the
 * view stays mounted behind `hidden`; where another's Generate is making
 * them, a Refresh, since only a read sees them land.
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
  const words = ours ? CHAPTERS_WORDS.GENERATING : CHAPTERS_WORDS.ELSEWHERE;
  return (
    <div className="chapters-generating">
      <p className="chapters-generating-line">
        <span>
          {words}
          {live ? (
            <>
              {" · "}
              <Elapsed startedAt={startedAt} />
            </>
          ) : null}
        </span>
        {ours ? null : (
          <Button icon={<RotateCwIcon aria-hidden="true" />} disabled={reading} onClick={onRefresh}>
            {CHAPTERS_WORDS.REFRESH}
          </Button>
        )}
      </p>
      <SkeletonRegion label={words}>
        <div className="chapters-skeleton">
          <div className="chapters-skeleton-rail">
            {SKELETON_ROWS.map((width) => (
              <Skeleton key={width} width={width} />
            ))}
          </div>
          <div className="chapters-skeleton-reading">
            {SKELETON_LINES.map((width) => (
              <Skeleton key={width} width={width} />
            ))}
          </div>
        </div>
      </SkeletonRegion>
    </div>
  );
}

/** A chapter's risk as its row's mark, in the risk's colour; none for "Other changes". Decoration: the row's name says it. */
function RiskMark({ risk }: { risk: Chapter["risk"] }): React.JSX.Element {
  return <span className="chapter-risk-mark" data-risk={risk ?? undefined} />;
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
      <HoverCard>
        <HoverCardHead name={RISK_WORDS[risk]} />
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
  readonly lines: { readonly additions: number; readonly deletions: number };
  readonly threads: number;
}

/** The rail's toggle, drawn for each place the rail can stand, the stylesheet showing the one the panel's width leaves room for, as the tree's is (`TreeToggle`). */
function RailToggle({
  beside,
  over,
  onBeside,
  onOver,
}: {
  beside: boolean;
  over: boolean;
  onBeside: () => void;
  onOver: () => void;
}): React.JSX.Element {
  const toggle = (place: string, open: boolean, onToggle: () => void) => {
    const label = open ? CHAPTERS_WORDS.HIDE_RAIL : CHAPTERS_WORDS.SHOW_RAIL;
    return (
      <span className="chapter-rail-toggle" data-place={place}>
        <Tooltip label={label}>
          <IconButton
            icon={<PanelLeftIcon aria-hidden="true" />}
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
      {toggle("over", over, onOver)}
    </>
  );
}

/** The rail: a row for each chapter, the one shown marked; a press shows it. */
function ChapterRail({
  rows,
  at,
  stale,
  viewed,
  pane,
  leaving,
  onChoose,
}: {
  rows: readonly ChapterRow[];
  at: number;
  /** Whether the chapters were made for an older head, whose lines and threads the files now read cannot count. */
  stale: boolean;
  viewed: (paths: readonly string[]) => boolean;
  pane: React.Ref<HTMLElement>;
  leaving: boolean;
  onChoose: (at: number) => void;
}): React.JSX.Element {
  return (
    <nav
      ref={pane}
      className="chapter-rail"
      aria-label={CHAPTERS_WORDS.RAIL}
      data-leaving={leaving ? "" : undefined}
      inert={leaving}
    >
      <ScrollArea>
        <ol className="chapter-rail-list">
          {rows.map((row, index) => {
            const risk = row.chapter.risk === null ? undefined : RISK_WORDS[row.chapter.risk];
            const done = viewed(row.paths);
            return (
              <li key={index}>
                <Tooltip label={row.chapter.title}>
                  <NavItem
                    icon={<RiskMark risk={row.chapter.risk} />}
                    current={index === at ? NAV_CURRENT.PAGE : undefined}
                    detail={
                      stale ? undefined : (
                        <LinesChanged
                          additions={row.lines.additions}
                          deletions={row.lines.deletions}
                        />
                      )
                    }
                    count={stale ? undefined : { value: row.threads, noun: CHAPTERS_WORDS.threads }}
                    mark={done ? <CheckIcon aria-hidden="true" /> : undefined}
                    aria-label={CHAPTERS_WORDS.row(index + 1, row.chapter.title, risk, done)}
                    onClick={() => onChoose(index)}
                  >
                    <span className="chapter-row-number">{index + 1}</span>
                    {row.chapter.title}
                  </NavItem>
                </Tooltip>
              </li>
            );
          })}
        </ol>
      </ScrollArea>
    </nav>
  );
}

/** The strip the rail leaves in its place while hidden: a mark for each chapter in its risk's colour, dimmed once viewed, the one shown standing out; a press shows the rail. A picture of the rail, hidden from assistive technology, which reaches the rail through its toggle. */
function ChapterStrip({
  rows,
  at,
  viewed,
  onOpen,
}: {
  rows: readonly ChapterRow[];
  at: number;
  viewed: (paths: readonly string[]) => boolean;
  onOpen: () => void;
}): React.JSX.Element {
  return (
    <div className="chapter-strip" aria-hidden="true" onClick={onOpen}>
      {rows.map((row, index) => (
        <span
          key={index}
          className="chapter-strip-mark"
          data-risk={row.chapter.risk ?? undefined}
          data-viewed={viewed(row.paths) ? "" : undefined}
          data-current={index === at ? "" : undefined}
        />
      ))}
    </div>
  );
}

/** One change a reviewer should weigh: its words, and the first lines it points at in the chapter's reading order, a press of which brings them into view; named alone where there is no diff to bring them into (`onReveal` none). */
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
    <li className="chapter-key-change">
      <div className="chapter-key-change-words">
        <TranscriptWords text={change.content} />
      </div>
      {first === undefined ? null : onReveal === undefined ? (
        <span className="chapter-key-change-ref">{lineRefLabel(first)}</span>
      ) : (
        <TextButton tone={TEXT_BUTTON_TONE.LINK} onClick={() => onReveal(first)}>
          {lineRefLabel(first)}
        </TextButton>
      )}
    </li>
  );
}

/** Whether an element of the view is drawn, which is the stylesheet's to say. */
function drawnIn(view: Element | null, selector: string): boolean {
  const element = view?.querySelector(selector);
  return element !== null && element !== undefined && getComputedStyle(element).display !== "none";
}

/** No review thread, for a view handed none. */
const NO_THREADS: ChangesThreads = { list: [], draw: () => null };

/** The chapters ready: the rail, the chapter chosen, its diff, and its foot. */
function ChaptersReading({
  agentId,
  control,
  shown,
  repository,
  tree,
  chapters,
  stale,
  generatable,
  read,
  changes,
  files,
  threads,
  lineComments,
}: {
  agentId: string;
  control: CodingAgentsControl;
  shown: boolean;
  repository: string | null;
  tree: TreeShown;
  chapters: readonly Chapter[];
  stale: boolean;
  generatable: boolean;
  read: ChaptersRead;
  changes: ChangesReads;
  /** Every file the pull request changes, as the read of its files answered. */
  files: readonly CodingAgentChangedFile[];
  threads: ChangesThreads;
  lineComments: LineComments | undefined;
}): React.JSX.Element {
  const headingId = useId();
  const [chosen, setChosen] = useState(0);
  const at = Math.min(chosen, chapters.length - 1);
  const [beside, setBeside] = useState(true);
  const [over, setOver] = useState(false);
  const slide = usePaneSlide(beside, PANE_EDGE.LEFT);
  // The chapter's own tree starts hidden, the rail standing in its room; its width is the panel's for every tree.
  const [filesOpen, setFilesOpen] = useState(false);
  const filesTree: TreeShown = {
    open: filesOpen,
    onToggle: () => setFilesOpen((was) => !was),
    width: tree.width,
  };
  const [reveal, setReveal] = useState<FileReveal | undefined>(undefined);
  const asks = useRef(0);
  const root = useRef<HTMLDivElement | null>(null);
  const hunks = useMemo(() => chapterHunks(files), [files]);
  const rows = useMemo(
    () =>
      chapters.map(
        (chapter): ChapterRow => ({
          chapter,
          paths: chapterPaths(chapter, files),
          lines: chapterLineCounts(chapter, hunks),
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
    drawnIn(root.current, BESIDE_TOGGLE) ? setBeside((was) => !was) : setOver((was) => !was);
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
    return <EmptyState icon={<BookOpenIcon />}>{CHAPTERS_WORDS.NOTHING}</EmptyState>;
  }
  const done = viewed(row.paths);
  const previous = chapters[at - 1];
  const next = chapters[at + 1];
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the view hears its chapter keys from whatever in it has the focus, past the list's own.
    <div
      ref={root}
      className="chapters-view"
      data-rail-beside={String(slide.drawn)}
      data-rail-over={over ? "open" : "closed"}
      onKeyDown={onKeyDown}
    >
      {stale ? (
        <div className="file-tab-notice chapters-stale">
          <p>{CHAPTERS_WORDS.STALE}</p>
          {generatable ? (
            <Button icon={<SparklesIcon aria-hidden="true" />} onClick={read.generate}>
              {CHAPTERS_WORDS.REGENERATE}
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="chapters-body">
        {slide.drawn || over ? (
          <ChapterRail
            rows={rows}
            at={at}
            viewed={viewed}
            stale={stale}
            pane={slide.pane}
            leaving={slide.leaving}
            onChoose={choose}
          />
        ) : null}
        <ChapterStrip rows={rows} at={at} viewed={viewed} onOpen={toggleRail} />
        <section className="chapter-reading" aria-labelledby={headingId}>
          <header className="chapter-head">
            <ScrollArea size={SCROLL_SIZE.CONTENT}>
              <div className="chapter-head-body">
                <div className="chapter-head-row">
                  <RailToggle
                    beside={beside}
                    over={over}
                    onBeside={() => setBeside((was) => !was)}
                    onOver={() => setOver((was) => !was)}
                  />
                  <Text as={TEXT_ELEMENT.H3} variant={TEXT_VARIANT.SECTION} id={headingId}>
                    {at + 1}. {chapter.title}
                  </Text>
                  {chapter.risk === null ? null : (
                    <RiskChip risk={chapter.risk} reasons={chapter.riskReasons} />
                  )}
                  <span className="chapter-head-actions">
                    {marks === undefined ? null : (
                      <Tooltip
                        label={done ? CHAPTERS_WORDS.UNMARK_VIEWED : CHAPTERS_WORDS.MARK_VIEWED}
                        chord={CHAPTERS_SHORTCUTS[CHAPTERS_KEY.MARK_CHAPTER_VIEWED].chord}
                      >
                        <span className="chapter-viewed">
                          <Checkbox checked={done} onChange={markChapter}>
                            {CHAPTERS_WORDS.VIEWED}
                          </Checkbox>
                        </span>
                      </Tooltip>
                    )}
                    <BarMenu
                      label={CHAPTERS_WORDS.ACTIONS}
                      actions={[
                        {
                          label: CHAPTERS_WORDS.REFRESH_CHAPTERS,
                          icon: <RotateCwIcon aria-hidden="true" />,
                          disabled: read.out,
                          onSelect: read.ask,
                        },
                        ...(generatable
                          ? [
                              {
                                label: CHAPTERS_WORDS.REGENERATE_CHAPTERS,
                                icon: <SparklesIcon aria-hidden="true" />,
                                onSelect: read.generate,
                              },
                            ]
                          : []),
                      ]}
                    />
                  </span>
                </div>
                <div className="chapter-summary">
                  <TranscriptWords text={chapter.summary} />
                </div>
                {chapter.keyChanges.length === 0 ? null : (
                  <section
                    className="chapter-key-changes"
                    aria-label={CHAPTERS_WORDS.WHAT_TO_REVIEW}
                  >
                    <Text as={TEXT_ELEMENT.H4} variant={TEXT_VARIANT.CAPTION}>
                      {CHAPTERS_WORDS.WHAT_TO_REVIEW}
                    </Text>
                    <ul>
                      {chapter.keyChanges.map((change, index) => (
                        <KeyChangeItem
                          // oxlint-disable-next-line react/no-array-index-key -- a chapter's key changes never move.
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
            </ScrollArea>
          </header>
          {stale ? (
            <EmptyState icon={<FileDiffIcon />}>{CHAPTERS_WORDS.STALE_DIFF}</EmptyState>
          ) : chapterFiles.length === 0 ? (
            <EmptyState icon={<FileDiffIcon />}>{CHAPTERS_WORDS.NO_FILES}</EmptyState>
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
            />
          )}
          <footer className="chapter-foot">
            <Tooltip
              label={previous?.title}
              chord={CHAPTERS_SHORTCUTS[CHAPTERS_KEY.PREVIOUS_CHAPTER].chord}
            >
              <Button
                variant={BUTTON_VARIANT.QUIET}
                icon={<ArrowLeftIcon aria-hidden="true" />}
                disabled={previous === undefined}
                onClick={() => step(-1)}
              >
                {CHAPTERS_WORDS.PREVIOUS}
              </Button>
            </Tooltip>
            <span className="chapter-foot-place">{CHAPTERS_WORDS.of(at + 1, chapters.length)}</span>
            <Tooltip
              label={next?.title}
              chord={CHAPTERS_SHORTCUTS[CHAPTERS_KEY.NEXT_CHAPTER].chord}
            >
              <Button
                variant={BUTTON_VARIANT.QUIET}
                icon={<ArrowRightIcon aria-hidden="true" />}
                disabled={next === undefined}
                onClick={() => step(1)}
              >
                {CHAPTERS_WORDS.NEXT}
              </Button>
            </Tooltip>
          </footer>
        </section>
      </div>
    </div>
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
      return <SpinnerRegion label={CHAPTERS_WORDS.READING} />;
    case CHAPTERS_SHOWN.FAILED:
      return (
        <ErrorState onRetry={read.ask} placement={ERROR_STATE_PLACEMENT.CENTRED}>
          {CHAPTERS_WORDS.FAILED}
        </ErrorState>
      );
    case CHAPTERS_SHOWN.NO_PULL_REQUEST:
      return <EmptyState icon={<BookOpenIcon />}>{CHAPTERS_WORDS.NO_PULL_REQUEST}</EmptyState>;
    case CHAPTERS_SHOWN.NONE:
      return state.generatable ? (
        <EmptyState
          icon={<BookOpenIcon />}
          action={{
            label: CHAPTERS_WORDS.GENERATE,
            icon: <SparklesIcon aria-hidden="true" />,
            look: EMPTY_STATE_ACTION_LOOK.PRIMARY,
            onClick: read.generate,
          }}
        >
          {CHAPTERS_WORDS.NONE}
        </EmptyState>
      ) : (
        <EmptyState icon={<BookOpenIcon />}>{CHAPTERS_WORDS.UNAVAILABLE}</EmptyState>
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
  control: CodingAgentsControl;
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
  const state = chaptersShown(chapters.answer, chapters.out, chapters.generating);
  if (state.kind !== CHAPTERS_SHOWN.READY) return <>{chaptersState(state, chapters, shown)}</>;
  // The chapters wait on the files as Files changed does: a failure gives way to the wait once asked again.
  const { answer, out, pullRequest } = changes;
  if (answer === undefined || (out && "failure" in answer)) {
    return <SpinnerRegion label={CHANGES_WORDS.READING} />;
  }
  if ("failure" in answer) {
    return (
      <ErrorState onRetry={changes.ask} placement={ERROR_STATE_PLACEMENT.CENTRED}>
        {CHANGES_WORDS.FAILED}
      </ErrorState>
    );
  }
  if (pullRequest === null) {
    return <EmptyState icon={<BookOpenIcon />}>{CHAPTERS_WORDS.NO_PULL_REQUEST}</EmptyState>;
  }
  return (
    <ChaptersReading
      agentId={agentId}
      control={control}
      shown={shown}
      repository={repository}
      tree={tree}
      chapters={state.chapters}
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
