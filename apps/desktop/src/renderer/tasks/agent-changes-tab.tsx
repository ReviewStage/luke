import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentChangesAnswerView,
} from "@luke/features/coding-agent-view";
import {
  CODING_AGENT_STATUS,
  type CodingAgentChangedFile,
  type CodingAgentChangesPeople,
  type CodingAgentPullRequest,
  type ReviewThread,
} from "@luke/features/coding-agent-wire";
import { imageTypeOfPath } from "@luke/features/github-image";
import type { CatalogModel } from "@luke/features/models-wire";
import { appPlatform } from "@luke/panel/app-platform";
import { DIFF_LAYOUT, INLINE_DIFF } from "@luke/settings/diff-view";
import {
  CopyIcon,
  DownloadIcon,
  EmptyState,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  HoverCard,
  HoverCardHead,
  HoverCardNote,
} from "@luke/ui";
import { fileName } from "@luke/voice/code-pane-model";
import {
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  ClipboardCopyIcon,
  CodeIcon,
  Columns2Icon,
  FileDiffIcon,
  HighlighterIcon,
  ImageIcon,
  RotateCwIcon,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCopyToast } from "../copy-feedback";
import { DIFF_SELECTION_SIDE, type DiffSelection, FILE_NOTE_LINE } from "../diff-view/contract";
import { SpinnerRegion } from "../spinner";
import { Tooltip } from "../tooltip";
import { LinesChanged } from "./agent-published";
import { AgentActorRef, type AgentSubject } from "./agent-ref";
import { type ChangesList, FileHead, FOLD_CHORD, LIST_WORDS, useChangesList } from "./changes-list";
import {
  CHANGES_WORDS,
  changedFolders,
  changeMarks,
  fileNotice,
  filePatch,
  headerPatch,
  linesChanged,
  listPatch,
  STATUS_LETTER,
  STATUS_WORDS,
  threadsOn,
} from "./changes-model";
import { agentStillWriting, pullRequestNumberLabel } from "./coding-agent-model";
import { type DiffListEntry, type DiffNote, PierreDiffList } from "./diff-list";
import { DiffSettingsButton } from "./diff-settings";
import { useDiffLook, useSplitRoom } from "./file-diff";
import { LinesMenu, useSaveText } from "./file-menu";
import { FileTreePane } from "./file-tree-pane";
import { FileViewBar, usePaneRoom } from "./file-view";
import { useFileViewSettings } from "./file-view-settings";
import { ImageDiff, type ImageSides, imageDrawable } from "./image-diff";
import { PullRequestMark } from "./pull-request-mark";
import { OpenedBy, PullRequestPeople, ReviewersLine } from "./pull-request-people";
import type { CodingAgentsControl, HeldPeople } from "./use-coding-agents";

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
 * Under its bar the view says who the pull request names, who opened it,
 * its reviewers, and who authored its commits (`pull-request-people.tsx`);
 * what the reviews said stands in the tab's overview, whole, in its
 * conversation.
 *
 * Otherwise the tab is a File view (`file-view.tsx`) over its files' diffs,
 * every file in one list as stage-cli draws them (`diff-list.tsx`), each
 * under a header of its own that folds it, names it, with the letter of
 * what became of it and the lines it adds and removes, and stays at the top
 * while its lines scroll by; a file with no hunks says why under its header.
 * Its bar names the file the keys stand on, or else the one at the top of
 * the list, as breadcrumbs, whose trees list only the changed files, the
 * same letter and lines quietly beside, then the pull request's files on
 * GitHub, the diff settings, every one stage-cli offers in a popover
 * (`diff-settings.tsx`), Collapse all or Expand all, the ⋯ (the file's name
 * or its patch copied, the patch saved, the changes read again, the File
 * tabs' two settings, and two of the diff's as quick checks: Split view,
 * offered dimmed while the list is too narrow to split (`file-diff.tsx`),
 * and Highlight changed words), and the tree's toggle, which shows and
 * hides the tree for every File and Changes tab alike. The tree is a File
 * tab's own pane (`file-tree-pane.tsx`) narrowed to the changed files,
 * every folder open, each row lettered A, M, D, or R, its search the
 * list's filter, narrowing the list to the files whose path holds it as it
 * narrows the rows, said over the list while the tree is hidden, with the
 * pull request's count under it, or under the list while the tree is
 * hidden; choosing a file there or in a crumb's tree scrolls the list to
 * it. stage-cli's keys walk the list (`changes-list.tsx`). The diffs are
 * drawn by Pierre's diffs in a bundle of its own (`../diff-view/`), on the
 * File tab's ground, in its type and colours, unified or split, numbered
 * and wrapped as the File tabs' settings say, their numbers left out of the
 * find and of a copy as a File tab's are; what is a diff's alone is the
 * tint of a line added or removed, the words a changed line changed, and
 * the count of unchanged lines between two hunks.
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

