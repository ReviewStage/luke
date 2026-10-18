import type { ReviewThread } from "@luke/features/coding-agent-wire";
import {
  PULL_REQUEST_ACTION,
  PULL_REQUEST_WRITE_BOUNDS,
} from "@luke/features/pull-request-write-wire";
import { BUTTON_VARIANT, Button } from "@luke/ui";
import { CircleCheckIcon, RotateCcwIcon } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { PullRequestWriteNote, usePullRequestWrites } from "./pull-request-writes";

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
  REPLY: "Reply",
  REPLYING: "Replying",
  REPLY_FIELD: "Reply",
  REPLY_PLACEHOLDER: "Reply in Markdown…",
  CANCEL: "Cancel",
  RESOLVE: "Resolve conversation",
  RESOLVING: "Resolving conversation",
  UNRESOLVE: "Unresolve conversation",
  UNRESOLVING: "Unresolving conversation",
} as const;

/** Which agent's pull request a tab's threads are on, and what to read again once one changes. */
interface ThreadWrites {
  readonly agentId: string;
  readonly onWritten: () => void;
}

const ThreadWritesContext = createContext<ThreadWrites | undefined>(undefined);

/** Gives every review thread drawn under it its controls, on the agent named. */
export const ThreadWritesProvider = ThreadWritesContext.Provider;

/** What a thread drawn outside a tab reads again once changed: nothing, since it offers no change. */
function noop(): void {}

/**
 * The reply being written: a field, Cancel, and Reply; ⌘↩ sends it and
 * Escape lets it go. While any change to its thread is out, the reply
 * stands still, neither sent nor let go, so nothing is posted twice and
 * nothing written is lost to a refusal.
 */
function ReplyForm({
  busy,
  sending,
  onSend,
  onCancel,
}: {
  /** Whether a change to the thread is out, this reply or another. */
  busy: boolean;
  /** Whether the change out is this reply. */
  sending: boolean;
  onSend: (body: string) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [body, setBody] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  const blank = body.trim() === "";
  const send = () => {
    if (!blank && !busy) onSend(body);
  };

  useEffect(() => {
    field.current?.focus();
  }, []);

  return (
    <div className="pull-request-thread-reply">
      <textarea
        ref={field}
        className="settings-input pull-request-thread-reply-field"
        aria-label={THREAD_WORDS.REPLY_FIELD}
        placeholder={THREAD_WORDS.REPLY_PLACEHOLDER}
        value={body}
        maxLength={PULL_REQUEST_WRITE_BOUNDS.MAX_BODY_CHARS}
        readOnly={busy}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          // Note that Escape goes no further than the field, because the window's own Escape would leave the tab as well.
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            if (!busy) onCancel();
          }
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            send();
          }
        }}
      />
      <div className="pull-request-thread-reply-foot">
        <Button disabled={busy} onClick={onCancel}>
          {THREAD_WORDS.CANCEL}
        </Button>
        <Button
          variant={BUTTON_VARIANT.PRIMARY}
          disabled={blank || (busy && !sending)}
          busy={sending}
          busyLabel={THREAD_WORDS.REPLYING}
          onClick={send}
        >
          {THREAD_WORDS.REPLY}
        </Button>
      </div>
    </div>
  );
}

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
  const writing = useContext(ThreadWritesContext);
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
          busy={out !== undefined}
          sending={out === PULL_REQUEST_ACTION.REPLY_TO_THREAD}
          onSend={(body) =>
            writes.write({ action: PULL_REQUEST_ACTION.REPLY_TO_THREAD, threadId: id, body }, () =>
              setReplying(false),
            )
          }
          onCancel={() => setReplying(false)}
        />
      ) : null}
      <div className="pull-request-thread-actions-row">
        {replying ? null : (
          <button
            type="button"
            className="pull-request-thread-reply-open"
            onClick={() => setReplying(true)}
          >
            {THREAD_WORDS.REPLY_OPEN}
          </button>
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
