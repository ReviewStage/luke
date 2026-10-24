import type { ReviewThread } from "@luke/features/coding-agent-wire";
import { PULL_REQUEST_ACTION } from "@luke/features/pull-request-write-wire";
import { BUTTON_VARIANT, Button } from "@luke/ui";
import { CircleCheckIcon, RotateCcwIcon } from "lucide-react";
import { createContext, type ReactNode, useContext, useRef, useState } from "react";
import { type HeldBodies, heldBodies } from "./comment-drafts.js";
import { PullRequestWriteNote, usePullRequestWrites } from "./pull-request-writes.js";
import { ReplyForm, type ReplyFormWords } from "./reply-form.js";

/**
 * pull-request-thread-actions.tsx -- what a member does on a review thread of an agent's pull request, wherever the thread is drawn: reply to it in Markdown, and resolve it or open it again, as stage-cli's review cards offer.
 *
 * Each is one change (`PULL_REQUEST_ACTION.REPLY_TO_THREAD`,
 * `RESOLVE_THREAD`, `UNRESOLVE_THREAD`) naming the thread by GitHub's own
 * id, which the conversation's read carries, made on GitHub by the service
 * as the member pressing it, on their own GitHub sign-in and never the
 * Luke GitHub App's; GitHub's refusal stands under the thread in its own
 * words, with the sign-in offered where GitHub would not take the
 * member's. Whatever GitHub answered, the tab reads the conversation
 * again, so the thread says where it stands now.
 *
 * The controls are the thread's own, so a thread drawn anywhere in the tab,
 * in the Conversation or on its line in Files changed, carries them: the
 * tab says which agent's pull request its threads are on, and what to read
 * again once one changes, through `ThreadWritesProvider`, and a thread
 * drawn outside one, or read from a service that names no thread's id,
 * offers none.
 */

/** The controls' own words. */
const THREAD_WORDS = {
  REPLY_OPEN: "Reply…",
  RESOLVE: "Resolve conversation",
  RESOLVING: "Resolving conversation",
  UNRESOLVE: "Unresolve conversation",
  UNRESOLVING: "Unresolving conversation",
} as const;

/** What a reply's form is named, asks for, and says. */
const REPLY_WORDS: ReplyFormWords = {
  field: "Reply",
  placeholder: "Reply in Markdown…",
  cancel: "Cancel",
  send: "Reply",
  sending: "Replying",
};

/** Which agent's pull request a tab's threads are on, and what to read again once one changes. */
interface ThreadWrites {
  readonly agentId: string;
  readonly onWritten: () => void;
}

/** What a tab's threads write on, and the words held in its replies and its pending-comment edits, which outlast the box they were written in. */
interface ThreadWritesHeld extends ThreadWrites {
  readonly replies: HeldBodies;
  readonly edits: HeldBodies;
}

const ThreadWritesContext = createContext<ThreadWritesHeld | undefined>(undefined);

/**
 * Gives every review thread drawn under it its controls, on the agent named,
 * and keeps the words of a reply or an edit closed unsent for as long as it
 * stands, by the thread's id and the comment's, so one closed by Esc, or
 * scrolled out of the list and back, loses nothing.
 */
export function ThreadWritesProvider({
  value,
  children,
}: {
  value: ThreadWrites;
  children: ReactNode;
}): React.JSX.Element {
  const replies = useRef(heldBodies());
  const edits = useRef(heldBodies());
  return (
    <ThreadWritesContext.Provider
      value={{
        agentId: value.agentId,
        onWritten: value.onWritten,
        replies: replies.current,
        edits: edits.current,
      }}
    >
      {children}
    </ThreadWritesContext.Provider>
  );
}

/** Which agent's pull request the tab around the caller writes to, and what it reads again after; none outside a tab. A reaction's controls take it too (`pull-request-reactions.tsx`). */
export function useThreadWriting(): ThreadWritesHeld | undefined {
  return useContext(ThreadWritesContext);
}

/** What a thread drawn outside a tab reads again once changed: nothing, since it offers no change. */
export function noop(): void {}

/** What the resolve press says, by where the thread stands and whether its change is out. */
function resolveWords(resolved: boolean, out: boolean): string {
  if (resolved) return out ? THREAD_WORDS.UNRESOLVING : THREAD_WORDS.UNRESOLVE;
  return out ? THREAD_WORDS.RESOLVING : THREAD_WORDS.RESOLVE;
}

/**
 * Under a thread's comments: Reply…, which opens the reply's field, and
 * Resolve or Unresolve conversation by where it stands; GitHub's refusal of
 * the last one under them. None where the tab gives the thread no agent or
 * the read named no id for it.
 */
export function ThreadActions({ thread }: { thread: ReviewThread }): React.JSX.Element | null {
  const writing = useThreadWriting();
  const writes = usePullRequestWrites(writing?.agentId ?? "", writing?.onWritten ?? noop);
  const [replying, setReplying] = useState(false);
  const { id } = thread;
  if (writing === undefined || id === undefined) return null;
  const out = writes.pending;
  const resolveAction = thread.resolved
    ? PULL_REQUEST_ACTION.UNRESOLVE_THREAD
    : PULL_REQUEST_ACTION.RESOLVE_THREAD;
  return (
    <div className="pull-request-thread-actions">
      {replying ? (
        <ReplyForm
          words={REPLY_WORDS}
          start={writing.replies.of(id) ?? ""}
          busy={out !== undefined}
          sending={out === PULL_REQUEST_ACTION.REPLY_TO_THREAD}
          onWrite={(body) => writing.replies.keep(id, body === "" ? undefined : body)}
          onSend={(body) =>
            writes.write(
              { action: PULL_REQUEST_ACTION.REPLY_TO_THREAD, threadId: id, body },
              () => {
                writing.replies.keep(id, undefined);
                setReplying(false);
              },
            )
          }
          onLeave={() => setReplying(false)}
          onDiscard={() => {
            writing.replies.keep(id, undefined);
            setReplying(false);
          }}
        />
      ) : null}
      <div className="pull-request-thread-actions-row">
        {replying ? null : (
          <Button variant={BUTTON_VARIANT.OUTLINE} onClick={() => setReplying(true)}>
            {THREAD_WORDS.REPLY_OPEN}
          </Button>
        )}
        <Button
          variant={BUTTON_VARIANT.OUTLINE}
          icon={
            thread.resolved ? (
              <RotateCcwIcon aria-hidden="true" />
            ) : (
              <CircleCheckIcon aria-hidden="true" />
            )
          }
          disabled={out !== undefined && out !== resolveAction}
          busy={out === resolveAction}
          busyLabel={resolveWords(thread.resolved, true)}
          onClick={() => writes.write({ action: resolveAction, threadId: id })}
        >
          {resolveWords(thread.resolved, false)}
        </Button>
      </div>
      <PullRequestWriteNote writes={writes} className="pull-request-thread-note" />
    </div>
  );
}
