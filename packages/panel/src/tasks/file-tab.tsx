import { encodeMention, MENTION_KIND } from "@repo/features/mention-link";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import type { TasksFileAnswer } from "@repo/features/tasks-view";
import { readingWords } from "@repo/features/words";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import {
  EmptyState,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  FILL_ELEMENT,
  Fill,
  SpinnerRegion,
} from "@repo/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { useAppCommand } from "../app-commands.js";
import { unreadShown } from "../failure-report.js";
import { fileName } from "./file-ref-model.js";
import {
  FILE_READ,
  type FileRead,
  type FileText,
  lineCountOf,
  refusalLine,
  refusalPasses,
} from "./file-tab-model.js";
import { ReadRefused, taskFileQueryOptions } from "./repository-reads.js";
import { useMentionDrop, useTaskMentions } from "./task-mentions.js";
import type { FileReadPlace, OpenFile } from "./use-side-panel.js";
import { WholeFile, type WholeFileHandle, type WholeFileNote } from "./whole-file.js";

/**
 * file-tab.tsx -- a File tab: one whole file of the open task's repository, opened from a file named in place, its lines lit and scrolled into view.
 *
 * The file is drawn whole, numbered and colored as every code is, by
 * Pierre's diffs (`whole-file.tsx`). The file
 * is read through the service whole (\`ACT_KIND.TASKS_FILE\`, raw), since
 * Pierre numbers a file from its first line, and drawn only near the view,
 * however long. A file an inbox item's code opened is read at the commit the
 * agent named, so its lines are the ones it meant. Note that the service
 * otherwise reads the file from GitHub as it stands now on the repository's
 * default branch, so the tab first reads one line of it, which names the
 * commit the head stands at, and then the whole text at that commit, so a
 * mention of its lines and its page on GitHub name the lines it draws. A file
 * changed since its lines were named is drawn as it is now, those lines lit
 * where they fall, and a file gone, or one the service refuses, says so in
 * the file's place. The tab
 * draws no heading of its own: the File view's bar over it names the file
 * and offers what is done with it (\`file-view.tsx\`), told how the read
 * stands as it moves. The lines are drawn as every code is
 * (\`file-view-settings.ts\`), and ⌘F finds in the whole file, drawn or not
 * (\`file-find.ts\`). Every line here is the repository's, so the root is
 * left out of the screen recording (\`ph-no-capture\`) as a second line
 * behind the recording's text masking.
 */

/** The first line of a file, the one read to learn the commit the head stands at. */
const FIRST_LINE = { firstLine: 1, lastLine: 1 } as const;

/** The read a failed query stands for: the refusal the service answered, or a read that never arrived. */
function failedRead(error: unknown): FileRead {
  return error instanceof ReadRefused ? notRead(error.answer) : { kind: FILE_READ.FAILED };
}

/** The read a refusal or a failure stands for, from an answer that carried no file. */
function notRead(answer: TasksFileAnswer): FileRead {
  if ("refusal" in answer) {
    return { kind: FILE_READ.REFUSED, refusal: answer.refusal, branch: answer.branch };
  }
  return { kind: FILE_READ.FAILED };
}

/** Where TanStack Query says a read stands, as its `status` names it. */
const QUERY_STATUS = {
  PENDING: "pending",
  ERROR: "error",
  SUCCESS: "success",
} as const;

/** One of the tab's reads as its result stands: its status, whether it is out, and what it answered. */
interface ReadStanding {
  readonly status: (typeof QUERY_STATUS)[keyof typeof QUERY_STATUS];
  readonly fetching: boolean;
  readonly data: TasksFileAnswer | undefined;
  /** Why the read failed, a refusal the service answered among them. */
  readonly error: unknown;
}

/**
 * The whole text of the file once both reads answered: the head's first line,
 * where the tab is pinned to no commit, naming the commit the text is then
 * read at, so the text and the commit a mention names are one. A read still
 * out, a Retry's among them, stands as reading.
 */
function wholeTextRead(
  pinned: string | undefined,
  head: ReadStanding,
  whole: ReadStanding,
): FileRead {
  if (pinned === undefined) {
    if (head.status === QUERY_STATUS.PENDING || head.fetching) return { kind: FILE_READ.READING };
    if (head.status === QUERY_STATUS.ERROR) return failedRead(head.error);
    if (head.data === undefined) return { kind: FILE_READ.FAILED };
    if (!("file" in head.data)) return notRead(head.data);
  }
  if (whole.status === QUERY_STATUS.PENDING || whole.fetching) return { kind: FILE_READ.READING };
  if (whole.status === QUERY_STATUS.ERROR) return failedRead(whole.error);
  if (whole.data === undefined) return { kind: FILE_READ.FAILED };
  if (!("text" in whole.data)) return notRead(whole.data);
  const { repository, branch, text } = whole.data.text;
  const commit =
    pinned ?? (head.data !== undefined && "file" in head.data ? head.data.file.commit : undefined);
  const file: FileText = { repository, branch, commit, text, lineCount: lineCountOf(text) };
  return { kind: FILE_READ.READY, ...file };
}

/** A file carries no notes, the same array every render. */
const NO_NOTES: readonly WholeFileNote[] = [];

/** The file drawn whole, the lines it was opened on lit and centered each time it is opened. */
function FileTextView({
  file,
  held,
  handleRef,
}: {
  file: OpenFile;
  held: FileText;
  handleRef: React.RefObject<WholeFileHandle | null>;
}): React.JSX.Element {
  return (
    <WholeFile
      name={file.path}
      text={held.text}
      revision={held.commit ?? held.branch}
      lit={file.range}
      notes={NO_NOTES}
      findFrom={file.range?.startLine ?? 1}
      reveal={{ range: file.range ?? { startLine: 1, endLine: 1 }, at: file.opened }}
      handleRef={handleRef}
    />
  );
}

