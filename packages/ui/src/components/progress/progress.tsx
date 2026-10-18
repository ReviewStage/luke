/**
 * progress.tsx -- how far a known amount of work has come, as a thin bar filling in the working ink: a download, an upload, a count against its whole.
 *
 * The bar is the one meter every wait with a known end is drawn as, so a
 * download in Settings and any other reads as one object. Where words beside
 * it already say the same in numbers ("12 of 40 MB"), the bar is their
 * picture and says nothing to a reader; given a `label`, it is a progress bar
 * of its own, named by it and read as a percentage. A wait with no known end
 * is a spinner's, never an empty bar.
 */

/** The share of the work done, as a percentage held to 0–100, a value that is not a number read as none. */
function percentOf(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/** A bar filled to `value` percent, read by `label` where given, else the picture of words beside it. */
export function Progress({
  value,
  label,
}: {
  /** How far the work has come, in percent. */
  value: number;
  /** What the bar measures, where no words beside it say it ("Downloading the update"). */
  label?: string | undefined;
}): React.JSX.Element {
  const percent = percentOf(value);
  const read =
    label === undefined
      ? ({ "aria-hidden": true } as const)
      : ({
          role: "progressbar",
          "aria-label": label,
          "aria-valuemin": 0,
          "aria-valuemax": 100,
          "aria-valuenow": Math.round(percent),
        } as const);
  return (
    <span className="luke-progress" {...read}>
      <span className="luke-progress-fill" style={{ width: `${String(percent)}%` }} />
    </span>
  );
}
