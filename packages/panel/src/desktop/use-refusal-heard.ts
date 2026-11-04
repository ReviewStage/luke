import type { FailureAbout, FailureSurface } from "@repo/features/shown-failure";
import { STATUS_TONE } from "@repo/ui";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useCallback, useEffect, useRef } from "react";
import { TOAST_HOLD, useToast } from "../toast.js";

/**
 * use-refusal-heard.ts -- a confirmed act's refusal said in a toast where the dialog that asked no longer stands to say it.
 *
 * A dialog says its act's refusal itself (`useConfirmDialog`), for as long
 * as its subject and its surface stand. An act the host draws at once, a
 * delete or an archive, can take the row that drew the dialog with it, so
 * the dialog is gone, or its subject is, by the time the service refuses
 * and the row comes back; the dialog's own refusal would then be heard by
 * no one. This hands the act's answer on as it came, and says a refusal in
 * a toast where the dialog that asked was let go or stands no longer.
 */

/** Whatever `result` an act answered, handed on as it came; a refusal said in a toast where the dialog no longer `standing`. */
export function useRefusalHeard(
  standing: boolean,
  failure: { readonly surface: FailureSurface; readonly about?: FailureAbout },
): (result: ActionResult) => ActionResult {
  const toast = useToast();
  // Read as the answer lands, which is renders after the press.
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
