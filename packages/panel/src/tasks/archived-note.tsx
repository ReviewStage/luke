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
import { COMPOSER_ROOM_CLASS } from "./agent-composer.js";
import type { ArchivedByReading } from "./coding-agent-model.js";

/**
 * archived-note.tsx -- what stands in a composer's place while the agent it writes to is archived.
 *
 * An archived agent reads but takes no message until it is brought back, so
 * its composer says why rather than standing there as a dead control, with
 * the one press that brings it back.
 */

/** What the composer's note says, worded once. */
const ARCHIVED_NOTE_COPY = {
  COMPOSER: "Unarchive to send messages",
  UNARCHIVE: "Unarchive",
  UNARCHIVING: "Unarchiving",
  STOP: "Stop",
  STOPPING: "Stopping",
} as const;

/** The two presses the note waits on, of which one is out at a time. */
const ARCHIVED_PRESS = { STOP: "stop", UNARCHIVE: "unarchive" } as const;
type ArchivedPress = (typeof ARCHIVED_PRESS)[keyof typeof ARCHIVED_PRESS];

/**
 * What stands in an agent's composer's place while the agent is archived:
 * why nothing is sent, and Unarchive, after who archived the agent and why
 * where the service said. An agent still running finishes the turn it is
 * on, so its Stop stands beside them. A press that waits on the service
 * shows busy until it settles, and the other waits meanwhile.
 */
export function ArchivedComposerNote({
  onUnarchive,
  stop,
  archivedBy,
}: {
  onUnarchive: () => void | Promise<void>;
  /** Who archived the agent and why, where the agent itself was archived and the service said. */
  archivedBy?: ArchivedByReading | undefined;
  /** Stops the agent, while it has a turn to stop; settles once the service has answered. */
  stop?: (() => Promise<void>) | undefined;
}): React.JSX.Element {
  const [out, setOut] = useState<ArchivedPress | undefined>(undefined);
  const press = (which: ArchivedPress, run: () => void | Promise<void>) => {
    if (out !== undefined) return;
    const settles = run();
    // Note that a press that answers at once, as one that asks first does, has nothing to wait on.
    if (!(settles instanceof Promise)) return;
    setOut(which);
    settles.finally(() => setOut(undefined));
  };
  return (
    <div className={COMPOSER_ROOM_CLASS}>
      <Banner
        look={BANNER_LOOK.ROW}
        glyph={<ArchiveIcon />}
        actions={
          <>
            {stop === undefined ? null : (
              <Button
                disabled={out === ARCHIVED_PRESS.UNARCHIVE}
                busy={out === ARCHIVED_PRESS.STOP}
                busyLabel={ARCHIVED_NOTE_COPY.STOPPING}
                onClick={() => press(ARCHIVED_PRESS.STOP, stop)}
              >
                {ARCHIVED_NOTE_COPY.STOP}
              </Button>
            )}
            <Button
              variant={BUTTON_VARIANT.PRIMARY}
              disabled={out === ARCHIVED_PRESS.STOP}
              busy={out === ARCHIVED_PRESS.UNARCHIVE}
              busyLabel={ARCHIVED_NOTE_COPY.UNARCHIVING}
              onClick={() => press(ARCHIVED_PRESS.UNARCHIVE, onUnarchive)}
            >
              {ARCHIVED_NOTE_COPY.UNARCHIVE}
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
        <Text tone={TEXT_TONE.MUTED}>{ARCHIVED_NOTE_COPY.COMPOSER}</Text>
      </Banner>
    </div>
  );
}
