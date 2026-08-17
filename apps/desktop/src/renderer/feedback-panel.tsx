import type { FeedbackKind } from "../shared/feedback";
import { FEEDBACK_KIND } from "../shared/feedback";
import { FEEDBACK_COPY, type FeedbackEntryControl } from "./feedback-entry";
import { CheckIcon, MegaphoneIcon } from "./settings-icons";

/**
 * One line that offers a kind: its name and the button that opens the
 * composer on it. No sentence under it — the composer's own shape is where
 * each kind explains itself. The button says "keep writing" when a draft of
 * this kind is waiting, because pressing it then continues rather than opens.
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
    <div className="settings-row">
      <span className="settings-copy">
        <strong>{copy.title}</strong>
      </span>
      <span className="settings-actions">
        <button type="button" className="quiet-button" onClick={() => control.begin(kind)}>
          {holdsDraft ? "Keep writing" : copy.opener}
        </button>
      </span>
    </div>
  );
}

/**
 * The last section of the settings front page: the two ways to write to the
 * people who make Luke. The section only offers — pressing either button stands the
 * panel down to the composer's own shape, the way pressing Connect stands it
 * down to the key slot — and the line under the offers is where a landed send
 * reports back.
 */
export function FeedbackSection({ control }: { control: FeedbackEntryControl }): React.JSX.Element {
  return (
    <section className="settings-section" style={{ "--row-index": 3 } as React.CSSProperties}>
      <h2>
        <MegaphoneIcon />
        Feedback
      </h2>
      <FeedbackOffer kind={FEEDBACK_KIND.FEEDBACK} control={control} />
      <FeedbackOffer kind={FEEDBACK_KIND.PROMPT} control={control} />
      {control.notice ? (
        <p className="feedback-sent">
          <CheckIcon />
          {control.notice}
        </p>
      ) : null}
    </section>
  );
}
