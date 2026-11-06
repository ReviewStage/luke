import { Button, ComposerFoot } from "@repo/ui";
import { useState } from "react";
import { CommentEditor, overCommentBound } from "./comment-editor.js";

export interface ReplyFormWords {
  readonly field: string;
  readonly placeholder: string;
  readonly cancel: string;
  readonly send: string;
  readonly sending: string;
}

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
  start: string;
  busy: boolean;
  sending: boolean;
  onWrite: (body: string) => void;
  onSend: (body: string) => void;
  onLeave: () => void;
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
