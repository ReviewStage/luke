import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentChangesAnswerView,
} from "@luke/features/coding-agent-view";
import {
  CODING_AGENT_STATUS,
  type CodingAgentChangedFile,
  type CodingAgentChangesPeople,
  type CodingAgentPullRequest,
  DIFF_SIDE,
  type ReviewThread,
} from "@luke/features/coding-agent-wire";
import { imageTypeOfPath } from "@luke/features/github-image";
import type { CatalogModel } from "@luke/features/models-wire";
import { TASK_FILE_REFUSAL, type TaskFileRefusal } from "@luke/features/task-wire";
import { ACT_KIND } from "@luke/host/acts";
import {
  Button,
  Checkbox,
  CopyIcon,
  DownloadIcon,
  EmptyState,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  HoverCard,
  HoverCardHead,
  HoverCardNote,
  IconButton,
} from "@luke/ui";
import { fileName } from "@luke/voice/code-pane-model";
import {
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  ClipboardCopyIcon,
  CodeIcon,
  FileDiffIcon,
  ImageIcon,
  RotateCwIcon,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAct } from "../act.js";
import { appPlatform } from "../app-platform.js";
import { useCopyToast } from "../copy-feedback.js";
import {
  DIFF_SELECTION_SIDE,
  type DiffFileTexts,
  type DiffListSelection,
  type DiffSelection,
  FILE_NOTE_LINE,
} from "../diff-view/contract.js";
import { SpinnerRegion } from "../spinner.js";
import { Tooltip } from "../tooltip.js";
import { LinesChanged } from "./agent-published.js";
import { AgentActorRef, type AgentSubject } from "./agent-ref.js";
import {
  type ChangesList,
  FileHead,
  FOLD_CHORD,
  LIST_WORDS,
  useChangesList,
  VIEWED_CHORD,
} from "./changes-list.js";
import {
  blobShaOf,
  CHANGES_WORDS,
  changedFolders,
  changeMarks,
  commentLines,
  commentLinesLabel,
  EXPANSION_REFUSAL,
  EXPANSION_REFUSED_WORDS,
  type ExpansionRefusal,
  expandable,
  fileNotice,
  filePatch,
  headerPatch,
  linesChanged,
  listPatch,
  rowPlace,
  STATUS_LETTER,
  STATUS_WORDS,
  suggestedLines,
  textsOf,
  threadsOn,
  treeOrder,
} from "./changes-model.js";
import { ChangesStrip } from "./changes-strip.js";
import { agentStillWriting, pullRequestNumberLabel } from "./coding-agent-model.js";
import {
  type CommentDrafts,
  closeDraft,
  lightDraft,
  NO_DRAFTS,
  openDraft,
  withWords,
  wordsOf,
} from "./comment-drafts.js";
import { type DiffListEntry, type DiffNote, PierreDiffList } from "./diff-list.js";
import { useDiffLook, useSplitRoom } from "./file-diff.js";
import { BarMenu, copyPathAction, useSaveText } from "./file-menu.js";
import { FileTreePane } from "./file-tree-pane.js";
import { FileViewBar, type TreeShown, usePaneRoom, useTreeEdge } from "./file-view.js";
import { useFileViewSettings } from "./file-view-settings.js";
import { FilesChangedKeysSheet } from "./files-changed-keys.js";
import { ImageDiff, type ImageSides, imageDrawable } from "./image-diff.js";
import { LineComment, type PendingReview } from "./line-comment.js";
import { MinimizedThreads } from "./minimized-threads.js";
import { PullRequestMark } from "./pull-request-mark.js";
import { usePullRequestNumber } from "./pull-request-number.js";
import { OpenedBy, ReviewersLine } from "./pull-request-people.js";
import { PullRequestWriteNote } from "./pull-request-writes.js";
import type { CodingAgentsControl, HeldPeople } from "./use-coding-agents.js";
import { VIEW_SETTINGS_SCOPE, ViewSettingsButton } from "./view-settings.js";
import { useViewedFiles } from "./viewed-files.js";

/**
 * agent-changes-tab.tsx -- the Files changed view of an agent's Pull request tab (`agent-pull-request-tab.tsx`): its pull request's files drawn as a File tab draws a file, the chosen file's unified diff under the same bar and beside the same tree.
 *
 * The files are read from GitHub afresh by the service on each ask, so
 * nothing here reads on a clock: the tab asks as it first comes on screen,
 * when the developer presses Retry or Refresh changes, and the moment the
 * agent ends, since that is when what it published has settled. A refresh
 * leaves the files drawn standing until its answer lands; a read that
 * failed says so with a retry, as a File tab's does; an agent with no pull
 * request yet, or one whose pull request changes nothing, says that. The
 * panel keys the tab by its agent, so one agent's answer is never drawn in
 * another's tab.
 *
 * Who opened the pull request and its reviewers stand in the Pull request
 * tab's header above it, and what the reviews said in its overview's
 * conversation, so the view leads with its files.
 *
 * The tab is a File view (`file-view.tsx`) over its files' diffs,
 * every file in one list as stage-cli draws them (`diff-list.tsx`), each
 * under a header of its own that folds it, names it, with the letter of
 * what became of it and the lines it adds and removes, and stays at the top
 * while its lines scroll by; a file with no hunks says why under its header.
 * Its bar names the file the keys stand on, or else the one at the top of
 * the list, as breadcrumbs, whose trees list only the changed files, the
 * same letter and lines quietly beside, then the pull request's files on
 * GitHub, the diff settings, every one stage-cli offers in a popover
 * (`view-settings.tsx`), Collapse all or Expand all, the ⋯ (the file's name
 * or its patch copied, the patch saved, the changes read again, the File
 * tabs' two settings, and two of the diff's as quick checks: Split view,
 * offered dimmed while the list is too narrow to split (`file-diff.tsx`),
 * and Highlight changed words), and the tree's toggle, which shows and
 * hides the tree for every File and Changes tab alike. The tree is a File
 * tab's own pane (`file-tree-pane.tsx`) narrowed to the changed files,
 * every folder open, each row lettered A, M, D, or R, and ending, as
 * stage-cli's do, in how many review threads stand on its file, the lines
 * it adds and removes where the tree has room, and a Viewed toggle that
 * marks it as its header's box does, its row dimmed once viewed; its search the
 * list's filter, narrowing the list to the files whose path holds it as it
 * narrows the rows, said over the list while the tree is hidden, with the
 * pull request's count under it, or under the list while the tree is
 * hidden; choosing a file there or in a crumb's tree scrolls the list to
 * it. stage-cli's keys walk the list (`changes-list.tsx`), and `?` opens a
 * sheet listing them (`files-changed-keys.tsx`). The diffs are
 * drawn by Pierre's diffs in a bundle of its own (`../diff-view/`), on the
 * File tab's ground, in its type and colours, unified or split, numbered
 * and wrapped as the File tabs' settings say, their numbers left out of the
 * find and of a copy as a File tab's are; what is a diff's alone is the
 * tint of a line added or removed, the words a changed line changed, and
 * the count of unchanged lines between two hunks, which open twenty at a
 * time or all at once, read from the file at the pull request's head the
 * first time one of its gaps is opened (`useFileTexts`).
 *
 * Where the Pull request tab lets the member comment, lines picked with
 * the gutter's +, or code selected as text over them, open a comment under
 * the last of them (`line-comment.tsx`), several at once across lines and
 * files, each keeping its words while it is scrolled out of the list
 * (`useListCommenting`). The pointer resting on a review thread lights the
 * lines it is on (`useThreadHover`), over those of the comment written in
 * last.
 * Every name and line here is the repository's, so the tab is left out of
 * the screen recording (`ph-no-capture`).
 */

