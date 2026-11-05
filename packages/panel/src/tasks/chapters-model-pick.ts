import type { ChaptersModelId } from "@repo/features/chapters-model-choice";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { ACT_KIND } from "@repo/host/acts";
import { STATUS_TONE } from "@repo/ui";
import { useCallback, useRef } from "react";
import { useAccountPreferences } from "../account-choices.js";
import { useAct } from "../act.js";
import { showToast, TOAST_HOLD } from "../toast.js";

/**
 * chapters-model-pick.ts -- the Claude model a Generate chapters runs on, as the Chapters view offers it on its Generate and Regenerate: the account's choice, and a pick that keeps it before the Generate after it is asked.
 *
 * The choice is the account's, kept on the service beside the default model
 * (`@repo/features/chapters-model-choice`), which the service reads when the
 * member presses Generate, so a pick here stands for their next Generate on
 * any pull request and any device. The host draws a pick over the account's
 * row as it is made (`LIVE_READ.ACCOUNT_PREFERENCES`), so the menu checks it
 * at once. A Generate asked after a pick waits on that pick's write, because
 * the service reads the model it keeps, and a Generate that overtook the
 * write would run on the model before it. A write the service refuses says
 * so in a toast, the Generate after it running on the model it still keeps.
 */

/** What a pick the service refused says. */
const WRITE_FAILED = "The chapters model could not be saved. Try again.";

/** The model Generate runs on, and the pick that changes it. */
export interface ChaptersModelPick {
  /** The account's choice, where its preferences have been read. */
  readonly model: ChaptersModelId | undefined;
  /** Keeps `model` as the account's choice. */
  readonly choose: (model: ChaptersModelId) => void;
  /** The view's Generate, asked once the pick before it has landed. */
  readonly generate: () => void;
}

/** The account's chapters model and its pick, over the view's own Generate. */
export function useChaptersModelPick(generate: () => void): ChaptersModelPick {
  const { act } = useAct();
  const preferences = useAccountPreferences();
  // Note that the newest pick's write is kept, settled either way, since a Generate waits on it alone.
  const written = useRef<Promise<void>>(Promise.resolve());
  const choose = useCallback(
    (model: ChaptersModelId) => {
      const refused = (cause: unknown) =>
        showToast({
          words: WRITE_FAILED,
          tone: STATUS_TONE.DANGER,
          hold: TOAST_HOLD.FAILED,
          failure: { surface: FAILURE_SURFACE.CHAPTERS_MODEL_WRITE, cause },
        });
      written.current = act(ACT_KIND.CHAPTERS_MODEL_WRITE, { model }).then((answer) => {
        if ("failure" in answer) refused(answer);
      }, refused);
    },
    [act],
  );
  const generateAfter = useCallback(() => {
    void written.current.then(generate);
  }, [generate]);
  return { model: preferences.rows?.chaptersModel, choose, generate: generateAfter };
}
