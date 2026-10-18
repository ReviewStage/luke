import { useOpenFeedback } from "@luke/panel/open-feedback";
import type { Experiment } from "@luke/settings";
import { MessageSquareIcon } from "lucide-react";
import { FoldingButton } from "./folding-button";

/**
 * experiment-marks.tsx -- what an experiment's page wears in its toolbar: the Experimental tag after its title, and Send feedback among its actions.
 *
 * Factory, Automations, and an automation's page each say they are an
 * experiment the same way, so the two are drawn here once. The tag reads as
 * a devtool's Beta label rather than a badge that asks for a look: small,
 * neutral, hairlined, and sitting on the title's baseline (`.experiment-tag`
 * in desktop.css). Send feedback is the window's labelled toolbar button,
 * the same box, weight, and glyph as every other act in a page's toolbar,
 * its words folding away where a narrow toolbar folds its acts', and opens
 * the feedback dialog about the page's own experiment.
 */

/** The quiet tag after an experiment's title. */
export function ExperimentTag(): React.JSX.Element {
  return <span className="experiment-tag">Experimental</span>;
}

/** The toolbar's Send feedback: the feedback dialog, about `experiment`. */
export function SendFeedbackButton({ experiment }: { experiment: Experiment }): React.JSX.Element {
  const openFeedback = useOpenFeedback();
  return (
    <FoldingButton
      label="Send feedback"
      icon={<MessageSquareIcon />}
      onClick={() => openFeedback(experiment)}
    />
  );
}
