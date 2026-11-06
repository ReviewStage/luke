import type { ReviewThread } from "@repo/features/agent-wire";
import { PULL_REQUEST_ACTION } from "@repo/features/pull-request-write-wire";
import { BUTTON_VARIANT, Button } from "@repo/ui";
import { CircleCheckIcon, RotateCcwIcon } from "lucide-react";
import { createContext, type ReactNode, useContext, useRef, useState } from "react";
import { type HeldBodies, heldBodies } from "./comment-drafts.js";
import { ACTS_AT_END_CLASS } from "./pull-request-look.js";
import {
  PullRequestWriteNote,
  type ReadAgain,
  usePullRequestWrites,
} from "./pull-request-writes.js";
import { ReplyForm, type ReplyFormWords } from "./reply-form.js";

const THREAD_WORDS = {
  REPLY_OPEN: "Reply…",
  RESOLVE: "Resolve conversation",
  RESOLVING: "Resolving conversation",
  UNRESOLVE: "Unresolve conversation",
  UNRESOLVING: "Unresolving conversation",
} as const;

const REPLY_WORDS: ReplyFormWords = {
  field: "Reply",
  placeholder: "Reply",
  cancel: "Cancel",
  send: "Reply",
  sending: "Replying",
};

interface ThreadWrites {
  readonly agentId: string;
  readonly onWritten: ReadAgain;
}

interface ThreadWritesHeld extends ThreadWrites {
  readonly replies: HeldBodies;
  readonly edits: HeldBodies;
}

const ThreadWritesContext = createContext<ThreadWritesHeld | undefined>(undefined);

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

export function useThreadWriting(): ThreadWritesHeld | undefined {
  return useContext(ThreadWritesContext);
}

export function noop(): void {}

function resolveWords(resolved: boolean, out: boolean): string {
  if (resolved) return out ? THREAD_WORDS.UNRESOLVING : THREAD_WORDS.UNRESOLVE;
  return out ? THREAD_WORDS.RESOLVING : THREAD_WORDS.RESOLVE;
}

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
    <div className="pull-request-thread-actions flex flex-col gap-control-gap border-t border-border px-list-inset py-row-inset">
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
      <div className={`pull-request-thread-actions-row items-center ${ACTS_AT_END_CLASS}`}>
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
