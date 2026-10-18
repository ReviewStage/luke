import type { Experiment } from "@luke/settings";
import { createContext, useContext } from "react";

/**
 * open-feedback.tsx -- Send feedback about one experiment from anywhere in the window: the way an experiment's row opens the feedback dialog about it.
 *
 * The window's one dialog (`App`'s `FeedbackDialog`) is opened on a context,
 * as Settings is (`open-settings.tsx`), so a row deep in Settings ›
 * Experimental opens it about its own experiment without every surface
 * between threading the opener on. Outside the window, as in a test of one
 * surface, the opener does nothing.
 */

const OpenFeedbackContext = createContext<(about: Experiment) => void>(() => undefined);

/** Hands the window's opener to everything under it. */
export const OpenFeedbackProvider = OpenFeedbackContext.Provider;

/** The window's way to open the feedback dialog about one experiment. */
export function useOpenFeedback(): (about: Experiment) => void {
  return useContext(OpenFeedbackContext);
}
