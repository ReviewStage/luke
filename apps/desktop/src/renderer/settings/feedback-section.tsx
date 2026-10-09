import { FEEDBACK_KIND, type FeedbackKind } from "@sidecar/feedback";
import { MegaphoneIcon } from "@sidecar/panel";
import { cssCustomProperties } from "@sidecar/surface/react-css";
import { FEEDBACK_COPY } from "../feedback-dialog";
import { SETTINGS_SEARCH_ROW, searchAnchorProps } from "../settings-anchors";

/**
 * The two ways to write to the people who make Luke, side by side on one row,
 * standing on the settings front page above the account. The section only
 * offers: each button opens the dialog for its kind, which is where the note
 * is written and where it explains itself.
 */
export function FeedbackSection({
  onOpen,
}: {
  onOpen: (kind: FeedbackKind) => void;
}): React.JSX.Element {
  return (
    <section
      className="settings-section"
      style={cssCustomProperties({ "--row-index": 3 })}
      {...searchAnchorProps(SETTINGS_SEARCH_ROW.FEEDBACK)}
    >
      <h2>
        <MegaphoneIcon />
        Feedback
      </h2>
      <div className="feedback-offers">
        {[FEEDBACK_KIND.FEEDBACK, FEEDBACK_KIND.PROMPT].map((kind) => (
          <button
            key={kind}
            type="button"
            className="toolbar-button"
            aria-haspopup="dialog"
            onClick={() => onOpen(kind)}
          >
            {FEEDBACK_COPY[kind].title}
          </button>
        ))}
      </div>
    </section>
  );
}
