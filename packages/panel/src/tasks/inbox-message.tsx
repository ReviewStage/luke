import { INBOX_MESSAGE_AUTHOR, type InboxMessage } from "@repo/features/inbox-wire";
import type { CatalogModel } from "@repo/features/models-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { type CommentAuthor, ErrorState } from "@repo/ui";
import { PICTURE_STATE } from "@repo/ui/picture-read";
import { useQueries } from "@tanstack/react-query";
import { type ReactNode, useMemo } from "react";
import { ActorRef, commentAuthor } from "../actor-ref.js";
import { unreadShown } from "../failure-report.js";
import { usePerson } from "../member-directory.js";
import { pictureQuery } from "../picture-query.js";
import { AgentActorRef, type AgentSubject } from "./agent-ref.js";
import { AttachedFileChips } from "./attached-file-chips.js";
import type { InboxCodeDoors } from "./inbox-code-card.js";
import { inboxCommentFiles, inboxFileChips } from "./inbox-model.js";
import { InboxPicture, InboxPictures } from "./inbox-pictures.js";
import { LoneLinkCards } from "./lone-link-card.js";
import { SentWords } from "./skill-chip.js";
import { TranscriptWords } from "./transcript-blocks.js";
import { WordsWorkspace } from "./use-link-standing.js";
import type { InboxImageReads } from "./use-task-inbox.js";

const FILES_FAILED_LINE = "Some files could not be read.";

const NO_FILES: NonNullable<InboxMessage["files"]> = [];

export interface ItemAgent {
  readonly subject: AgentSubject;
  readonly models: readonly CatalogModel[] | undefined;
  readonly onOpen: () => void;
}

export function AgentName({ by }: { by: ItemAgent }): React.JSX.Element {
  return <AgentActorRef subject={by.subject} models={by.models} onOpen={by.onOpen} nameOnly />;
}

export function useMessageWriter(
  message: InboxMessage | undefined,
  by: ItemAgent,
): { readonly author: CommentAuthor; readonly nameRef: ReactNode } {
  const member = usePerson(message?.member);
  if (message?.author === INBOX_MESSAGE_AUTHOR.AGENT) {
    return { author: commentAuthor(by.subject.tile), nameRef: <AgentName by={by} /> };
  }
  return { author: commentAuthor(member), nameRef: <ActorRef actor={member} nameOnly /> };
}

export function ItemWords({
  itemId,
  workspaceId,
  images,
  code,
  children,
}: {
  itemId: string;
  workspaceId: string | undefined;
  images: InboxImageReads;
  code: InboxCodeDoors | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const cards = useMemo(() => (code === undefined ? undefined : { code }), [code]);
  const pictured = (
    <InboxPictures itemId={itemId} control={images}>
      {cards === undefined ? children : <LoneLinkCards doors={cards}>{children}</LoneLinkCards>}
    </InboxPictures>
  );
  return <WordsWorkspace value={workspaceId}>{pictured}</WordsWorkspace>;
}

function CommentFiles({
  itemId,
  files,
  words,
  images,
}: {
  itemId: string;
  files: NonNullable<InboxMessage["files"]>;
  words: string | undefined;
  images: InboxImageReads;
}): React.ReactNode {
  const { pictures, others } = useMemo(
    () => inboxCommentFiles(files, words, itemId),
    [files, words, itemId],
  );
  const reads = useQueries({
    queries: others.map((file) => pictureQuery(itemId, file.attachmentId, images.read)),
  });
  const urls = new Map(
    others.flatMap((file, index) => {
      const read = reads[index]?.data;
      return read?.kind === PICTURE_STATE.READY ? [[file.attachmentId, read.url] as const] : [];
    }),
  );
  const failed = reads.filter((read) => read.isError && !read.isFetching);
  return (
    <>
      {pictures.length === 0 ? null : (
        <div
          className="transcript-pictures grid grid-cols-picture-row items-start gap-block-gap"
          data-inbox-file-pictures=""
        >
          {pictures.map((file) => (
            <InboxPicture
              key={file.attachmentId}
              attachmentId={file.attachmentId}
              alt={file.name}
              caption={undefined}
              name={file.name}
            />
          ))}
        </div>
      )}
      {others.length === 0 ? null : <AttachedFileChips files={inboxFileChips(others, urls)} />}
      {failed.length === 0 ? null : (
        <div data-inbox-files-failed="">
          <ErrorState
            failure={unreadShown(FAILURE_SURFACE.INBOX_FILES_READ)}
            onRetry={() => {
              for (const read of failed) void read.refetch();
            }}
          >
            {FILES_FAILED_LINE}
          </ErrorState>
        </div>
      )}
    </>
  );
}

export function MessageWords({
  itemId,
  message,
  images,
}: {
  itemId: string;
  message: InboxMessage;
  images: InboxImageReads;
}): React.JSX.Element {
  const fromAgent = message.author === INBOX_MESSAGE_AUTHOR.AGENT;
  return (
    <>
      <CommentFiles
        itemId={itemId}
        files={message.files ?? NO_FILES}
        words={message.text}
        images={images}
      />
      {message.text === "" ? null : (
        <div
          className="inbox-message-words m-0 leading-reading select-text"
          data-inbox-message-text=""
        >
          {fromAgent ? (
            <TranscriptWords text={message.text} asDocument />
          ) : (
            <SentWords text={message.text} asDocument />
          )}
        </div>
      )}
    </>
  );
}