/** A read that threw rather than answered, drawn as any other failed read. */
const UNANSWERED: CodingAgentChangesAnswerView = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED };

/**
 * One agent's read as last answered, none before the first read lands;
 * whether a read is out; and the door that reads it again. The read is
 * asked as the tab first comes on screen and again the moment the agent
 * ends, since that is when what it published settles; every ask is
 * numbered, so only the latest one's answer is drawn, and a read that threw
 * rather than answered lands as `unanswered`. The Changes and Pull request
 * tabs read through it alike.
 */
export function useAgentRead<A>(
  agentId: string,
  shown: boolean,
  ended: boolean,
  read: (agentId: string) => Promise<A>,
  unanswered: A,
) {
  const [answer, setAnswer] = useState<A | undefined>(undefined);
  const [out, setOut] = useState(false);
  const latest = useRef({ read, unanswered });
  latest.current = { read, unanswered };
  const asked = useRef(0);
  // The agent's standing the last read on its own was asked for.
  const readFor = useRef<boolean | undefined>(undefined);

  const ask = useCallback(() => {
    asked.current += 1;
    const ask = asked.current;
    setOut(true);
    const settle = (next: A) => {
      if (ask !== asked.current) return;
      setOut(false);
      setAnswer(next);
    };
    latest.current.read(agentId).then(settle, () => settle(latest.current.unanswered));
  }, [agentId]);

  useEffect(() => {
    if (!shown || readFor.current === ended) return;
    readFor.current = ended;
    ask();
  }, [shown, ended, ask]);

  return { answer, out, ask };
}

/** What became of the chosen file, quiet beside its path in the bar: its letter, named in its hint, and the lines it adds and removes. */
function ChangeBeside({ file }: { file: CodingAgentChangedFile }): React.JSX.Element {
  return (
    <>
      <Tooltip label={STATUS_WORDS[file.status]}>
        <span className="file-view-status" data-status={file.status}>
          {STATUS_LETTER[file.status]}
        </span>
      </Tooltip>
      <LinesChanged additions={file.additions} deletions={file.deletions} />
    </>
  );
}

/** The bar's ⋯ over a diff: the file's name, its path, or its patch copied, the patch saved, and the changes read again. */
function ChangesMenu({
  file,
  reading,
  onRefresh,
}: {
  file: CodingAgentChangedFile;
  /** Whether a read is out, which a refresh would only repeat. */
  reading: boolean;
  onRefresh: () => void;
}): React.JSX.Element {
  const copyWithToast = useCopyToast();
  const saveText = useSaveText();
  const name = fileName(file.path);
  const patch = filePatch(file);
  return (
    <BarMenu
      label="Changes actions"
      actions={[
        {
          label: "Copy file name",
          icon: <CopyIcon />,
          onSelect: () => copyWithToast(name, "File name copied"),
        },
        copyPathAction(file.path, copyWithToast),
        {
          label: "Copy patch",
          icon: <ClipboardCopyIcon aria-hidden="true" />,
          disabled: patch === undefined,
          onSelect: () => {
            if (patch !== undefined) copyWithToast(patch, "Patch copied");
          },
        },
        {
          label: "Download patch",
          icon: <DownloadIcon />,
          disabled: patch === undefined,
          onSelect: () => {
            if (patch !== undefined) saveText(`${name}.patch`, patch).catch(() => undefined);
          },
        },
        {
          label: "Refresh changes",
          icon: <RotateCwIcon aria-hidden="true" />,
          disabled: reading,
          onSelect: onRefresh,
        },
      ]}
    />
  );
}

/** A pull request's review threads as Files changed draws them on their lines: the threads, and the door that draws one. */
export interface ChangesThreads {
  readonly list: readonly ReviewThread[];
  /** Draws one, under its line or above the diff, where it names the lines it is on. */
  readonly draw: (thread: ReviewThread, place: ThreadPlace) => ReactNode;
  /** Reads the threads again, as Refresh changes reads the files again, so the two describe the same push. */
  readonly refresh?: (() => void) | undefined;
}

/** Where a review thread is drawn in a file's diff: under the line it stands on, or above the diff, which draws no row for it. */
export const THREAD_PLACE = {
  ON_LINE: "on-line",
  ABOVE: "above",
} as const;

export type ThreadPlace = (typeof THREAD_PLACE)[keyof typeof THREAD_PLACE];

/**
 * The key each side's review threads with no drawn row stand above a
 * file's first hunk by, in a list of their own; a review thread's note is
 * keyed by its page, which neither is.
 */
const ABOVE_KEY = {
  [DIFF_SELECTION_SIDE.DELETIONS]: "above-deletions",
  [DIFF_SELECTION_SIDE.ADDITIONS]: "above-additions",
} as const satisfies Record<DiffSelection["side"], string>;

/** The key of the line saying why a file's gaps could not be opened; a review thread's note is keyed by its page, which this never is. */
const REFUSED_KEY = "gaps-refused";

/** The key of what stands in the place of the lines of a file that draws none; a review thread's note is keyed by its page, which this never is. */
const LEAD_KEY = "lead";

/** A file's review threads that stand above its lines, as one list. */
function AboveThreads({
  above,
  draw,
}: {
  above: readonly { readonly key: string; readonly thread: ReviewThread }[];
  draw: ChangesThreads["draw"] | undefined;
}): React.JSX.Element {
  return (
    <ol className="diff-outdated-threads" aria-label={CHANGES_WORDS.UNPLACED_THREADS}>
      {above.map((each) => (
        <li key={each.key}>{draw?.(each.thread, THREAD_PLACE.ABOVE)}</li>
      ))}
    </ol>
  );
}

