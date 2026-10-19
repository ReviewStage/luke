import { PULL_REQUEST_WRITE_BOUNDS } from "@luke/features/pull-request-write-wire";
import { SCROLL_OVERSCROLL, SCROLL_SIZE, ScrollArea, TextArea } from "@luke/ui";
import { type RefObject, useRef, useState } from "react";
import { Segmented } from "../segmented.js";
import { applyMarkdownEdit, fieldEdit, formatForKey, MarkdownToolbar } from "./markdown-toolbar.js";
import { TranscriptWords } from "./transcript-blocks.js";

/**
 * markdown-field.tsx -- a field for words a member sends to GitHub as Markdown, with Write and Preview as GitHub's own comment box offers them: the review panel's, and the conversation's comment box.
 *
 * Write is the app's own text area (`TextArea`), bounded at GitHub's length
 * for a comment, with GitHub's formatting presses beside Write and Preview
 * (`markdown-toolbar.tsx`), and ⌘B, ⌘I and ⌘K answered in the words as
 * GitHub's own box answers them; a comment on lines of the head offers a
 * suggestion among them. Preview draws what is written as the transcript
 * draws Markdown, which is near enough GitHub's own rendering to read it
 * back before sending, a suggestion block headed as one. The words are the
 * owner's, so they stand whichever is shown.
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
  suggestion,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  /** Whether the words are on their way to GitHub, so the field takes no typing. */
  busy: boolean;
  /** The field itself, for an owner that focuses it as it opens. */
  fieldRef?: RefObject<HTMLTextAreaElement | null>;
  /** What ⌘↩ in the field does, where the owner does not answer it itself. */
  onSubmit?: () => void;
  /** The lines a comment is on as they read at the head, which Add a suggestion writes for the member to change; none offers no suggestion. */
  suggestion?: string | undefined;
}): React.JSX.Element {
  const [mode, setMode] = useState<BodyMode>(BODY_MODE.WRITE);
  const ownField = useRef<HTMLTextAreaElement>(null);
  const field = fieldRef ?? ownField;
  const writing = mode === BODY_MODE.WRITE;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: ⌘B, ⌘I and ⌘K in the words format them, as in GitHub's own box; the keys arrive here from the field.
    <div
      className="markdown-field"
      onKeyDown={(event) => {
        const format = formatForKey(event);
        const area = field.current;
        if (format === undefined || area === null || event.target !== area || busy) return;
        // Note that the chord is the field's while it has the keyboard, so the window's keymap never hears it.
        event.preventDefault();
        event.stopPropagation();
        applyMarkdownEdit(area, fieldEdit(area, format));
      }}
    >
      <div className="markdown-field-head">
        <Segmented
          legend={`${label} ${FIELD_WORDS.MODE}`}
          options={[
            { value: BODY_MODE.WRITE, label: FIELD_WORDS.WRITE },
            { value: BODY_MODE.PREVIEW, label: FIELD_WORDS.PREVIEW },
          ]}
          value={mode}
          onChange={setMode}
        />
        {writing ? <MarkdownToolbar field={field} suggestion={suggestion} disabled={busy} /> : null}
      </div>
      {writing ? (
        <TextArea
          ref={field}
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
