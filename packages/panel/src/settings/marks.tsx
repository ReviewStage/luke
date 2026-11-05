import { SavedTick, SettingsAttentionMark, SettingsChangedMark } from "@repo/ui";
import type { ShownError } from "@repo/ui/reported-failure";
import { ReplayMask } from "@repo/ui/session-replay-marks";

/**
 * The word beside a row's name while its value differs from the default,
 * as VS Code's settings editor says it: what a page's reset would change,
 * said row by row rather than only by the reset appearing. A statement, not
 * a control — the row's own control is where the value moves — and a word
 * rather than a dot, so a reader and a glance read the same thing.
 */
export function ChangedMark(): React.JSX.Element {
  return <SettingsChangedMark />;
}

/**
 * What rides a settings row's name: the Modified word while its value
 * differs from the default, and the Saved tick each time a write of the row's
 * lands (`useSettingWrite`'s `saves`).
 */
export function SettingMarks({
  changed,
  saves,
}: {
  changed: boolean | undefined;
  saves: number;
}): React.JSX.Element {
  return (
    <>
      {changed === true ? <ChangedMark /> : null}
      <SavedTick saves={saves} />
    </>
  );
}

/**
 * The small mark beside a name while the feature it belongs to still needs a
 * hand — the same mark wherever it stands, so one urgency reads the same on
 * the row that supplies the missing thing and on a shortcut whose key
 * answers nothing until it is supplied. It is
 * `@repo/ui`'s alert glyph in the attention ink. A statement, not a control:
 * the words are the hover's and the screen reader's, and the page around it
 * is where the missing thing is explained.
 */
export function AttentionMark({ note }: { note: string }): React.JSX.Element {
  return <SettingsAttentionMark note={note} />;
}

/**
 * A row's error line kept masked in a screen recording, though the page
 * around it shows its own words, because a refusal the host or the service
 * words can quote what a person set or named.
 */
export function replayMaskedError(error: ShownError | undefined): ShownError | undefined {
  // Note that words saying nothing stay as they are, so the row still draws no line for them.
  const { words } = error ?? {};
  if (
    error === undefined ||
    words === undefined ||
    words === null ||
    words === false ||
    words === ""
  ) {
    return error;
  }
  return { ...error, words: <ReplayMask>{words}</ReplayMask> };
}

/* Whether each group holds a value its reset would change, judged from the
   same resolved settings the rows draw — so the mark, the reset, and the row
   always agree on what is standing. The voice and pace compare against the
   shipped defaults the way their menus label them; a launch-environment
   override reads as changed, which is what the row shows too. */
