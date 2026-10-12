/**
 * spinner.tsx -- the window's one spinner for a wait: a ring turning while something is read or a press is out.
 *
 * Every wait in the window is drawn with this one ring, so a region still
 * reading, a menu still listing, and a button whose press is out all read
 * as one object. An agent at work is not a wait and wears the working mark
 * instead (`working-mark.tsx`). The ring is an arc in the ink around it over a faint
 * track; reduced motion and a capture run hold it still on
 * `--loop-motion`, which still reads as a wait. A wait shows only once it
 * has stood for `SHOW_DELAY`, because a ring that flashes for a read that
 * landed at once is noise. Its words are said to a reader alone, in a
 * fixed phrase ("Loading transcript"), so nothing of the work rides the
 * attribute the screen recording keeps, and a reader still hears what the
 * old line said.
 */

import { useAtomValue } from "@effect/atom-react";
import { Duration, Effect } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { type ReactNode, useState } from "react";
import { rendererRuntime } from "./renderer-runtime";

/** How large the ring is drawn: beside words or inside a control, or alone in a region. */
export const SPINNER_SIZE = {
  INLINE: "inline",
  REGION: "region",
} as const;

export type SpinnerSize = (typeof SPINNER_SIZE)[keyof typeof SPINNER_SIZE];

/** How long a wait stands before its ring shows: past a read that lands at once, short of a wait anyone notices. */
const SHOW_DELAY = Duration.millis(180);

/** Whether the wait mounted with this hook has stood long enough to show; each mount waits afresh. */
function useWaitShown(): boolean {
  const [wait] = useState(() => rendererRuntime.atom(Effect.sleep(SHOW_DELAY)));
  return AsyncResult.isSuccess(useAtomValue(wait));
}

/** The ring alone, decorative, shown at once: a mark that is itself the wait, a sign-in waiting on the browser or a send that is out. */
export function SpinnerRing({ className }: { className?: string }): React.JSX.Element {
  return (
    <span className={className ? `spinner-ring ${className}` : "spinner-ring"} aria-hidden="true" />
  );
}

/**
 * A wait, said to a reader in `label` and drawn as the ring once it has
 * stood a moment. The status line stands from the start, empty until then,
 * because a reader announces a line filling more surely than one arriving.
 */
export function Spinner({
  label,
  size = SPINNER_SIZE.INLINE,
}: {
  label: string;
  size?: SpinnerSize;
}): React.JSX.Element {
  const shown = useWaitShown();
  return (
    <span className="spinner" data-size={size} role="status">
      {shown ? (
        <>
          <SpinnerRing />
          <span className="visually-hidden">{label}</span>
        </>
      ) : null}
    </span>
  );
}

/** A region still being read: the ring at the region's size, centred in the room it fills. */
export function SpinnerRegion({
  label,
  className,
}: {
  label: string;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={className ? `spinner-region ${className}` : "spinner-region"}>
      <Spinner label={label} size={SPINNER_SIZE.REGION} />
    </div>
  );
}

/** A control's words with the ring standing over them once its wait has stood, `label` naming it to a reader. */
function BusyWords({ label, children }: { label: string; children: ReactNode }): React.JSX.Element {
  const shown = useWaitShown();
  return (
    <span className="busy-label" data-shown={String(shown)}>
      <span className="busy-label-words">{children}</span>
      {shown ? (
        <>
          <span className="spinner" data-size={SPINNER_SIZE.INLINE}>
            <SpinnerRing />
          </span>
          <span className="visually-hidden">{label}</span>
        </>
      ) : null}
    </span>
  );
}

/**
 * A button's words, which give way to the ring while its press is out. The
 * words keep their room, hidden under the ring, so the button neither
 * shrinks nor moves what stands beside it, and the button is named by
 * `label` ("Checking for updates") while the ring stands, since hidden
 * words name nothing.
 */
export function BusyLabel({
  busy,
  label,
  children,
}: {
  busy: boolean;
  label: string;
  children: ReactNode;
}): React.JSX.Element {
  return busy ? <BusyWords label={label}>{children}</BusyWords> : <>{children}</>;
}