/**
 * What lights the lines review threads are on while the pointer rests on
 * them, and lets them go as it leaves: one thread, or the chip a line's
 * threads are minimized to, the whole group, told apart by `group`, since
 * the chip and a thread under it share their first thread's key.
 */
type ThreadHover = (
  key: string,
  group: boolean,
  lines: DiffListSelection | undefined,
  resting: boolean,
) => void;

/**
 * Review threads on their line, one or a minimized chip's, which light the
 * lines they are on while the pointer rests on them, as stage-cli's threads
 * do; drawn as they are where nothing lights them.
 */
function ThreadLines({
  hoverKey,
  group = false,
  lines,
  hover,
  children,
}: {
  hoverKey: string;
  group?: boolean;
  /** The lines the threads are on, as the list lights them (`threadLines`). */
  lines: DiffListSelection | undefined;
  hover: ThreadHover | undefined;
  children: ReactNode;
}): React.JSX.Element {
  if (hover === undefined) return <>{children}</>;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the pointer resting on a thread only lights the lines it is on; nothing is pressed.
    <div
      className="diff-thread-lines"
      onMouseEnter={() => hover(hoverKey, group, lines, true)}
      onMouseLeave={() => hover(hoverKey, group, lines, false)}
    >
      {children}
    </div>
  );
}

/** Which of a file's lines show their threads while Minimize inline comments is on, and the door that shows or hides one line's. */
interface FileMinimized {
  readonly shown: (side: DiffSelection["side"], line: number) => boolean;
  readonly show: (side: DiffSelection["side"], line: number, shown: boolean) => void;
}

/**
 * A file's threads on their lines while Minimize inline comments is on, as
 * stage-cli draws them: each line's threads as one chip at the line's end
 * (`MinimizedThreads`), standing in a row of no height, and under it, once
 * the chip shows them, the threads as they are drawn otherwise. A line a
 * comment is being written on always shows its threads, since the comment
 * stands among them.
 */
function minimizedNotes(
  file: CodingAgentChangedFile,
  placed: ReturnType<typeof threadsOn>["placed"],
  draw: ChangesThreads["draw"] | undefined,
  minimized: FileMinimized,
  comments: readonly DiffNote[],
  hover: ThreadHover | undefined,
): DiffNote[] {
  const lines = new Map<DiffSelection["side"], Map<number, typeof placed>>();
  for (const each of placed) {
    const side = lines.get(each.side) ?? new Map<number, typeof placed>();
    lines.set(each.side, side.set(each.line, [...(side.get(each.line) ?? []), each]));
  }
  return [...lines].flatMap(([side, onSide]) =>
    [...onSide].flatMap(([line, threads]) => {
      const drawn = threads.map((each) => (
        <ThreadLines
          key={each.key}
          hoverKey={each.key}
          lines={threadLines([each.thread], file)}
          hover={hover}
        >
          {draw?.(each.thread, THREAD_PLACE.ON_LINE)}
        </ThreadLines>
      ));
      const [first] = threads;
      if (first === undefined) return [];
      // A line a comment is being written on shows its threads as they are, the comment among them.
      const writing = comments.some((comment) => comment.side === side && comment.line === line);
      return writing
        ? threads.map((each, at) => ({ key: each.key, side, line, content: drawn[at] }))
        : [
            {
              key: first.key,
              side,
              line,
              content: (
                // The chip lights the lines its threads stand on, as each thread does once shown.
                <ThreadLines
                  hoverKey={first.key}
                  group
                  lines={threadLines(
                    threads.map((each) => each.thread),
                    file,
                  )}
                  hover={hover}
                >
                  <MinimizedThreads
                    threads={threads.map((each) => each.thread)}
                    shown={minimized.shown(side, line)}
                    onShown={(shown) => minimized.show(side, line, shown)}
                  >
                    {drawn}
                  </MinimizedThreads>
                </ThreadLines>
              ),
            },
          ];
    }),
  );
}

/**
 * A file of the list as the bundle is handed it: its patch, its fold, its
 * header, and its notes: each review thread under its line, and those its
 * diff draws no row for above the first hunk (`threadsOn`), on the side
 * each counts on, as GitHub's split diff has them. A file with no hunks to
 * draw, or a changed image drawn as its pictures (`image-diff.tsx`), stands
 * as what is drawn in the place of its lines alone (`lead`), across its
 * width: why it has none, or the pictures, and every one of its review
 * threads. Each comment being written on its lines stands under the last
 * of them, and each thread on a line lights its lines while the pointer
 * rests on it.
 */
