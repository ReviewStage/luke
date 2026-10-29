import type { InboxCodeBlock } from "@luke/features/inbox-wire";
import { FAILURE_SURFACE } from "@luke/features/shown-failure";
import type { CodeRef } from "@luke/features/task-wire";
import { TASK_CALL_FAILURE, type TasksFileAnswer } from "@luke/features/tasks-view";
import { readingWords } from "@luke/features/words";
import { ANNOUNCE, ErrorState, FileCodeCard, SpinnerRegion, TabNotice } from "@luke/ui";
import { useEffect, useRef, useState } from "react";
import { copyThroughShell } from "../copy-feedback.js";
import { unreadShown } from "../failure-report.js";
import { useAnnounceShown } from "../use-announce-shown.js";
import { CodeSnippet } from "./code-snippet.js";
import { FileRef } from "./file-ref.js";
import { copiedLines, fileRefText } from "./file-ref-model.js";
import type { ReadFileWindow } from "./file-tab.js";
import {
  CODE_READ,
  CODE_READ_FAILED,
  type CodeRead,
  codeNotice,
  codeReadOf,
  codeWindow,
} from "./inbox-model.js";

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

/** The code of an item whose agent's repository is not known, or that has none, reads no file, there being no repository to read it through. */
export const UNREAD_FILE = (): Promise<TasksFileAnswer> =>
  Promise.resolve({ failure: TASK_CALL_FAILURE.UNANSWERED });

/** What a code block reads its lines through and opens its file with. */
export interface InboxCodeDoors {
  /** The task's repository, `owner/name`, which the lines are read through; none where the task names none. */
  readonly repository: string | null;
  /** Reads a window of a file of the task's repository, as the File tab does. */
  readonly readFile: ReadFileWindow;
  /** Opens the file in the side panel's File tab at the commit named, the reference's lines lit. */
  readonly onOpenFile: (ref: CodeRef, commit: string) => void;
}

/**
 * A code block: a card headed by the path and
 * the lines, the file opened in the File tab at the block's commit from
 * either, and the lines read from GitHub at that commit with a few around
 * them, the block's own lit; lines the task cannot read say why, and open
 * nothing. Note that the read goes through a ref to the
 * latest door, so a parent drawing a fresh door does not read again, and
 * that an answer landing after the block changed or left is dropped.
 */
export function InboxCodeCard({
  block,
  code,
}: {
  block: InboxCodeBlock;
  code: InboxCodeDoors;
}): React.JSX.Element {
  const unread = codeNotice(block, code.repository);
  const [read, setRead] = useState<CodeRead>({ kind: CODE_READ.READING });
  const [asked, setAsked] = useState(0);
  const latest = useRef({ block, readFile: code.readFile });
  latest.current = { block, readFile: code.readFile };
  const { path, sha, startLine, endLine } = block;
  const codeRef = { path, startLine, endLine };

  useEffect(() => {
    if (unread !== undefined) return;
    let standing = true;
    const { block: asking, readFile } = latest.current;
    setRead({ kind: CODE_READ.READING });
    readFile(codeWindow(asking)).then(
      (answer) => {
        if (standing) setRead(codeReadOf(asking, answer));
      },
      () => {
        if (standing) setRead(CODE_READ_FAILED);
      },
    );
    return () => {
      standing = false;
    };
  }, [unread, path, sha, startLine, endLine, asked]);

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
                onRetry={() => setAsked((was) => was + 1)}
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
