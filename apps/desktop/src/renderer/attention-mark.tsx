/**
 * attention-mark.tsx -- the mark of something about a task that wants the developer's hand: a white exclamation on a disc of the attention orange.
 *
 * The orange alone is the window's word for a temporary state (`base.css`'s
 * `--state-attention`), light in the dark and deep in the light, so a
 * white glyph would not hold on it in the dark. The disc is the mark's own
 * orange instead, deep enough under the white in either appearance, so the
 * mark reads the same on the sidebar's ground and a banner's tint alike.
 * The mark is hidden from a screen reader; whatever wears it says why in
 * words beside it or in its pill.
 */

/** The mark: a disc with a white exclamation, the size of the glyph it stands in for. */
export function AttentionMark(): React.JSX.Element {
  return (
    <span className="attention-mark" aria-hidden="true">
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
        <path d="M8 4.25v4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="8" cy="11.6" r="1.15" fill="currentColor" />
      </svg>
    </span>
  );
}