function entryOf(
  file: CodingAgentChangedFile,
  list: ChangesList,
  /** The review threads on this file, and the door that draws one. */
  threads: readonly ReviewThread[],
  draw: ChangesThreads["draw"] | undefined,
  images: ImageSides | undefined,
  comments: readonly DiffNote[],
  /** Whether the lines between its hunks may be opened, and why they could not be where a read was refused. */
  gaps: { readonly open: boolean; readonly refused: ExpansionRefusal | undefined },
  /** Which of the file's lines show their threads while Minimize inline comments is on, and the door that shows or hides one; none while it is off. */
  minimized: FileMinimized | undefined,
  hover: ThreadHover | undefined,
): DiffListEntry {
  const path = file.path;
  const image = imageTypeOfPath(path) === undefined || images === undefined ? undefined : images;
  // An SVG with lines to draw is text as well as a picture: its lines are drawn while its source is asked for.
  const source = fileNotice(file) === undefined && list.asSource(path);
  const pictured = image !== undefined && !source && imageDrawable(file, image) ? image : undefined;
  // Note that a pictured file draws no lines, so its threads stand above it, as on a binary file.
  const drawnAs = pictured === undefined ? file : { ...file, patch: null };
  const { placed, above } = threadsOn(threads, drawnAs);
  const notes: DiffNote[] =
    minimized === undefined
      ? placed.map((each) => ({
          key: each.key,
          side: each.side,
          line: each.line,
          content: (
            <ThreadLines hoverKey={each.key} lines={threadLines([each.thread], file)} hover={hover}>
              {draw?.(each.thread, THREAD_PLACE.ON_LINE)}
            </ThreadLines>
          ),
        }))
      : minimizedNotes(file, placed, draw, minimized, comments, hover);
  // The threads above the diff, as one list, or minimized to a chip of their own.
  const aboveOf = (unplaced: typeof above, side: DiffSelection["side"]) => {
    const list = <AboveThreads above={unplaced} draw={draw} />;
    if (minimized === undefined) return list;
    return (
      <MinimizedThreads
        threads={unplaced.map((each) => each.thread)}
        shown={minimized.shown(side, FILE_NOTE_LINE)}
        onShown={(shown) => minimized.show(side, FILE_NOTE_LINE, shown)}
        above
      >
        {list}
      </MinimizedThreads>
    );
  };
  // A pictured image, or a file with no hunks, stands as what is drawn in the place of its lines.
  const notice = fileNotice(file);
  const lead =
    pictured !== undefined ? (
      <ImageDiff file={file} sides={pictured} />
    ) : notice === undefined ? undefined : (
      <p className="diff-list-notice">{notice}</p>
    );
  if (lead !== undefined) {
    notes.unshift({
      key: LEAD_KEY,
      side: DIFF_SELECTION_SIDE.ADDITIONS,
      line: FILE_NOTE_LINE,
      content: (
        <>
          {lead}
          {above.length === 0 ? null : aboveOf(above, DIFF_SELECTION_SIDE.ADDITIONS)}
        </>
      ),
    });
  }
  for (const side of lead === undefined ? Object.values(DIFF_SELECTION_SIDE) : []) {
    const unplaced = above.filter((each) => each.side === side);
    if (unplaced.length === 0) continue;
    notes.unshift({
      key: ABOVE_KEY[side],
      side,
      line: FILE_NOTE_LINE,
      content: aboveOf(unplaced, side),
    });
  }
  if (lead === undefined && gaps.refused !== undefined) {
    notes.unshift({
      key: REFUSED_KEY,
      side: DIFF_SELECTION_SIDE.ADDITIONS,
      line: FILE_NOTE_LINE,
      content: <p className="diff-list-refused">{EXPANSION_REFUSED_WORDS[gaps.refused]}</p>,
    });
  }
  notes.push(...comments);
  const collapsed = list.collapsed(path);
  return {
    path,
    patch: pictured === undefined ? listPatch(file) : headerPatch(file),
    collapsed,
    lead: lead !== undefined,
    expandable: lead === undefined && gaps.open,
    header: (
      <FileHead
        file={file}
        controls={
          <>
            {image === undefined || fileNotice(file) !== undefined ? null : (
              <SourceToggle source={source} onToggle={() => list.toggleSource(path)} />
            )}
            {list.viewed === undefined || list.markViewed === undefined ? null : (
              <ViewedBox viewed={list.viewed(path)} onToggle={() => list.markViewed?.(path)} />
            )}
          </>
        }
        collapsed={collapsed}
        standing={list.standing === path}
        onToggle={() => list.toggle(path)}
        onToggleAll={list.toggleAll}
        onStand={() => list.stand(path)}
      />
    ),
    notes,
  };
}

/** What a file's entry is drawn from, in a fixed order: the entry stands while each is the same. */
function entryInputs(
  file: CodingAgentChangedFile,
  list: ChangesList,
  threads: readonly ReviewThread[],
  draw: ChangesThreads["draw"] | undefined,
  images: ImageSides | undefined,
  comments: readonly DiffNote[],
): readonly unknown[] {
  const path = file.path;
  return [
    file,
    list.collapsed(path),
    list.standing === path,
    list.viewed?.(path),
    list.asSource(path),
    list.toggle,
    list.toggleAll,
    list.stand,
    list.toggleSource,
    list.markViewed,
    images,
    comments.length,
    ...comments,
    // Note that the door drawing a thread matters only to a file a thread is on.
    threads.length === 0 ? undefined : draw,
    ...threads,
  ];
}

/** Whether two lists of inputs are the same, each by identity. */
function sameInputs(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((each, at) => Object.is(each, b[at]));
}

/**
 * Each kept file's entry, the one drawn last kept while nothing it is drawn
 * from changed, so a draw of the view for a key or a scroll builds and
 * reconciles only the files that changed: the file stood on and the one
 * before it, not every file of the pull request. A file's header and notes
 * are then the very elements drawn last, which React leaves as they stand.
 */
function useEntries(
  list: ChangesList,
  threads: ChangesThreads | undefined,
  images: ImageSides | undefined,
  commenting: ListCommenting | undefined,
  texts: FileTexts,
  minimizedOf: (path: string) => FileMinimized | undefined,
  hover: ThreadHover | undefined,
): readonly DiffListEntry[] {
  const kept = useRef(new Map<string, { inputs: readonly unknown[]; entry: DiffListEntry }>());
  const next = new Map<string, { inputs: readonly unknown[]; entry: DiffListEntry }>();
  const entries = list.kept.map((file) => {
    const own = threads?.list.filter((thread) => thread.path === file.path) ?? [];
    const comments = commenting?.notes.get(file.path) ?? NO_NOTES;
    const gaps = { open: texts.expandable(file), refused: texts.refused.get(file.path) };
    const minimized = minimizedOf(file.path);
    const inputs = [
      ...entryInputs(file, list, own, threads?.draw, images, comments),
      gaps.open,
      gaps.refused,
      minimized,
      own.length === 0 ? undefined : hover,
    ];
    const was = kept.current.get(file.path);
    const entry =
      was !== undefined && sameInputs(was.inputs, inputs)
        ? was.entry
        : entryOf(file, list, own, threads?.draw, images, comments, gaps, minimized, hover);
    next.set(file.path, { inputs, entry });
    return entry;
  });
  kept.current = next;
  return entries;
}

/** The lines that show their threads while Minimize inline comments is on: by file, by side, by line. */
type ShownLines = ReadonlyMap<string, ReadonlyMap<DiffSelection["side"], ReadonlySet<number>>>;

/** No line showing its threads. */
const NONE_SHOWN: ShownLines = new Map();

/**
 * Which lines show their threads while Minimize inline comments is on,
 * each file's answer the same object while none of its lines was shown or
 * hidden since, so the files whose lines did not change keep their entries;
 * none while it is off, and every line minimized again each time it is
 * turned on, as stage-cli does.
 */
function useMinimizedLines(minimize: boolean): (path: string) => FileMinimized | undefined {
  const [shown, setShown] = useState<{ readonly of: boolean; readonly lines: ShownLines }>({
    of: minimize,
    lines: NONE_SHOWN,
  });
  const lines = shown.of === minimize ? shown.lines : NONE_SHOWN;
  const toggle = useCallback(
    (path: string, side: DiffSelection["side"], line: number, open: boolean) =>
      setShown((was) => {
        const all = was.of === minimize ? was.lines : NONE_SHOWN;
        const sides = all.get(path) ?? new Map<DiffSelection["side"], ReadonlySet<number>>();
        const onSide = new Set(sides.get(side));
        if (open) onSide.add(line);
        else onSide.delete(line);
        return { of: minimize, lines: new Map(all).set(path, new Map(sides).set(side, onSide)) };
      }),
    [minimize],
  );
  const kept = useRef(
    new Map<
      string,
      { readonly of: unknown; readonly toggle: unknown; readonly answer: FileMinimized }
    >(),
  );
  return (path) => {
    if (!minimize) return undefined;
    const own = lines.get(path);
    const held = kept.current.get(path);
    if (held !== undefined && held.of === own && held.toggle === toggle) return held.answer;
    const answer: FileMinimized = {
      shown: (side, line) => own?.get(side)?.has(line) === true,
      show: (side, line, open) => toggle(path, side, line, open),
    };
    kept.current.set(path, { of: own, toggle, answer });
    return answer;
  };
}

