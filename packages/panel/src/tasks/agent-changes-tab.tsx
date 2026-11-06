import { AGENT_CALL_FAILURE, type AgentChangesAnswerView } from "@repo/features/agent-view";
import {
  type AgentChangedFile,
  CHANGED_FILE_STATUS,
  DIFF_SIDE,
  PATCH_OMITTED,
  type ReviewThread,
} from "@repo/features/agent-wire";
import { imageTypeOfPath } from "@repo/features/github-image";
import { FAILURE_CONDITION, FAILURE_SURFACE } from "@repo/features/shown-failure";
import { TASK_FILE_REFUSAL, type TaskFileRefusal } from "@repo/features/task-wire";
import { REFRESH_FAILED_WORDS } from "@repo/features/words";
import {
  BUTTON_SIZE,
  Button,
  Checkbox,
  DownloadIcon,
  EmptyState,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  FILL_ELEMENT,
  FILL_FLOW,
  Fill,
  GAP,
  IconButton,
  INSET,
  LAYOUT_ELEMENT,
  type PaneBarMenu,
  type ScrollOverscroll,
  SpinnerRegion,
  Stack,
  TabNotice,
  TextButton,
  Tooltip,
} from "@repo/ui";
import {
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  CodeIcon,
  FoldVerticalIcon,
  GLYPH,
  ImageIcon,
  UnfoldVerticalIcon,
} from "@repo/ui/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ComponentProps,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { appPlatform } from "../app-platform.js";
import { useDraft } from "../composer-drafts.js";
import { useCopyToast } from "../copy-feedback.js";
import type { MenuAction } from "../desktop/action-menu.js";
import { useTabActions } from "../desktop/strip-tabs.js";
import {
  DIFF_SELECTION_SIDE,
  type DiffFileTexts,
  type DiffLineSpan,
  type DiffListSelection,
  type DiffSelection,
  FILE_NOTE_LINE,
} from "../diff-view/contract.js";
import { failureShown, unreadShown } from "../failure-report.js";
import { usePhoneRoom } from "../stage-room.js";
import { useRegained } from "../use-regained.js";
import { agentChangesQueryOptions, ChangesFailed } from "./agent-reads.js";
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
  DIFF_LOAD_REFUSED_WORDS,
  EXPANSION_REFUSAL,
  EXPANSION_REFUSED_WORDS,
  type ExpansionRefusal,
  expandable,
  fileNotice,
  gapLines,
  headerPatch,
  listPatch,
  pullRequestPatch,
  pullRequestPatchName,
  rowPlace,
  suggestedLines,
  textsOf,
  threadsOn,
  tooLargeToDiff,
  treeOrder,
  wholeable,
} from "./changes-model.js";
import { ChangesStrip } from "./changes-strip.js";
import {
  type CommentDraft,
  type CommentDrafts,
  closeDraft,
  lightDraft,
  lineCommentPlace,
  NO_DRAFTS,
  openDraft,
} from "./comment-drafts.js";
import {
  type DiffListEntry,
  type DiffListFlash,
  type DiffListReveal,
  type DiffNote,
  PierreDiffList,
} from "./diff-list.js";
import { useDiffLook, useSplitRoom } from "./file-diff.js";
import { useSaveText } from "./file-menu.js";
import { FileTreePane } from "./file-tree-pane.js";
import {
  barMenuItems,
  FileViewBar,
  gitHubAction,
  paneToggleAction,
  type TreeShown,
  TreeToggle,
  usePaneRoom,
  useTreeEdge,
} from "./file-view.js";
import { useFileViewSettings } from "./file-view-settings.js";
import { FilesChangedKeysSheet } from "./files-changed-keys.js";
import { ImageDiff, type ImageSides, imageDrawable } from "./image-diff.js";
import { LineComment, type PendingReview } from "./line-comment.js";
import { MinimizedThreads } from "./minimized-threads.js";
import { useOpenFileTab } from "./open-file-tab.js";
import { usePullRequestNumber } from "./pull-request-number.js";
import type { PullRequestSource } from "./pull-request-source.js";
import { PullRequestWriteNote, type ReadAgain } from "./pull-request-writes.js";
import { refusedAnswer, taskFileQueryOptions } from "./repository-reads.js";
import { landable, type ThreadLanding, ThreadLandingProvider } from "./thread-reveal.js";
import { useViewSettingsSheet, VIEW_SETTINGS_SCOPE, ViewSettingsButton } from "./view-settings.js";
import { useViewedFiles, type ViewedFiles } from "./viewed-files.js";

const UNANSWERED: AgentChangesAnswerView = { failure: AGENT_CALL_FAILURE.UNANSWERED };

const CHANGES_MENU_WORDS = {
  COPY_PATCH: "Copy patch",
  DOWNLOAD_PATCH: "Download patch",
  PATCH_COPIED: "Patch copied",
  TRUNCATED: "This pull request has more files than were read",
  NO_PATCH: "No file has lines to copy",
} as const;

