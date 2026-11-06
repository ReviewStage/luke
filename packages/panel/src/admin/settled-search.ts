import { useAtom } from "@effect/atom-react";
import { Duration, Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useEffect, useState } from "react";
import { rendererRuntime } from "../renderer-runtime.js";
import { SEARCH_DEBOUNCE_MS } from "./routing.js";

const restAtom = () =>
  rendererRuntime.fn((term: string | undefined) =>
    Effect.as(Effect.sleep(Duration.millis(SEARCH_DEBOUNCE_MS)), term),
  );

export function useSettledSearch(term: string | undefined): string | undefined {
  const [atom] = useState(restAtom);
  const [opened] = useState(term);
  const [rested, rest] = useAtom(atom);
  useEffect(() => {
    rest(term);
  }, [term, rest]);
  return AsyncResult.isSuccess(rested) ? rested.value : opened;
}