/** No comment being written on a file's lines. */
const NO_NOTES: readonly DiffNote[] = [];

/** Where the lines a comment is on are lit and its note drawn: under the last of them, on the side that one counts on. */
const COMMENT_SIDE = {
  [DIFF_SIDE.LEFT]: DIFF_SELECTION_SIDE.DELETIONS,
  [DIFF_SIDE.RIGHT]: DIFF_SELECTION_SIDE.ADDITIONS,
} as const;

/**
 * The lines review threads ending on one line of `file` are on now, as the
 * list lights them: the widest of their ranges, the one whose first line's
 * row the diff draws first, a first line out of the patch before any, which
 * holds every other; none for threads on no line of the head.
 */
function threadLines(
  threads: readonly ReviewThread[],
  file: CodingAgentChangedFile,
): DiffListSelection | undefined {
  const ranges = threads.flatMap((thread) => {
    if (thread.line === null) return [];
    const side = COMMENT_SIDE[thread.startSide ?? thread.side];
    const start = thread.startLine ?? thread.line;
    // Note that an undrawn first line precedes drawn rows, because the threads share a drawn end.
    const place = rowPlace(file, side, start) ?? Number.NEGATIVE_INFINITY;
    const selection = { start, side, end: thread.line, endSide: COMMENT_SIDE[thread.side] };
    return [{ place, lines: { path: thread.path, selection } }];
  });
  return ranges.toSorted(
    (a, b) => a.place - b.place || a.lines.selection.start - b.lines.selection.start,
  )[0]?.lines;
}

/**
 * What the list is handed of commenting: what opens a comment on lines
 * picked, what those lines are called where GitHub would take a comment on
 * them, each file's comments being written, and the lines of the one
 * opened or written in last, lit.
 */
interface ListCommenting {
  readonly open: (picked: DiffListSelection) => void;
  readonly commentOn: (picked: DiffListSelection) => string | undefined;
  readonly notes: ReadonlyMap<string, readonly DiffNote[]>;
  readonly lit: DiffListSelection | undefined;
}

/** How Files changed comments on lines, where its Pull request tab lets it: the member's pending review, which names the offers, and what reads the tab again once GitHub answered. */
export interface LineComments {
  readonly pending: PendingReview;
  readonly onWritten: () => void;
}

/**
 * The comments being written on lines of the files, several at once
 * across lines and files, held above the list with their words
 * (`comment-drafts.ts`) for as long as the tab stands, so one scrolled out
 * of the list and back loses nothing; one opens where the gutter's + or a
 * selection of code picks lines GitHub would take a comment on
 * (`commentLines`). A comment whose lines a read of the files no longer
 * holds is not drawn.
 */
function useListCommenting(
  agentId: string,
  files: readonly CodingAgentChangedFile[],
  headSha: string | undefined,
  comments: LineComments | undefined,
  onRefresh: () => void,
): ListCommenting | undefined {
  const [drafts, setDrafts] = useState<CommentDrafts>(NO_DRAFTS);
  // Each comment's own key, counted, which its note stands under.
  const opened = useRef(0);
  const linesOf = useCallback(
    (picked: DiffListSelection) => {
      const file = files.find((each) => each.path === picked.path);
      return file === undefined ? undefined : commentLines(file, picked.selection);
    },
    [files],
  );
  const open = useCallback(
    (picked: DiffListSelection) => {
      const lines = linesOf(picked);
      if (lines === undefined) return;
      opened.current += 1;
      const id = String(opened.current);
      setDrafts((was) => openDraft(was, picked, lines, id));
    },
    [linesOf],
  );
  const commentOn = useCallback(
    (picked: DiffListSelection) => {
      const lines = linesOf(picked);
      return lines === undefined ? undefined : commentLinesLabel(lines);
    },
    [linesOf],
  );
  if (comments === undefined) return undefined;
  const notes = new Map<string, DiffNote[]>();
  let lit: DiffListSelection | undefined;
  for (const draft of drafts.open) {
    const { path } = draft.picked;
    const file = files.find((each) => each.path === path);
    const lines = file === undefined ? undefined : commentLines(file, draft.picked.selection);
    if (file === undefined || lines === undefined) continue;
    if (draft.id === drafts.lit) lit = draft.picked;
    notes.set(path, [
      ...(notes.get(path) ?? []),
      {
        key: draft.id,
        side: COMMENT_SIDE[lines.side],
        line: lines.line,
        content: (
          <LineComment
            agentId={agentId}
            path={path}
            lines={lines}
            headSha={headSha}
            pending={comments.pending}
            body={wordsOf(drafts, draft)}
            onBody={(body) => setDrafts((was) => withWords(was, draft, body))}
            suggestion={suggestedLines(file, lines)}
            onActive={() => setDrafts((was) => lightDraft(was, draft.id))}
            onClose={() => setDrafts((was) => closeDraft(was, draft.id))}
            onWritten={comments.onWritten}
            onRefresh={onRefresh}
          />
        ),
      },
    ]);
  }
  return { open, commentOn, notes, lit };
}

/** The lines of the thread the pointer rests on, and the door that sets them. */
interface RestingThread {
  readonly lines: DiffListSelection | undefined;
  readonly hover: ThreadHover;
}

/**
 * The lines of the review thread the pointer rests on, which the list
 * lights over those of the comment being written while it does, and the
 * door that sets them; the door stays the same, so a file's entry is kept.
 */
function useThreadHover(): RestingThread {
  // Note that what the pointer rests on stands as a stack, a thread on top of
  // the chip it opened from, so leaving the thread for its chip lights the
  // chip's lines again.
  const [resting, setResting] = useState<
    readonly { key: string; group: boolean; lines: DiffListSelection }[]
  >([]);
  const hover = useCallback<ThreadHover>((key, group, lines, on) => {
    setResting((was) => {
      const others = was.filter((each) => each.key !== key || each.group !== group);
      if (on && lines !== undefined) return [...others, { key, group, lines }];
      return others.length === was.length ? was : others;
    });
  }, []);
  return { lines: resting.at(-1)?.lines, hover };
}

