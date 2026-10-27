import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import { cn } from "../cn.js";

/**
 * progress.tsx -- shadcn/ui's progress (style `base-nova`, on Base UI), vendored and drawn as Luke's hairline meter.
 *
 * The component is shadcn's own source, kept as close to it as the window
 * allows, so a later `shadcn add progress` reads as a small diff. Its local
 * changes: every part renders a `span` rather than Base UI's `div`, because
 * a meter stands inside a line of words, a `<p>`'s among them; the root is a
 * block as long as a short line of words (`max-w-progress`) rather than
 * shadcn's wrapping flex row, which held a label and a value Luke never
 * draws; the track is Luke's hairline (`h-progress-height`) in the strong fill
 * (`bg-secondary`), clipped on both axes (`overflow-hidden` rather than
 * `overflow-x-hidden`, whose scroller rounds a full bar's start a shade
 * differently), and the indicator fills in the working ink rather than
 * `primary`, with no `transition-all`, since the bar has never glided; and
 * the root says only what the component puts in it, without the visually
 * hidden "x" Base UI appends to the root's children, so a bar beside words
 * that say the same adds nothing to them. `ProgressLabel` and
 * `ProgressValue` are dropped, since nothing draws them. `@luke/ui`'s
 * `Progress` (`components/progress/progress.tsx`) is what an app draws; this
 * is its inside.
 */

function Progress({ className, children, value, ...props }: ProgressPrimitive.Root.Props) {
  return (
    <ProgressPrimitive.Root
      value={value}
      data-slot="progress"
      className={cn("block w-full max-w-progress", className)}
      // Note that Base UI hands the root its children after a hidden "x" of its own, which this drops, rendering only the component's.
      render={({ children: _announced, ...root }) => (
        <span {...root}>
          {children}
          <ProgressTrack>
            <ProgressIndicator />
          </ProgressTrack>
        </span>
      )}
      {...props}
    />
  );
}

function ProgressTrack({ className, ...props }: ProgressPrimitive.Track.Props) {
  return (
    <ProgressPrimitive.Track
      className={cn(
        "relative flex h-progress-height w-full items-center overflow-hidden rounded-full bg-secondary",
        className,
      )}
      data-slot="progress-track"
      render={<span />}
      {...props}
    />
  );
}

function ProgressIndicator({ className, ...props }: ProgressPrimitive.Indicator.Props) {
  return (
    <ProgressPrimitive.Indicator
      data-slot="progress-indicator"
      className={cn("block h-full bg-working", className)}
      render={<span />}
      {...props}
    />
  );
}

export { Progress, ProgressIndicator, ProgressTrack };
