import { PULL_REQUEST_WRITE_BOUNDS } from "@luke/features/pull-request-write-wire";
import { SCROLL_OVERSCROLL, SCROLL_SIZE, ScrollArea, TextArea } from "@luke/ui";
import { type Ref, useState } from "react";
import { Segmented } from "../segmented.js";
import { TranscriptWords } from "./transcript-blocks.js";

/**
 * markdown-field.tsx -- a field for words a member sends to GitHub as Markdown, with Write and Preview as GitHub's own comment box offers them: the review panel's, and the conversation's comment box.
 *
 * Write is the app's own text area (`TextArea`), bounded at GitHub's length
 * for a comment; Preview draws what is written as the transcript draws
 * Markdown, which is near enough GitHub's own rendering to read it back
 * before sending. The words are the owner's, so they stand whichever is
 * shown.
 */

/** The field's own words. */
const FIELD_WORDS = {
  MODE: "view",
  WRITE: "Write",
  PREVIEW: "Preview",
  NOTHING: "Nothing to preview.",
} as const;

/** Whether the field shows what is written or how it reads. */
const BODY_MODE = {
  WRITE: "write",
  PREVIEW: "preview",
} as const;

type BodyMode = (typeof BODY_MODE)[keyof typeof BODY_MODE];

/** The words, Write and Preview over them, the field named `label` to a reader. */
export function MarkdownField({
  label,
  placeholder,
  value,
  onChange,
  busy,
  fieldRef,
  onSubmit,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  /** Whether the words are on their way to GitHub, so the field takes no typing. */
  busy: boolean;
  /** The field itself, for an owner that focuses it as it opens. */
  fieldRef?: Ref<HTMLTextAreaElement>;
  /** What ⌘↩ in the field does, where the owner does not answer it itself. */
  onSubmit?: () => void;
}): React.JSX.Element {
  const [mode, setMode] = useState<BodyMode>(BODY_MODE.WRITE);
  return (
    <div className="markdown-field">
      <Segmented
        legend={`${label} ${FIELD_WORDS.MODE}`}
        options={[
          { value: BODY_MODE.WRITE, label: FIELD_WORDS.WRITE },
          { value: BODY_MODE.PREVIEW, label: FIELD_WORDS.PREVIEW },
        ]}
        value={mode}
        onChange={setMode}
      />
      {mode === BODY_MODE.WRITE ? (
        <TextArea
          ref={fieldRef}
          label={label}
          placeholder={placeholder}
          value={value}
          maxLength={PULL_REQUEST_WRITE_BOUNDS.MAX_BODY_CHARS}
          rows={4}
          busy={busy}
          onChange={onChange}
          onSubmit={onSubmit}
        />
      ) : (
        <div className="markdown-field-preview">
          <ScrollArea size={SCROLL_SIZE.CONTENT} overscroll={SCROLL_OVERSCROLL.CHAIN}>
            <div className="markdown-field-preview-words pull-request-words">
              {value.trim() === "" ? (
                <p className="pull-request-quiet">{FIELD_WORDS.NOTHING}</p>
              ) : (
                <TranscriptWords text={value} />
              )}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
