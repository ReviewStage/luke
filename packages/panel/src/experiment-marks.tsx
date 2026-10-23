import type { Experiment } from "@luke/settings";
import { FoldingButton, Tooltip } from "@luke/ui";
import { FlaskConicalIcon, MessageSquareIcon } from "lucide-react";
import { useOpenFeedback } from "./open-feedback.js";

/**
 * experiment-marks.tsx -- what an experiment's page wears in its toolbar: the Experimental tag after its title, and Send feedback among its actions.
 *
 * Automations and an automation's page each say they are an
 * experiment the same way, so the two are drawn here once. The tag reads as
 * a devtool's Beta label rather than a badge that asks for a look: small,
 * neutral, hairlined, and sitting on the title's baseline (`.experiment-tag`
 * in desktop.css); a phone draws its glyph alone. Send feedback is the window's labelled toolbar button,
 * the same box, weight, and glyph as every other act in a page's toolbar,
 * its words folding away where a narrow toolbar folds its acts', and opens
 * the feedback dialog about the page's own experiment.
 */

/** What the tag says, and what its glyph is called where it is drawn alone. */
const EXPERIMENTAL = "Experimental";

/**
 * The quiet tag after an experiment's title; in a narrow room, a phone's,
 * whose header leaves the title little room, the experiment's glyph alone,
 * the flask Settings › Experimental is listed by, still called Experimental
 * and saying so in its hint.
 */
export function ExperimentTag({ narrow = false }: { narrow?: boolean }): React.JSX.Element {
  if (!narrow) return <span className="experiment-tag">{EXPERIMENTAL}</span>;
  return (
    <Tooltip label={EXPERIMENTAL}>
      <span className="experiment-tag" data-glyph="" role="img" aria-label={EXPERIMENTAL}>
        <FlaskConicalIcon aria-hidden="true" />
      </span>
    </Tooltip>
  );
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
