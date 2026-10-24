import type { ReactNode } from "react";
import { cn } from "../../cn.js";
import { ShadcnSpinner } from "../../shadcn/spinner.js";
import { useSettled } from "./settle-wait.js";

/**
 * spinner.tsx -- the one spinner for a wait: a ring turning while something is read or a press is out.
 *
 * Every wait is drawn with this one ring, so a region still reading, a menu
 * still listing, and a button whose press is out read as one object. The
 * ring is an arc in the ink around it over a faint track, and holds still on
 * `--luke-loop-motion` under reduced motion and a capture run, still reading as a
 * wait. Its words are said to a reader alone, in a fixed phrase ("Loading
 * transcript"), from a status line that stands from the start, empty until
 * the ring shows, because a reader announces a line filling more surely than
 * one arriving.
 *
 * A wait shows its ring only once it has stood a moment (`--luke-settle-delay`,
 * 180ms, `settle-wait.ts`), because a ring that flashes for a read that
 * landed at once is noise; each mount waits afresh, and its status line stands
 * from the start. A wait whose ring must stand at once says `delay={false}`.
 *
 * The ring itself is shadcn/ui's spinner (`../../shadcn/spinner.tsx`), drawn
 * in Tailwind utilities over the theme; `spinner.css` keeps the turn and the
 * stroke a region's ring takes, a keyframe and a custom property one element
 * sets for another. Every ring a wait draws, a busy button's among them, is
 * this one, turning at its one speed.
 */

/** How large the ring is drawn: on a caption's line, beside words or inside a control, or alone in a region. */
export const SPINNER_SIZE = {
  SMALL: "small",
  INLINE: "inline",
  REGION: "region",
} as const;

export type SpinnerSize = (typeof SPINNER_SIZE)[keyof typeof SPINNER_SIZE];

/** The ring's box: 12px on a caption's line, 16px beside words or inside a control, 22px alone in a region, in the muted ink a wait is said in. */
const SPINNER_BOX =
  "luke-spinner inline-flex flex-none size-spinner text-muted-foreground data-[size=small]:size-spinner-small data-[size=region]:size-spinner-region";

/** The ring's box inside a busy control, in the control's own ink, standing in the one cell it shares with the control's words. */
const BUSY_SPINNER_BOX = "luke-spinner inline-flex flex-none size-spinner col-start-1 row-start-1";

/**
 * The ring alone, decorative: a mark that is itself the wait, such as a
 * sign-in waiting on the browser, filling the box it stands in, or drawn at
 * `size` where words beside it already say the wait.
 */
export function SpinnerRing({ size }: { size?: SpinnerSize }): React.JSX.Element {
  const ring = <ShadcnSpinner />;
  if (size === undefined) return ring;
  return (
    <span className={SPINNER_BOX} data-size={size} aria-hidden="true">
      {ring}
    </span>
  );
}

/** A wait, said to a reader in `label` and drawn as the ring, once it has stood a moment unless `delay` is off. */
export function Spinner({
  label,
  size = SPINNER_SIZE.INLINE,
  delay = true,
}: {
  label: string;
  size?: SpinnerSize;
  delay?: boolean;
}): React.JSX.Element {
  const settled = useSettled(delay);
  return (
    <span className={SPINNER_BOX} data-size={size} role="status">
      {delay && !settled ? null : <SpinnerRing />}
      <span className="luke-visually-hidden">{label}</span>
    </span>
  );
}

/** A region still being read: the ring at the region's size, centred in the room it fills. */
export function SpinnerRegion({
  label,
  delay = true,
}: {
  label: string;
  delay?: boolean;
}): React.JSX.Element {
  return (
    <div className="luke-spinner-region flex min-h-0 flex-1 items-center justify-center self-stretch p-spinner-region-inset">
      <Spinner label={label} size={SPINNER_SIZE.REGION} delay={delay} />
    </div>
  );
}

/**
 * A control's words, which give way to the ring once the press has been out
 * a moment while `busy`, or at once where `delay` is off. The words keep
 * their room, hidden under the ring, so the control neither shrinks nor
 * moves what stands beside it, and the control is named by `label`
 * ("Checking for updates") from the press on, since hidden words name nothing.
 */
export function BusyLabel({
  busy,
  label,
  delay = true,
  children,
}: {
  busy: boolean;
  label: string;
  delay?: boolean;
  children: ReactNode;
}): React.JSX.Element {
  const settled = useSettled(busy && delay);
  if (!busy) return <>{children}</>;
  const ringShown = !delay || settled;
  return (
    <span className="luke-busy-label inline-grid items-center justify-items-center gap-[inherit]">
      <span
        className={cn(
          "luke-busy-label-words col-start-1 row-start-1 inline-flex items-center gap-[inherit]",
          ringShown && "invisible",
        )}
      >
        {children}
      </span>
      {ringShown ? (
        <span className={BUSY_SPINNER_BOX} data-size={SPINNER_SIZE.INLINE}>
          <SpinnerRing />
        </span>
      ) : null}
      <span className="luke-visually-hidden">{label}</span>
    </span>
  );
}
