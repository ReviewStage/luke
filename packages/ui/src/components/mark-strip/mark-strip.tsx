/**
 * mark-strip.tsx -- the thin strip a hidden rail leaves in its place: one mark for each of its rows, a press on which shows the rail again.
 *
 * Each mark is a dot in its row's tone from the state palette, or the
 * border's ink where it has none, dimmed once its row is viewed, the row
 * shown standing out. It is a picture of the rail, hidden from assistive
 * technology, which reaches the rail through its own toggle, so its press is
 * the pointer's shortcut to that toggle and no control of its own. It fills
 * the box its place stands it in, which says when the strip is drawn at all
 * and the edge it keeps from the rail's neighbour.
 */

/** The tones a mark comes in, from the state palette. */
export const MARK_STRIP_TONE = {
  DANGER: "danger",
  ATTENTION: "attention",
  COMPLETE: "complete",
} as const;

export type MarkStripTone = (typeof MARK_STRIP_TONE)[keyof typeof MARK_STRIP_TONE];

/** One row's mark: its tone, whether its row was viewed, and whether its row is the one shown. */
export interface StripMark {
  readonly tone?: MarkStripTone | undefined;
  readonly viewed?: boolean | undefined;
  readonly current?: boolean | undefined;
}

/** A strip of marks, one for each row of a hidden rail, a press on which shows it. */
export function MarkStrip({
  marks,
  onPress,
}: {
  marks: readonly StripMark[];
  /** Shows the rail, as its toggle does. */
  onPress: () => void;
}): React.JSX.Element {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: a picture hidden from assistive technology; the keyboard shows the rail through its toggle.
    // biome-ignore lint/a11y/noStaticElementInteractions: as above.
    <div className="luke-mark-strip" aria-hidden="true" onClick={onPress}>
      {marks.map((mark, index) => (
        <span
          key={index}
          className="luke-mark-strip-mark"
          data-tone={mark.tone}
          data-viewed={mark.viewed === true ? "" : undefined}
          data-current={mark.current === true ? "" : undefined}
        />
      ))}
    </div>
  );
}
