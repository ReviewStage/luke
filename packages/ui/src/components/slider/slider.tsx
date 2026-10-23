/**
 * slider.tsx -- a native range input, one thumb along a track, for a value
 * chosen between two ends: how far a swipe or a fade has gone.
 *
 * It is the browser's own range input, so the arrow, Home, End, and Page keys
 * and the slider role and value reading come with it. A `label` names it.
 */

/** A range at `value` between `min` and `max`, named by `label`, told of each change. */
export function Slider({
  value,
  onChange,
  label,
  min = 0,
  max = 100,
}: {
  value: number;
  onChange: (value: number) => void;
  /** What the slider moves, for a reader who cannot see it ("Swipe position"). */
  label: string;
  min?: number | undefined;
  max?: number | undefined;
}): React.JSX.Element {
  return (
    <input
      type="range"
      className="luke-slider"
      min={min}
      max={max}
      value={value}
      aria-label={label}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  );
}
