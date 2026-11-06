import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CheckIcon } from "../../face/glyphs.js";
import { runningMotions } from "../../use-disclosure.js";
import { ANNOUNCE, announce, type Retire } from "../announcer/announcer.js";

const SAVED = "Saved";

export function SavedTick({ saves }: { saves: number }): React.JSX.Element {
  const [seen, setSeen] = useState(saves);
  const [landed, setLanded] = useState(0);
  const [standing, setStanding] = useState(false);
  if (saves !== seen) {
    setSeen(saves);
    if (saves > seen) {
      setLanded(landed + 1);
      setStanding(true);
    }
  }
  const tick = useRef<HTMLSpanElement | null>(null);
  const said = useRef(0);
  const taken = useRef<Retire>(() => undefined);
  useEffect(() => {
    if (landed === said.current) return;
    said.current = landed;
    taken.current();
    taken.current = announce(ANNOUNCE.POLITE, SAVED);
  }, [landed]);
  useEffect(() => {
    if (!standing) taken.current();
  }, [standing]);
  useEffect(() => () => taken.current(), []);

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
  }, [standing, landed]);

  return (
    <span className="ui-saved-tick-region inline-flex min-w-0">
      {standing ? (
        <span
          key={landed}
          ref={tick}
          className="ui-saved-tick inline-flex items-center gap-ui-4 font-ui text-caption font-caption whitespace-nowrap text-muted-foreground [&>svg]:size-caption-leading [&>svg]:flex-none [&>svg]:text-complete"
        >
          <CheckIcon />
          {SAVED}
        </span>
      ) : null}
    </span>
  );
}
