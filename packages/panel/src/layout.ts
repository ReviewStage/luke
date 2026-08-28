/** `--wing-inset` beside the housing, and the keep before the shape's far corner. */
const WING_INSETS = 29;
const MARK_WIDTH = 14;
const MARK_AND_GAP = 21;

/**
 * How many marks fit along a wing of this width, laid flat. The peek's side is
 * 124px beside the housing it was measured against: each mark past the first
 * costs 21px of the 95px between the wing's insets. The panel's side is what
 * is left of `--panel-width` after the housing, so it holds roughly twice as
 * many.
 */
export function wingMarkCapacity(sideWidth: number): number {
  return Math.max(1, 1 + Math.floor((sideWidth - WING_INSETS - MARK_WIDTH) / MARK_AND_GAP));
}

/**
 * Where slot `index` rests before the shape has room to lay the strip out
 * flat: exactly on the first slot, which is the only one the capsule's side
 * draws. Overlapping them instead was tried and abandoned — a facepile reads
 * because avatars share one circular frame, where these are heterogeneous
 * glyphs at 14px, and a mark cropped to a crescent carries no identity at all.
 *
 * The rest is an offset off the flat layout rather than a layout of its own,
 * because the spread has to run on transform alone: an animated `gap` would
 * re-lay the strip out every frame.
 */
export function wingPileOffset(index: number): number {
  return -MARK_AND_GAP * index;
}

export function observedAgoLabel(observedAt: number, now: number): string {
  const elapsedMinutes = Math.floor((now - observedAt) / 60_000);
  if (elapsedMinutes < 1) return "Now";
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h`;
  return `${Math.floor(elapsedHours / 24)}d`;
}
