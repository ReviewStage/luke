import { Progress as ShadcnProgress } from "../../shadcn/progress.js";

/**
 * progress.tsx -- how far a known amount of work has come, as a thin bar filling in the working ink: a download, an upload, a count against its whole.
 *
 * The bar is the one meter every wait with a known end is drawn as, so a
 * download in Settings and any other reads as one object. Where words beside
 * it already say the same in numbers ("12 of 40 MB"), the bar is their
 * picture and says nothing to a reader; given a `label`, it is a progress bar
 * of its own, named by it and read as a percentage. A wait with no known end
 * is a spinner's, never an empty bar.
 *
 * The bar is shadcn/ui's progress over Base UI (`../../shadcn/progress.tsx`),
 * drawn in Tailwind utilities over the theme. Base UI's root would name
 * every bar a progress bar and read its share aloud as text of its own
 * (`aria-valuetext`, "42%") at its exact value; this hands it the reading
 * the bar has always given instead, so a reader hears the same: a labelled
 * bar's role, label, bounds, and share rounded to a whole percent, and no
 * role or value at all on one hidden beside its words.
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
  // Note that each attribute Base UI's root sets is named here, undefined where the bar never said it, because a prop given overrides the root's own.
  const read =
    label === undefined
      ? ({
          "aria-hidden": true,
          role: undefined,
          "aria-valuemin": undefined,
          "aria-valuemax": undefined,
          "aria-valuenow": undefined,
          "aria-valuetext": undefined,
        } as const)
      : ({
          role: "progressbar",
          "aria-label": label,
          "aria-valuemin": 0,
          "aria-valuemax": 100,
          "aria-valuenow": Math.round(percent),
          "aria-valuetext": undefined,
        } as const);
  return <ShadcnProgress value={percent} {...read} />;
}
