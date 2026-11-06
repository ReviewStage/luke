import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import { cn } from "../cn.js";

function Progress({ className, children, value, ...props }: ProgressPrimitive.Root.Props) {
  return (
    <ProgressPrimitive.Root
      value={value}
      data-slot="progress"
      className={cn("block w-full max-w-progress", className)}
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