/** A file's Viewed box at the end of its header, GitHub's own, as the member's marks hold it; V does the same for the file the keys stand on. */
function ViewedBox({
  viewed,
  onToggle,
}: {
  viewed: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <Tooltip
      label={viewed ? LIST_WORDS.UNMARK_VIEWED : LIST_WORDS.MARK_VIEWED}
      chord={VIEWED_CHORD}
    >
      <span className="diff-list-viewed">
        <Checkbox checked={viewed} onChange={onToggle}>
          {LIST_WORDS.VIEWED}
        </Checkbox>
      </span>
    </Tooltip>
  );
}

/** An SVG's turn between its picture and its source's lines, at the end of its header. */
function SourceToggle({
  source,
  onToggle,
}: {
  source: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const label = source ? LIST_WORDS.SHOW_IMAGE : LIST_WORDS.SHOW_SOURCE;
  return (
    <Tooltip label={label}>
      <IconButton
        icon={source ? <ImageIcon aria-hidden="true" /> : <CodeIcon aria-hidden="true" />}
        label={label}
        onClick={onToggle}
      />
    </Tooltip>
  );
}

/**
 * Where a pull request's changed images are read: its repository, named by
 * its page on GitHub, and the commits the service named; none where the
 * page names no repository.
 */
function imagesOf(
  agentId: string,
  pullRequest: { readonly url: string; readonly headSha?: string; readonly baseSha?: string },
  read: number,
): ImageSides | undefined {
  const [owner, name] = URL.canParse(pullRequest.url)
    ? new URL(pullRequest.url).pathname.split("/").filter((segment) => segment !== "")
    : [];
  if (owner === undefined || name === undefined) return undefined;
  return {
    agentId,
    repository: `${owner}/${name}`,
    headSha: pullRequest.headSha,
    baseSha: pullRequest.baseSha,
    read,
  };
}

/** The repository a pull request's page on GitHub names, as `owner/name`; none where it names none. */
function repositoryOf(url: string): string | undefined {
  const [owner, name] = URL.canParse(url)
    ? new URL(url).pathname.split("/").filter((segment) => segment !== "")
    : [];
  return owner === undefined || name === undefined ? undefined : `${owner}/${name}`;
}

/** What a refusal of the service's read says of a file's gaps: not text, and anything else that it could not be read just now. */
function expansionRefusalOf(refusal: TaskFileRefusal): ExpansionRefusal {
  return refusal === TASK_FILE_REFUSAL.NOT_TEXT
    ? EXPANSION_REFUSAL.NOT_TEXT
    : EXPANSION_REFUSAL.UNAVAILABLE;
}

/** How Files changed opens the lines between a file's hunks: whether a file's may be, the door that reads one whole, and why any could not be. */
interface FileTexts {
  readonly expandable: (file: CodingAgentChangedFile) => boolean;
  readonly read: ((path: string) => Promise<DiffFileTexts | undefined>) | undefined;
  readonly refused: ReadonlyMap<string, ExpansionRefusal>;
}

/**
 * How Files changed reads a changed file whole, for the lines between its
 * hunks: its text at the pull request's head, read as a File tab reads one
 * (`TASKS_FILE`, raw, at that commit) the first time a gap of it is
 * opened, and kept for the answer's life, and its text before turned back
 * from that text and its patch (`textsOf`), so one read stands for both.
 * None where the read could not be promised to reach the pull request's own
 * files: an agent on no task, a head the service did not name, or a task
 * whose repository is not the one the pull request is in, since the read
 * is the task's. A file not changed in place, or a secret one, which the
 * service never reads, offers no gap (`expandable`); and a file whose read
 * the service refused, or whose text is not the one its patch was made
 * against, offers none from then on, and says why.
 */
function useFileTexts(
  taskId: string | null,
  repository: string | null,
  pullRequest: { readonly url: string; readonly headSha?: string } | null,
  files: readonly CodingAgentChangedFile[],
): FileTexts {
  const { act } = useAct();
  const [refusals, setRefusals] = useState<{
    readonly of: unknown;
    readonly refused: ReadonlyMap<string, ExpansionRefusal>;
  }>({ of: pullRequest, refused: new Map() });
  // Note that a new answer offers every gap again, since a push may have mended what was refused.
  const refused = refusals.of === pullRequest ? refusals.refused : NONE_REFUSED;
  const read = useMemo(() => {
    const headSha = pullRequest?.headSha;
    const own = pullRequest === null ? undefined : repositoryOf(pullRequest.url);
    if (taskId === null || headSha === undefined || repository === null || own === undefined) {
      return undefined;
    }
    if (repository.toLowerCase() !== own.toLowerCase()) return undefined;
    const kept = new Map<string, Promise<DiffFileTexts | undefined>>();
    const refuse = (path: string, why: ExpansionRefusal) =>
      setRefusals((was) => ({
        of: pullRequest,
        refused: new Map(was.of === pullRequest ? was.refused : NONE_REFUSED).set(path, why),
      }));
    return (path: string) => {
      const file = files.find((each) => each.path === path);
      if (file === undefined || !expandable(file)) return Promise.resolve(undefined);
      const held = kept.get(path);
      if (held !== undefined) return held;
      const reading = act(ACT_KIND.TASKS_FILE, {
        taskId,
        path,
        firstLine: 1,
        lastLine: 1,
        raw: true,
        ref: headSha,
      }).then(
        async (answer) => {
          const texts = "text" in answer ? await checkedTextsOf(file, answer.text.text) : undefined;
          if (texts !== undefined) return texts;
          const why =
            "text" in answer
              ? EXPANSION_REFUSAL.CHANGED
              : "refusal" in answer
                ? expansionRefusalOf(answer.refusal)
                : EXPANSION_REFUSAL.UNAVAILABLE;
          refuse(path, why);
          return undefined;
        },
        () => {
          refuse(path, EXPANSION_REFUSAL.UNAVAILABLE);
          return undefined;
        },
      );
      kept.set(path, reading);
      return reading;
    };
  }, [act, taskId, repository, pullRequest, files]);
  const offered = useCallback(
    (file: CodingAgentChangedFile) =>
      read !== undefined && expandable(file) && !refused.has(file.path),
    [read, refused],
  );
  return { expandable: offered, read, refused };
}

/**
 * A file's texts from its text after, where that text is the very
 * contents GitHub listed the file's patch against: the object it names
 * (`blobSha`), where the service named one, since a push between the
 * service's reads could leave a text whose hunks match its patch but whose
 * lines between them do not; and its hunks at their places (`textsOf`).
 */
async function checkedTextsOf(
  file: CodingAgentChangedFile,
  after: string,
): Promise<DiffFileTexts | undefined> {
  if (file.blobSha !== undefined && (await blobShaOf(after)) !== file.blobSha) return undefined;
  return textsOf(file, after);
}

/** No file's gaps refused. */
const NONE_REFUSED: ReadonlyMap<string, ExpansionRefusal> = new Map();

/** Collapse all or Expand all, for the files the filter keeps, in the bar. */
function FoldAllButton({ list }: { list: ChangesList }): React.JSX.Element {
  const label = list.allCollapsed ? LIST_WORDS.EXPAND_ALL : LIST_WORDS.COLLAPSE_ALL;
  return (
    <Tooltip label={label} chord={FOLD_CHORD.ALL}>
      <IconButton
        icon={
          list.allCollapsed ? (
            <ChevronsUpDownIcon aria-hidden="true" />
          ) : (
            <ChevronsDownUpIcon aria-hidden="true" />
          )
        }
        label={label}
        disabled={list.kept.length === 0}
        onClick={list.toggleAll}
      />
    </Tooltip>
  );
}

/** The list of files, or the words saying the filter keeps none, and over it the filter where the tree that holds it is hidden. */
function FilesList({
  list,
  threads,
  images,
  commenting,
  texts,
  filterShown,
  roomy,
  boxRef,
}: {
  list: ChangesList;
  threads: ChangesThreads | undefined;
  /** Where the pull request's changed images are read, drawn as pictures; none draws them as binary files. */
  images: ImageSides | undefined;
  /** The comments being written, and what opens one; none offers no +. */
  commenting: ListCommenting | undefined;
  /** How the lines between a file's hunks are opened, and why a file's could not be. */
  texts: FileTexts;
  /** Whether the tree, whose search is the filter, is drawn, so the filter is in sight. */
  filterShown: boolean;
  roomy: boolean;
  boxRef: (element: HTMLDivElement | null) => void;
}): React.JSX.Element {
  const look = useDiffLook(roomy);
  const { settings } = useFileViewSettings();
  const minimizedOf = useMinimizedLines(settings.diffMinimizeComments);
  const resting = useThreadHover();
  const entries = useEntries(list, threads, images, commenting, texts, minimizedOf, resting.hover);
  const query = list.query.trim();
  return (
    <section className="file-tab" aria-label="Diffs of the changed files">
      {query === "" || filterShown ? null : (
        <div className="file-tab-notice">
          <p className="m-0">
            {LIST_WORDS.FILTERED} “<bdi>{query}</bdi>”
          </p>
          <Button onClick={() => list.onQuery("")}>{LIST_WORDS.CLEAR_FILTER}</Button>
        </div>
      )}
      {list.kept.length === 0 ? (
        <p className="side-panel-empty">{LIST_WORDS.NONE_KEPT}</p>
      ) : (
        <PierreDiffList
          entries={entries}
          look={look}
          door={list.door}
          onTopFile={list.onTopFile}
          boxRef={boxRef}
          onComment={commenting?.open}
          commentOn={commenting?.commentOn}
          selected={resting.lines ?? commenting?.lit}
          readTexts={texts.read}
        />
      )}
    </section>
  );
}

/** Who a pull request names, as its tab last read them for that very pull request; none where the tab read them for another, or has not yet. */
export function peopleOf(
  held: HeldPeople | undefined,
  pullRequest: Pick<CodingAgentPullRequest, "url">,
): CodingAgentChangesPeople | undefined {
  return held?.url === pullRequest.url ? held.people : undefined;
}

/**
 * The card a Changes tab hangs, and its row in the task's summary, in a tab
 * card's look: the pull request's title with its mark and number at the
 * right, the coding agent whose pull request it is under the title, by its
 * tile and name as every place naming an agent draws it (`ActorRef`),
 * which hang the agent's card and open its tab, and under them how many
 * files it changes and the lines it adds and removes, as GitHub counts
 * them, then, once its Changes tab has read them, who opened it and its
 * reviewers, each face wearing where they stand (`pull-request-people.tsx`).
 */
export function ChangesCard({
  subject,
  models,
  pullRequest,
  people,
  onOpenAgent,
}: {
  /** The agent whose pull request it is, as the plan's list names it. */
  subject: AgentSubject;
  /** The catalog as last read, which names the agent's model on its card. */
  models: readonly CatalogModel[] | undefined;
  pullRequest: CodingAgentPullRequest;
  /** Who the pull request names, as its Changes tab last read them; none before it has. */
  people: CodingAgentChangesPeople | undefined;
  /** Opens the agent's tab in the plan's column. */
  onOpenAgent: () => void;
}): React.JSX.Element {
  const count = pullRequest.changedFiles;
  const reviewers = people?.reviewers ?? [];
  return (
    <HoverCard data-tab-card="">
      <HoverCardHead
        name={pullRequest.title}
        sub={<AgentActorRef subject={subject} models={models} onOpen={onOpenAgent} />}
        corner={
          <>
            <PullRequestMark pullRequest={pullRequest} className="card-corner-mark" />
            {pullRequestNumberLabel(pullRequest)}
          </>
        }
      />
      <HoverCardNote>
        {count} {count === 1 ? "file" : "files"} changed{" "}
        <LinesChanged additions={pullRequest.additions} deletions={pullRequest.deletions} />
      </HoverCardNote>
      {people?.author === undefined ? null : (
        <HoverCardNote oneLine>
          <OpenedBy person={people.author} />
        </HoverCardNote>
      )}
      {reviewers.length === 0 ? null : (
        <HoverCardNote>
          <ReviewersLine reviewers={reviewers} />
        </HoverCardNote>
      )}
    </HoverCard>
  );
}

export function AgentChangesTab({
  agentId,
  control,
  shown,
  repository,
  tree,
  threads,
  lineComments,
}: {
  agentId: string;
  control: CodingAgentsControl;
  /** Whether the panel is on screen, which is when the tab reads. */
  shown: boolean;
  /** The task's repository, which the agent works in and the breadcrumbs name; none names the path plain. */
  repository: string | null;
  /** Whether the tree beside File and Changes tabs is open, and its toggle. */
  tree: TreeShown;
  /** The pull request's review threads, drawn on their lines in each file's diff; none draws none. */
  threads?: ChangesThreads | undefined;
  /** How a comment on lines is made, where the tab lets one be; none offers no comment. */
  lineComments?: LineComments | undefined;
}): React.JSX.Element {
  const status = control.agents?.find((each) => each.id === agentId)?.status;
  const ended = !agentStillWriting(status ?? CODING_AGENT_STATUS.RUNNING);
  // The pull request the tab names by its number, where it names one other than the agent's own (`pull-request-number.ts`).
  const number = usePullRequestNumber();
  const { answer, out, ask } = useAgentRead(
    agentId,
    shown,
    ended,
    (id: string) => control.readChanges(id, number),
    UNANSWERED,
  );
  // How many answers have landed, which a changed image is drawn anew on.
  const reads = useRef<{ readonly of: unknown; readonly count: number }>({
    of: undefined,
    count: 0,
  });
  if (reads.current.of !== answer) reads.current = { of: answer, count: reads.current.count + 1 };
  const room = usePaneRoom(tree);
  const edge = useTreeEdge(tree);
  const [diffBox, setDiffBox] = useState<HTMLDivElement | null>(null);
  const roomy = useSplitRoom(diffBox);
  const pullRequest = answer !== undefined && "pullRequest" in answer ? answer.pullRequest : null;
  // Note that the lists are kept while the answer is the same one, because
  // fresh ones would have the tree draw itself anew.
  const changed = useMemo(() => {
    const files = pullRequest?.files ?? [];
    const paths = files.map((file) => file.path);
    return { files, paths, ordered: treeOrder(files), folders: changedFolders(paths) };
  }, [pullRequest]);
  // Note that the marks are read with each answer the changes read lands with, so the two describe the same push.
  const readViewed = useCallback(
    (id: string) => control.readPullRequestViewed(id, number),
    [control.readPullRequestViewed, number],
  );
  const viewedFiles = useViewedFiles(
    agentId,
    readViewed,
    pullRequest === null ? undefined : reads.current.count,
  );
  const viewSettings = useFileViewSettings();
  const minimize = () =>
    viewSettings.change("diffMinimizeComments", !viewSettings.settings.diffMinimizeComments);
  const list = useChangesList(changed.files, viewedFiles.marks, minimize, room.toggle);
  const marks = useMemo(
    () => changeMarks(changed.files, { threads: threads?.list, viewed: list.viewed }),
    [changed.files, threads?.list, list.viewed],
  );
  const answered = reads.current.count;
  // Note that the images are named afresh only with an answer, because every changed image's entry is drawn from them.
  const images = useMemo(
    () => (pullRequest === null ? undefined : imagesOf(agentId, pullRequest, answered)),
    [agentId, pullRequest, answered],
  );
  const { closeOver } = room;
  const { hideKeys } = list;
  // The sheet of the view's keys goes with the view: a Dialog stands over the
  // whole window from document.body, so it would outlast the view's panel
  // being hidden for another of the Pull request tab's views.
  useEffect(() => {
    if (!shown) hideKeys();
  }, [shown, hideKeys]);
  const { go } = list;
  // A file chosen in the tree floating over the list takes the tree down, to show the file.
  const choose = useCallback(
    (path: string) => {
      closeOver();
      go(path);
    },
    [closeOver, go],
  );
  const shownFile = changed.files.find((file) => file.path === list.current) ?? changed.files[0];
  const refresh = () => {
    ask();
    threads?.refresh?.();
  };
  const taskId = control.agents?.find((each) => each.id === agentId)?.planId ?? null;
  const texts = useFileTexts(taskId, repository, pullRequest, changed.files);
  const commenting = useListCommenting(
    agentId,
    changed.files,
    pullRequest?.headSha,
    lineComments,
    refresh,
  );
  // A failure gives way to the wait as soon as it is asked again; files drawn stand until the answer lands.
  if (answer === undefined || (out && "failure" in answer)) {
    return <SpinnerRegion label={CHANGES_WORDS.READING} />;
  }
  if ("failure" in answer) {
    return (
      <ErrorState onRetry={ask} placement={ERROR_STATE_PLACEMENT.CENTRED}>
        {CHANGES_WORDS.FAILED}
      </ErrorState>
    );
  }
  if (pullRequest === null) {
    return <EmptyState icon={<FileDiffIcon />}>{CHANGES_WORDS.NO_PULL_REQUEST}</EmptyState>;
  }
  if (shownFile === undefined) {
    return <EmptyState icon={<FileDiffIcon />}>{CHANGES_WORDS.EMPTY}</EmptyState>;
  }
  const count = pullRequest.files.length;
  const total = linesChanged(pullRequest.files);
  const counted = (
    <>
      {count} {count === 1 ? "file" : "files"} changed{" "}
      <LinesChanged additions={total.additions} deletions={total.deletions} />
      {list.viewed === undefined ? null : (
        <span className="diff-list-progress">
          {" · "}
          {LIST_WORDS.viewedOf(
            pullRequest.files.filter((file) => list.viewed?.(file.path) === true).length,
            count,
          )}
        </span>
      )}
    </>
  );
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the view hears stage-cli's keys from whatever in it has the focus, the list's own scroller among them.
    <div
      className="file-view ph-no-capture"
      {...room.root}
      onKeyDown={(event) => {
        room.root.onKeyDown(event);
        list.onKeyDown(event);
      }}
    >
      <FileViewBar
        path={{
          path: shownFile.path,
          browse:
            repository === null
              ? undefined
              : { repository, listFolder: changed.folders, onOpen: choose },
        }}
        beside={<ChangeBeside file={shownFile} />}
        onGitHub={() => appPlatform().openGitHub(`${pullRequest.url}/files`)}
        menu={
          <>
            <ViewSettingsButton scope={{ kind: VIEW_SETTINGS_SCOPE.DIFF, roomy }} />
            <FoldAllButton list={list} />
            <ChangesMenu file={shownFile} reading={out} onRefresh={refresh} />
          </>
        }
        tree={room.toggles}
      />
      <PullRequestWriteNote writes={viewedFiles} />
      {pullRequest.truncated ? (
        <div className="file-tab-notice">
          <p>{CHANGES_WORDS.TRUNCATED}</p>
        </div>
      ) : null}
      <div className="file-view-body" {...room.body}>
        <FilesList
          list={list}
          threads={threads}
          images={images}
          commenting={commenting}
          texts={texts}
          filterShown={room.drawn}
          roomy={roomy}
          boxRef={setDiffBox}
        />
        {room.drawn ? (
          <FileTreePane
            file={shownFile.path}
            only={changed.paths}
            marks={marks}
            label="Changed files"
            foot={counted}
            listFolder={changed.folders}
            search={{ query: list.query, onQuery: list.onQuery }}
            onOpen={choose}
            onViewed={list.markViewed}
            pane={room.beside.pane}
            float={room.pane}
            leaving={room.beside.leaving}
            width={tree.width?.width}
            edge={edge}
          />
        ) : null}
        {tree.open ? null : (
          <ChangesStrip
            files={changed.ordered}
            current={shownFile.path}
            viewed={list.viewed}
            peek={room.strip}
          />
        )}
      </div>
      {/* The count stands under the tree, and under the list while the tree
          stands nowhere beside it, which the stylesheet says (tasks.css). */}
      <p className="file-tree-foot">{counted}</p>
      {shown && list.keysShown ? <FilesChangedKeysSheet onDismiss={hideKeys} /> : null}
    </div>
  );
}
