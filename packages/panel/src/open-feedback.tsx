import type { Experiment } from "@repo/settings";
import { createContext, useContext } from "react";

const OpenFeedbackContext = createContext<(about: Experiment) => void>(() => undefined);

export const OpenFeedbackProvider = OpenFeedbackContext.Provider;

export function useOpenFeedback(): (about: Experiment) => void {
  return useContext(OpenFeedbackContext);
}
