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
import { ReadRefused, taskFileQueryOptions } from "./repository-reads.js";
import type { FileReadPlace } from "./use-side-panel.js";

const UNREAD_FILE: TasksFileAnswer = { failure: TASK_CALL_FAILURE.UNANSWERED };

export interface InboxCodeDoors {
  readonly repository: string | null;
  readonly place: FileReadPlace | undefined;
  readonly onOpenFile: (ref: CodeRef, commit: string) => void;
}

function codeReadFrom(
  block: InboxCodeBlock,
  place: FileReadPlace | undefined,
  file: UseQueryResult<TasksFileAnswer>,
): CodeRead {
  if (place === undefined) return codeReadOf(block, UNREAD_FILE);
  if (file.isPending || file.isFetching) return { kind: CODE_READ.READING };
  if (file.isError) {
    return file.error instanceof ReadRefused
      ? codeReadOf(block, file.error.answer)
      : CODE_READ_FAILED;
  }
  return codeReadOf(block, file.data);
}

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
  useAnnounceShown(
    ANNOUNCE.ALERT,
    shown.kind === CODE_READ.NOTICE && !shown.again ? shown.line : "",
  );
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
