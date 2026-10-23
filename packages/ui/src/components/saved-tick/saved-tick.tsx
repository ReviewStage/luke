import { useLayoutEffect, useRef, useState } from "react";
import { CheckIcon } from "../../face/glyphs.js";
import { runningMotions } from "../../use-disclosure.js";

/**
 * saved-tick.tsx -- the confirmation an autosave gives once its write lands: a small Saved tick that springs in, stands a moment, and fades.
 *
 * Something that saves itself (a setting written on change, a plan's words
 * saved as they are typed) has no Save button to answer, so its caller
 * counts the writes that landed (`saves`) and the tick says so each time the
 * count moves: it fades and springs in, stands for `--luke-confirm-delay`,
 * and fades out over the exit, held drawn through it and taken once it is
 * done. A count the tick first stands at says nothing, since no write landed
 * while it watched, and a write landing while one stands starts it over. The
 * words stand in a polite live region from the first render, so a reader
 * hears Saved as a sighted one sees it. Reduced motion zeroes its motions
 * but not its stand, so the words are still there to read.
 *
 * It takes no class or style: where it stands, the line after what it
 * confirms, is its caller's.
 */

/** Saved, for a moment, each time `saves` moves. */
export function SavedTick({ saves }: { saves: number }): React.JSX.Element {
  const [seen, setSeen] = useState(saves);
  const [standing, setStanding] = useState(false);
  // Note that the move is taken in the render that sees it, as a disclosure's is, so the tick arrives on that frame.
  if (saves !== seen) {
    setSeen(saves);
    setStanding(true);
  }
  const tick = useRef<HTMLSpanElement | null>(null);

  // Note that the tick is taken once every motion it runs has ended, its
  // exit last, and one cancelled counts as ended; a tick of a later write
  // leaves this effect behind first, which `current` answers.
  useLayoutEffect(() => {
    if (!standing) return undefined;
    const motions = tick.current === null ? [] : runningMotions(tick.current);
    if (motions.length === 0) {
      setStanding(false);
      return undefined;
    }
    let current = true;
    const left = new Set(motions);
    for (const motion of motions) {
      const ended = () => {
        left.delete(motion);
        if (current && left.size === 0) setStanding(false);
      };
      motion.addEventListener("finish", ended, { once: true });
      motion.addEventListener("cancel", ended, { once: true });
    }
    return () => {
      current = false;
    };
  }, [standing, seen]);

  return (
    <span className="luke-saved-tick-region" role="status">
      {standing ? (
        // Note that each write lands a tick of its own, so one landing while another stands starts its motion over.
        <span key={saves} ref={tick} className="luke-saved-tick">
          <CheckIcon />
          Saved
        </span>
      ) : null}
    </span>
  );
}
