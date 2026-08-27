const WING_INSETS = 29;
const FACE_AND_GAP = 26;
const MARK_WIDTH = 14;
const MARK_AND_GAP = 21;
/** The meter is as wide as the face it stands beside, so it costs the same. */
const METER_AND_GAP = 26;
/** The talk button wraps a face-sized glyph, so it costs what the face does. */
const TALK_BUTTON_AND_GAP = 26;

/**
 * How many marks fit beside the face, in a wing where the meter is also
 * standing beside it rather than taking its place — Luke's own turn, or an
 * audio signal with no turn to read at all. The developer's own live turn
 * hands the meter the face's own slot instead, at the face's own width, so
 * it costs the marks nothing extra. The talk button, when its setting draws
 * one, stands beside the face the same way and reserves the same room.
 * Reserving these widths here rather than hiding marks to make room is what
 * keeps the strip from ever drawing either across a mark it already
 * committed to.
 */
export function wingMarkCapacity(
  sideWidth: number,
  meterBesideFace = false,
  talkButton = false,
): number {
  const beyondFirst = Math.floor(
    (sideWidth -
      WING_INSETS -
      FACE_AND_GAP -
      (meterBesideFace ? METER_AND_GAP : 0) -
      (talkButton ? TALK_BUTTON_AND_GAP : 0) -
      MARK_WIDTH) /
      MARK_AND_GAP,
  );
  return Math.max(1, 1 + beyondFirst);
}

export function observedAgoLabel(observedAt: number, now: number): string {
  const elapsedMinutes = Math.floor((now - observedAt) / 60_000);
  if (elapsedMinutes < 1) return "Now";
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h`;
  return `${Math.floor(elapsedHours / 24)}d`;
}
