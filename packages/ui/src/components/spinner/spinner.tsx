import type { ReactNode } from "react";

/**
 * spinner.tsx -- the one spinner for a wait: a ring turning while something is read or a press is out.
 *
 * Every wait is drawn with this one ring, so a region still reading, a menu
 * still listing, and a button whose press is out read as one object. The
 * ring is an arc in the ink around it over a faint track, and holds still on
 * `--loop-motion` under reduced motion and a capture run, still reading as a
 * wait. Its words are said to a reader alone, in a fixed phrase ("Loading
 * transcript"), from a status line that stands from the start, empty until
 * the ring shows, because a reader announces a line filling more surely than
 * one arriving.
 *
 * When a wait starts showing is the app's: one that waits a moment before
 * drawing a ring for a read that may land at once says so with `shown`,
 * which is true unless it says otherwise.
 */

/** How large the ring is drawn: beside words or inside a control, or alone in a region. */
export const SPINNER_SIZE = {
  INLINE: "inline",
  REGION: "region",
} as const;

export type SpinnerSize = (typeof SPINNER_SIZE)[keyof typeof SPINNER_SIZE];

/** The ring alone, decorative: a mark that is itself the wait, such as a sign-in waiting on the browser. */
export function SpinnerRing(): React.JSX.Element {
  return <span className="luke-spinner-ring" aria-hidden="true" />;
}

/** A wait, said to a reader in `label` and drawn as the ring while `shown`. */
export function Spinner({
  label,
  size = SPINNER_SIZE.INLINE,
  shown = true,
}: {
  label: string;
  size?: SpinnerSize;
  shown?: boolean;
}): React.JSX.Element {
  return (
    <span className="luke-spinner" data-size={size} role="status">
      {shown ? (
        <>
          <SpinnerRing />
          <span className="luke-visually-hidden">{label}</span>
        </>
      ) : null}
    </span>
  );
}

/** A region still being read: the ring at the region's size, centred in the room it fills. */
export function SpinnerRegion({
  label,
  shown = true,
}: {
  label: string;
  shown?: boolean;
}): React.JSX.Element {
  return (
    <div className="luke-spinner-region">
      <Spinner label={label} size={SPINNER_SIZE.REGION} shown={shown} />
    </div>
  );
}

/**
 * A control's words, which give way to the ring while `busy`. The words
 * keep their room, hidden under the ring, so the control neither shrinks nor
 * moves what stands beside it, and the control is named by `label` ("Checking
 * for updates") while the ring stands, since hidden words name nothing.
 */
export function BusyLabel({
  busy,
  label,
  shown = true,
  children,
}: {
  busy: boolean;
  label: string;
  shown?: boolean;
  children: ReactNode;
}): React.JSX.Element {
  if (!busy) return <>{children}</>;
  return (
    <span className="luke-busy-label" data-shown={shown}>
      <span className="luke-busy-label-words">{children}</span>
      {shown ? (
        <>
          <span className="luke-spinner" data-size={SPINNER_SIZE.INLINE}>
            <SpinnerRing />
          </span>
          <span className="luke-visually-hidden">{label}</span>
        </>
      ) : null}
    </span>
  );
}
