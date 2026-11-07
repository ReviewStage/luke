/**
 * settled-search.ts -- a typed search once the typing has rested on it, which the Users and Workspaces reads are keyed by.
 */

import { useWait } from "@repo/ui";
import { Duration, Effect } from "effect";
import { useEffect, useState } from "react";
import { SEARCH_DEBOUNCE_MS } from "./routing.js";

/**
 * The search a read asks for: the term the screen opened on at once, then
 * each later term once the typing has rested on it, so a typed word
 * coalesces into one read rather than one per keystroke while the box
 * filters the loaded rows itself. Each term starts the rest over, so only
 * the newest one rests.
 */
export function useSettledSearch(term: string | undefined): string | undefined {
  const rest = useWait();
  const [rested, setRested] = useState(term);
  useEffect(() => {
    rest.start(
      Effect.andThen(
        Effect.sleep(Duration.millis(SEARCH_DEBOUNCE_MS)),
        Effect.sync(() => setRested(term)),
      ),
    );
  }, [term, rest]);
  return rested;
}
