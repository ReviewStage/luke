import type { InboxCodeBlock } from "@luke/features/inbox-wire";
import type { CodeRef } from "@luke/features/task-wire";
import { ErrorState } from "@luke/ui";
import { copiedLines, fileRefText } from "@luke/voice/code-pane-model";
import { useEffect, useRef, useState } from "react";
import { SpinnerRegion } from "../spinner.js";
import { CodeCardHeader, CodeLines } from "./code-pane.js";
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
 * inbox-code-card.tsx -- lines of a file at a commit, as the Code tab draws a card of them, wherever an Inbox item shows them: a code block, and a link to those lines standing alone in its words.
 *
 * The card is headed by the path and the lines, the file opened in the
 * File tab at the commit from either, and the lines read from GitHub at
 * that commit through the File tab's own read, with a few around them, the
 * named ones lit. Lines the task cannot read, another repository's or a
 * range past the bound, say why and open nothing. The card shows the
 * repository's lines, so it is out of the session recording
 * (`ph-no-capture`).
 */

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
 * A code block: a card as the Code tab draws one, headed by the path and
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
  return (
    <article
      className="code-card ph-no-capture"
      aria-label={fileRefText(codeRef)}
      data-inbox-code=""
    >
      <CodeCardHeader
        codeRef={codeRef}
        note={undefined}
        copied={shown.kind === CODE_READ.READY ? copiedLines(shown.code) : undefined}
        // Note that lines the task does not read open nothing, because the File tab reads the task's repository alone.
        onOpen={unread === undefined ? () => code.onOpenFile(codeRef, sha) : undefined}
      />
      {shown.kind === CODE_READ.READY ? (
        <CodeLines code={shown.code} />
      ) : shown.kind === CODE_READ.READING ? (
        <SpinnerRegion label="Loading lines" />
      ) : (
        <div className="file-tab-notice">
          {shown.again ? (
            <ErrorState onRetry={() => setAsked((was) => was + 1)}>{shown.line}</ErrorState>
          ) : (
            <p role="alert">{shown.line}</p>
          )}
        </div>
      )}
    </article>
  );
}