/** The bar's ⋯ over a diff: the file's name or its patch copied, the patch saved, and the changes read again, over the File tabs' settings and the diff's own. */
function ChangesMenu({
  file,
  reading,
  onRefresh,
  roomy,
}: {
  file: CodingAgentChangedFile;
  /** Whether a read is out, which a refresh would only repeat. */
  reading: boolean;
  onRefresh: () => void;
  /** Whether the diff is wide enough to split, which Split view is offered by. */
  roomy: boolean;
}): React.JSX.Element {
  const copyWithToast = useCopyToast();
  const saveText = useSaveText();
  const { settings, change } = useFileViewSettings();
  const name = fileName(file.path);
  const patch = filePatch(file);
  const split = settings.diffLayout === DIFF_LAYOUT.SPLIT;
  return (
    <LinesMenu
      label="Changes actions"
      actions={[
        {
          label: "Copy file name",
          icon: <CopyIcon />,
          onSelect: () => copyWithToast(name, "File name copied"),
        },
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
      looks={[
        {
          label: "Split view",
          icon: <Columns2Icon aria-hidden="true" />,
          detail: roomy ? undefined : CHANGES_WORDS.TOO_NARROW_TO_SPLIT,
          checked: split && roomy,
          disabled: !roomy,
          onSelect: () => change("diffLayout", split ? DIFF_LAYOUT.UNIFIED : DIFF_LAYOUT.SPLIT),
        },
        {
          label: "Highlight changed words",
          icon: <HighlighterIcon aria-hidden="true" />,
          checked: settings.inlineDiff !== INLINE_DIFF.NONE,
          onSelect: () =>
            change(
              "inlineDiff",
              settings.inlineDiff === INLINE_DIFF.NONE ? INLINE_DIFF.WORD_ALT : INLINE_DIFF.NONE,
            ),
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

/** The key of what stands in the place of the lines of a file that draws none; a review thread's note is keyed by its page, which this never is. */
const LEAD_KEY = "lead";

/** A file's review threads that stand above its lines, as one list. */
function AboveThreads({
  above,
  threads,
}: {
  above: readonly { readonly key: string; readonly thread: ReviewThread }[];
  threads: ChangesThreads | undefined;
}): React.JSX.Element {
  return (
    <ol className="diff-outdated-threads" aria-label={CHANGES_WORDS.UNPLACED_THREADS}>
      {above.map((each) => (
        <li key={each.key}>{threads?.draw(each.thread, THREAD_PLACE.ABOVE)}</li>
      ))}
    </ol>
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
 * threads.
 */
function entryOf(
  file: CodingAgentChangedFile,
  list: ChangesList,
  threads: ChangesThreads | undefined,
  images: ImageSides | undefined,
): DiffListEntry {
  const path = file.path;
  const image = imageTypeOfPath(path) === undefined || images === undefined ? undefined : images;
  // An SVG with lines to draw is text as well as a picture: its lines are drawn while its source is asked for.
  const source = fileNotice(file) === undefined && list.asSource(path);
  const pictured = image !== undefined && !source && imageDrawable(file, image) ? image : undefined;
  // Note that a pictured file draws no lines, so its threads stand above it, as on a binary file.
  const drawnAs = pictured === undefined ? file : { ...file, patch: null };
  const { placed, above } = threadsOn(threads?.list ?? [], drawnAs);
  const notes: DiffNote[] = placed.map((each) => ({
    key: each.key,
    side: each.side,
    line: each.line,
    content: threads?.draw(each.thread, THREAD_PLACE.ON_LINE),
  }));
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
          {above.length === 0 ? null : <AboveThreads above={above} threads={threads} />}
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
      content: <AboveThreads above={unplaced} threads={threads} />,
    });
  }
  const collapsed = list.collapsed(path);
  return {
    path,
    patch: pictured === undefined ? listPatch(file) : headerPatch(file),
    collapsed,
    lead: lead !== undefined,
    header: (
      <FileHead
        file={file}
        controls={
          image === undefined || fileNotice(file) !== undefined ? null : (
            <SourceToggle source={source} onToggle={() => list.toggleSource(path)} />
          )
        }
        collapsed={collapsed}
        standing={list.standing === path}
        onToggle={() => list.toggle(path)}
        onStand={() => list.stand(path)}
      />
    ),
    notes,
  };
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
      <button
        type="button"
        className="icon-button diff-list-source"
        aria-label={label}
        onClick={onToggle}
      >
        {source ? <ImageIcon aria-hidden="true" /> : <CodeIcon aria-hidden="true" />}
      </button>
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

/** Collapse all or Expand all, for the files the filter keeps, in the bar. */
function FoldAllButton({ list }: { list: ChangesList }): React.JSX.Element {
  const label = list.allCollapsed ? LIST_WORDS.EXPAND_ALL : LIST_WORDS.COLLAPSE_ALL;
  return (
    <Tooltip label={label} chord={FOLD_CHORD.ALL}>
      <button
        type="button"
        className="icon-button"
        aria-label={label}
        disabled={list.kept.length === 0}
        onClick={list.toggleAll}
      >
        {list.allCollapsed ? (
          <ChevronsUpDownIcon aria-hidden="true" />
        ) : (
          <ChevronsDownUpIcon aria-hidden="true" />
        )}
      </button>
    </Tooltip>
  );
}

/** The list of files, or the words saying the filter keeps none, and over it the filter where the tree that holds it is hidden. */
function FilesList({
  list,
  threads,
  images,
  filterShown,
  roomy,
  boxRef,
}: {
  list: ChangesList;
  threads: ChangesThreads | undefined;
  /** Where the pull request's changed images are read, drawn as pictures; none draws them as binary files. */
  images: ImageSides | undefined;
  /** Whether the tree, whose search is the filter, is drawn, so the filter is in sight. */
  filterShown: boolean;
  roomy: boolean;
  boxRef: (element: HTMLDivElement | null) => void;
}): React.JSX.Element {
  const look = useDiffLook(roomy);
  const query = list.query.trim();
  return (
    <section className="file-tab" aria-label="Diffs of the changed files">
      {query === "" || filterShown ? null : (
        <div className="file-tab-notice">
          <p className="m-0">
            {LIST_WORDS.FILTERED} “<bdi>{query}</bdi>”
          </p>
          <button type="button" className="toolbar-button" onClick={() => list.onQuery("")}>
            {LIST_WORDS.CLEAR_FILTER}
          </button>
        </div>
      )}
      {list.kept.length === 0 ? (
        <p className="side-panel-empty">{LIST_WORDS.NONE_KEPT}</p>
      ) : (
        <PierreDiffList
          entries={list.kept.map((file) => entryOf(file, list, threads, images))}
          look={look}
          door={list.door}
          onTopFile={list.onTopFile}
          boxRef={boxRef}
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
            <PullRequestMark pullRequest={pullRequest} />
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
}: {
  agentId: string;
  control: CodingAgentsControl;
  /** Whether the panel is on screen, which is when the tab reads. */
  shown: boolean;
  /** The task's repository, which the agent works in and the breadcrumbs name; none names the path plain. */
  repository: string | null;
  /** Whether the tree beside File and Changes tabs is open, and its toggle. */
  tree: { readonly open: boolean; readonly onToggle: () => void };
  /** The pull request's review threads, drawn on their lines in each file's diff; none draws none. */
  threads?: ChangesThreads | undefined;
}): React.JSX.Element {
  const status = control.agents?.find((each) => each.id === agentId)?.status;
  const ended = !agentStillWriting(status ?? CODING_AGENT_STATUS.RUNNING);
  const { answer, out, ask } = useAgentRead(agentId, shown, ended, control.readChanges, UNANSWERED);
  // How many answers have landed, which a changed image is drawn anew on.
  const reads = useRef<{ readonly of: unknown; readonly count: number }>({
    of: undefined,
    count: 0,
  });
  if (reads.current.of !== answer) reads.current = { of: answer, count: reads.current.count + 1 };
  const room = usePaneRoom(tree);
  const [diffBox, setDiffBox] = useState<HTMLDivElement | null>(null);
  const roomy = useSplitRoom(diffBox);
  const pullRequest = answer !== undefined && "pullRequest" in answer ? answer.pullRequest : null;
  // Note that the lists are kept while the answer is the same one, because
  // fresh ones would have the tree draw itself anew.
  const changed = useMemo(() => {
    const files = pullRequest?.files ?? [];
    const paths = files.map((file) => file.path);
    return { files, paths, marks: changeMarks(files), folders: changedFolders(paths) };
  }, [pullRequest]);
  const list = useChangesList(changed.files);
  const { closeOver } = room;
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
  // A pull request that changes no file still names its people, over the line saying so.
  if (shownFile === undefined) {
    return (
      <div className="file-view ph-no-capture">
        <PullRequestPeople people={pullRequest} />
        <EmptyState icon={<FileDiffIcon />}>{CHANGES_WORDS.EMPTY}</EmptyState>
      </div>
    );
  }
  const count = pullRequest.files.length;
  const total = linesChanged(pullRequest.files);
  const counted = (
    <>
      {count} {count === 1 ? "file" : "files"} changed{" "}
      <LinesChanged additions={total.additions} deletions={total.deletions} />
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
            <DiffSettingsButton roomy={roomy} />
            <FoldAllButton list={list} />
            <ChangesMenu
              file={shownFile}
              reading={out}
              onRefresh={() => {
                ask();
                threads?.refresh?.();
              }}
              roomy={roomy}
            />
          </>
        }
        tree={room.toggles}
      />
      <PullRequestPeople people={pullRequest} />
      {pullRequest.truncated ? (
        <div className="file-tab-notice">
          <p>{CHANGES_WORDS.TRUNCATED}</p>
        </div>
      ) : null}
      <div className="file-view-body" {...room.body}>
        <FilesList
          list={list}
          threads={threads}
          images={imagesOf(agentId, pullRequest, reads.current.count)}
          filterShown={room.drawn}
          roomy={roomy}
          boxRef={setDiffBox}
        />
        {room.drawn ? (
          <FileTreePane
            file={shownFile.path}
            only={changed.paths}
            marks={changed.marks}
            label="Changed files"
            foot={counted}
            listFolder={changed.folders}
            search={{ query: list.query, onQuery: list.onQuery }}
            onOpen={choose}
            pane={room.beside.pane}
            float={room.pane}
            leaving={room.beside.leaving}
          />
        ) : null}
      </div>
      {/* The count stands under the tree, and under the list while the tree
          stands nowhere beside it, which the stylesheet says (tasks.css). */}
      <p className="file-tree-foot">{counted}</p>
    </div>
  );
}
