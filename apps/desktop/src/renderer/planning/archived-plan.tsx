import { ArchiveIcon } from "@luke/ui";
import { useState } from "react";
import { BANNER_LOOK, Banner } from "../banner";
import { BusyLabel } from "../spinner";

/**
 * archived-plan.tsx -- what an archived plan draws where its actions would stand: the banner over its document, and the note in place of an agent's composer.
 *
 * An archived plan reads but takes nothing: its document is not edited,
 * no call is about it, no agent starts on it, and no agent of it is sent a
 * message, until it is brought back. So each place that would have taken
 * something says why it does not, with the one press that brings the plan
 * back, rather than standing there as a dead control. The banner is the
 * plan's call to action, the way Notion marks a page in the trash: the
 * archive glyph, what it means, and Unarchive as the primary button.
 */

/** What the banner and the composer's note say, worded once. */
const ARCHIVED_PLAN_COPY = {
  TITLE: "This task is archived",
  COMPOSER: "Unarchive to send messages",
  UNARCHIVE: "Unarchive",
} as const;

/** The banner across the top of an archived plan's document, with Unarchive as its primary button. */
export function ArchivedBanner({ onUnarchive }: { onUnarchive: () => void }): React.JSX.Element {
  return (
    <Banner
      look={BANNER_LOOK.CARD}
      className="archived-banner"
      glyph={
        <span className="document-banner-glyph" aria-hidden="true">
          <ArchiveIcon />
        </span>
      }
      actions={
        <button type="button" className="primary-button" onClick={onUnarchive}>
          {ARCHIVED_PLAN_COPY.UNARCHIVE}
        </button>
      }
    >
      <p className="document-banner-title">{ARCHIVED_PLAN_COPY.TITLE}</p>
    </Banner>
  );
}

/**
 * What stands in an agent's composer's place while its plan is archived:
 * why nothing is sent, and Unarchive. An agent still running when its plan
 * was archived finishes the turn it is on, so its Stop stands beside them.
 */
export function ArchivedComposerNote({
  onUnarchive,
  stop,
}: {
  onUnarchive: () => void;
  /** Stops the agent, while it has a turn to stop; settles once the service has answered. */
  stop?: (() => Promise<void>) | undefined;
}): React.JSX.Element {
  const [stopping, setStopping] = useState(false);
  const pressStop = (run: () => Promise<void>) => {
    setStopping(true);
    run().finally(() => setStopping(false));
  };
  return (
    <Banner
      look={BANNER_LOOK.COMPOSER}
      glyph={<ArchiveIcon />}
      actions={
        <>
          {stop === undefined ? null : (
            <button
              type="button"
              className="toolbar-button"
              disabled={stopping}
              onClick={() => pressStop(stop)}
            >
              <BusyLabel busy={stopping} label="Stopping">
                Stop
              </BusyLabel>
            </button>
          )}
          <button type="button" className="primary-button" onClick={onUnarchive}>
            {ARCHIVED_PLAN_COPY.UNARCHIVE}
          </button>
        </>
      }
    >
      <p className="archived-composer-line">{ARCHIVED_PLAN_COPY.COMPOSER}</p>
    </Banner>
  );
}
