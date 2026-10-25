import { Button, ComposerFoot } from "@luke/ui";
import { useState } from "react";
import { CommentEditor, overCommentBound } from "./comment-editor.js";

/**
 * reply-form.tsx -- the words a member writes over a GitHub comment or beside it, with their Cancel and their send: a thread's reply, a pending comment's edit.
 *
 * One form for every small box of words sent to GitHub: the Markdown field
 * (`CommentEditor`) and, under its words inside its frame, the shared foot
 * (`ComposerFoot`) holding Cancel and the send, which reads in words. Enter
 * sends, Shift+Enter adds a line, Esc lets the form go keeping its
 * words, and Cancel lets them go too. The owner holds the words, through
 * `onWrite`, so what Esc closed is there when the form opens again; it
 * closes the form once GitHub took them.
 *
 * While a change to the comment's thread is out, this one or another, the
 * form stands still: the field and Cancel take no press and Esc closes
 * nothing, and the send is busy only where the change out is its own.
 */

/** The form's words: what its field is named, what it asks for, and what Cancel and the send say. */
export interface ReplyFormWords {
  readonly field: string;
  readonly placeholder: string;
  readonly cancel: string;
  /** What the send does, which is its name: "Reply", "Save". */
  readonly send: string;
  /** What the send is named while its change is out. */
  readonly sending: string;
}

/** The form over `start`, its words handed to `onWrite` as they change. */
export function ReplyForm({
  words,
  start,
  busy,
  sending,
  onWrite,
  onSend,
  onLeave,
  onDiscard,
}: {
  words: ReplyFormWords;
  /** The words it opens on. */
  start: string;
  /** Whether a change to the thread is out, this one or another. */
  busy: boolean;
  /** Whether the change out is this form's own. */
  sending: boolean;
  /** Hears the words as they change, for the owner that keeps them. */
  onWrite: (body: string) => void;
  onSend: (body: string) => void;
  /** Esc: the form goes, the owner keeping its words. */
  onLeave: () => void;
  /** Cancel: the form goes, and the owner lets its words go. */
  onDiscard: () => void;
}): React.JSX.Element {
  const [body, setBody] = useState(start);
  const blank = body.trim() === "" || overCommentBound(body);
  const send = () => {
    if (!blank && !busy) onSend(body);
  };
  return (
    <CommentEditor
      label={words.field}
      placeholder={words.placeholder}
      value={body}
      onChange={(next) => {
        setBody(next);
        onWrite(next);
      }}
      busy={busy}
      focus
      onSubmit={send}
      onCancel={() => {
        if (!busy) onLeave();
      }}
      foot={
        <ComposerFoot
          actions={
            <Button disabled={busy} onClick={onDiscard}>
              {words.cancel}
            </Button>
          }
          send={{
            label: words.send,
            inWords: true,
            empty: blank,
            held: busy && !sending,
            onSend: send,
            busy: sending,
            busyLabel: words.sending,
          }}
        />
      }
    />
  );
}
