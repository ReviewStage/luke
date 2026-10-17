import { ArchiveIcon } from "@luke/ui";
import { useState } from "react";
import { BANNER_LOOK, Banner } from "../banner";
import { BusyLabel } from "../spinner";
import type { ArchivedByReading } from "./coding-agent-model";

/**
 * archived-task.tsx -- what an archived task draws where its actions would stand: the banner over its document, and the note in place of an agent's composer.
 *
 * An archived task reads but takes nothing: its document is not edited,
 * no call is about it, no agent starts on it, and no agent of it is sent a
 * message, until it is brought back. So each place that would have taken
 * something says why it does not, with the one press that brings the task
 * back, rather than standing there as a dead control. The banner is the
 * task's call to action, the way Notion marks a page in the trash: the
 * archive glyph, what it means, and Unarchive as the primary button.
 */

/** What the banner and the composer's note say, worded once. */
const ARCHIVED_TASK_COPY = {
  TITLE: "This task is archived",
  COMPOSER: "Unarchive to send messages",
  UNARCHIVE: "Unarchive",
} as const;

/** The banner across the top of an archived task's document, with Unarchive as its primary button. */
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
          {ARCHIVED_TASK_COPY.UNARCHIVE}
        </button>
      }
    >
      <p className="document-banner-title">{ARCHIVED_TASK_COPY.TITLE}</p>
    </Banner>
  );
}

/**
 * What stands in an agent's composer's place while its plan, or the agent
 * itself, is archived: why nothing is sent, and Unarchive, after who
 * archived the agent and why where it was the agent that was archived. An
 * agent still running when its plan was archived finishes the turn it is
 * on, so its Stop stands beside them.
 */
export function ArchivedComposerNote({
  onUnarchive,
  stop,
  archivedBy,
}: {
  onUnarchive: () => void;
  /** Who archived the agent and why, where the agent itself was archived and the service said. */
  archivedBy?: ArchivedByReading | undefined;
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
            {ARCHIVED_TASK_COPY.UNARCHIVE}
          </button>
        </>
      }
    >
      <div className="archived-composer-words">
        {archivedBy === undefined ? null : (
          <p className="archived-composer-by">
            {archivedBy.words}
            {archivedBy.reason === undefined ? null : `: ${archivedBy.reason}`}
          </p>
        )}
        <p className="archived-composer-line">{ARCHIVED_TASK_COPY.COMPOSER}</p>
      </div>
    </Banner>
  );
}
