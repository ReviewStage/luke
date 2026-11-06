import {
  ArchiveIcon,
  BANNER_LOOK,
  Banner,
  BUTTON_VARIANT,
  Button,
  TEXT_TONE,
  Text,
} from "@repo/ui";
import { useState } from "react";
import { COMPOSER_ROOM_CLASS } from "./agent-composer.js";
import type { ArchivedByReading } from "./agent-model.js";

const ARCHIVED_NOTE_COPY = {
  COMPOSER: "Unarchive to send messages",
  UNARCHIVE: "Unarchive",
  UNARCHIVING: "Unarchiving",
  STOP: "Stop",
  STOPPING: "Stopping",
} as const;

const ARCHIVED_PRESS = { STOP: "stop", UNARCHIVE: "unarchive" } as const;
type ArchivedPress = (typeof ARCHIVED_PRESS)[keyof typeof ARCHIVED_PRESS];

export function ArchivedComposerNote({
  onUnarchive,
  stop,
  archivedBy,
}: {
  onUnarchive: () => void | Promise<void>;
  archivedBy?: ArchivedByReading | undefined;
  stop?: (() => Promise<boolean>) | undefined;
}): React.JSX.Element {
  const [out, setOut] = useState<ArchivedPress | undefined>(undefined);
  if (out === ARCHIVED_PRESS.STOP && stop === undefined) setOut(undefined);
  const press = (which: ArchivedPress, run: () => unknown) => {
    if (out !== undefined) return;
    const settles = run();
    if (!(settles instanceof Promise)) return;
    setOut(which);
    settles.then(
      (took) => {
        if (which !== ARCHIVED_PRESS.STOP || took !== true) setOut(undefined);
      },
      () => setOut(undefined),
    );
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
