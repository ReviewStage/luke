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

const FIRST_LINE = { firstLine: 1, lastLine: 1 } as const;

function failedRead(error: unknown): FileRead {
  return error instanceof ReadRefused ? notRead(error.answer) : { kind: FILE_READ.FAILED };
}

function notRead(answer: TasksFileAnswer): FileRead {
  if ("refusal" in answer) {
    return { kind: FILE_READ.REFUSED, refusal: answer.refusal, branch: answer.branch };
  }
  return { kind: FILE_READ.FAILED };
}

const QUERY_STATUS = {
  PENDING: "pending",
  ERROR: "error",
  SUCCESS: "success",
} as const;

interface ReadStanding {
  readonly status: (typeof QUERY_STATUS)[keyof typeof QUERY_STATUS];
  readonly fetching: boolean;
  readonly data: TasksFileAnswer | undefined;
  readonly error: unknown;
}

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

const NO_NOTES: readonly WholeFileNote[] = [];

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

function ReadNotice({
  read,
  commit,
  onRetry,
}: {
  read: Exclude<FileRead, { kind: typeof FILE_READ.READY | typeof FILE_READ.READING }>;
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

function linesName(path: string, lines: { readonly startLine: number; readonly endLine: number }) {
  const span =
    lines.startLine === lines.endLine
      ? String(lines.startLine)
      : `${lines.startLine}–${lines.endLine}`;
  return `${fileName(path)}:${span}`;
}

export function FileTab({
  place,
  file,
  onRead,
}: {
  place: FileReadPlace;
  file: OpenFile;
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
    enabled: pinned !== undefined || headRead,
  });
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
  const headStopped = head.status === QUERY_STATUS.ERROR || !headRead;
  const readAgain = () => void (pinned === undefined && headStopped ? head : whole).refetch();
  const told = useRef(onRead);
  told.current = onRead;
  useEffect(() => {
    told.current(read);
  }, [read]);

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
