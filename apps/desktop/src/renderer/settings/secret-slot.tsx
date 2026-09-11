import { useEffect, useRef } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { tell } from "../act";
import { useStagedFocus } from "../credential-entry";
import { type Destination, DestinationNote } from "../destination-note";

/** What any secret being entered holds, whichever flow is entering it. */
export interface SecretEntry {
  /** What has been typed or pasted so far. Empty until it has been. */
  draft: string;
  /** True while the secret is being sent. */
  busy: boolean;
  /** Why the last attempt was refused, if it was. */
  rejection?: string | undefined;
}

/**
 * The one thing anyone entering a secret needs: somewhere to paste it, and the
 * way to go and get one.
 *
 * To a hand, a one-time code and an API key are the same errand with a
 * different word on it, so both wear this: what to paste named above the field
 * in the issuer's own word for it, its mark beside the field, where it comes
 * from on the line below, and the confirm quiet until there is something to
 * confirm. Luke floats above every window — including the page the secret has
 * to be copied from — so nothing here dismisses the shape it is drawn in: a
 * credential on the clipboard is only worth as much as the place to put it.
 */
export function SecretSlot({
  label,
  mark,
  ariaLabel,
  entry,
  live,
  placeholder,
  hint,
  verb,
  running,
  onChange,
  onCommit,
  onCancel,
  onFetch,
}: {
  /** What to paste, in the issuer's own word for it: "API key", "Sign-in code". */
  label: string;
  /** Whose secret this is, said exactly the way the settings line says it. */
  mark: React.ReactNode;
  /** The field's own name for a reader arriving at it without the line above. */
  ariaLabel: string;
  /** The one entry, held by whoever owns it across an exit. */
  entry: SecretEntry;
  /**
   * Whether there is still something behind the field to act on. Drawn and live
   * are not the same thing for the length of an exit: what is on screen is what
   * the slot last held, but it stops taking the caret the moment the entry ends
   * rather than when the shape finally goes.
   */
  live: boolean;
  /** What the empty field says, which is what the stored secret decides. */
  placeholder: string;
  /** Where to go and get one, absent for a secret with no page to fetch it from. */
  hint?: Destination;
  /** The word on the confirm, and its word while it runs. */
  verb: string;
  running: string;
  onChange: (draft: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  onFetch?: () => void;
}): React.JSX.Element {
  const field = useRef<HTMLInputElement | null>(null);
  // Holding a secret is what brings the confirm out; being able to send it is
  // what makes it pressable. They differ while one is being written, and the
  // button has to stay on screen to say so.
  const filled = entry.draft.trim().length > 0;
  const ready = live && filled && !entry.busy;

  useStagedFocus(field, live && !entry.busy);

  useEffect(() => {
    if (!live) return;
    // Coming back from the browser with the secret on the clipboard should cost
    // one gesture, not two: however the window is raised, the caret is already
    // where the secret goes. The slot is long since drawn by then, so this can
    // ask directly.
    const takeCaret = () => field.current?.focus({ preventScroll: true });
    window.addEventListener("focus", takeCaret);
    return () => window.removeEventListener("focus", takeCaret);
  }, [live]);

  return (
    <>
      {/* What to paste, in the issuer's own word for it. The line this opened
          from labels its field the same way, and the placeholder beneath is the
          one both share, so neither has to repeat the other. */}
      <span className="settings-label key-slot-label">{label}</span>
      <div className="key-slot-row">
        <span className="key-slot-mark">{mark}</span>
        <input
          ref={field}
          className="settings-input key-slot-input"
          type="password"
          aria-label={ariaLabel}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          value={entry.draft}
          disabled={entry.busy}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => {
            // The slot is shown without stealing focus, and a field that cannot
            // be typed into is worse than no field.
            tell(ACT_KIND.WINDOW_FOCUS_PANEL);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && ready) onCommit();
            // Escape belongs to the entry here: there is no panel behind the
            // slot to close.
            if (event.key === "Escape") {
              event.stopPropagation();
              onCancel();
            }
          }}
        />
      </div>
      {/* The panel's own editor, at the slot's width: what it takes on one
          line, where to go and get it on the next. Making the field the whole
          width is not a flourish — the sentence it holds is the same one the
          panel's field holds, and it has to fit. */}
      <div className="settings-row key-slot-foot">
        {/* Opening the issuer's page is what the slot is standing aside for, so
            the press does not move the shape again. */}
        {hint && onFetch ? (
          <DestinationNote {...hint} disabled={entry.busy} onOpen={onFetch} />
        ) : null}
        <span className="settings-actions">
          <button type="button" className="quiet-button" disabled={entry.busy} onClick={onCancel}>
            Cancel
          </button>
          {/* The same words the panel's own editor uses, because it is the same
              entry — only the place it is drawn has changed. It is quiet and
              small until the secret lands in the field, and comes up to size
              and into the accent when it does; its place on the line never
              moves, so nothing else on the line moves either. */}
          <button
            type="button"
            className="action-button key-slot-confirm"
            data-ready={String(entry.busy || filled)}
            disabled={!ready}
            onClick={onCommit}
          >
            {entry.busy ? running : verb}
          </button>
        </span>
      </div>
      {entry.rejection ? (
        <p className="error-message" role="alert">
          {entry.rejection}
        </p>
      ) : null}
    </>
  );
}
