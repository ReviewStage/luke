import {
  ArchiveIcon,
  BANNER_LOOK,
  Banner,
  BUTTON_VARIANT,
  Button,
  TEXT_TONE,
  Text,
} from "@luke/ui";
import { useState } from "react";
import type { ArchivedByReading } from "./coding-agent-model.js";

/**
 * archived-note.tsx -- what stands in a composer's place while what it writes to is archived: an agent, or a chat's topic.
 *
 * An archived agent reads but takes no message until it is brought back, so
 * its composer says why rather than standing there as a dead control, with
 * the one press that brings it back.
 */

/** What the composer's note says, worded once. */
const ARCHIVED_NOTE_COPY = {
  COMPOSER: "Unarchive to send messages",
  UNARCHIVE: "Unarchive",
  STOP: "Stop",
  STOPPING: "Stopping",
} as const;

/**
 * What stands in an agent's composer's place while the agent is archived:
 * why nothing is sent, and Unarchive, after who archived the agent and why
 * where the service said. An agent still running finishes the turn it is
 * on, so its Stop stands beside them.
 */
export function ArchivedComposerNote({
  onUnarchive,
  stop,
  archivedBy,
  words = ARCHIVED_NOTE_COPY.COMPOSER,
  action = ARCHIVED_NOTE_COPY.UNARCHIVE,
}: {
  onUnarchive: () => void;
  /** Why nothing is sent, where the box it stands in sends something other than a message, as an Inbox item's answer. */
  words?: string;
  /** What the press that brings it back says, where what is archived is no agent, as a chat's topic. */
  action?: string;
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
    <div className="agent-composer">
      <Banner
        look={BANNER_LOOK.ROW}
        glyph={<ArchiveIcon />}
        actions={
          <>
            {stop === undefined ? null : (
              <Button
                busy={stopping}
                busyLabel={ARCHIVED_NOTE_COPY.STOPPING}
                onClick={() => pressStop(stop)}
              >
                {ARCHIVED_NOTE_COPY.STOP}
              </Button>
            )}
            <Button variant={BUTTON_VARIANT.PRIMARY} onClick={onUnarchive}>
              {action}
            </Button>
          </>
        }
      >
        {archivedBy === undefined ? null : (
          <Text>
            {archivedBy.words}
            {archivedBy.reason === undefined ? null : `: ${archivedBy.reason}`}
          </Text>
        )}
        <Text tone={TEXT_TONE.MUTED}>{words}</Text>
      </Banner>
    </div>
  );
}
