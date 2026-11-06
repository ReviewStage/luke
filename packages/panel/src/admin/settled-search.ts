/**
 * settled-search.ts -- a typed search once the typing has rested on it, which the Users and Workspaces reads are keyed by.
 */

import { useAtom } from "@effect/atom-react";
import { Duration, Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useEffect, useState } from "react";
import { rendererRuntime } from "../renderer-runtime.js";
import { SEARCH_DEBOUNCE_MS } from "./routing.js";

/**
 * A term once it has stood the pause, as an atom whose work is the wait:
 * setting it again starts the wait over, so only the newest term rests.
 */
const restAtom = () =>
  rendererRuntime.fn((term: string | undefined) =>
    Effect.as(Effect.sleep(Duration.millis(SEARCH_DEBOUNCE_MS)), term),
  );

/**
 * The search a read asks for: the term the screen opened on at once, then
 * each later term once the typing has rested on it, so a typed word
 * coalesces into one read rather than one per keystroke while the box
 * filters the loaded rows itself.
 */
export function useSettledSearch(term: string | undefined): string | undefined {
  const [atom] = useState(restAtom);
  const [opened] = useState(term);
  const [rested, rest] = useAtom(atom);
  useEffect(() => {
    rest(term);
  }, [term, rest]);
  return AsyncResult.isSuccess(rested) ? rested.value : opened;
}
