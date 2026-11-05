import { type ReactNode, useState } from "react";
import { SPINNER_SIZE, SpinnerRing } from "../spinner/spinner.js";

/**
 * arrival.tsx -- a region's content arriving from its first read: nothing at first, one quiet line once the wait has stood a while, and the content fading in as it lands.
 *
 * Most reads land at once, and a placeholder drawn for one that does is
 * noise, so a wait draws nothing until it has stood `--ui-late-delay` (a
 * second), and then one muted line, the ring before its words ("Reading
 * your tasks…"), where the content will stand. The line is a status from
 * the start, so a reader hears it as it shows. Content that lands after a
 * wait fades in over `--ui-duration-quick`, so the page does not jump into
 * place; content standing from the start, as a list a disk kept, draws as it
 * is. The region lays nothing out: its content stands in its container's
 * own flow, as it would without it.
 */

/** A region's content, or while `reading` the line `label` says once the wait has stood a while. */
export function Arrival({
  reading,
  label,
  children,
}: {
  reading: boolean;
  /** What is being read, said to a reader from the start and shown once the wait has stood a while. */
  label: string;
  children: ReactNode;
}): React.JSX.Element {
  // Note that only content that waited fades in, because content standing from the start has nothing to arrive from.
  const [waited, setWaited] = useState(reading);
  if (reading && !waited) setWaited(true);
  if (reading) {
    return (
      <p className="ui-arrival-wait" role="status">
        <SpinnerRing size={SPINNER_SIZE.SMALL} />
        <span>{label}</span>
      </p>
    );
  }
  return (
    <div className="ui-arrival" data-waited={waited ? "" : undefined}>
      {children}
    </div>
  );
}
