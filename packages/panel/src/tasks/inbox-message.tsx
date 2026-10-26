import { INBOX_MESSAGE_AUTHOR, type InboxMessage } from "@luke/features/inbox-wire";
import type { CatalogModel } from "@luke/features/models-wire";
import { type CommentAuthor, ErrorState } from "@luke/ui";
import { type ReactNode, useEffect, useMemo } from "react";
import { ActorRef, commentAuthor } from "../actor-ref.js";
import { usePerson } from "../member-directory.js";
import { AgentActorRef, type AgentSubject } from "./agent-ref.js";
import { AttachedFileChips } from "./attached-file-chips.js";
import type { InboxCodeDoors } from "./inbox-code-card.js";
import { inboxCommentFiles, inboxFileChips } from "./inbox-model.js";
import { InboxPicture, InboxPictures } from "./inbox-pictures.js";
import { LoneLinkCards } from "./lone-link-card.js";
import { REPLY_SCOPE } from "./reply-to-selection.js";
import { SentWords } from "./skill-chip.js";
import { TranscriptWords } from "./transcript-blocks.js";
import { WordsWorkspace } from "./use-link-standing.js";
import type { InboxImageReads } from "./use-task-inbox.js";

/**
 * inbox-message.tsx -- an Inbox item's message as every place draws it: its words, the files it carried, the agent named with its card, and the item's words read where they belong.
 *
 * A thread's pane (`inbox-pane.tsx`) and a channel's stream, whose post is
 * its thread's first message (`channel-stream.tsx`), draw a message through
 * these alone, so the two never disagree. Words under `ItemWords` read their
 * links under the item's workspace, a pull request alone on its line as its
 * card with its title and lines (`lone-link-card.tsx`), and draw the item's
 * own pictures through the reads it is handed (`inbox-pictures.tsx`).
 */

/** What a comment says under its files where some could not be read. */
const FILES_FAILED_LINE = "Some files could not be read.";

/** No files, one array so a comment that has none hands down the same one. */
const NO_FILES: NonNullable<InboxMessage["files"]> = [];

/** The item's agent as a thread names it, the catalog its card names the model from, and the press that opens its tab. */
export interface ItemAgent {
  readonly subject: AgentSubject;
  readonly models: readonly CatalogModel[] | undefined;
  readonly onOpen: () => void;
}

/** The agent named at a message's head, whose tile its comment's face draws: its name, which hangs its card and opens its tab. */
export function AgentName({ by }: { by: ItemAgent }): React.JSX.Element {
  return <AgentActorRef subject={by.subject} models={by.models} onOpen={by.onOpen} nameOnly />;
}

/**
 * A message's writer as its comment's head draws them: a member by their
 * face and name, which hangs their card, and the agent by its tile and its
 * name, which hangs the agent's card and opens its tab.
 */
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

/**
 * Where an item's words are drawn: under its own workspace, by its id, so a
 * link reads what it names through that workspace's connections; its own
 * pictures read through `images`, one viewer walking them; and a link alone
 * on its line drawn as its card, a file's lines read through `code`.
 */
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

/**
 * The files a message on the thread carried, drawn over its words, as the agent's tab draws a sent message's and every
 * box holds them over what is typed. A picture its words
 * name already stands there, as an agent's do, so it is not drawn again;
 * every other picture is drawn as one in the words is, side by side where
 * several, the item's viewer walking it with the rest (`inbox-pictures.tsx`),
 * and any other file as the agent's tab draws a sent message's, its chip
 * (`attached-file-chips.tsx`). Each asks for its bytes as it is first
 * drawn, through the same read a picture in its words takes, and a chip
 * is drawn by its name alone until they land; where a file's read did not
 * answer, a line under the files says so with Retry, as a picture's does.
 */
function CommentFiles({
  itemId,
  files,
  words,
  images: { images, onImage, onRetryImage },
}: {
  itemId: string;
  files: NonNullable<InboxMessage["files"]>;
  /** The comment's words, whose own pictures stand where they name them; none where it wrote none. */
  words: string | undefined;
  images: InboxImageReads;
}): React.ReactNode {
  const { pictures, others } = useMemo(
    () => inboxCommentFiles(files, words, itemId),
    [files, words, itemId],
  );
  useEffect(() => {
    for (const file of others) {
      if (!images.has(file.attachmentId)) onImage(itemId, file.attachmentId);
    }
  }, [others, images, itemId, onImage]);
  const failed = others.filter((file) => {
    const read = images.get(file.attachmentId);
    return read !== undefined && "failed" in read;
  });
  return (
    <>
      {pictures.length === 0 ? null : (
        <div
          className="transcript-pictures flex items-start gap-block-gap"
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
      {others.length === 0 ? null : <AttachedFileChips files={inboxFileChips(others, images)} />}
      {failed.length === 0 ? null : (
        <div data-inbox-files-failed="">
          <ErrorState
            onRetry={() => {
              for (const file of failed) onRetryImage(file.attachmentId);
            }}
          >
            {FILES_FAILED_LINE}
          </ErrorState>
        </div>
      )}
    </>
  );
}

/**
 * A message's files and words, as its thread draws them: the files it
 * carried over its words, the agent's words drawn as its question's are and
 * a member's as a sent message's, a Markdown document either way.
 */
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
          // The agent's words alone may be replied to, as in its tab, never a member's.
          {...(fromAgent ? { [REPLY_SCOPE]: "" } : {})}
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
