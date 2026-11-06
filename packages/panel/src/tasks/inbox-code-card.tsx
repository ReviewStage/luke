import type { InboxCodeBlock } from "@repo/features/inbox-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import type { CodeRef } from "@repo/features/task-wire";
import { TASK_CALL_FAILURE, type TasksFileAnswer } from "@repo/features/tasks-view";
import { readingWords } from "@repo/features/words";
import { ANNOUNCE, ErrorState, FileCodeCard, SpinnerRegion, TabNotice } from "@repo/ui";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { copyThroughShell } from "../copy-feedback.js";
import { unreadShown } from "../failure-report.js";
import { useAnnounceShown } from "../use-announce-shown.js";
import { CodeSnippet } from "./code-snippet.js";
import { FileRef } from "./file-ref.js";
import { copiedLines, fileRefText } from "./file-ref-model.js";
import {
  CODE_READ,
  CODE_READ_FAILED,
  type CodeRead,
  codeNotice,
  codeReadOf,
  codeWindow,
} from "./inbox-model.js";
import { taskFileQueryOptions } from "./repository-reads.js";
import type { FileReadPlace } from "./use-side-panel.js";

/**
 * inbox-code-card.tsx -- lines of a file at a commit, as a code card, wherever an Inbox item shows them: a code block, and a link to those lines standing alone in its words.
 *
 * The card is headed by the path and the lines, the file opened in the
 * File tab at the commit from either, and the lines read from GitHub at
 * that commit through the File tab's own read, with a few around them, the
 * named ones lit (`code-snippet.tsx`). Lines the task cannot read, another repository's or a
 * range past the bound, say why and open nothing. The card shows the
 * repository's lines, so it is out of the session recording, which
 * `CodeCard` sees to (`ph-no-capture`).
 */

/** What the code of an item no place reads its file through comes to: unread, there being no repository to read it through. */
const UNREAD_FILE: TasksFileAnswer = { failure: TASK_CALL_FAILURE.UNANSWERED };

/** What a code block reads its lines through and opens its file with. */
export interface InboxCodeDoors {
  /** The task's repository, `owner/name`, which the lines are read through; none where the task names none. */
  readonly repository: string | null;
  /** Where a window of a file of the task's repository is read, as the File tab reads it; none where the item's agent's repository is not known, or it has none. */
  readonly place: FileReadPlace | undefined;
  /** Opens the file in the side panel's File tab at the commit named, the reference's lines lit. */
  readonly onOpenFile: (ref: CodeRef, commit: string) => void;
}

/** Where the read of the block's lines stands: being read, a Retry's read among them, or what it answered. */
function codeReadFrom(
  block: InboxCodeBlock,
  place: FileReadPlace | undefined,
  file: UseQueryResult<TasksFileAnswer>,
): CodeRead {
  if (place === undefined) return codeReadOf(block, UNREAD_FILE);
  if (file.isPending || file.isFetching) return { kind: CODE_READ.READING };
  if (file.isError) return CODE_READ_FAILED;
  return codeReadOf(block, file.data);
}

/**
 * A code block: a card headed by the path and
 * the lines, the file opened in the File tab at the block's commit from
 * either, and the lines read from GitHub at that commit with a few around
 * them, the block's own lit; lines the task cannot read say why, and open
 * nothing. The read is keyed by the place and the block's window, so a
 * parent drawing afresh reads nothing again.
 */
export function InboxCodeCard({
  block,
  code,
}: {
  block: InboxCodeBlock;
  code: InboxCodeDoors;
}): React.JSX.Element {
  const unread = codeNotice(block, code.repository);
  const { path, sha, startLine, endLine } = block;
  const codeRef = { path, startLine, endLine };
  const file = useQuery({
    ...taskFileQueryOptions(code.place, codeWindow(block)),
    enabled: unread === undefined,
  });
  const read = codeReadFrom(block, code.place, file);

  const shown: CodeRead =
    unread === undefined ? read : { kind: CODE_READ.NOTICE, line: unread, again: false };
  // Note that a failure that offers Retry is said by its `ErrorState`, so only a notice with none is said here.
  useAnnounceShown(
    ANNOUNCE.ALERT,
    shown.kind === CODE_READ.NOTICE && !shown.again ? shown.line : "",
  );
  // Note that lines the task does not read open nothing, because the File tab reads the task's repository alone.
  const onOpen = unread === undefined ? () => code.onOpenFile(codeRef, sha) : undefined;
  return (
    <FileCodeCard
      title={<FileRef codeRef={codeRef} repository={block.repo} onOpen={onOpen} />}
      label={fileRefText(codeRef)}
      data={{ "data-inbox-code": "" }}
      copied={shown.kind === CODE_READ.READY ? copiedLines(shown.code) : undefined}
      copy={copyThroughShell}
      onOpen={onOpen}
      body={
        shown.kind === CODE_READ.READY ? (
          <CodeSnippet code={shown.code} />
        ) : shown.kind === CODE_READ.READING ? (
          <SpinnerRegion delay label={readingWords("the lines")} />
        ) : (
          <TabNotice>
            {shown.again ? (
              <ErrorState
                failure={unreadShown(FAILURE_SURFACE.INBOX_CODE_READ)}
                onRetry={() => void file.refetch()}
              >
                {shown.line}
              </ErrorState>
            ) : (
              <p>{shown.line}</p>
            )}
          </TabNotice>
        )
      }
    />
  );
}
