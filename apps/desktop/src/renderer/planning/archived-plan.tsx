import { ArchiveIcon } from "@sidecar/panel";
import { useState } from "react";

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
  TITLE: "This plan is archived",
  DETAIL: "Unarchive it to edit, talk with Luke, or start agents.",
  COMPOSER: "Unarchive to send messages",
  UNARCHIVE: "Unarchive",
} as const;

/** The banner across the top of an archived plan's document, with Unarchive as its primary button. */
export function ArchivedBanner({ onUnarchive }: { onUnarchive: () => void }): React.JSX.Element {
  return (
    <section className="archived-banner" aria-label={ARCHIVED_PLAN_COPY.TITLE}>
      <span className="archived-banner-glyph" aria-hidden="true">
        <ArchiveIcon />
      </span>
      <div className="archived-banner-words">
        <p className="archived-banner-title">{ARCHIVED_PLAN_COPY.TITLE}</p>
        <p className="archived-banner-detail">{ARCHIVED_PLAN_COPY.DETAIL}</p>
      </div>
      <button type="button" className="primary-button" onClick={onUnarchive}>
        {ARCHIVED_PLAN_COPY.UNARCHIVE}
      </button>
    </section>
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
    <div className="agent-composer archived-composer">
      <p className="archived-composer-line">
        <ArchiveIcon />
        <span>{ARCHIVED_PLAN_COPY.COMPOSER}</span>
      </p>
      {stop === undefined ? null : (
        <button
          type="button"
          className="toolbar-button"
          disabled={stopping}
          onClick={() => pressStop(stop)}
        >
          {stopping ? "Stopping…" : "Stop"}
        </button>
      )}
      <button type="button" className="primary-button" onClick={onUnarchive}>
        {ARCHIVED_PLAN_COPY.UNARCHIVE}
      </button>
    </div>
  );
}
