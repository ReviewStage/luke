import type { FeedbackKind } from "@sidecar/feedback";
import { FEEDBACK_KIND } from "@sidecar/feedback";
import { cssCustomProperties } from "@sidecar/surface/react-css";
import { FEEDBACK_COPY, type FeedbackEntryControl } from "./feedback-entry";
import { CheckIcon, MegaphoneIcon } from "./settings-icons";
import { SETTINGS_SEARCH_ROW, searchAnchorProps } from "./settings-search";

/**
 * One button that offers a kind: its name is the whole line, and pressing it
 * opens the composer on it. No sentence under it — the composer's own shape is
 * where each kind explains itself. The button says "keep writing" when a draft
 * of this kind is waiting, because pressing it then continues rather than
 * opens.
 */
function FeedbackOffer({
  kind,
  control,
}: {
  kind: FeedbackKind;
  control: FeedbackEntryControl;
}): React.JSX.Element {
  const copy = FEEDBACK_COPY[kind];
  const holdsDraft = control.entry?.kind === kind;
  return (
    <button
      type="button"
      className="quiet-button feedback-offer"
      onClick={() => control.begin(kind)}
    >
      {holdsDraft ? "Keep writing" : copy.title}
    </button>
  );
}

/**
 * The two ways to write to the people who make Luke, side by side on one row,
 * standing on the settings front page above the account and the way out. The
 * section only offers — pressing either button stands the panel down to the
 * composer's own shape, the way pressing Connect stands it down to the key
 * slot — and the line under the offers is where a landed send reports back,
 * which is why leaving the composer comes back to this page rather than to
 * wherever it was last.
 */
export function FeedbackSection({ control }: { control: FeedbackEntryControl }): React.JSX.Element {
  return (
    <section
      className="settings-section"
      style={cssCustomProperties({ "--row-index": 4 })}
      {...searchAnchorProps(SETTINGS_SEARCH_ROW.FEEDBACK)}
    >
      <h2>
        <MegaphoneIcon />
        Feedback
      </h2>
      <div className="feedback-offers">
        <FeedbackOffer kind={FEEDBACK_KIND.FEEDBACK} control={control} />
        <FeedbackOffer kind={FEEDBACK_KIND.PROMPT} control={control} />
      </div>
      {control.notice ? (
        <p className="feedback-sent">
          <CheckIcon />
          {control.notice}
        </p>
      ) : null}
    </section>
  );
}