function useChangesMenu({
  pullRequest,
}: {
  pullRequest: {
    readonly url: string;
    readonly truncated: boolean;
    readonly files: readonly AgentChangedFile[];
  } | null;
}): PaneBarMenu | undefined {
  const copyWithToast = useCopyToast();
  const saveText = useSaveText();
  if (pullRequest === null) return undefined;
  const patch = pullRequest.truncated ? undefined : pullRequestPatch(treeOrder(pullRequest.files));
  const why = pullRequest.truncated
    ? CHANGES_MENU_WORDS.TRUNCATED
    : patch === undefined
      ? CHANGES_MENU_WORDS.NO_PATCH
      : undefined;
  return {
    thing: "Files changed",
    groups: [
      [
        {
          label: CHANGES_MENU_WORDS.COPY_PATCH,
          icon: <GLYPH.COPY />,
          detail: why,
          disabled: patch === undefined,
          onSelect: () => {
            if (patch !== undefined) copyWithToast(patch, CHANGES_MENU_WORDS.PATCH_COPIED);
          },
        },
        {
          label: CHANGES_MENU_WORDS.DOWNLOAD_PATCH,
          icon: <DownloadIcon />,
          detail: why,
          disabled: patch === undefined,
          onSelect: () => {
            if (patch !== undefined) {
              saveText(pullRequestPatchName(pullRequest.url), patch).catch(() => undefined);
            }
          },
        },
      ],
    ],
  };
}

const OPEN_FILES_ON_GITHUB = "Open files on GitHub";

function foldAllAction(list: ChangesList): MenuAction {
  return {
    label: list.allCollapsed ? LIST_WORDS.EXPAND_ALL : LIST_WORDS.COLLAPSE_ALL,
    icon: list.allCollapsed ? (
      <ChevronsUpDownIcon aria-hidden="true" />
    ) : (
      <ChevronsDownUpIcon aria-hidden="true" />
    ),
    disabled: list.kept.length === 0,
    onSelect: list.toggleAll,
  };
}

export interface ChangesThreads {
  readonly list: readonly ReviewThread[];
  readonly draw: (thread: ReviewThread, place: ThreadPlace) => ReactNode;
  readonly refresh?: (() => void) | undefined;
}

export interface ChangesReveal {
  readonly thread: ReviewThread;
  readonly ask: number;
  readonly onLanded: (ask: number) => void;
  readonly onGone: (ask: number) => void;
}

export const THREAD_PLACE = {
  ON_LINE: "on-line",
  ABOVE: "above",
} as const;

export type ThreadPlace = (typeof THREAD_PLACE)[keyof typeof THREAD_PLACE];

const ABOVE_KEY = {
  [DIFF_SELECTION_SIDE.DELETIONS]: "above-deletions",
  [DIFF_SELECTION_SIDE.ADDITIONS]: "above-additions",
} as const satisfies Record<DiffSelection["side"], string>;

const REFUSED_KEY = "gaps-refused";

const LEAD_KEY = "lead";

function AboveThreads({
  above,
  draw,
}: {
  above: readonly { readonly key: string; readonly thread: ReviewThread }[];
  draw: ChangesThreads["draw"] | undefined;
}): React.JSX.Element {
  return (
    <Stack
      as={LAYOUT_ELEMENT.OL}
      gap={GAP.ITEM}
      inset={INSET.BLOCK}
      className="flex-none"
      aria-label={CHANGES_WORDS.UNPLACED_THREADS}
    >
      {above.map((each) => (
        <li key={each.key}>{draw?.(each.thread, THREAD_PLACE.ABOVE)}</li>
      ))}
    </Stack>
  );
}

type ThreadHover = (
  key: string,
  group: boolean,
  lines: DiffListSelection | undefined,
  resting: boolean,
) => void;

function ThreadLines({
  hoverKey,
  group = false,
  lines,
  hover,
  children,
}: {
  hoverKey: string;
  group?: boolean;
  lines: DiffListSelection | undefined;
  hover: ThreadHover | undefined;
  children: ReactNode;
}): React.JSX.Element {
  if (hover === undefined) return <>{children}</>;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the pointer resting on a thread, or the keyboard in it, only lights the lines it is on; nothing is pressed.
    <div
      className="diff-thread-lines"
      onMouseEnter={() => hover(hoverKey, group, lines, true)}
      onMouseLeave={() => hover(hoverKey, group, lines, false)}
      onFocus={(event) => {
        const nearest =
          event.target instanceof Element ? event.target.closest(".diff-thread-lines") : null;
        if (nearest !== event.currentTarget) return;
        if (document.documentElement.dataset.keyboard === "true")
          hover(hoverKey, group, lines, true);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          hover(hoverKey, group, lines, false);
      }}
    >
      {children}
    </div>
  );
}

interface FileMinimized {
  readonly shown: (side: DiffSelection["side"], line: number) => boolean;
  readonly show: (side: DiffSelection["side"], line: number, shown: boolean) => void;
}

