import type { FailureAbout, FailureSurface } from "@repo/features/shown-failure";
import { STATUS_TONE } from "@repo/ui";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useCallback, useEffect, useRef } from "react";
import { TOAST_HOLD, useToast } from "../toast.js";

export function useRefusalHeard(
  standing: boolean,
  failure: { readonly surface: FailureSurface; readonly about?: FailureAbout },
): (result: ActionResult) => ActionResult {
  const toast = useToast();
  const stands = useRef(standing);
  stands.current = standing;
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const { surface, about } = failure;
  return useCallback(
    (result) => {
      if (result.status === ACTION_RESULT_STATUS.ACCEPTED) return result;
      if (mounted.current && stands.current) return result;
      toast({
        words: result.reason,
        tone: STATUS_TONE.DANGER,
        hold: TOAST_HOLD.FAILED,
        failure: { surface, cause: result, about },
      });
      return result;
    },
    [toast, surface, about],
  );
}