/**
 * Why a file read is not drawn, centered in the file's place: a read that did
 * not land, or a refusal that may pass, as a read failure with Retry; any
 * other refusal in the notice's own ink. Note that each is said by the
 * component that draws it.
 */
function ReadNotice({
  read,
  commit,
  onRetry,
}: {
  read: Exclude<FileRead, { kind: typeof FILE_READ.READY | typeof FILE_READ.READING }>;
  /** The commit the file was read at, where one pinned it. */
  commit: string | undefined;
  onRetry: () => void;
}): React.JSX.Element {
  if (read.kind === FILE_READ.FAILED || refusalPasses(read.refusal)) {
    const line =
      read.kind === FILE_READ.FAILED
        ? "The file could not be read."
        : refusalLine(read.refusal, read.branch, commit);
    return (
      <ErrorState
        failure={unreadShown(FAILURE_SURFACE.FILE_READ)}
        onRetry={onRetry}
        placement={ERROR_STATE_PLACEMENT.CENTERED}
      >
        {line}
      </ErrorState>
    );
  }
  return <EmptyState alert>{refusalLine(read.refusal, read.branch, commit)}</EmptyState>;
}

/** A file's lines as their mention's chip names them: the file's name and the lines, `app.ts:12–20`, or the one line. */
function linesName(path: string, lines: { readonly startLine: number; readonly endLine: number }) {
  const span =
    lines.startLine === lines.endLine
      ? String(lines.startLine)
      : `${lines.startLine}–${lines.endLine}`;
  return `${fileName(path)}:${span}`;
}

/**
 * The tab: the file, or why it is not shown. The file is read once for the tab, which is drawn anew for another
 * file or commit (\`file-view.tsx\`), and opened again on other lines only
 * scrolls to them.
 */
export function FileTab({
  place,
  file,
  onRead,
}: {
  /** Where the file is read: through the task, or the workspace's repository. */
  place: FileReadPlace;
  file: OpenFile;
  /** Hears how the read of the file stands each time it moves, the bar over the tab offering what it allows. */
  onRead: (read: FileRead) => void;
}): React.JSX.Element {
  const page = useTaskMentions();
  const drop = useMentionDrop();
  const handle = useRef<WholeFileHandle | null>(null);
  const pinned = file.commit;
  const head = useQuery({
    ...taskFileQueryOptions(place, { path: file.path, ...FIRST_LINE }),
    enabled: pinned === undefined,
  });
  const headRead = head.data !== undefined && "file" in head.data;
  const headCommit =
    head.data !== undefined && "file" in head.data ? head.data.file.commit : undefined;
  const commitAsked = pinned ?? headCommit;
  const whole = useQuery({
    ...taskFileQueryOptions(place, {
      path: file.path,
      ...FIRST_LINE,
      raw: true,
      ...(commitAsked === undefined ? undefined : { ref: commitAsked }),
    }),
    // Note that a head that answered no file, a refusal, ends the read there, as the tab draws it.
    enabled: pinned !== undefined || headRead,
  });
  // Note that the read is drawn from what each result says rather than the result itself, which is a new object every render.
  const { status: headStatus, isFetching: headFetching, data: headData, error: headError } = head;
  const {
    status: wholeStatus,
    isFetching: wholeFetching,
    data: wholeData,
    error: wholeError,
  } = whole;
  const read = useMemo(
    () =>
      wholeTextRead(
        pinned,
        { status: headStatus, fetching: headFetching, data: headData, error: headError },
        { status: wholeStatus, fetching: wholeFetching, data: wholeData, error: wholeError },
      ),
    [
      pinned,
      headStatus,
      headFetching,
      headData,
      headError,
      wholeStatus,
      wholeFetching,
      wholeData,
      wholeError,
    ],
  );
  // Retry reads again the read that stopped the tab: the head's where it failed or named no file, else the whole text.
  // Note that a head read again that failed keeps the file it named before, so its status is weighed beside its answer.
  const headStopped = head.status === QUERY_STATUS.ERROR || !headRead;
  const readAgain = () => void (pinned === undefined && headStopped ? head : whole).refetch();
  const told = useRef(onRead);
  told.current = onRead;
  useEffect(() => {
    told.current(read);
  }, [read]);

  // ⌥⌘K hands the agent's message box the lines picked here, pinned to the commit they were read at.
  const commit = read.kind === FILE_READ.READY ? (read.commit ?? file.commit) : undefined;
  const mentionLines =
    page === undefined || drop === undefined || commit === undefined
      ? undefined
      : () => {
          const lines = handle.current?.pickedLines();
          if (lines === undefined) return;
          const mention = { kind: MENTION_KIND.FILE, path: file.path, lines: { commit, ...lines } };
          drop({
            name: linesName(file.path, lines),
            target: encodeMention(mention, page.doors.place),
          });
        };
  useAppCommand(APP_COMMAND.MENTION_LINES, mentionLines);

  return (
    <Fill
      as={FILL_ELEMENT.SECTION}
      className="file-tab ph-no-capture bg-card-code"
      aria-label={file.path}
    >
      {read.kind === FILE_READ.READY ? (
        <FileTextView file={file} held={read} handleRef={handle} />
      ) : read.kind === FILE_READ.READING ? (
        <SpinnerRegion delay label={readingWords("the file")} />
      ) : (
        <ReadNotice read={read} commit={file.commit} onRetry={readAgain} />
      )}
    </Fill>
  );
}