function minimizedNotes(
  file: AgentChangedFile,
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
      const writing = comments.some((comment) => comment.side === side && comment.line === line);
      return writing
        ? threads.map((each, at) => ({ key: each.key, side, line, content: drawn[at] }))
        : [
            {
              key: first.key,
              side,
              line,
              content: (
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

function entryOf(
  file: AgentChangedFile,
  list: ChangesList,
  threads: readonly ReviewThread[],
  draw: ChangesThreads["draw"] | undefined,
  images: ImageSides | undefined,
  comments: readonly DiffNote[],
  gaps: { readonly open: boolean; readonly refused: ExpansionRefusal | undefined },
  minimized: FileMinimized | undefined,
  hover: ThreadHover | undefined,
  whole: FileWhole,
  opened: ReadonlySet<number> | undefined,
): DiffListEntry {
  const path = file.path;
  const image = imageTypeOfPath(path) === undefined || images === undefined ? undefined : images;
  const source = fileNotice(file) === undefined && list.asSource(path);
  const pictured = image !== undefined && !source && imageDrawable(file, image) ? image : undefined;
  const drawnAs = pictured === undefined ? file : { ...file, patch: null };
  const drawnWhole = pictured === undefined && !emptyWhole(whole.texts) ? whole.texts : undefined;
  const { placed, above } = threadsOn(threads, drawnAs, drawnWhole, opened);
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
  const notice = drawnWhole === undefined ? fileNotice(file) : undefined;
  const offer =
    !whole.offered || whole.texts !== undefined
      ? undefined
      : notice === CHANGES_WORDS.UNCHANGED_CONTENTS
        ? LIST_WORDS.SHOW_FILE
        : file.omitted === PATCH_OMITTED.TOO_LARGE
          ? LIST_WORDS.LOAD_DIFF
          : undefined;
  const shown =
    offer === undefined ? null : (
      <>
        {" · "}
        <TextButton aria-label={`${offer}: ${path}`} onClick={whole.toggle}>
          {offer}
        </TextButton>
      </>
    );
  const loadRefused =
    file.omitted === PATCH_OMITTED.TOO_LARGE && gaps.refused !== undefined
      ? ` ${DIFF_LOAD_REFUSED_WORDS[gaps.refused]}`
      : null;
  const lead =
    pictured !== undefined ? (
      <ImageDiff file={file} sides={pictured} />
    ) : notice === undefined ? undefined : (
      <p className="diff-list-notice m-0 py-list-inset pr-list-inset pl-ui-40 text-caption-inline text-muted-foreground">
        {notice}
        {loadRefused}
        {shown}
      </p>
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
      content: (
        <p className="m-0 py-tight-gap pr-list-inset pl-ui-40 text-caption-inline text-muted-foreground">
          {EXPANSION_REFUSED_WORDS[gaps.refused]}
        </p>
      ),
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
    whole: lead === undefined ? whole.texts : undefined,
    hidden:
      lead === undefined && gaps.open && drawnWhole === undefined
        ? gapLines(threads, file)
        : undefined,
    header: (
      <FileHead
        file={file}
        controls={
          <>
            {image === undefined || fileNotice(file) !== undefined ? null : (
              <SourceToggle source={source} onToggle={() => list.toggleSource(path)} />
            )}
            {!whole.offered || pictured !== undefined ? null : (
              <WholeToggle whole={whole.texts !== undefined} onToggle={whole.toggle} />
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

function entryInputs(
  file: AgentChangedFile,
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
    threads.length === 0 ? undefined : draw,
    ...threads,
  ];
}

function sameInputs(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((each, at) => Object.is(each, b[at]));
}

function useEntries(
  list: ChangesList,
  threads: ChangesThreads | undefined,
  images: ImageSides | undefined,
  commenting: ListCommenting | undefined,
  texts: FileTexts,
  minimizedOf: (path: string) => FileMinimized | undefined,
  hover: ThreadHover | undefined,
  wholeOf: (file: AgentChangedFile) => FileWhole,
  openedOf: (path: string) => ReadonlySet<number> | undefined,
): readonly DiffListEntry[] {
  const kept = useRef(new Map<string, { inputs: readonly unknown[]; entry: DiffListEntry }>());
  const next = new Map<string, { inputs: readonly unknown[]; entry: DiffListEntry }>();
  const entries = list.kept.map((file) => {
    const own = threads?.list.filter((thread) => thread.path === file.path) ?? [];
    const comments = commenting?.notes.get(file.path) ?? NO_NOTES;
    const gaps = { open: texts.expandable(file), refused: texts.refused.get(file.path) };
    const minimized = minimizedOf(file.path);
    const whole = wholeOf(file);
    const opened = own.length === 0 ? undefined : openedOf(file.path);
    const inputs = [
      ...entryInputs(file, list, own, threads?.draw, images, comments),
      gaps.open,
      gaps.refused,
      minimized,
      own.length === 0 ? undefined : hover,
      whole.texts,
      whole.offered,
      whole.toggle,
      opened,
    ];
    const was = kept.current.get(file.path);
    const entry =
      was !== undefined && sameInputs(was.inputs, inputs)
        ? was.entry
        : entryOf(
            file,
            list,
            own,
            threads?.draw,
            images,
            comments,
            gaps,
            minimized,
            hover,
            whole,
            opened,
          );
    next.set(file.path, { inputs, entry });
    return entry;
  });
  kept.current = next;
  return entries;
}

interface FileWhole {
  readonly texts: DiffFileTexts | undefined;
  readonly offered: boolean;
  readonly toggle: () => void;
}

function emptyWhole(texts: DiffFileTexts | undefined): boolean {
  return texts !== undefined && texts.before === "" && texts.after === "";
}

const NONE_WHOLE: ReadonlyMap<string, DiffFileTexts> = new Map();

function useWholeFiles(texts: FileTexts): (file: AgentChangedFile) => FileWhole {
  const { read, refused, whole, wholeable } = texts;
  const [held, setHeld] = useState<{
    readonly of: unknown;
    readonly files: ReadonlyMap<string, DiffFileTexts>;
  }>({ of: read, files: NONE_WHOLE });
  const files = held.of === read ? held.files : NONE_WHOLE;
  const latest = useRef({ read, files });
  latest.current = { read, files };
  const toggle = useCallback((path: string) => {
    const { read, files } = latest.current;
    const held = (next: ReadonlyMap<string, DiffFileTexts>) => setHeld({ of: read, files: next });
    if (files.has(path)) {
      const next = new Map(files);
      next.delete(path);
      held(next);
      return;
    }
    read?.(path).then(
      (whole) => {
        if (whole !== undefined && latest.current.read === read) {
          held(new Map(latest.current.files).set(path, whole));
        }
      },
      () => undefined,
    );
  }, []);
  const doors = useRef(new Map<string, () => void>());
  return (file) => {
    const door = doors.current.get(file.path) ?? (() => toggle(file.path));
    doors.current.set(file.path, door);
    return {
      texts: files.get(file.path),
      offered: read !== undefined && whole(file) && wholeable(file) && !refused.has(file.path),
      toggle: door,
    };
  };
}

type OpenedLines = ReadonlyMap<string, ReadonlySet<number>>;

const NONE_OPENED: OpenedLines = new Map();

interface ListOpened {
  readonly openedOf: (path: string) => ReadonlySet<number> | undefined;
  readonly onDrawn: (path: string, lines: readonly number[]) => void;
}

function useOpenedLines(): ListOpened {
  const [opened, setOpened] = useState<OpenedLines>(NONE_OPENED);
  const onDrawn = useCallback((path: string, lines: readonly number[]) => {
    setOpened((was) => {
      const next = new Map(was);
      if (lines.length === 0) next.delete(path);
      else next.set(path, new Set(lines));
      return next;
    });
  }, []);
  return { openedOf: (path) => opened.get(path), onDrawn };
}

type ShownLines = ReadonlyMap<string, ReadonlyMap<DiffSelection["side"], ReadonlySet<number>>>;

const NONE_SHOWN: ShownLines = new Map();

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

const NO_NOTES: readonly DiffNote[] = [];

const COMMENT_SIDE = {
  [DIFF_SIDE.LEFT]: DIFF_SELECTION_SIDE.DELETIONS,
  [DIFF_SIDE.RIGHT]: DIFF_SELECTION_SIDE.ADDITIONS,
} as const;

function threadLines(
  threads: readonly ReviewThread[],
  file: AgentChangedFile,
): DiffListSelection | undefined {
  const ranges = threads.flatMap((thread) => {
    if (thread.line === null) return [];
    const side = COMMENT_SIDE[thread.startSide ?? thread.side];
    const start = thread.startLine ?? thread.line;
    const place = rowPlace(file, side, start) ?? Number.NEGATIVE_INFINITY;
    const selection = { start, side, end: thread.line, endSide: COMMENT_SIDE[thread.side] };
    return [{ place, lines: { path: thread.path, selection } }];
  });
  return ranges.toSorted(
    (a, b) => a.place - b.place || a.lines.selection.start - b.lines.selection.start,
  )[0]?.lines;
}

interface ListCommenting {
  readonly open: (picked: DiffListSelection) => void;
  readonly commentOn: (picked: DiffListSelection) => string | undefined;
  readonly notes: ReadonlyMap<string, readonly DiffNote[]>;
  readonly lit: DiffListSelection | undefined;
}

export interface LineComments {
  readonly pending: PendingReview;
  readonly onWritten: ReadAgain;
}

function DraftedLineComment({
  draft,
  ...comment
}: Omit<ComponentProps<typeof LineComment>, "body" | "onBody"> & {
  draft: CommentDraft;
}): React.JSX.Element {
  const number = usePullRequestNumber();
  const { draft: kept, update } = useDraft(lineCommentPlace(comment.agentId, number, draft));
  return (
    <LineComment
      {...comment}
      body={kept.text}
      onBody={(text) => update((was) => ({ ...was, text }))}
    />
  );
}

function useListCommenting(
  agentId: string,
  files: readonly AgentChangedFile[],
  headSha: string | undefined,
  comments: LineComments | undefined,
  onRefresh: () => void,
): ListCommenting | undefined {
  const [drafts, setDrafts] = useState<CommentDrafts>(NO_DRAFTS);
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
          <DraftedLineComment
            draft={draft}
            agentId={agentId}
            path={path}
            lines={lines}
            headSha={headSha}
            pending={comments.pending}
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

interface RestingThread {
  readonly lines: DiffListSelection | undefined;
  readonly hover: ThreadHover;
}

function useThreadHover(): RestingThread {
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

interface RevealedPlace {
  readonly at: DiffListReveal["at"];
  readonly chip: { readonly side: DiffSelection["side"]; readonly line: number };
}

function revealedPlace(
  thread: ReviewThread,
  file: AgentChangedFile,
  lead: boolean,
  whole: DiffFileTexts | undefined,
  opened: ReadonlySet<number> | undefined,
): RevealedPlace {
  const fileWide = { side: DIFF_SELECTION_SIDE.ADDITIONS, line: FILE_NOTE_LINE };
  if (lead) return { at: undefined, chip: fileWide };
  const drawnWhole = emptyWhole(whole) ? undefined : whole;
  const { placed, above } = threadsOn([thread], file, drawnWhole, opened);
  const [onLine] = placed;
  if (onLine !== undefined) {
    const at = { side: onLine.side, line: onLine.line };
    return { at, chip: at };
  }
  return { at: undefined, chip: { side: above[0]?.side ?? fileWide.side, line: FILE_NOTE_LINE } };
}

type ListReveal = ChangesReveal & { readonly file: AgentChangedFile };

interface ListLanding {
  readonly ask: number;
  readonly threadId: string;
  readonly thread: ReviewThread;
  readonly file: AgentChangedFile;
}

interface ListLandingControl {
  readonly reveal: DiffListReveal | undefined;
  readonly lines: DiffListSelection | undefined;
  readonly provided: ThreadLanding | undefined;
}

const LANDING_FRAMES = 240;

function standsIn(box: HTMLElement | null, card: HTMLElement): boolean {
  if (box === null || !landable(card)) return false;
  const area = box.getBoundingClientRect();
  const { top } = card.getBoundingClientRect();
  return top >= area.top && top < area.bottom;
}

function useListLanding(
  reveal: ListReveal | undefined,
  list: ChangesList,
  entries: readonly DiffListEntry[],
  minimizedOf: (path: string) => FileMinimized | undefined,
  wholeOf: (file: AgentChangedFile) => FileWhole,
  openedOf: (path: string) => ReadonlySet<number> | undefined,
  box: React.RefObject<HTMLElement | null>,
): ListLandingControl {
  const [landing, setLanding] = useState<ListLanding | undefined>(undefined);
  const latest = useRef({ reveal, list });
  latest.current = { reveal, list };
  const ask = reveal?.ask;
  useEffect(() => {
    const { reveal, list } = latest.current;
    const threadId = reveal?.thread.id;
    if (reveal === undefined || threadId === undefined) return;
    list.expand(reveal.file.path);
    setLanding({ ask: reveal.ask, threadId, thread: reveal.thread, file: reveal.file });
  }, [ask]);
  const entry =
    landing === undefined ? undefined : entries.find((each) => each.path === landing.file.path);
  const place =
    landing === undefined || entry === undefined
      ? undefined
      : revealedPlace(
          landing.thread,
          landing.file,
          entry.lead,
          wholeOf(landing.file).texts,
          openedOf(landing.file.path),
        );
  const chipShown = useRef<number | undefined>(undefined);
  const latestPlace = useRef({ landing, place, minimizedOf });
  latestPlace.current = { landing, place, minimizedOf };
  const placed = place !== undefined;
  useEffect(() => {
    const { landing, place, minimizedOf } = latestPlace.current;
    if (landing === undefined || place === undefined || chipShown.current === landing.ask) return;
    chipShown.current = landing.ask;
    minimizedOf(landing.file.path)?.show(place.chip.side, place.chip.line, true);
  }, [landing?.ask, placed]);
  const onLanded = reveal?.onLanded;
  const provided =
    landing === undefined || onLanded === undefined
      ? undefined
      : {
          target: landing.threadId,
          ask: landing.ask,
          frames: LANDING_FRAMES,
          ready: (card: HTMLElement) => standsIn(box.current, card),
          onLanded,
          onFaded: (faded: number) => setLanding((was) => (was?.ask === faded ? undefined : was)),
        };
  return {
    reveal:
      landing === undefined || place === undefined
        ? undefined
        : { ask: landing.ask, path: landing.file.path, at: place.at },
    lines:
      landing === undefined || place?.at === undefined
        ? undefined
        : threadLines([landing.thread], landing.file),
    provided,
  };
}

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
      <span className="diff-list-viewed ml-auto flex flex-none items-center text-caption-inline text-muted-foreground">
        <Checkbox checked={viewed} onChange={onToggle}>
          {LIST_WORDS.VIEWED}
        </Checkbox>
      </span>
    </Tooltip>
  );
}

function WholeToggle({
  whole,
  onToggle,
}: {
  whole: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const label = whole ? LIST_WORDS.COLLAPSE_TO_CHANGES : LIST_WORDS.EXPAND_WHOLE;
  return (
    <Tooltip label={label}>
      <IconButton
        icon={whole ? <FoldVerticalIcon /> : <UnfoldVerticalIcon />}
        label={label}
        size={BUTTON_SIZE.COMPACT}
        pressed={whole}
        onClick={onToggle}
      />
    </Tooltip>
  );
}

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
        size={BUTTON_SIZE.COMPACT}
        onClick={onToggle}
      />
    </Tooltip>
  );
}

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

function repositoryOf(url: string): string | undefined {
  const [owner, name] = URL.canParse(url)
    ? new URL(url).pathname.split("/").filter((segment) => segment !== "")
    : [];
  return owner === undefined || name === undefined ? undefined : `${owner}/${name}`;
}

function expansionRefusalOf(refusal: TaskFileRefusal): ExpansionRefusal {
  return refusal === TASK_FILE_REFUSAL.NOT_TEXT
    ? EXPANSION_REFUSAL.NOT_TEXT
    : EXPANSION_REFUSAL.UNAVAILABLE;
}

interface FileTexts {
  readonly expandable: (file: AgentChangedFile) => boolean;
  readonly whole: (file: AgentChangedFile) => boolean;
  readonly wholeable: (file: AgentChangedFile) => boolean;
  readonly read: ((path: string) => Promise<DiffFileTexts | undefined>) | undefined;
  readonly refused: ReadonlyMap<string, ExpansionRefusal>;
}

type RawRead = { readonly text: string } | { readonly refused: ExpansionRefusal };

type TextsRead = { readonly texts: DiffFileTexts } | { readonly refused: ExpansionRefusal };

function useFileTexts(
  taskId: string | null,
  repository: string | null,
  pullRequest: {
    readonly url: string;
    readonly headSha?: string;
    readonly baseSha?: string;
    readonly files: readonly AgentChangedFile[];
  } | null,
  files: readonly AgentChangedFile[],
): FileTexts {
  const queryClient = useQueryClient();
  const [refusals, setRefusals] = useState<{
    readonly of: unknown;
    readonly refused: ReadonlyMap<string, ExpansionRefusal>;
  }>({ of: pullRequest, refused: new Map() });
  const refused = refusals.of === pullRequest ? refusals.refused : NONE_REFUSED;
  const baseSha = pullRequest?.baseSha;
  const drawable = useCallback(
    (file: AgentChangedFile) =>
      wholeable(file) ||
      (tooLargeToDiff(file) &&
        (file.status === CHANGED_FILE_STATUS.ADDED || baseSha !== undefined)),
    [baseSha],
  );
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
    const rawAt = (ref: string, path: string): Promise<RawRead> =>
      queryClient
        .fetchQuery(
          taskFileQueryOptions({ taskId }, { path, firstLine: 1, lastLine: 1, raw: true, ref }),
        )
        .then(
          (answer) =>
            "text" in answer
              ? { text: answer.text.text }
              : { refused: EXPANSION_REFUSAL.UNAVAILABLE },
          (error: unknown) => {
            const refused = refusedAnswer(error);
            return {
              refused:
                "refusal" in refused
                  ? expansionRefusalOf(refused.refusal)
                  : EXPANSION_REFUSAL.UNAVAILABLE,
            };
          },
        );
    const textsAt = async (file: AgentChangedFile): Promise<TextsRead> => {
      if (!tooLargeToDiff(file)) {
        const after = await rawAt(headSha, file.path);
        if ("refused" in after) return after;
        const texts = await checkedTextsOf(file, after.text);
        return texts === undefined ? { refused: EXPANSION_REFUSAL.CHANGED } : { texts };
      }
      const nothing: RawRead = { text: "" };
      const [before, after] = await Promise.all([
        file.status === CHANGED_FILE_STATUS.ADDED
          ? nothing
          : baseSha === undefined
            ? { refused: EXPANSION_REFUSAL.UNAVAILABLE }
            : rawAt(baseSha, file.previousPath ?? file.path),
        file.status === CHANGED_FILE_STATUS.DELETED ? nothing : rawAt(headSha, file.path),
      ]);
      if ("refused" in before) return before;
      if ("refused" in after) return after;
      if (file.blobSha !== undefined && (await blobShaOf(after.text)) !== file.blobSha) {
        return { refused: EXPANSION_REFUSAL.CHANGED };
      }
      return { texts: { before: before.text, after: after.text } };
    };
    return (path: string) => {
      const file = files.find((each) => each.path === path);
      if (file === undefined || !drawable(file)) return Promise.resolve(undefined);
      const held = kept.get(path);
      if (held !== undefined) return held;
      const reading = textsAt(file).then((read) => {
        if ("texts" in read) return read.texts;
        refuse(path, read.refused);
        return undefined;
      });
      kept.set(path, reading);
      return reading;
    };
  }, [queryClient, taskId, repository, pullRequest, files, baseSha, drawable]);
  const own = useMemo(() => new Set(pullRequest?.files), [pullRequest]);
  const whole = useCallback((file: AgentChangedFile) => own.has(file), [own]);
  const offered = useCallback(
    (file: AgentChangedFile) =>
      read !== undefined && whole(file) && expandable(file) && !refused.has(file.path),
    [read, whole, refused],
  );
  return { expandable: offered, wholeable: drawable, read, refused, whole };
}

async function checkedTextsOf(
  file: AgentChangedFile,
  after: string,
): Promise<DiffFileTexts | undefined> {
  if (file.blobSha !== undefined && (await blobShaOf(after)) !== file.blobSha) return undefined;
  return textsOf(file, after);
}

const NONE_REFUSED: ReadonlyMap<string, ExpansionRefusal> = new Map();

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

function shownFileOf(
  files: readonly AgentChangedFile[],
  current: string | undefined,
): AgentChangedFile | undefined {
  return files.find((file) => file.path === current) ?? files[0];
}

function FilesList({
  list,
  threads,
  images,
  commenting,
  texts,
  filterShown,
  roomy,
  boxRef,
  reveal,
  flash,
  overscroll,
}: {
  list: ChangesList;
  threads: ChangesThreads | undefined;
  images: ImageSides | undefined;
  commenting: ListCommenting | undefined;
  texts: FileTexts;
  filterShown: boolean;
  roomy: boolean;
  boxRef: (element: HTMLDivElement | null) => void;
  reveal: ListReveal | undefined;
  flash: DiffListFlash | undefined;
  overscroll: ScrollOverscroll | undefined;
}): React.JSX.Element {
  const look = useDiffLook(roomy);
  const box = useRef<HTMLDivElement | null>(null);
  const holdBox = useCallback(
    (element: HTMLDivElement | null) => {
      box.current = element;
      boxRef(element);
    },
    [boxRef],
  );
  const { settings } = useFileViewSettings();
  const minimizedOf = useMinimizedLines(settings.diffMinimizeComments);
  const wholeOf = useWholeFiles(texts);
  const resting = useThreadHover();
  const opened = useOpenedLines();
  const entries = useEntries(
    list,
    threads,
    images,
    commenting,
    texts,
    minimizedOf,
    resting.hover,
    wholeOf,
    opened.openedOf,
  );
  const landing = useListLanding(reveal, list, entries, minimizedOf, wholeOf, opened.openedOf, box);
  const query = list.query.trim();
  return (
    <Fill
      as={FILL_ELEMENT.SECTION}
      className="file-tab bg-card-code"
      aria-label="Diffs of the changed files"
    >
      {query === "" || filterShown ? null : (
        <TabNotice>
          <p>
            {LIST_WORDS.FILTERED} “<bdi>{query}</bdi>”
          </p>
          <Button onClick={() => list.onQuery("")}>{LIST_WORDS.CLEAR_FILTER}</Button>
        </TabNotice>
      )}
      {list.kept.length === 0 ? (
        <EmptyState>{LIST_WORDS.NONE_KEPT}</EmptyState>
      ) : (
        <ThreadLandingProvider value={landing.provided}>
          <PierreDiffList
            entries={entries}
            look={look}
            door={list.door}
            onTopFile={list.onTopFile}
            boxRef={holdBox}
            onComment={commenting?.open}
            commentOn={commenting?.commentOn}
            selected={landing.lines ?? resting.lines ?? commenting?.lit}
            readTexts={texts.read}
            reveal={landing.reveal}
            onDrawn={opened.onDrawn}
            flash={flash}
            overscroll={overscroll}
          />
        </ThreadLandingProvider>
      )}
    </Fill>
  );
}

type ChangesPullRequest = Extract<AgentChangesAnswerView, { pullRequest: unknown }>["pullRequest"];

export interface ChangesReads {
  readonly answer: AgentChangesAnswerView | undefined;
  readonly refreshFailed: boolean;
  readonly out: boolean;
  readonly ask: () => void;
  readonly count: number;
  readonly pullRequest: ChangesPullRequest;
  readonly viewedFiles: ViewedFiles;
}

export function useChangesReads(
  agentId: string,
  source: PullRequestSource,
  shown: boolean,
): ChangesReads {
  const changes = useQuery({ ...agentChangesQueryOptions(agentId, source.number), enabled: false });
  const { refetch, isFetching: out, data: good, error } = changes;
  const ask = useCallback(() => void refetch(), [refetch]);
  const readFor = useRef<{ readonly agentId: string; readonly ended: boolean } | undefined>(
    undefined,
  );
  useEffect(() => {
    if (!shown) return;
    if (readFor.current?.agentId === agentId && readFor.current.ended === source.ended) return;
    readFor.current = { agentId, ended: source.ended };
    ask();
  }, [shown, agentId, source.ended, ask]);
  const failure =
    error instanceof ChangesFailed ? error.answer : error === null ? undefined : UNANSWERED;
  useRegained(() => {
    if (shown && (out || failure !== undefined)) ask();
  });
  const answer: AgentChangesAnswerView | undefined = good ?? failure;
  const refreshFailed = good !== undefined && failure !== undefined;
  const reads = useRef<{ readonly of: unknown; readonly count: number }>({
    of: undefined,
    count: 0,
  });
  if (reads.current.of !== answer) reads.current = { of: answer, count: reads.current.count + 1 };
  const pullRequest = answer !== undefined && "pullRequest" in answer ? answer.pullRequest : null;
  const viewedFiles = useViewedFiles(
    agentId,
    source,
    pullRequest === null ? undefined : reads.current.count,
  );
  return { answer, refreshFailed, out, ask, count: reads.current.count, pullRequest, viewedFiles };
}

export interface FileReveal {
  readonly path: string;
  readonly ask: number;
  readonly lines?: DiffLineSpan | undefined;
}

export interface ChangesBarHost {
  readonly tools: HTMLElement | null;
  readonly end: HTMLElement | null;
  readonly view: HTMLElement | null;
}

export function AgentChangesTab({
  agentId,
  source,
  shown,
  repository,
  tree,
  threads,
  lineComments,
  reveal,
  reads,
  files,
  fileReveal,
  overscroll,
  host,
}: {
  agentId: string;
  source: PullRequestSource;
  shown: boolean;
  repository: string | null;
  tree: TreeShown;
  threads?: ChangesThreads | undefined;
  lineComments?: LineComments | undefined;
  reveal?: ChangesReveal | undefined;
  reads: ChangesReads;
  files?: readonly AgentChangedFile[] | undefined;
  fileReveal?: FileReveal | undefined;
  overscroll?: ScrollOverscroll | undefined;
  host?: ChangesBarHost | undefined;
}): React.JSX.Element {
  const { answer, refreshFailed, out, ask, pullRequest, viewedFiles } = reads;
  const room = usePaneRoom(tree, host?.view);
  const edge = useTreeEdge(tree);
  const [diffBox, setDiffBox] = useState<HTMLDivElement | null>(null);
  const roomy = useSplitRoom(diffBox);
  const changed = useMemo(() => {
    const drawn = files ?? pullRequest?.files ?? [];
    const paths = drawn.map((file) => file.path);
    return { files: drawn, paths, ordered: treeOrder(drawn), folders: changedFolders(paths) };
  }, [pullRequest, files]);
  const viewSettings = useFileViewSettings();
  const minimize = () =>
    viewSettings.change("diffMinimizeComments", !viewSettings.settings.diffMinimizeComments);
  const list = useChangesList(changed.files, viewedFiles.marks, minimize, room.toggle);
  const marks = useMemo(
    () => changeMarks(changed.files, { threads: threads?.list, viewed: list.viewed }),
    [changed.files, threads?.list, list.viewed],
  );
  const answered = reads.count;
  const images = useMemo(
    () => (pullRequest === null ? undefined : imagesOf(agentId, pullRequest, answered)),
    [agentId, pullRequest, answered],
  );
  const { closeOver } = room;
  const { hideKeys } = list;
  useEffect(() => {
    if (!shown) hideKeys();
  }, [shown, hideKeys]);
  const { go, expand } = list;
  const openTab = useOpenFileTab();
  const choose = useCallback(
    (path: string, newTab: boolean) => {
      if (newTab && openTab !== undefined) return openTab(path);
      closeOver();
      go(path);
    },
    [closeOver, go, openTab],
  );
  const latestFileReveal = useRef({ fileReveal, expand, go, stand: list.stand });
  latestFileReveal.current = { fileReveal, expand, go, stand: list.stand };
  useEffect(() => {
    const { fileReveal, expand, go, stand } = latestFileReveal.current;
    if (fileReveal === undefined) return;
    expand(fileReveal.path);
    if (fileReveal.lines === undefined) go(fileReveal.path);
    else stand(fileReveal.path);
  }, [fileReveal?.ask]);
  const flash =
    fileReveal?.lines === undefined
      ? undefined
      : { ask: fileReveal.ask, range: { path: fileReveal.path, ...fileReveal.lines } };
  const shownFile = shownFileOf(changed.files, list.current);
  const refresh = () => {
    ask();
    threads?.refresh?.();
  };
  const changesMenu = useChangesMenu({ pullRequest });
  const settings = useViewSettingsSheet({ kind: VIEW_SETTINGS_SCOPE.DIFF, roomy });
  const phone = usePhoneRoom();
  const url = pullRequest?.url;
  useTabActions(
    phone && shown && url !== undefined && shownFileOf(changed.files, list.current) !== undefined
      ? host === undefined
        ? [
            [
              paneToggleAction(room),
              {
                ...gitHubAction(() => appPlatform().openGitHub(`${url}/files`)),
                label: OPEN_FILES_ON_GITHUB,
              },
              settings.action,
              foldAllAction(list),
            ],
            ...barMenuItems(changesMenu),
          ]
        : [[paneToggleAction(room), settings.action, foldAllAction(list)]]
      : undefined,
  );
  const texts = useFileTexts(source.place.taskId, repository, pullRequest, changed.files);
  const commenting = useListCommenting(
    agentId,
    changed.files,
    pullRequest?.headSha,
    lineComments,
    refresh,
  );
  const revealAsk = reveal?.ask;
  const revealPath = reveal?.thread.path;
  const revealFile = changed.files.find((file) => file.path === revealPath);
  const revealGone = reveal !== undefined && pullRequest !== null && revealFile === undefined;
  const latestReveal = useRef(reveal);
  latestReveal.current = reveal;
  useEffect(() => {
    const standing = latestReveal.current;
    if (revealGone && standing !== undefined) standing.onGone(standing.ask);
  }, [revealGone, revealAsk]);
  if (answer === undefined || (out && "failure" in answer)) {
    return <SpinnerRegion delay label={CHANGES_WORDS.READING} />;
  }
  const unkept = refreshFailed && !out && (pullRequest === null || shownFile === undefined);
  if ("failure" in answer || unkept) {
    return (
      <ErrorState
        failure={failureShown({
          surface: FAILURE_SURFACE.AGENT_CHANGES_READ,
          cause: "failure" in answer ? answer : FAILURE_CONDITION.UNREAD,
        })}
        onRetry={refresh}
        placement={ERROR_STATE_PLACEMENT.CENTERED}
      >
        {CHANGES_WORDS.FAILED}
      </ErrorState>
    );
  }
  if (pullRequest === null) {
    return (
      <EmptyState icon={<GLYPH.PULL_REQUEST_CHANGES />}>{CHANGES_WORDS.NO_PULL_REQUEST}</EmptyState>
    );
  }
  if (shownFile === undefined) {
    return <EmptyState icon={<GLYPH.PULL_REQUEST_CHANGES />}>{CHANGES_WORDS.EMPTY}</EmptyState>;
  }
  return (
    <Fill
      className="file-view ph-no-capture"
      {...room.root}
      onKeyDown={(event) => {
        room.root.onKeyDown(event);
        list.onKeyDown(event);
      }}
    >
      {phone ? (
        settings.sheet
      ) : host !== undefined ? (
        <>
          {host.tools === null
            ? null
            : createPortal(
                <>
                  <ViewSettingsButton scope={{ kind: VIEW_SETTINGS_SCOPE.DIFF, roomy }} />
                  <FoldAllButton list={list} />
                </>,
                host.tools,
              )}
          {host.end === null ? null : createPortal(<TreeToggle toggles={room.toggles} />, host.end)}
        </>
      ) : (
        <FileViewBar
          github={{
            href: `${pullRequest.url}/files`,
            open: (url) => appPlatform().openGitHub(url),
          }}
          menu={
            <>
              <ViewSettingsButton scope={{ kind: VIEW_SETTINGS_SCOPE.DIFF, roomy }} />
              <FoldAllButton list={list} />
            </>
          }
          more={changesMenu}
          tree={room.toggles}
        />
      )}
      <PullRequestWriteNote writes={viewedFiles} />
      {refreshFailed && !out ? (
        <ErrorState failure={unreadShown(FAILURE_SURFACE.AGENT_CHANGES_REFRESH)} onRetry={refresh}>
          {REFRESH_FAILED_WORDS}
        </ErrorState>
      ) : null}
      {pullRequest.truncated ? (
        <TabNotice>
          <p>{CHANGES_WORDS.TRUNCATED}</p>
        </TabNotice>
      ) : null}
      <Fill flow={FILL_FLOW.ROW} clip className="file-view-body relative" {...room.body}>
        <FilesList
          list={list}
          threads={threads}
          images={images}
          commenting={commenting}
          texts={texts}
          filterShown={room.drawn}
          roomy={roomy}
          boxRef={setDiffBox}
          reveal={
            reveal === undefined || revealFile === undefined
              ? undefined
              : { ...reveal, file: revealFile }
          }
          flash={flash}
          overscroll={overscroll}
        />
        <FileTreePane
          file={shownFile.path}
          only={changed.paths}
          marks={marks}
          label="Changed files"
          listFolder={changed.folders}
          search={{ query: list.query, onQuery: list.onQuery }}
          onOpen={choose}
          onViewed={list.markViewed}
          over={room.docked ? undefined : room.over}
          narrow={room.narrow}
          pane={room.beside.pane}
          leaving={room.beside.leaving}
          width={tree.width?.width}
          edge={edge}
        />
        {tree.open || host !== undefined ? null : (
          <ChangesStrip
            files={changed.ordered}
            current={shownFile.path}
            viewed={list.viewed}
            peek={room.strip}
          />
        )}
      </Fill>
      <FilesChangedKeysSheet open={shown && list.keysShown} onDismiss={hideKeys} />
    </Fill>
  );
}
