import type { Experiment } from "@luke/settings";
import { CornerBadge, FoldingButton } from "@luke/ui";
import { FlaskConicalIcon, MessageSquareIcon } from "lucide-react";
import type { MenuAction } from "./desktop/action-menu.js";
import { useOpenFeedback } from "./open-feedback.js";

/**
 * experiment-marks.tsx -- what says a surface is still an experiment: the flask badge on its control, and Send feedback among a page's actions.
 *
 * A control that is still an experiment, New task's Runs on chip, wears the
 * flask Settings › Experimental is listed by as a small badge on its corner,
 * as an app's icon wears a beta badge, rather than a glyph beside it that
 * reads as a press of its own; the control's hint says Experimental. Send
 * feedback is the window's labelled toolbar button, the same box, weight,
 * and glyph as every other act in a page's toolbar, its words folding away
 * where a narrow toolbar folds its acts', and opens the feedback dialog
 * about the page's own experiment.
 */

/** What the badge stands for, said in the hint of the control that wears it. */
export const EXPERIMENTAL = "Experimental";

/** `children`, a control still behind Settings › Experimental, wearing the flask at its corner. */
export function ExperimentBadge({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <CornerBadge mark={<FlaskConicalIcon />}>{children}</CornerBadge>;
}

/** What Send feedback is called, on the toolbar's button and a menu's item alike. */
const SEND_FEEDBACK = "Send feedback";

/** The toolbar's Send feedback: the feedback dialog, about `experiment`. */
export function SendFeedbackButton({ experiment }: { experiment: Experiment }): React.JSX.Element {
  const openFeedback = useOpenFeedback();
  return (
    <FoldingButton
      label={SEND_FEEDBACK}
      icon={<MessageSquareIcon />}
      onClick={() => openFeedback(experiment)}
    />
  );
}

/** Send feedback as a menu's item, as a phone's ⋯ offers it where the toolbar has no room for its button (`phone-head.tsx`). */
export function useSendFeedbackItem(experiment: Experiment): MenuAction {
  const openFeedback = useOpenFeedback();
  return {
    label: SEND_FEEDBACK,
    icon: <MessageSquareIcon />,
    onSelect: () => openFeedback(experiment),
  };
}
