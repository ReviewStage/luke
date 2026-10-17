import { ISSUE_BOUNDS } from "@luke/features/issue-wire";
import { useLayoutEffect, useRef, useState } from "react";
import { MarkdownMessage } from "../markdown-message";

/**
 * issue-description.tsx -- an issue's description, drawn as Markdown and written in place as plain text.
 *
 * At rest the description is drawn as the Markdown it is, or a quiet line
 * asking for one where there is none; a press swaps in a field holding its
 * text. Leaving the field, or ⌘Return, sends what was typed, and the field
 * stays open until the service keeps it, so a refused save keeps every word
 * and says so beside it; while the save is out the field takes no typing
 * and no Escape, so nothing typed then is lost and nothing sent is taken
 * back. Escape before then puts back the description it opened on and sends
 * nothing. Text left as it was sends nothing either.
 */

/** What stands where an issue has no description. */
const PLACEHOLDER = "Add a description…";

/** What a refused save says under the field. */
const REFUSED_LINE = "Couldn't save the description. Try again.";

export function IssueDescription({
  description,
  onSave,
}: {
  description: string;
  /** Sends the description, answering whether it was kept. */
  onSave: (description: string) => Promise<boolean>;
}): React.JSX.Element {
  // Note that a draft stands only while the field is open, so at rest the issue's own description is drawn.
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const [refused, setRefused] = useState(false);
  const [saving, setSaving] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const editing = draft !== undefined;
  useLayoutEffect(() => {
    if (!editing) return;
    const opened = field.current;
    opened?.focus();
    opened?.setSelectionRange(opened.value.length, opened.value.length);
  }, [editing]);

  const begin = () => {
    setRefused(false);
    setDraft(description);
  };
  const save = () => {
    if (draft === undefined || saving) return;
    if (draft === description) {
      setDraft(undefined);
      return;
    }
    setSaving(true);
    onSave(draft).then((kept) => {
      setSaving(false);
      if (kept) setDraft(undefined);
      setRefused(!kept);
    });
  };
  // Note that a save under way is not taken back, since it is already on its way to the service.
  const revert = () => {
    if (saving) return;
    setRefused(false);
    setDraft(undefined);
  };

  if (editing) {
    return (
      <div className="issue-description-editor">
        <textarea
          ref={field}
          className="settings-input issue-description-field"
          aria-label="Description"
          value={draft}
          maxLength={ISSUE_BOUNDS.MAX_DESCRIPTION_CHARS}
          readOnly={saving}
          aria-busy={saving}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={save}
          onKeyDown={(event) => {
            // Note that Escape goes no further than the field, because the window's own Escape would leave the issue as well.
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              revert();
            }
            if (event.key === "Enter" && event.metaKey) {
              event.preventDefault();
              save();
            }
          }}
        />
        {refused ? (
          <p className="issue-description-refused" role="status">
            {REFUSED_LINE}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    // biome-ignore lint/a11y/useSemanticElements: the description holds headings and lists, which a button may not.
    <div
      className="issue-description"
      role="button"
      tabIndex={0}
      aria-label="Edit description"
      onClick={begin}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target === event.currentTarget) {
          event.preventDefault();
          begin();
        }
      }}
    >
      {description === "" ? (
        <p className="issue-description-empty">{PLACEHOLDER}</p>
      ) : (
        <MarkdownMessage words={description} />
      )}
    </div>
  );
}
